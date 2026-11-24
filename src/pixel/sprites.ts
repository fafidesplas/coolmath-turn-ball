// Sprite atlas: loading, per-player palette swaps (skin, hair, kit), frame drawing and a tiny digit font.
// The atlas is built from the licensed asset pack by tools/pixel-art/export_atlas.py (never committed).
import atlasUrl from './art/atlas.png?url';
import atlasJsonUrl from './art/atlas.json?url';

/** [x, y, w, h, dx, dy]: rect in the atlas and offset inside the original 64x64 cell (0, 0 for plain crops). */
export type Piece = [number, number, number, number, number, number];
export interface AtlasData {
  size: [number, number];
  frames: number;
  tags: Record<string, [number, number]>;
  durs: number[];
  hairs: string[];
  cell: [number, number];
  p: Record<string, Piece>;
}

export let A: AtlasData;
let sheet: HTMLImageElement;
/** Feet anchor inside the 64x64 cell. */
export const FEET = { x: 32, y: 48 };

export async function loadAtlas() {
  const [data, img] = await Promise.all([
    fetch(atlasJsonUrl).then((r) => r.json() as Promise<AtlasData>),
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('atlas image failed to load'));
      i.src = atlasUrl;
    }),
  ]);
  A = data;
  sheet = img;
  const b = A.p['body:0'];
  FEET.x = b[4] + Math.floor(b[2] / 2);
  FEET.y = b[5] + b[3];
}

export const atlasImage = () => sheet;

// ---------------------------------------------------------------- colors
type RGB = [number, number, number];
const hex = (h: string): RGB => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const scale = (c: RGB, k: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as RGB;
export const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** Team kit. Home plays in a light kit with stripes, away in a dark kit with a headband (shape cue). */
export interface Kit { jersey: string; shade: string; stripe: string | null; stripe2: string | null; band: string | null }
export interface Look { skin: string; hair: string; hairStyle: number; kit: Kit }

/** Stable hair style per player template id (index into the pack's hair layers; -1 = shaved). */
export function hairStyleFor(tid: string) {
  let h = 0;
  for (const c of tid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 6) - 1;
}

const SKIN_KEYS: RGB[] = [[205, 104, 61], [158, 69, 57], [122, 48, 69], [150, 108, 108]];
const HAIR_KEYS: RGB[] = [[46, 34, 47], [62, 53, 70]];
const key = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2];

const cache = new Map<string, HTMLCanvasElement>();

/** A copy of the atlas with this look's colors swapped in (cached). */
export function sheetFor(look: Look): HTMLCanvasElement {
  const id = JSON.stringify(look);
  const hit = cache.get(id);
  if (hit) return hit;
  const map = new Map<number, RGB>();
  const skin = hex(look.skin);
  const base = lum(SKIN_KEYS[0]);
  for (const c of SKIN_KEYS) map.set(key(c), scale(skin, (lum(c) / base) * 0.98));
  const hair = hex(look.hair);
  map.set(key(HAIR_KEYS[0]), hair);
  map.set(key(HAIR_KEYS[1]), scale(hair, 1.25));
  map.set(key([77, 155, 230]), hex(look.kit.jersey));
  map.set(key([77, 101, 180]), hex(look.kit.shade));
  if (look.kit.stripe) map.set(key([254, 254, 254]), hex(look.kit.stripe));
  if (look.kit.stripe2) { map.set(key([232, 59, 59]), hex(look.kit.stripe2)); map.set(key([234, 79, 54]), hex(look.kit.stripe2)); }
  if (look.kit.band) map.set(key([253, 253, 253]), hex(look.kit.band));
  const c = document.createElement('canvas');
  c.width = sheet.width; c.height = sheet.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(sheet, 0, 0);
  // Only the character rows need recoloring; the court and props keep their colors (they are drawn from the plain sheet).
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const to = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (to) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2]; }
  }
  g.putImageData(d, 0, 0);
  cache.set(id, c);
  return c;
}

