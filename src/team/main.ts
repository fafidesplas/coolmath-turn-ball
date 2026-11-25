// Turn Ball 5v5, playbook mode (page /5v5/). Full court seen from the side, higher and farther than the 1v1
// camera, ten players; each team attacks its own hoop and brings the ball up after every change of possession. You coach: on offense you call a play seeing their scheme, watch it run, and at its key moment pick
// the read that punishes their reaction; on defense you set the scheme and choose the reaction. Eight
// possessions each, most points wins. Rules and odds: rules.ts (the page shows grades and OPEN / CONTESTED /
// TOUGH, never percentages).
import '@fontsource/press-start-2p/400.css';
import '../duel/style.css';
import './style.css';
import { sfx, unlockAudio } from '../audio';
import { pxsfx } from '../pixel/pxsfx';
import { loadAtlas, pixText, releaseIndex } from '../pixel/sprites';
import {
  AWAY, H, HOME, HOOP, W, anim, ball, cheer, dribble, ent, face, jump, move, moveThen, players, proj, say, setCamDist, setCamH, setFeetY, setFullCourt, setSize, shake, startScene,
  swishNet, throwBall, view, wait, type Ent,
} from '../duel/scene';
import {
  AWAY_TEAM, HOME_TEAM, PLAYS, PLAY_INFO, POSSESSIONS, REACTIONS, SCHEMES, SCHEME_INFO, aiPlay, aiReaction, aiRead, aiScheme,
  bestRead, odds, orebChance, playEV, ptsOf, readsFor, type PlayId, type Read, type Scheme, type TP,
} from './rules';

const rnd = Math.random;
/** Normal animation speed (tests raise it). */
let speedBase = 1;
const HZ = HOOP.z;
/**
 * Direction of the attack: +1 toward the right hoop (you), -1 toward the left one (the rival). Plays are written
 * for a half court with the hoop at x 12.425; cx() maps that x to the attacked end of the full court.
 */
let dir: 1 | -1 = 1;
const cx = (x: number) => 14 + dir * x;
let HX = cx(12.425);
function setDir(off: 0 | 1) { dir = off === 0 ? 1 : -1; HX = cx(12.425); }

