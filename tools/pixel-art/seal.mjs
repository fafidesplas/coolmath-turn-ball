// Seal / unseal the pixel-art atlas (licensed assets) so they never sit in the public repo in usable form.
//   node tools/pixel-art/seal.mjs seal     src/pixel/art/* -> tools/pixel-art/art.sealed (AES-256-GCM)
//   node tools/pixel-art/seal.mjs unseal   tools/pixel-art/art.sealed -> src/pixel/art/*
// Key: PIXEL_ART_KEY (64 hex chars) from the environment (GitHub Actions secret) or the git-ignored
// .pixel-art-key file. `seal` creates the key file the first time.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ART = 'src/pixel/art';
const SEALED = 'tools/pixel-art/art.sealed';
const KEY_FILE = '.pixel-art-key';
const FILES = ['atlas.png', 'atlas.json'];
const MAGIC = Buffer.from('TBPX1');

function key(create) {
  let hex = process.env.PIXEL_ART_KEY?.trim();
  if (!hex && existsSync(KEY_FILE)) hex = readFileSync(KEY_FILE, 'utf8').trim();
  if (!hex && create) { hex = randomBytes(32).toString('hex'); writeFileSync(KEY_FILE, `${hex}\n`, { mode: 0o600 }); console.log(`created ${KEY_FILE}`); }
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    console.error('PIXEL_ART_KEY is missing or invalid: the pixel edition art cannot be unsealed. See tools/pixel-art/README.md.');
    process.exit(1);
  }
  return Buffer.from(hex, 'hex');
}

const mode = process.argv[2];
if (mode === 'seal') {
  const parts = [];
  for (const f of FILES) {
    const data = readFileSync(`${ART}/${f}`);
    const name = Buffer.from(f);
    const head = Buffer.alloc(6);
    head.writeUInt16LE(name.length, 0);
    head.writeUInt32LE(data.length, 2);
    parts.push(head, name, data);
  }
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(true), iv);
  const enc = Buffer.concat([c.update(Buffer.concat(parts)), c.final()]);
  writeFileSync(SEALED, Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]));
  console.log(`sealed ${FILES.join(', ')} -> ${SEALED}`);
} else if (mode === 'unseal') {
  const buf = readFileSync(SEALED);
  if (!buf.subarray(0, 5).equals(MAGIC)) { console.error('not a sealed art file'); process.exit(1); }
  const iv = buf.subarray(5, 17), tag = buf.subarray(17, 33);
  const d = createDecipheriv('aes-256-gcm', key(false), iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(buf.subarray(33)), d.final()]);
  mkdirSync(ART, { recursive: true });
  for (let o = 0; o < plain.length;) {
    const nl = plain.readUInt16LE(o), len = plain.readUInt32LE(o + 2);
    const name = plain.subarray(o + 6, o + 6 + nl).toString();
    if (!FILES.includes(name)) { console.error(`unexpected entry ${name}`); process.exit(1); }
    writeFileSync(`${ART}/${name}`, plain.subarray(o + 6 + nl, o + 6 + nl + len));
    o += 6 + nl + len;
  }
  console.log(`unsealed ${SEALED} -> ${ART}/`);
} else {
  console.error('usage: node tools/pixel-art/seal.mjs seal|unseal');
  process.exit(1);
}