/** Draw an atlas piece with its cell offset at (x, y) (top-left of the 64x64 cell or of the crop). */
export function drawPiece(g: CanvasRenderingContext2D, src: CanvasImageSource, k: string, x: number, y: number, flip = false) {
  const p = A.p[k];
  if (!p) return false;
  if (!flip) g.drawImage(src, p[0], p[1], p[2], p[3], x + p[4], y + p[5], p[2], p[3]);
  else {
    // Mirror around the cell's feet anchor.
    const fx = x + 2 * FEET.x - p[4] - p[2];
    g.save();
    g.translate(fx + p[2], y + p[5]);
    g.scale(-1, 1);
    g.drawImage(src, p[0], p[1], p[2], p[3], 0, 0, p[2], p[3]);
    g.restore();
  }
  return true;
}

export const hasPiece = (k: string) => !!A.p[k];

/** Frame index inside a tag after `t` seconds, at `ms` per frame (defaults to the file's timing); loops or holds the last frame. */
export function tagFrame(tag: string, t: number, loop: boolean, ms?: number) {
  const [f0, f1] = A.tags[tag];
  const n = f1 - f0 + 1;
  const step = (ms ?? A.durs[f0] ?? 100) / 1000;
  let k = Math.floor(t / step);
  k = loop ? k % n : Math.min(n - 1, k);
  return f0 + k;
}
export const tagLen = (tag: string) => A.tags[tag][1] - A.tags[tag][0] + 1;

/** Index inside the tag of the first frame without the ball after it was held (release frame), or -1. */
export function releaseIndex(tag: string) {
  const [f0, f1] = A.tags[tag];
  let had = false;
  for (let f = f0; f <= f1; f++) {
    const has = !!A.p[`ball:${f}`];
    if (has) had = true;
    else if (had) return f - f0;
  }
  return -1;
}

/** Draw a whole player frame (body, stripes, hair, band, ball, arm on top, effects). */
export function drawPlayer(g: CanvasRenderingContext2D, look: Look, frame: number, x: number, y: number, flip: boolean, ball: boolean) {
  const src = sheetFor(look);
  drawPiece(g, src, `body:${frame}`, x, y, flip);
  if (look.kit.stripe) drawPiece(g, src, `stripes:${frame}`, x, y, flip);
  if (look.hairStyle >= 0) drawPiece(g, src, `${A.hairs[look.hairStyle % A.hairs.length]}:${frame}`, x, y, flip);
  if (look.kit.band) drawPiece(g, src, `band:${frame}`, x, y, flip);
  if (ball) drawPiece(g, sheet, `ball:${frame}`, x, y, flip);
  drawPiece(g, src, `top:${frame}`, x, y, flip);
  drawPiece(g, sheet, `fx:${frame}`, x, y, flip);
}

const avCache = new Map<string, string>();
/** Pixel portrait (head and shoulders) as a data URL. */
export function avatarURL(look: Look) {
  const id = JSON.stringify(look);
  const hit = avCache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 20; c.height = 20;
  const g = c.getContext('2d')!;
  drawPlayer(g, look, 0, -(FEET.x - 10), -(FEET.y - 38), false, false);
  const url = c.toDataURL();
  avCache.set(id, url);
  return url;
}

// ---------------------------------------------------------------- 3x5 digit font
const DIG: Record<string, string> = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '#': '101111101111101', '+': '000010111010000', '%': '101001010100101',
};
/** Width in pixels of a string drawn with pixText. */
export const pixTextW = (s: string) => s.length * 4 - 1;
/** Draw digits with a 1px dark outline. */
export function pixText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, outline = '#1b1029') {
  const draw = (ox: number, oy: number, col: string) => {
    g.fillStyle = col;
    for (let i = 0; i < s.length; i++) {
      const m = DIG[s[i]];
      if (!m) continue;
      for (let k = 0; k < 15; k++) if (m[k] === '1') g.fillRect(x + ox + i * 4 + (k % 3), y + oy + Math.floor(k / 3), 1, 1);
    }
  };
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) draw(ox, oy, outline);
  draw(0, 0, color);
}