// ---------------------------------------------------------------- page
// A bigger canvas than the 1v1 (same-size players, more court around them).
setSize(320, 180);
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="stage">
    <canvas width="${W}" height="${H}" aria-label="Side view of a street court: five against five"></canvas>
    <div class="word" aria-live="polite"></div>
    <div class="score"><span class="sc you"><i class="mk home"></i>SUN <b id="s0">0</b></span><span class="to" id="possn"></span><span class="sc them"><b id="s1">0</b> RIVAL<i class="mk away"></i></span></div>
    <a class="modes" href="../menu/">&#9776; MODES</a>
    <button class="cam" id="cam" aria-label="Camera angle"></button>
  </div>
  <div class="cmd" id="cmd">
    <div class="c-head"><span class="c-title" id="ctitle"></span><span class="c-scheme" id="cscheme"></span></div>
    <div class="c-read" id="cread"></div>
    <div class="c-rows" id="crows" role="menu"></div>
    <div class="c-line" id="cline" aria-live="polite"></div>
  </div>`;
const canvas = app.querySelector('canvas')!;
const $ = (id: string) => document.getElementById(id)!;
function fit() {
  const k = Math.max(1, Math.floor(Math.min((innerWidth - 32) / W, (innerHeight - 250) / H)));
  canvas.style.width = `${W * k}px`;
  canvas.style.height = `${H * k}px`;
  $('cmd').style.width = `${Math.max(W * k, 320)}px`;
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- command window (rows)
interface Row { key: string; name: string; big: string; small?: string; line: string; tone?: 'good' | 'bad' }
let rows: Row[] = [];
let curRow = 0;
let pending: ((key: string) => void) | null = null;
/** Called when the cursor lands on a row (draws that option's routes on the court). */
let onFocus: ((key: string) => void) | null = null;
function ask(title: string, read: string, list: Row[], focus?: (key: string) => void): Promise<string> {
  rows = list;
  onFocus = focus ?? null;
  $('ctitle').innerHTML = title;
  $('cread').innerHTML = read;
  $('crows').innerHTML = list.map((r, i) => `
    <button class="c-row" role="menuitem" data-i="${i}">
      <span class="c-hand" aria-hidden="true">&#9658;</span><span class="c-name">${r.name}</span>
      <span class="c-small ${r.tone ?? ''}">${r.small ?? ''}</span><span class="c-big">${r.big}</span>
    </button>`).join('');
  focusRow(0, true);
  $('cmd').classList.add('live');
  return new Promise((res) => { pending = res; });
}
function focusRow(i: number, quiet = false) {
  if (i < 0 || i >= rows.length) return;
  curRow = i;
  $('crows').querySelectorAll('.c-row').forEach((b, k) => b.classList.toggle('cur', k === i));
  $('cline').textContent = rows[i].line;
  onFocus?.(rows[i].key);
  if (!quiet) sfx.tick();
}
function choose(i: number) {
  const r = rows[i];
  if (!r || !pending) return;
  sfx.tap();
  const p = pending;
  pending = null;
  onFocus = null;
  $('cmd').classList.remove('live');
  p(r.key);
}
function idle(title: string, read = '') {
  $('ctitle').innerHTML = title;
  $('cread').innerHTML = read;
  $('crows').innerHTML = '';
  $('cline').textContent = '';
}
$('crows').addEventListener('click', (e) => {
  unlockAudio();
  const b = (e.target as HTMLElement).closest<HTMLElement>('.c-row');
  if (b) choose(+b.dataset.i!);
});
$('crows').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const b = (e.target as HTMLElement).closest<HTMLElement>('.c-row');
  if (b && +b.dataset.i! !== curRow) focusRow(+b.dataset.i!);
});
addEventListener('keydown', (e) => {
  if (!pending) return;
  const n = rows.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); focusRow((curRow + 1) % n); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); focusRow((curRow - 1 + n) % n); }
  else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { e.preventDefault(); unlockAudio(); choose(curRow); }
  else { const d = parseInt(e.key, 10); if (d >= 1 && d <= n) { e.preventDefault(); if (curRow === d - 1) choose(d - 1); else focusRow(d - 1); } }
});

const stars = (n: number) => '&#9733;'.repeat(n) + '<span class="off">' + '&#9733;'.repeat(5 - n) + '</span>';
/**
 * Grades are relative to the other options in the same menu: the best one for you is A, and each step down is a
 * clear drop in expected points. On defense the value is what they get, so lower is better.
 */
function grades(vs: number[], forDefense = false): string[] {
  const u = forDefense ? vs.map((v) => -v) : vs;
  const best = Math.max(...u);
  return u.map((v) => { const d = best - v; const g = d <= 0.04 ? 'A' : d <= 0.12 ? 'B' : d <= 0.22 ? 'C' : 'D'; return `<span class="grade g${g}">${g}</span>`; });
}
const Q_WORD = { open: 'OPEN', contested: 'CONTESTED', tough: 'TOUGH' };
const qHTML = (q: keyof typeof Q_WORD) => `<span class="qual q-${q}">${Q_WORD[q]}</span>`;

// ---------------------------------------------------------------- teams on the court
const TEAMS: [TP[], TP[]] = [HOME_TEAM, AWAY_TEAM];
const ents: Ent[][] = TEAMS.map((t, k) => t.map((p, i) => ent({ skin: p.skin, hair: p.hair, hairStyle: p.hairStyle, kit: k === 0 ? HOME : AWAY }, 4 + i, 3 + i * 1.6, 'Idle')));
players.length = 0;
players.push(...ents[0], ...ents[1]);
const plOf = new Map<Ent, TP>();
ents.forEach((es, k) => es.forEach((e, i) => plOf.set(e, TEAMS[k][i])));

/**
 * Offense spots, spread over the whole width like a real half-court set: point guard at the top of the arc,
 * the two wings and the near corner behind the three-point line, the center outside the paint on the far side.
 */
const SPOT = [{ x: 5.4, z: 7.5 }, { x: 7.2, z: 12.2 }, { x: 7.2, z: 2.8 }, { x: 12.9, z: 14.2 }, { x: 11.6, z: 3.6 }];
/** A defender's spot between his man and the rim (sag = meters toward the rim). */
function guardSpot(m: { x: number; z: number }, sag = 0.9) {
  const dx = HX - m.x, dz = HZ - m.z, l = Math.hypot(dx, dz) || 1;
  // A little deeper into the picture than his man, so the two sprites do not sit on top of each other.
  return { x: m.x + (dx / l) * sag + dir * 0.3, z: m.z + (dz / l) * sag - 0.6 };
}

let holder: Ent | null = null;
function give(e: Ent | null) {
  ball.free = false; ball.flight = null; ball.bounce = null;
  for (const p of players) p.ball = p === e;
  holder = e;
}

/** Run (or slide) to a spot; resolves on arrival. */
/** Players posting up: they hold the ball with their back to the rim. */
const posting = new Set<Ent>();
/** A stable number per player for his style (which dribble move, which dunk, which jumper). */
const styleOf = (e: Ent) => { const n = plOf.get(e)!.name; let h = 7; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const isBig = (e: Ent) => { const p = plOf.get(e)!.pos; return p === 'C' || p === 'PF'; };

/** Run (or slide) to a spot; resolves on arrival. Fast runs are sprints; short defensive steps are slides. */
async function go(e: Ent, x: number, z: number, o: { speed?: number; def?: boolean; min?: number } = {}) {
  const d = Math.hypot(x - e.x, z - e.z);
  if (d < 0.05) return;
  const speed = o.speed ?? 5.5;
  const dur = Math.max(o.min ?? 0.25, d / speed);
  if (Math.abs(x - e.x) > 0.1) face(e, x > e.x);
  const fast = speed >= 7 && d > 2;
  const tag = e.ball ? (d < 1.2 ? (e.hand > 0 ? 'Dribble_1' : 'Dribble_1_Left') : fast ? 'Sprint_Ball' : 'Run_Ball') : o.def && d < 2.2 ? 'Slide' : fast ? 'Sprint' : 'Run';
  anim(e, tag, 80, true);
  move(e, x, z, dur);
  await wait(dur);
  settle(e, !!o.def);
}
function settle(e: Ent, def: boolean) {
  if (def) { face(e, dir < 0); anim(e, 'Idle_2', 110, true); return; }
  if (e.ball && posting.has(e)) { face(e, dir < 0); anim(e, styleOf(e) % 2 ? 'Back_Dribble' : 'Back_Idle', 110, true); return; }
  face(e, dir > 0);
  if (e.ball) dribble(e); else anim(e, 'Idle', 120, true);
}
/** Chest pass (or a lob, caught in the air); resolves when the ball is caught. */
function pass(from: Ent, to: Ent, lob = false): Promise<void> {
  face(from, to.x > from.x);
  anim(from, lob ? 'Free_Throw' : 'Jab', 60);
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const dur = Math.max(0.3, d / (lob ? 9 : 14));
  if (lob) wait(Math.max(0, dur - 0.35)).then(() => { anim(to, 'Jump_TwoFeet_Ball', 70); jump(to, 0.6, 0.5); });
  return new Promise((res) => {
    throwBall(from, to.x, to.z, lob ? 2.4 : 1.3, lob ? 1.6 : 0.25, dur, () => { give(to); if (!lob) settle(to, false); res(); });
  });
}
/** A pass picked off: the defender jumps the lane. */
async function pickOff(from: Ent, to: Ent, thief: Ent) {
  clearMarks();
  const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2;
  face(from, to.x > from.x);
  anim(from, 'Jab', 60);
  go(thief, mx, mz, { speed: 8, min: 0.2 });
  await new Promise<void>((res) => throwBall(from, mx, mz, 1.2, 0.2, 0.32, () => res()));
  anim(thief, 'Steal', 60);
  give(thief);
  sfx.steal(); pxsfx.ooh(); shake(0.12);
  say('STOLEN!');
  await wait(0.5);
  face(thief, dir < 0); anim(thief, 'Sprint_Ball', 70, true); move(thief, thief.x - dir * 3, thief.z, 0.9);
  await wait(0.9);
}

/**
 * Shoot. The animation follows the player and the situation: a dribble move first when he creates his own
 * drive, his own dunk (post dunks for the bigs, flying ones for the guards, a reverse dunk with his back to the
 * rim on a roll or a cut), a double clutch through contact, a fadeaway or a pump fake on a contested jumper, the
 * hook from the post. Then the closeout, and the make or the miss.
 */
async function shot(e: Ent, kind: Read['kind'], q: Read['q'], made: boolean, closer: Ent, how = '', selfMade = false) {
  clearMarks();
  const st = styleOf(e);
  const inside = kind === 'layup' || kind === 'dunk';
  // A drive he creates himself starts with a move off the dribble.
  if (inside && selfMade && !posting.has(e)) {
    const moves = ['Crossover', 'Behind_Back', 'Between', 'Hesi', 'Side_Step'];
    const mv = moves[st % moves.length];
    face(e, dir > 0);
    const d = moveThen(e, mv, 70, mv !== 'Hesi' && mv !== 'Side_Step');
    pxsfx.squeak();
    go(closer, closer.x, closer.z + (e.z > closer.z ? -0.9 : 0.9), { def: true, speed: 4 });
    await wait(d * 0.85);
  }
  // From the post: back him down first.
  if (posting.has(e)) { face(e, dir < 0); anim(e, 'Back_Down', 90); move(e, e.x + dir * 0.6, e.z, 0.45); sfx.clash(); await wait(0.5); posting.delete(e); }
  const reverse = kind === 'dunk' && (how === 'roll' || how === 'slip' || how === 'lob' || how === 'backdoor' || how === 'cut') && st % 2 === 0;
  const side = e.z > HZ ? 1 : -1;
  // Get to where the shot is taken.
  const dh = Math.hypot(HX - e.x, HZ - e.z);
  if (reverse) await go(e, HX + dir * 0.1, HZ + side * 1.1, { speed: 7.5 });
  else if (inside) await go(e, HX - dir * 1.0, HZ + side * 0.5, { speed: 7.5 });
  else if (kind === 'three' && dh < 6.9) await go(e, HX - dir * 7.0, e.z, { speed: 6 });
  else if (kind === 'mid' && dh > 5.5) await go(e, e.x + (HX - e.x) * 0.35, e.z + (HZ - e.z) * 0.35, { speed: 6 });
  // A pump fake: the closer bites and flies by.
  if (kind !== 'three' && !inside && q === 'contested' && st % 3 === 0) {
    face(e, dir > 0);
    anim(e, 'Jump_OneFeet_Ball', 90);
    go(closer, e.x + dir * 0.7, e.z - 0.2, { speed: 8, def: true, min: 0.2 }).then(() => { anim(closer, 'Block_1', 70); jump(closer, 0.6, 0.55); });
    await wait(0.45);
  }
  face(e, reverse ? dir < 0 : dir > 0);
  const fade = kind === 'mid' && q !== 'open' && st % 2 === 1;
  const POST_DUNKS = ['Dunk_1', 'Dunk_2', 'Dunk_4', 'Dunk_7'];
  const tag = kind === 'three' ? (st % 2 ? 'Jumpshot_2' : 'Jumpshot_3')
    : kind === 'mid' ? (fade ? 'Fadeaway_Left' : 'Jumpshot')
    : kind === 'hook' ? 'Floater'
    : kind === 'dunk' ? (reverse ? (st % 4 < 2 ? 'Dunk_5' : 'Dunk_6') : isBig(e) ? POST_DUNKS[(st >>> 2) % POST_DUNKS.length] : 'Dunk_3')
    : q !== 'open' && st % 2 === 0 ? 'Double_Clutch' : 'Layup';
  const ms = 70;
  anim(e, tag, ms);
  const rel = Math.max(1, releaseIndex(tag)) * ms / 1000;
  if (reverse) { move(e, HX + dir * 0.15, HZ + side * 0.25, rel); jump(e, 1.15, rel + 0.4); }
  else if (inside) { move(e, HX - dir * 0.55, HZ + side * 0.2, rel); jump(e, kind === 'dunk' ? 1.15 : 0.75, rel + 0.35); }
  else if (fade) { move(e, e.x - dir * 0.6, e.z, rel + 0.2); jump(e, 0.5, rel + 0.3); }
  else jump(e, 0.45, 0.65);
  // The closeout: late on an open look, in his face otherwise.
  const gap = q === 'open' ? 1.8 : q === 'contested' ? 0.8 : 0.5;
  const tx = e.x + dir * (inside ? 0.4 : gap), tz = e.z - 0.2;
  go(closer, tx, tz, { speed: 8, def: true, min: 0.2 }).then(() => { if (q !== 'open') { anim(closer, inside ? 'Block_1' : 'Block_2', 70); jump(closer, inside ? 0.8 : 0.6, 0.55); } });
  await wait(rel);
  if (kind === 'dunk' && made) {
    e.ball = false; ball.free = true;
    ball.flight = { fx: HX, fz: HZ, fh: 3.3, tx: HX, tz: HZ, th: 0.15, apex: 0, t: 0, dur: 0.4, done: () => { ball.bounce = { vx: -dir * 1.2, vz: 0.3, vh: 2.5 }; } };
    pxsfx.slam(); sfx.swish(); shake(0.3); swishNet();
    say(reverse ? 'REVERSE SLAM!' : 'SLAM!');
    cheer();
    await wait(1.1);
    return;
  }
  const dist = Math.hypot(HX - e.x, HZ - e.z);
  await new Promise<void>((res) => throwBall(e, HX, HZ, 3.2, inside ? 0.5 : 1 + dist * 0.15, inside ? 0.35 : 0.6 + dist * 0.06, () => {
    if (made) {
      sfx.swish(); swishNet();
      ball.flight = { fx: HX, fz: HZ, fh: 3.2, tx: HX - dir * 0.2, tz: HZ, th: 0.15, apex: 0, t: 0, dur: 0.4, done: () => { ball.bounce = { vx: -dir * 0.8, vz: 0.3, vh: 2 }; } };
    } else sfx.rim();
    res();
  }));
  if (made) { say(kind === 'three' ? 'SPLASH!' : 'BUCKET!'); cheer(); await wait(1.0); }
}

/** A miss: the ball comes off the rim and someone goes up for it. Returns the rebounder. */
async function rebound(offense: 0 | 1, offBoard: boolean): Promise<Ent> {
  const team = offBoard ? ents[offense] : ents[1 - offense];
  const big = team.slice().sort((a, b) => Math.hypot(a.x - HX, a.z - HZ) - Math.hypot(b.x - HX, b.z - HZ))[0];
  const lx = HX - dir * 1.6, lz = HZ + (rnd() - 0.5) * 2;
  ball.flight = { fx: HX, fz: HZ, fh: 3.2, tx: lx, tz: lz, th: 2.4, apex: 0.8, t: 0, dur: 0.6, done: () => {} };
  go(big, lx + dir * 0.2, lz, { speed: 7, min: 0.3 });
  const other = ents[offBoard ? 1 - offense : offense].slice().sort((a, b) => Math.hypot(a.x - HX, a.z - HZ) - Math.hypot(b.x - HX, b.z - HZ))[0];
  go(other, lx + dir * 0.5, lz + 0.4, { speed: 7, min: 0.3 });
  await wait(0.45);
  anim(big, offBoard ? 'Rebound_2' : 'Rebound_1', 70); jump(big, 0.55, 0.5);
  anim(other, 'Block_1', 70); jump(other, 0.4, 0.45);
  await wait(0.3);
  give(big);
  say(offBoard ? 'OFFENSIVE BOARD!' : 'NO GOOD');
  await wait(0.6);
  return big;
}

// ---------------------------------------------------------------- set-up and plays
/** Who guards whom: guard[i] = index (in the defense) of the man on offensive player i. */
let guard = [0, 1, 2, 3, 4];
async function formation(off: 0 | 1, sc: Scheme) {
  const O = ents[off], D = ents[1 - off];
  guard = [0, 1, 2, 3, 4];
  posting.clear();
  const sag = sc === 'zone' ? 2.0 : sc === 'trap' ? 0.5 : 0.9;
  // The ball first: whoever has it on the new offense hands it to the point guard; after a basket or a
  // defensive stop the point guard goes and gets it.
  if (!holder || !O.includes(holder)) {
    const bx = ball.free ? ball.x : holder ? holder.x : O[0].x, bz = ball.free ? ball.z : holder ? holder.z : O[0].z;
    await go(O[0], bx, bz, { speed: 8, min: 0.2 });
    give(O[0]);
  } else if (holder !== O[0]) await pass(holder, O[0]);
  // Up the court: everyone runs to his spot at the other end, the point guard dribbling.
  const tasks: Promise<void>[] = [];
  O.forEach((e, i) => tasks.push(go(e, cx(SPOT[i].x), SPOT[i].z, { speed: 7 })));
  D.forEach((e, i) => { const p = guardSpot({ x: cx(SPOT[i].x), z: SPOT[i].z }, i === 0 ? 0.8 : sag); tasks.push(go(e, p.x, p.z, { def: true, speed: 7.5 })); });
  await Promise.all(tasks);
}
const D_ = (off: 0 | 1, i: number) => ents[1 - off][guard[i]];

/** The play runs up to its key moment. */
async function runPlay(p: PlayId, off: 0 | 1) {
  const O = ents[off];
  if (p === 'pnr') {
    await Promise.all([go(O[4], cx(6.7), 8.4), go(D_(off, 4), cx(7.6), 7.2, { def: true })]);
    sfx.clash();
    await Promise.all([go(O[0], cx(7.6), 9.3, { speed: 4 }), go(D_(off, 0), cx(6.9), 8.9, { def: true })]);
  } else if (p === 'iso') {
    await pass(O[0], O[1]);
    await Promise.all([go(O[0], cx(6.0), 4.0), go(D_(off, 0), cx(6.9), 4.6, { def: true }), go(O[1], cx(7.8), 11.6), go(D_(off, 1), cx(8.7), 11.0, { def: true })]);
  } else if (p === 'post') {
    posting.add(O[4]);
    await Promise.all([go(O[4], cx(11.6), 9.6), go(D_(off, 4), cx(12.1), 9.2, { def: true })]);
    await pass(O[0], O[1]);
  } else {
    await pass(O[0], O[1]);
    await Promise.all([go(O[3], cx(11.2), 8.6), go(O[2], cx(9.4), 4.4)]);
    await pass(O[1], O[0]);
  }
}
/** Who holds the ball at the key moment (post double: the entry pass has been made). */
const holderAt = (p: PlayId, re: string) => (p === 'iso' ? 1 : p === 'post' ? (re === 'double' ? 4 : 1) : 0);

/** A planned move of one player (reactions and routes share it). */
interface Mv { e: Ent; x: number; z: number; def: boolean }
/** The defense's reaction as moves: who goes where, a switch of marks, the post entry pass. */
function reactMoves(p: PlayId, re: string, off: 0 | 1): { mv: Mv[]; swapMarks?: [number, number]; entry?: boolean } {
  const O = ents[off];
  const mv: Mv[] = [];
  const dg = (i: number, x: number, z: number) => mv.push({ e: D_(off, i), x, z, def: true });
  const og = (i: number, x: number, z: number) => mv.push({ e: O[i], x, z, def: false });
  if (p === 'pnr') {
    if (re === 'hedge') { dg(4, cx(8.3), 9.3); dg(2, cx(10.6), 6.4); og(4, cx(10.9), 8.2); }
    else if (re === 'drop') { dg(4, cx(10.6), 7.6); og(4, cx(10.0), 8.6); }
    else { dg(4, cx(8.3), 9.2); dg(0, cx(11.3), 7.8); og(4, cx(10.8), 7.6); return { mv, swapMarks: [0, 4] }; }
  } else if (p === 'iso') {
    if (re === 'double') dg(0, cx(8.5), 11.0);
    else if (re === 'help') { dg(4, cx(10.6), 9.8); dg(3, cx(11.9), 12.4); }
  } else if (p === 'post') {
    if (re === 'front') dg(4, cx(11.0), 9.9);
    else if (re === 'behind') dg(4, cx(12.2), 9.5);
    else { dg(0, cx(10.9), 9.4); return { mv, entry: true }; }
  } else {
    if (re === 'deny') { dg(2, cx(8.0), 3.6); dg(1, cx(7.8), 11.2); }
    else if (re === 'pack') for (const i of [1, 2, 3, 4]) { const d = D_(off, i); const g2 = guardSpot({ x: d.x, z: d.z }, 1.4); dg(i, g2.x, g2.z); }
    else { const a = D_(off, 1), b = D_(off, 3); dg(1, b.x, b.z); dg(3, a.x, a.z); return { mv, swapMarks: [1, 3] }; }
  }
  return { mv };
}
/** The defense's reaction, on the court. */
async function showReaction(p: PlayId, re: string, off: 0 | 1) {
  const r = reactMoves(p, re, off);
  const t = r.mv.map((m) => go(m.e, m.x, m.z, m.def ? { def: true, speed: 7 } : {}));
  if (r.entry) t.push(pass(ents[off][1], ents[off][4]));
  if (r.swapMarks) guard = swap(guard, r.swapMarks[0], r.swapMarks[1]);
  await Promise.all(t);
  if (p === 'pnr' || re === 'double') sfx.clash();
}
const swap = (g: number[], a: number, b: number) => { const n = [...g]; [n[a], n[b]] = [n[b], n[a]]; return n; };

/** Play a read out: the passes, a possible pick-off, the shot, the board. Returns the points. */
async function playRead(rd: Read, sc: Scheme, off: 0 | 1, hIdx: number): Promise<number> {
  const O = ents[off];
  const od = odds(rd, sc, TEAMS[off], TEAMS[1 - off]);
  let h = O[hIdx];
  const shooter = O[rd.who];
  // Passes: to the passer first if he is not the one holding it, then the risky one to the shooter.
  if (rd.from !== null && O[rd.from] !== h) { await pass(h, O[rd.from]); h = O[rd.from]; }
  if (h !== shooter) {
    if (rnd() < od.to) { await pickOff(h, shooter, D_(off, rd.who)); return 0; }
    await pass(h, shooter, rd.id === 'lob');
    h = shooter;
  }
  const made = rnd() < od.make;
  await shot(shooter, rd.kind, rd.q, made, D_(off, rd.who), rd.id, h === shooter && rd.from === null);
  if (made) return ptsOf(rd.kind);
  // Off the rim: an offensive board gives one putback.
  const offBoard = rnd() < orebChance(TEAMS[off], TEAMS[1 - off]);
  const reb = await rebound(off, offBoard);
  if (!offBoard) return 0;
  const putIn = rnd() < 0.5;
  const ri = O.indexOf(reb);
  await shot(reb, 'layup', 'contested', putIn, D_(off, ri), 'putback');
  if (putIn) return 2;
  await rebound(off, false);
  return 0;
}

// ---------------------------------------------------------------- routes on the court
// Same language as the 3x3: marks march along each route, and a route never reads by its color alone.
//   a player who runs: arrowheads pointing where he goes     a screen: the arrowheads end in a bar
//   the ball in the air: dots (a lob: hollow squares)        a risky pass: crosses
//   the shooter: a pulsing double ring                        the shot: dots arcing up to the rim
// Every mark has a dark shadow a pixel below, so it reads on the light floor and over the players.
type Shape = 'chev' | 'dot' | 'ring' | 'x';
interface P3 { x: number; z: number; h: number }
interface Mark { a: P3; b: P3; apex: number; shape: Shape; color: string; bar?: boolean }
interface Ring { x: number; z: number; color: string; double: boolean }
let marks: Mark[] = [];
let rings: Ring[] = [];
const INK = '#1b1029';
const C_RUN = '#fff7ea';
const C_BALL = '#ffd166';
const C_DEF = '#7ee0ff';
const C_RISK = '#ff5c7a';
const Q_COLOR = { open: '#3ddc97', contested: '#ffd166', tough: '#ff5c7a' };
function clearMarks() { marks = []; rings = []; }
const at = (e: { x: number; z: number }, h = 0): P3 => ({ x: e.x, z: e.z, h });
const run = (a: { x: number; z: number }, b: { x: number; z: number }, color = C_RUN, bar = false): Mark => ({ a: at(a), b: at(b), apex: 0, shape: 'chev', color, bar });
const ballPath = (a: { x: number; z: number }, b: { x: number; z: number }, lob = false, risky = false): Mark =>
  ({ a: at(a, 1.3), b: at(b, 1.3), apex: lob ? 1.8 : 0.3, shape: risky ? 'x' : lob ? 'ring' : 'dot', color: risky ? C_RISK : C_BALL });

/** A play's routes, in half-court coordinates (cx() maps them to the attacked end). */
type Leg = { who: number; to: [number, number]; from?: [number, number]; kind: 'run' | 'screen' } | { pass: [number, number]; at?: [number, number] };
const ROUTES: Record<PlayId, Leg[]> = {
  pnr: [{ who: 4, to: [6.7, 8.4], kind: 'screen' }, { who: 0, to: [7.6, 9.3], kind: 'run' }, { who: 4, from: [6.7, 8.4], to: [10.9, 8.2], kind: 'run' }],
  iso: [{ pass: [0, 1] }, { who: 0, to: [6.0, 4.0], kind: 'run' }, { who: 1, from: [7.8, 11.6], to: [11.0, 9.4], kind: 'run' }],
  post: [{ who: 4, to: [11.6, 9.6], kind: 'run' }, { pass: [0, 1] }, { pass: [1, 4], at: [11.6, 9.6] }],
  motion: [{ pass: [0, 1] }, { who: 3, to: [11.2, 8.6], kind: 'screen' }, { who: 2, to: [9.4, 4.4], kind: 'run' }, { pass: [1, 0] }],
};
function playMarks(p: PlayId, off: 0 | 1) {
  const O = ents[off];
  marks = ROUTES[p].map((l): Mark => {
    if ('pass' in l) return ballPath(O[l.pass[0]], l.at ? { x: cx(l.at[0]), z: l.at[1] } : O[l.pass[1]]);
    const e = O[l.who];
    return run(l.from ? { x: cx(l.from[0]), z: l.from[1] } : e, { x: cx(l.to[0]), z: l.to[1] }, C_RUN, l.kind === 'screen');
  });
  rings = [];
}
/** A read: the passes to the shooter, his ring, his shot (or his drive to the rim). */
function readMarks(rd: Read, sc: Scheme, off: 0 | 1, hIdx: number, danger = false): { m: Mark[]; r: Ring[] } {
  const O = ents[off];
  const od = odds(rd, sc, TEAMS[off], TEAMS[1 - off]);
  const m: Mark[] = [];
  let h = O[hIdx];
  if (rd.from !== null && O[rd.from] !== h) { m.push(ballPath(h, O[rd.from])); h = O[rd.from]; }
  const sh = O[rd.who];
  if (h !== sh) m.push(ballPath(h, sh, rd.id === 'lob', od.to >= 0.1));
  const inside = rd.kind === 'layup' || rd.kind === 'dunk';
  const col = danger ? C_RISK : Q_COLOR[rd.q];
  if (inside) m.push(run(sh, { x: HX - dir * 0.9, z: HZ }, col));
  else m.push({ a: at(sh, 2.2), b: { x: HX, z: HZ, h: HOOP.h + 0.1 }, apex: 1.4, shape: 'dot', color: col });
  return { m, r: [{ x: sh.x, z: sh.z, color: col, double: !danger }] };
}
/** A reaction: where the defenders go, and (in red, with crosses) the read it leaves open. */
function reactionMarks(p: PlayId, re: string, sc: Scheme, off: 0 | 1) {
  const r = reactMoves(p, re, off);
  marks = r.mv.map((m) => run(m.e, m, m.def ? C_DEF : C_RUN));
  const b = bestRead(p, re, sc, TEAMS[off], TEAMS[1 - off]).r;
  const rm = readMarks(b, sc, off, holderAt(p, re), true);
  marks.push(...rm.m);
  rings = rm.r;
}

function px(g: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); }
/** One mark at (x, y) heading along (ux, uy), with its shadow. */
function mark1(g: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, shape: Shape, c: string) {
  const X = Math.round(x), Y = Math.round(y);
  const both = (f: (col: string, o: number) => void) => { f(INK, 1); f(c, 0); };
  if (shape === 'dot') both((col, o) => px(g, X - 1, Y - 1 + o, col, 2, 2));
  else if (shape === 'ring') both((col, o) => { px(g, X - 1, Y - 1 + o, col, 3, 1); px(g, X - 1, Y + 1 + o, col, 3, 1); px(g, X - 1, Y + o, col); px(g, X + 1, Y + o, col); });
  else if (shape === 'x') both((col, o) => { for (let i = -1; i <= 1; i++) { px(g, X + i, Y + i + o, col); px(g, X + i, Y - i + o, col); } });
  else both((col, o) => {
    // Arrowhead: the tip ahead, two arms going back at 45 degrees.
    px(g, X + ux * 1.5, Y + uy * 1.5 + o, col);
    for (let i = 1; i <= 3; i++) {
      px(g, X + ux * 1.5 - ux * i - uy * i, Y + uy * 1.5 - uy * i + ux * i + o, col);
      px(g, X + ux * 1.5 - ux * i + uy * i, Y + uy * 1.5 - uy * i - ux * i + o, col);
    }
  });
}
function drawMark(g: CanvasRenderingContext2D, m: Mark, time: number) {
  const P = (t: number) => proj(m.a.x + (m.b.x - m.a.x) * t, m.a.z + (m.b.z - m.a.z) * t, m.a.h + (m.b.h - m.a.h) * t + Math.sin(Math.PI * t) * m.apex);
  const A = P(0), B = P(1);
  const len = Math.hypot(B.x - A.x, B.y - A.y) + m.apex * 20;
  if (len < 4) return;
  const gap = m.shape === 'chev' ? 9 : 6;
  const n = Math.max(2, Math.round(len / gap));
  // The marks march toward the end of the route.
  const phase = (time * (m.shape === 'chev' ? 1.1 : 1.6)) % 1;
  for (let i = 0; i < n; i++) {
    const t = (i + phase) / n;
    if (t > 0.97) continue;
    const q = P(t), q2 = P(Math.min(1, t + 0.02));
    const dx = q2.x - q.x, dy = q2.y - q.y, l = Math.hypot(dx, dy) || 1;
    mark1(g, q.x, q.y, dx / l, dy / l, m.shape, m.color);
  }
  if (m.bar) {
    // A screen: a bar across the end of the run.
    const q = P(0.96), dx = B.x - q.x, dy = B.y - q.y, l = Math.hypot(dx, dy) || 1, vx = -dy / l, vy = dx / l;
    for (const [c, o] of [[INK, 1], [m.color, 0]] as const) for (let j = -5; j <= 5; j++) px(g, B.x + vx * j, B.y + vy * j + o, c, 2, 2);
  }
}
function drawRing(g: CanvasRenderingContext2D, r: Ring, time: number) {
  const pulse = 0.08 * Math.sin(time * 6);
  const ell = (rad: number, c: string, o: number, dash: boolean) => {
    for (let a = 0; a < 28; a++) {
      if (dash && a % 4 >= 2) continue;
      const t = (a / 28) * Math.PI * 2;
      const q = proj(r.x + Math.cos(t) * rad, r.z + Math.sin(t) * rad * 1.1);
      px(g, q.x, q.y + o, c, 2, 1);
    }
  };
  ell(0.8 + pulse, INK, 1, !r.double); ell(0.8 + pulse, r.color, 0, !r.double);
  if (r.double) { ell(0.5 + pulse, INK, 1, false); ell(0.5 + pulse, r.color, 0, false); }
  else {
    // Danger is never told by color alone: a cross by the ring.
    const q = proj(r.x + 1.0, r.z - 0.6);
    for (const [c, o] of [[INK, 1], [r.color, 0]] as const) for (let i = -2; i <= 2; i++) { px(g, q.x + i, q.y + i + o, c, 2, 2); px(g, q.x + i, q.y - i + o, c, 2, 2); }
  }
}
// Rings on the floor (under the players); the routes over everything, like the 3x3 previews.
view.underlay = (g) => { const t = performance.now() / 1000; for (const r of rings) drawRing(g, r, t); };
const drawRoutes = (g: CanvasRenderingContext2D) => { const t = performance.now() / 1000; for (const m of marks) drawMark(g, m, t); };

// ---------------------------------------------------------------- camera
/** Three angles: Mid (the first one), High (default, well above the court) and Top (almost from above). */
const CAMS = { mid: { h: 9, d: 24, feet: 109, name: 'MID' }, high: { h: 25, d: 40, feet: 87, name: 'HIGH' }, top: { h: 40, d: 60, feet: 91, name: 'TOP' } };
type CamKey = keyof typeof CAMS;
const CAM_ORDER: CamKey[] = ['high', 'top', 'mid'];
let camKey: CamKey = 'high';
try { const v = localStorage.getItem('turnball-5v5-cam2'); if (v && v in CAMS) camKey = v as CamKey; } catch { /* no storage */ }
function applyCam() {
  const c = CAMS[camKey];
  setCamDist(c.d); setCamH(c.h); setFeetY(c.feet);
  $('cam').textContent = `CAM: ${c.name}`;
}
$('cam').addEventListener('click', () => {
  camKey = CAM_ORDER[(CAM_ORDER.indexOf(camKey) + 1) % CAM_ORDER.length];
  try { localStorage.setItem('turnball-5v5-cam2', camKey); } catch { /* no storage */ }
  applyCam();
  sfx.tick();
});

// ---------------------------------------------------------------- the match
const score: [number, number] = [0, 0];
const possN: [number, number] = [0, 0];
function hudPoss() { $('possn').textContent = `${Math.min(POSSESSIONS, Math.max(possN[0], possN[1]) + (possN[0] === possN[1] ? 1 : 0))}/${POSSESSIONS}`; }

async function possession(off: 0 | 1) {
  const you = off === 0;
  setDir(off);
  const O = TEAMS[off], D = TEAMS[1 - off];
  hudPoss();
  // 1. The scheme.
  let sc: Scheme;
  if (you) {
    sc = aiScheme(O, D, rnd());
    idle('<span class="mk home"></span>YOUR BALL', '');
  } else {
    idle('<span class="mk away"></span>THEIR BALL', '');
    await formation(off, 'man');
    const bests = SCHEMES.map((s) => PLAYS.map((p) => ({ p, v: playEV(p, s, O, D) })).sort((a, b) => b.v - a.v)[0]);
    const gs = grades(bests.map((b) => b.v), true);
    sc = await ask('<span class="mk away"></span>DEFENSE: SET THE SCHEME', 'Their five: ' + O.map((p) => `#${p.num} ${p.pos}`).join(' · '), SCHEMES.map((s, i) => ({
      key: s, name: SCHEME_INFO[s].name, big: gs[i], small: `THEIR BEST: ${PLAY_INFO[bests[i].p].name.toUpperCase()}`, line: SCHEME_INFO[s].line,
    }))) as Scheme;
  }
  $('cscheme').innerHTML = `<b class="st sch">${SCHEME_INFO[sc].name.toUpperCase()}</b>`;
  await formation(off, sc);
  // 2. The play.
  let p: PlayId;
  if (you) {
    const gs = grades(PLAYS.map((pl) => playEV(pl, sc, O, D)));
    p = await ask('<span class="mk home"></span>CALL A PLAY', `They play <b>${SCHEME_INFO[sc].name.toUpperCase()}</b>: ${SCHEME_INFO[sc].line}`, PLAYS.map((pl, i) => ({
      key: pl, name: PLAY_INFO[pl].name, big: gs[i], small: playWho(pl, O), line: PLAY_INFO[pl].line,
    })), (k) => playMarks(k as PlayId, off)) as PlayId;
    playMarks(p, off);
  } else {
    p = aiPlay(sc, O, D, rnd());
    playMarks(p, off);
    say(PLAY_INFO[p].name.toUpperCase() + '!');
    await wait(0.6);
  }
  idle(`<span class="mk ${you ? 'home' : 'away'}"></span>${PLAY_INFO[p].name.toUpperCase()}`);
  await runPlay(p, off);
  clearMarks();
  // 3. The reaction.
  let re: string;
  if (you) re = aiReaction(p, sc, O, D, rnd());
  else {
    view.speed = view.reduce ? 1 : 0.25;
    const bs = REACTIONS[p].map((r) => bestRead(p, r.id, sc, O, D));
    const gs = grades(bs.map((b) => b.v), true);
    re = await ask('<span class="mk away"></span>HOW DO YOU REACT?', `They run <b>${PLAY_INFO[p].name.toUpperCase()}</b>. Each answer leaves something open.`, REACTIONS[p].map((r, i) => ({
      key: r.id, name: r.name, big: gs[i], small: `LEAVES: ${bs[i].r.name.toUpperCase()}`, line: r.line,
    })), (k) => reactionMarks(p, k, sc, off));
    clearMarks();
    view.speed = speedBase;
  }
  const reInfo = REACTIONS[p].find((r) => r.id === re)!;
  idle(`<span class="mk ${you ? 'home' : 'away'}"></span>${reInfo.name.toUpperCase()}!`, reInfo.line);
  await showReaction(p, re, off);
  // 4. The read.
  let rd: Read;
  if (you) {
    view.speed = view.reduce ? 1 : 0.25;
    const list = readsFor(p, re);
    const key = await ask(`<span class="mk home"></span>READ: THEY ${reInfo.name.toUpperCase()}`, reInfo.line, list.map((r) => {
      const s = O[r.who];
      const od = odds(r, sc, O, D);
      const inside = r.kind === 'layup' || r.kind === 'dunk' || r.kind === 'hook';
      return {
        key: r.id, name: r.name, big: qHTML(r.q),
        small: `#${s.num} ${s.name} ${stars(inside ? s.fi : s.sh)}${od.to >= 0.1 ? ' <b class="risky">RISKY PASS</b>' : ''}`,
        tone: od.to >= 0.1 ? 'bad' : undefined, line: `${r.line} ${r.kind === 'three' ? '3 points.' : '2 points.'}`,
      };
    }), (k) => { const x = readMarks(list.find((r) => r.id === k)!, sc, off, holderAt(p, re)); marks = x.m; rings = x.r; });
    view.speed = speedBase;
    rd = list.find((r) => r.id === key)!;
    const x = readMarks(rd, sc, off, holderAt(p, re));
    marks = x.m; rings = x.r;
  } else {
    rd = aiRead(p, re, sc, O, D, rnd());
    await wait(0.3);
  }
  idle(`<span class="mk ${you ? 'home' : 'away'}"></span>${rd.name.toUpperCase()}`);
  const pts = await playRead(rd, sc, off, holderAt(p, re));
  if (pts) { score[off] += pts; $(`s${off}`).textContent = String(score[off]); }
  possN[off]++;
  $('cscheme').innerHTML = '';
}

/** Who a play goes through, with the stars that matter. */
function playWho(p: PlayId, O: TP[]) {
  const s = (i: number, k: 'sh' | 'fi' | 'pa') => `#${O[i].num} ${k === 'sh' ? 'SHT' : k === 'fi' ? 'FIN' : 'PAS'} ${'&#9733;'.repeat(O[i][k])}`;
  if (p === 'pnr') return `${s(0, 'pa')} · ${s(4, 'fi')}`;
  if (p === 'iso') return s(1, 'sh');
  if (p === 'post') return s(4, 'fi');
  return `${s(1, 'sh')} · ${s(2, 'fi')}`;
}

/** A number label, drawn once with its outline and reused. */
const labels = new Map<string, HTMLCanvasElement>();
function label(s: string, color: string) {
  const k = s + color;
  let c = labels.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = s.length * 4 + 1; c.height = 7;
    pixText(c.getContext('2d')!, s, 1, 1, color);
    labels.set(k, c);
  }
  return c;
}
// Numbers over every player, and a marker over the ball handler.
view.overlay = (g) => {
  drawRoutes(g);
  // The camera follows the ball the whole length of the court.
  const bx = ball.free ? ball.x : holder ? holder.x : 14;
  // Lead toward the hoop being attacked: in a set the whole half court is in the picture (rim, both wings and
  // the near corner); in transition the camera runs with the ball.
  view.goal = Math.max(7.5, Math.min(20.5, bx + dir * 6));
  for (const e of players) {
    const tp = plOf.get(e)!;
    // Sprites are never scaled, so the label sits a fixed number of pixels over the head.
    const p = proj(e.x, e.z, e.h);
    const s = String(tp.num);
    const x = Math.round(p.x - (s.length * 4 - 1) / 2), y = Math.round(p.y) - 40;
    g.drawImage(label(s, ents[0].includes(e) ? '#fff7ea' : '#ffd166'), x - 1, y - 1);
    if (e === holder && !ball.free) {
      g.fillStyle = '#1b1029'; g.fillRect(x + 1, y - 6, 5, 3);
      g.fillStyle = '#ff9f1c'; g.fillRect(x + 2, y - 6, 3, 1); g.fillRect(x + 3, y - 5, 1, 1);
    }
  }
};

async function matchLoop() {
  for (;;) {
    score[0] = score[1] = 0; possN[0] = possN[1] = 0;
    $('s0').textContent = '0'; $('s1').textContent = '0';
    let off: 0 | 1 = 0;
    for (;;) {
      await possession(off);
      off = (1 - off) as 0 | 1;
      if (possN[0] >= POSSESSIONS && possN[0] === possN[1] && score[0] !== score[1]) break;
      await wait(0.3);
    }
    const won = score[0] > score[1];
    say(won ? 'YOU WIN!' : 'YOU LOSE');
    if (won) { sfx.levelUp(); cheer(); } else sfx.buzzer();
    await ask(won ? 'VICTORY' : 'DEFEAT', `${score[0]} - ${score[1]}`, [{ key: 'again', name: 'Play again', big: '', line: `${POSSESSIONS} possessions each again.` }]);
  }
}

// Tiny hook for automated checks.
(window as unknown as { __team: unknown }).__team = {
  get pending() { return !!pending; },
  get rows() { return rows.map((r) => `${r.key}:${r.big.replace(/<[^>]+>/g, '')}`); },
  choose: (i: number) => choose(i),
  setSpeed: (k: number) => { speedBase = k; view.speed = k; },
  score,
};

// Higher and farther than the 1v1 camera: the whole width of the court is in view.
setFullCourt();
applyCam();
loadAtlas().then(() => {
  startScene(canvas, app.querySelector<HTMLElement>('.word')!);
  ents.forEach((es, k) => es.forEach((e) => { face(e, k === 0); anim(e, 'Idle', 120, true); }));
  matchLoop();
}).catch(() => { app.innerHTML = '<p style="padding:24px">Could not load the game art. Reload to try again.</p>'; });
