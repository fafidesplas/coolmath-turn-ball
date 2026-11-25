// Turn Ball 1v1: the scene. A side-view, low-camera (2.5D) half court drawn in pixel art with the pack's
// sprites at full size: court, hoop, crowd, the two players and the ball, plus the small animation toolkit
// the duel scripts use (anim, move, jump, throwBall, wait, say). No rules here.
//
// Projection: the camera stands beyond the near sideline at height camH, looking across the court. A point
// (x along the court, z across it, h up) lands at screen x = W/2 + (x - camX) * s, y = horizon + (camH - h) * s,
// with s = F / (ZCAM - z). Players are never scaled (crisp pixels); only their position follows the projection.
// The crowd stands far behind and is drawn at half size.
import { sfx } from '../audio';
import { pxsfx } from '../pixel/pxsfx';
import { FEET, atlasImage, drawPiece, drawPlayer, tagFrame, tagLen, type Kit, type Look } from '../pixel/sprites';

export let W = 240, H = 135;
const floorCanvas = document.createElement('canvas');
floorCanvas.width = W; floorCanvas.height = H;
/** Canvas size in scene pixels (the 5v5 uses a bigger one, so more court fits around the same-size players). */
export function setSize(w: number, h: number) {
  W = w; H = h;
  floorImg = null;
  floorCanvas.width = W; floorCanvas.height = H;
}
/** Pixels per meter on the play line (matches the sprites: a standing player's body is 30 px, about 1.95 m). */
const PPM = 15;
export const Z0 = 7.5;
let D0 = 12;
let ZCAM = Z0 + D0;
let F = PPM * D0;
/** Camera distance from the play line (meters). Farther = flatter perspective, so a high camera sees the whole width. */
export const setCamDist = (d: number) => { D0 = d; ZCAM = Z0 + d; F = PPM * d; };
/** Screen row of the feet on the play line (fixed, whatever the camera height). */
let FEET_Y = 110;
/** Move the play line up or down the screen (the 5v5 raises it to see deeper into the court). */
export const setFeetY = (y: number) => { FEET_Y = y; };
export const BASELINE = 14;
export const HOOP = { x: BASELINE - 1.575, z: Z0, h: 3.05 };
/** Half court (the 1v1: one hoop on the right) or full court (the 5v5: 28 m, a hoop at each end). */
export const COURT = { full: false, len: BASELINE };
export interface Hoop { x: number; z: number; h: number; dir: 1 | -1 }
export const hoops = (): Hoop[] => COURT.full
  ? [{ x: 1.575, z: Z0, h: 3.05, dir: -1 }, { x: COURT.len - 1.575, z: Z0, h: 3.05, dir: 1 }]
  : [{ ...HOOP, dir: 1 }];
/** Unflipped sprites face right. */
export const BASE_RIGHT = true;

/** Camera height (m): "Mid", the one chosen in the scene test. */
let camH = 5.5;
let camX = 8.6;
/** The camera position used for drawing: snapped to whole pixels on the play line, so the floor and the
 * players move together while the camera pans (no shimmer). */
let camXs = 8.6;
let shakeT = 0;
let netT = 0;
export const view = {
  /** Where the camera pans to (court x). */
  goal: 8.6,
  reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  speed: 1,
  /** Drawn over the scene each frame (pips over a player). */
  overlay: null as ((g: CanvasRenderingContext2D) => void) | null,
  /** Drawn on the floor, under the players (routes, rings). */
  underlay: null as ((g: CanvasRenderingContext2D) => void) | null,
};
export const shake = (t: number) => { shakeT = t; };
export const swishNet = () => { netT = 0.8; };
export const setCamH = (h: number) => { camH = h; };

const scaleAt = (z: number) => F / (ZCAM - z);
const horizon = () => FEET_Y - camH * PPM;
export function proj(x: number, z: number, h = 0) {
  const s = scaleAt(z);
  return { x: W / 2 + (x - camXs) * s, y: horizon() + (camH - h) * s, s };
}

// ---------------------------------------------------------------- entities
interface Move { fx: number; fz: number; tx: number; tz: number; t: number; dur: number; jump: number }
export interface Ent {
  look: Look;
  x: number; z: number; h: number;
  flip: boolean;
  tag: string; t: number; ms: number; loop: boolean;
  ball: boolean;
  mv: Move | null;
  /** Extra jump (meters) over a time, as a sine arc. */
  jmp: { h: number; t: number; dur: number } | null;
  shadow: boolean;
  /** Dribbling hand: 1 the right one (Dribble_1/_2), -1 the left one (Dribble_1_Left/_2_Left). */
  hand: 1 | -1;
  /** Played when the current one-shot animation ends (a hand switch going back to the dribble). */
  next: { tag: string; ms: number; loop: boolean } | null;
  /** Seconds until a standing ball handler changes hands or plays with the ball. */
  idleT: number;
}
export const ent = (look: Look, x: number, z: number, tag: string): Ent => ({
  look, x, z, h: 0, flip: false, tag, t: Math.random() * 2, ms: 100, loop: true, ball: false, mv: null, jmp: null, shadow: true,
  hand: 1, next: null, idleT: 1.5,
});
export function face(e: Ent, right: boolean) { e.flip = right !== BASE_RIGHT; }
export function anim(e: Ent, tag: string, ms = 80, loop = false) {
  e.next = null; e.tag = tag; e.t = 0; e.ms = ms; e.loop = loop; return (tagLen(tag) * ms) / 1000; }
export function move(e: Ent, x: number, z: number, dur: number) { e.mv = { fx: e.x, fz: e.z, tx: x, tz: z, t: 0, dur: Math.max(0.01, dur), jump: 0 }; }
const DRIBBLES: Record<1 | -1, string[]> = { 1: ['Dribble_1', 'Dribble_2'], [-1]: ['Dribble_1_Left', 'Dribble_2_Left'] };
const isDribble = (tag: string) => tag.startsWith('Dribble_');
/** Standing dribble with the current hand. */
export function dribble(e: Ent, ms = 100) {
  const set = DRIBBLES[e.hand];
  anim(e, set[Math.random() < 0.7 ? 0 : 1], ms, true);
  e.idleT = 1.4 + Math.random() * 2.2;
}
/** Change hands (Switch_Dribble), then keep dribbling with the other one. */
export function switchHands(e: Ent) {
  const tag = e.hand > 0 ? 'Switch_Dribble_1' : 'Switch_Dribble_2';
  const d = anim(e, tag, 80);
  e.hand = (e.hand * -1) as 1 | -1;
  e.next = { tag: DRIBBLES[e.hand][0], ms: 100, loop: true };
  return d;
}
/** A one-shot move that ends back in the standing dribble (with the hand it leaves the ball in). */
export function moveThen(e: Ent, tag: string, ms: number, swapHand: boolean) {
  const d = anim(e, tag, ms);
  if (swapHand) e.hand = (e.hand * -1) as 1 | -1;
  e.next = { tag: DRIBBLES[e.hand][0], ms: 100, loop: true };
  return d;
}
export function jump(e: Ent, h: number, dur: number) { e.jmp = { h, t: 0, dur }; }

export const HOME: Kit = { jersey: '#f4efe6', shade: '#b9ae9f', stripe: '#f72585', stripe2: '#1b1029', band: null };
export const AWAY: Kit = { jersey: '#1f6f63', shade: '#134a42', stripe: null, stripe2: null, band: '#ffd166' };
function rnd0() { r0 = (r0 * 16807) % 2147483647; return r0 / 2147483647; }
let r0 = 11;
const STREET: Kit[] = [
  { jersey: '#8d99ae', shade: '#5c667a', stripe: null, stripe2: null, band: null },
  { jersey: '#c0587e', shade: '#8a3a5b', stripe: null, stripe2: null, band: null },
  { jersey: '#e0a458', shade: '#a8743a', stripe: null, stripe2: null, band: null },
  { jersey: '#4d7ea8', shade: '#335a7a', stripe: null, stripe2: null, band: null },
  { jersey: '#6a994e', shade: '#4a6d36', stripe: null, stripe2: null, band: null },
];
const SKINS = ['#f0c6a0', '#8d5a3b', '#c98a5a', '#5a3825', '#e0b090', '#a86b4a', '#6b4430'];
const HAIRS = ['#d9a441', '#1b1029', '#6b3a2a', '#2e222f', '#b23a48', '#1b1029', '#3a2a55'];
/** The crowd behind the far sideline: two loose rows, drawn at half size (they stand far away). */
export const fans: Ent[] = Array.from({ length: 22 }, (_, i) => {
  const x = -1.5 + i * 0.95 + (rnd0() - 0.5) * 0.4, z = i % 2 ? -1.9 : -1.2;
  const f = ent({ skin: SKINS[i % SKINS.length], hair: HAIRS[(i * 3) % HAIRS.length], hairStyle: (i * 2) % 6 - 1, kit: STREET[i % STREET.length] }, x, z, 'Idle');
  face(f, i % 3 !== 0);
  return f;
});
/** Switch to the full court (5v5): 28 m, two hoops, the crowd along the whole far side. */
export function setFullCourt() {
  COURT.full = true;
  COURT.len = 28;
  HOOP.x = COURT.len - 1.575;
  for (let i = 0; i < 16; i++) {
    const f = ent({ skin: SKINS[(i + 3) % SKINS.length], hair: HAIRS[(i * 5) % HAIRS.length], hairStyle: (i * 3) % 6 - 1, kit: STREET[(i + 2) % STREET.length] }, 19.5 + i * 0.75 + (rnd0() - 0.5) * 0.3, i % 2 ? -1.9 : -1.2, 'Idle');
    face(f, i % 3 === 0);
    fans.push(f);
  }
}
/** The two players: index 0 is you (home kit), 1 the rival. */
export const players: Ent[] = [
  ent({ skin: '#c98a5a', hair: '#2e222f', hairStyle: 1, kit: HOME }, 5.4, 7.8, 'Dribble_1'),
  ent({ skin: '#7a4a32', hair: '#1b1029', hairStyle: 3, kit: AWAY }, 6.5, 7.2, 'Idle_2'),
];

// ---------------------------------------------------------------- ball
interface Flight { fx: number; fz: number; fh: number; tx: number; tz: number; th: number; apex: number; t: number; dur: number; done: () => void }
export const ball = { x: 0, z: 0, h: 0, spin: 0, free: false, flight: null as Flight | null, bounce: null as { vx: number; vz: number; vh: number } | null };
/** Throw the ball from a player's hands to a point (apex: meters above the higher end). */
export function throwBall(from: Ent, tx: number, tz: number, th: number, apex: number, dur: number, done: () => void) {
  from.ball = false;
  const dir = from.flip === BASE_RIGHT ? -1 : 1;
  ball.free = true;
  ball.bounce = null;
  ball.flight = { fx: from.x + dir * 0.35, fz: from.z, fh: from.h + 2.2, tx, tz, th, apex, t: 0, dur, done };
  sfx.pass();
}

// ---------------------------------------------------------------- timers (sequences are async scripts)
export const timers: { t: number; fn: () => void }[] = [];
export const wait = (s: number) => new Promise<void>((r) => timers.push({ t: s, fn: r }));

// ---------------------------------------------------------------- canvas
let g: CanvasRenderingContext2D;
let wordEl: HTMLElement;
let floorImg: ImageData | null = null;
/** Big word over the stage ("SLAM!", "STEAL!"). */
export function say(w: string) {
  wordEl.textContent = w;
  wordEl.classList.remove('show');
  void wordEl.offsetWidth;
  wordEl.classList.add('show');
}

// ---------------------------------------------------------------- background
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const skyline = Array.from({ length: 26 }, (_, i) => ({ x: -12 + i * 2.1 + rnd() * 0.8, w: 1.4 + rnd() * 1.6, h: 22 + rnd() * 46, lit: Array.from({ length: 30 }, () => rnd() < 0.3) }));
const SKY = ['#1f1338', '#2a1745', '#371b50', '#4a2059', '#5f255f', '#783062', '#943d62', '#b04c60', '#c95e5c', '#de735a', '#ee8d5c', '#f6a962', '#f9c46e'];

function drawSky() {
  const hz = Math.round(proj(0, -2.4).y);
  const band = Math.max(1, Math.ceil(hz / SKY.length));
  for (let i = 0; i < SKY.length; i++) {
    g.fillStyle = SKY[i];
    g.fillRect(0, i * band, W, band + 1);
    // Dithered seam between bands.
    if (i > 0) { g.fillStyle = SKY[i - 1]; for (let x = (i & 1); x < W; x += 2) g.fillRect(x, i * band, 1, 1); }
  }
  g.fillStyle = SKY[SKY.length - 1];
  g.fillRect(0, SKY.length * band, W, H);
  // Sun, low, behind the city.
  const sx = Math.round(230 - camXs * 3), sy = hz - 18;
  g.fillStyle = '#ffe29a';
  for (let dy = -14; dy <= 14; dy++) { const w = Math.round(Math.sqrt(196 - dy * dy)); g.fillRect(sx - w, sy + dy, w * 2, 1); }
  // City silhouette with lit windows (slow parallax).
  for (const b of skyline) {
    const x = Math.round(W / 2 + (b.x - camXs * 0.35) * 6), w = Math.round(b.w * 6), h = Math.round(b.h * 0.75);
    g.fillStyle = '#2a1a3e';
    g.fillRect(x, hz - h, w, h + 2);
    g.fillStyle = '#ffd166';
    let k = 0;
    for (let yy = hz - h + 4; yy < hz - 4; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (b.lit[k++ % b.lit.length]) g.fillRect(xx, yy, 2, 2);
  }
}

/** The chain-link fence along the far side, with lamps behind it. */
function drawFence() {
  const zf = -2.4;
  const s = scaleAt(zf);
  const base = Math.round(proj(0, zf).y);
  const sheet = atlasImage();
  // Lamps first (behind).
  for (let lx = 1.5; lx <= COURT.len + 3; lx += 14) { const p = proj(lx, zf - 0.3); drawPiece(g, sheet, 'lamp2', Math.round(p.x) - 35, Math.round(p.y) - 66); }
  const step = 24 / s;
  const x0 = camXs - W / 2 / s - step;
  // Only the lower part of the pack's fence (the full piece is taller than the scene needs), with a top rail.
  const FH = 30;
  g.save();
  g.beginPath();
  g.rect(0, base - FH, W, FH);
  g.clip();
  for (let x = Math.floor(x0 / step) * step; x < camXs + W / 2 / s + step; x += step) {
    const p = proj(x, zf);
    drawPiece(g, sheet, 'fence', Math.round(p.x), base - 52);
  }
  g.restore();
  g.fillStyle = '#1b1029';
  g.fillRect(0, base - FH - 1, W, 3);
  g.fillStyle = '#a9b4c2';
  g.fillRect(0, base - FH, W, 1);
  // A dark strip of ground under the fence.
  g.fillStyle = '#3b2c47';
  g.fillRect(0, base - 1, W, 2);
}

// ---------------------------------------------------------------- floor
const C = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const WOOD = [C('#e9b682'), C('#e2ab77'), C('#e6b07c')];
const SEAM = C('#cf9563');
const JOINT = C('#c88c5c');
const APRON = C('#7d6b86');
const APRON2 = C('#74627d');
const PAINT = C('#5f4b6a');
const PAINT2 = C('#594563');
const ZFAR = -2.4;

function drawFloor() {
  const top = Math.max(0, Math.ceil(proj(0, ZFAR).y));
  const img = (floorImg ??= g.createImageData(W, H));
  const d = img.data;
  const hz = horizon();
  for (let y = top; y < H; y++) {
    const s = (y + 0.5 - hz) / camH;
    if (s <= 0) continue;
    const z = ZCAM - F / s;
    const zNext = ZCAM - F / ((y + 1.5 - hz) / camH);
    const plank = Math.floor(z / 0.2);
    const seam = Math.floor(zNext / 0.2) !== plank;
    const off = ((plank * 7919) % 13) / 13 * 2.4;
    for (let px = 0; px < W; px++) {
      const x = camXs + (px + 0.5 - W / 2) / s;
      const xn = camXs + (px + 1.5 - W / 2) / s;
      let c: number[];
      const inCourt = z >= 0 && z <= 15 && x <= COURT.len && (!COURT.full || x >= 0);
      if (!inCourt) c = ((Math.floor(x * 2) + Math.floor(z * 2)) & 1) ? APRON : APRON2;
      else if ((x >= COURT.len - 5.8 || (COURT.full && x <= 5.8)) && z >= Z0 - 2.45 && z <= Z0 + 2.45) c = (plank & 1) ? PAINT : PAINT2;
      else if (seam) c = SEAM;
      else if (Math.floor((x + off) / 2.4) !== Math.floor((xn + off) / 2.4)) c = JOINT;
      else c = WOOD[((plank % 3) + 3) % 3];
      const i = (y * W + px) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  // Clear the rows above the floor so the sky shows through.
  for (let i = 0; i < top * W * 4; i += 4) d[i + 3] = 0;
  floorCanvas.getContext('2d')!.putImageData(img, 0, 0);
  g.drawImage(floorCanvas, 0, 0);
  drawLines();
}

function polyline(pts: [number, number][], color = '#fff7ea') {
  g.fillStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = proj(pts[i][0], pts[i][1]), b = proj(pts[i + 1][0], pts[i + 1][1]);
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / n), y = Math.round(a.y + ((b.y - a.y) * k) / n);
      if (y >= 0 && y < H) g.fillRect(x, y, 1, 1);
    }
  }
}
const seg = (x0: number, z0: number, x1: number, z1: number, n = 24): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n = 64): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });

function drawLines() {
  const L = COURT.len, x0 = COURT.full ? 0 : -20;
  polyline(seg(x0, 0, L, 0, 120));
  polyline(seg(x0, 15, L, 15, 120));
  polyline(seg(L, 0, L, 15, 40));
  if (COURT.full) polyline(seg(0, 0, 0, 15, 40));
  // Half-court line and center circle (a half circle at the edge of the half court).
  const mid = COURT.full ? L / 2 : 0;
  polyline(seg(mid, 0, mid, 15, 40));
  polyline(COURT.full ? arc(mid, Z0, 1.8, 0, Math.PI * 2, 72) : arc(0, Z0, 1.8, -Math.PI / 2, Math.PI / 2));
  const dx = Math.sqrt(6.75 ** 2 - 6.6 ** 2);
  const a = Math.asin(6.6 / 6.75);
  for (const hp of hoops()) {
    const base = hp.dir > 0 ? L : 0;
    // Paint and free-throw circle.
    const ft = base - hp.dir * 5.8;
    polyline([[base, Z0 - 2.45], [ft, Z0 - 2.45], [ft, Z0 + 2.45], [base, Z0 + 2.45]].flatMap((p, i, q) => (i ? seg(q[i - 1][0], q[i - 1][1], p[0], p[1], 20).slice(1) : [p as [number, number]])));
    polyline(arc(ft, Z0, 1.8, 0, Math.PI * 2, 72));
    // Three-point line: corners, then the arc.
    polyline(seg(base, Z0 - 6.6, hp.x - hp.dir * dx, Z0 - 6.6, 12));
    polyline(seg(base, Z0 + 6.6, hp.x - hp.dir * dx, Z0 + 6.6, 12));
    const c = hp.dir > 0 ? Math.PI : 0;
    polyline(arc(hp.x, Z0, 6.75, c - a, c + a, 96));
  }
}

// ---------------------------------------------------------------- hoop
// Drawn in code from 3D points, so it follows the same projection as everything else at any camera height
// (the pack's stand is drawn for a top-down view).
type P3 = [number, number, number];
/** Drawn radius of the rim: bigger than life, to match the pack's ball (about 0.65 m across at this scale). */
const RIM_R = 0.45;
/** Backboard and post, behind the rim (dir: which end of the court the hoop is at). */
const boardX = (hp: Hoop) => hp.x + hp.dir * 0.375;
const postX = (hp: Hoop) => hp.x + hp.dir * 2.675;
const px3 = (q: P3) => { const p = proj(q[0], q[1], q[2]); return [Math.round(p.x), Math.round(p.y)] as [number, number]; };
/** Fill a polygon pixel by pixel (no antialiasing). */
function fillPoly(pts: [number, number][], color: string) {
  // Scanlines: per row, the crossings of the edges, filled in pairs (one fillRect per span).
  const ys = pts.map((p) => p[1]);
  g.fillStyle = color;
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const cy = y + 0.5, xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(((xj - xi) * (cy - yi)) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.ceil(xs[k] - 0.5), x1 = Math.floor(xs[k + 1] - 0.5);
      if (x1 >= x0) g.fillRect(x0, y, x1 - x0 + 1, 1);
    }
  }
}
function line3(a: P3, b: P3, color: string, w = 1) {
  const [ax, ay] = px3(a), [bx, by] = px3(b);
  const n = Math.max(1, Math.abs(bx - ax), Math.abs(by - ay));
  g.fillStyle = color;
  for (let k = 0; k <= n; k++) g.fillRect(Math.round(ax + ((bx - ax) * k) / n) - Math.floor(w / 2), Math.round(ay + ((by - ay) * k) / n), w, 1);
}
const rimPts = (hp: Hoop, r: number, h: number, dx = 0) => Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [hp.x + dx + Math.cos(a) * r, hp.z + Math.sin(a) * r, h] as P3;
});
/** Post, arm, backboard and the back half of the rim (behind the ball and the players near the hoop). */
function drawStand(hp: Hoop) {
  const BOARD_X = boardX(hp), POST_X = postX(hp), d = hp.dir;
  // Post and arm.
  line3([POST_X, Z0, 0], [POST_X, Z0, 3.55], '#1b1029', 6);
  line3([POST_X, Z0, 0], [POST_X, Z0, 3.55], '#3d3150', 4);
  line3([POST_X - d * 0.06, Z0, 0.2], [POST_X - d * 0.06, Z0, 3.5], '#5a4c6e', 1);
  line3([POST_X, Z0, 0], [POST_X, Z0, 1.4], '#2a7f9e', 4);
  line3([BOARD_X + d * 0.05, Z0, 3.35], [POST_X, Z0, 3.55], '#1b1029', 3);
  line3([BOARD_X + d * 0.05, Z0, 3.35], [POST_X, Z0, 3.55], '#3d3150', 1);
  // Backboard: a thin slab seen from the side.
  const b = (z: number, h: number) => px3([BOARD_X, z, h]);
  const lo = 2.85, hi = 4.0, z0 = Z0 - 1.2, z1 = Z0 + 1.2;
  fillPoly([b(z0, lo), b(z1, lo), b(z1, hi), b(z0, hi)], '#1b1029');
  const i = (z: number, h: number) => { const [x, y] = b(z, h); return [x, y] as [number, number]; };
  fillPoly([i(z0 + 0.06, lo + 0.05), i(z1 - 0.06, lo + 0.05), i(z1 - 0.06, hi - 0.05), i(z0 + 0.06, hi - 0.05)], '#f4f1ea');
  for (const [a, c] of [[[Z0 - 0.3, 3.05], [Z0 + 0.3, 3.05]], [[Z0 + 0.3, 3.05], [Z0 + 0.3, 3.5]], [[Z0 + 0.3, 3.5], [Z0 - 0.3, 3.5]], [[Z0 - 0.3, 3.5], [Z0 - 0.3, 3.05]]]) line3([BOARD_X - d * 0.01, a[0], a[1]], [BOARD_X - d * 0.01, c[0], c[1]], '#e8463a');
  line3([BOARD_X, Z0, 3.0], [hp.x + d * RIM_R, Z0, hp.h], '#1b1029', 1);
  // Back half of the rim.
  const r = rimPts(hp, RIM_R, hp.h);
  for (let k = 8; k < 16; k++) line3(r[k], r[(k + 1) % 16], '#a8302a', 1);
}
/** Net and the front half of the rim (over the ball when it drops through). */
function drawRimFront(hp: Hoop) {
  const sway = netT > 0 ? Math.sin(netT * 30) * 0.08 * netT : 0;
  const top = rimPts(hp, RIM_R, hp.h), mid = rimPts(hp, RIM_R * 0.8, hp.h - 0.3, sway * 0.5), bot = rimPts(hp, RIM_R * 0.55, hp.h - 0.62, sway);
  for (let k = 0; k < 16; k += 2) { line3(top[k], mid[(k + 1) % 16], '#fff7ea'); line3(mid[(k + 1) % 16], bot[k], '#fff7ea'); }
  for (let k = 0; k < 16; k += 2) line3(bot[k], bot[(k + 2) % 16], '#d9d2c5');
  for (let k = 0; k < 8; k++) line3(top[k], top[k + 1], '#1b1029', 3);
  for (let k = 0; k < 8; k++) line3(top[k], top[k + 1], '#e8463a', 1);
}

// ---------------------------------------------------------------- draw
function shadowAt(x: number, z: number, h: number) {
  const p = proj(x, z);
  const w = Math.max(3, Math.round(9 - h * 2));
  g.fillStyle = 'rgba(27,16,41,0.35)';
  g.fillRect(Math.round(p.x) - w, Math.round(p.y) - 1, w * 2, 2);
  g.fillRect(Math.round(p.x) - w + 2, Math.round(p.y) - 2, w * 2 - 4, 4);
}
function drawEnt(e: Ent) {
  const p = proj(e.x, e.z, e.h);
  const fr = tagFrame(e.tag, e.t, e.loop, e.ms);
  drawPlayer(g, e.look, fr, Math.round(p.x) - FEET.x, Math.round(p.y) - FEET.y, e.flip, e.ball);
}
const cell = document.createElement('canvas');
cell.width = 64; cell.height = 64;
const cg = cell.getContext('2d')!;
/** A fan, at half size (nearest-neighbor: every other pixel). */
/** Each fan's frames, already halved (built the first time they are shown). */
const fanFrames = new WeakMap<Ent, Map<number, HTMLCanvasElement>>();
function drawFan(e: Ent) {
  const p = proj(e.x, e.z, e.h);
  const fr = tagFrame(e.tag, e.t, e.loop, e.ms) * 2 + (e.flip ? 1 : 0);
  let m = fanFrames.get(e);
  if (!m) { m = new Map(); fanFrames.set(e, m); }
  let c = m.get(fr);
  if (!c) {
    cg.clearRect(0, 0, 64, 64);
    drawPlayer(cg, e.look, fr >> 1, 0, 0, e.flip, false);
    c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const cc = c.getContext('2d')!;
    cc.imageSmoothingEnabled = false;
    cc.drawImage(cell, 0, 0, 64, 64, 0, 0, 32, 32);
    m.set(fr, c);
  }
  g.drawImage(c, Math.round(p.x - FEET.x / 2), Math.round(p.y - FEET.y / 2));
}
function drawBall() {
  if (!ball.free) return;
  const p = proj(ball.x, ball.z, ball.h);
  const k = Math.floor(ball.spin * 12) % 3;
  drawPiece(g, atlasImage(), `b${k}`, Math.round(p.x) - 5, Math.round(p.y) - 5);
}

// Sky, city, fence, lamps, floor and court lines only change when the camera does: they are drawn once into
// an offscreen canvas and reused until the camera moves a whole pixel or changes height.
const bg = document.createElement('canvas');
let bgKey = '';
function drawBackground() {
  const key = `${camXs}|${camH}|${D0}|${FEET_Y}|${W}|${H}|${COURT.len}`;
  if (key !== bgKey) {
    bgKey = key;
    if (bg.width !== W || bg.height !== H) { bg.width = W; bg.height = H; }
    const main = g;
    g = bg.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    drawSky();
    drawFence();
    drawFloor();
    g = main;
  }
  g.drawImage(bg, 0, 0);
}

export function render() {
  g.save();
  if (shakeT > 0 && !view.reduce) g.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 3));
  drawBackground();
  view.underlay?.(g);
  for (const e of players) if (e.shadow) shadowAt(e.x, e.z, e.h);
  if (ball.free) shadowAt(ball.x, ball.z, ball.h);
  // Depth order: far first. The stand stands at the hoop's depth.
  const items: { z: number; draw: () => void }[] = [
    ...fans.map((e) => ({ z: e.z, draw: () => drawFan(e) })),
    ...hoops().map((hp) => ({ z: hp.z - 0.6, draw: () => drawStand(hp) })),
    ...players.map((e) => ({ z: e.z, draw: () => drawEnt(e) })),
  ];
  items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());
  // The ball goes behind the front of the rim when it drops through.
  const hs = hoops();
  const through = hs.find((hp) => ball.free && Math.abs(ball.x - hp.x) < RIM_R + 0.1 && ball.h < hp.h + 0.1 && ball.h > hp.h - 0.9);
  for (const hp of hs) if (hp !== through) drawRimFront(hp);
  drawBall();
  if (through) drawRimFront(through);
  view.overlay?.(g);
  g.restore();
}

// ---------------------------------------------------------------- update
export function update(dt: number) {
  const due = timers.filter((t) => (t.t -= dt) <= 0);
  for (const t of due) timers.splice(timers.indexOf(t), 1);
  for (const t of due) t.fn();
  for (const e of [...players, ...fans]) {
    e.t += dt;
    // A one-shot that ended hands over to what was queued after it.
    if (e.next && !e.loop && e.t >= (tagLen(e.tag) * e.ms) / 1000) { const n = e.next; anim(e, n.tag, n.ms, n.loop); }
    // A ball handler standing still is never frozen: he switches hands or plays with the ball now and then.
    if (e.ball && !e.mv && e.loop && isDribble(e.tag)) {
      e.idleT -= dt;
      if (e.idleT <= 0) {
        if (Math.random() < 0.6) switchHands(e);
        else moveThen(e, Math.random() < 0.5 ? 'Pocket_Dribble' : 'Hesi', 90, false);
        e.idleT = 1.6 + Math.random() * 2.4;
      }
    }
    if (e.mv) {
      const m = e.mv;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const q = k * k * (3 - 2 * k);
      e.x = m.fx + (m.tx - m.fx) * q;
      e.z = m.fz + (m.tz - m.fz) * q;
      if (k >= 1) e.mv = null;
    }
    if (e.jmp) {
      e.jmp.t += dt;
      const k = Math.min(1, e.jmp.t / e.jmp.dur);
      e.h = Math.sin(Math.PI * k) * e.jmp.h;
      if (k >= 1) { e.jmp = null; e.h = 0; }
    }
  }
  if (ball.flight) {
    const f = ball.flight;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    ball.x = f.fx + (f.tx - f.fx) * k;
    ball.z = f.fz + (f.tz - f.fz) * k;
    const top = Math.max(f.fh, f.th) + f.apex;
    const lin = f.fh + (f.th - f.fh) * k;
    ball.h = lin + Math.sin(Math.PI * k) * (top - (f.fh + f.th) / 2);
    ball.spin += dt;
    if (k >= 1) { ball.flight = null; f.done(); }
  } else if (ball.bounce) {
    const b = ball.bounce;
    b.vh -= 9.8 * dt;
    ball.x += b.vx * dt; ball.z += b.vz * dt; ball.h += b.vh * dt;
    ball.spin += dt;
    if (ball.h <= 0.12) {
      ball.h = 0.12;
      if (Math.abs(b.vh) > 1.2) { b.vh = -b.vh * 0.55; b.vx *= 0.7; b.vz *= 0.7; sfx.bounce(); } else { b.vh = 0; b.vx *= 0.9; b.vz *= 0.9; }
    }
  }
  // Camera: follows the action, slowly.
  camX += (view.goal - camX) * Math.min(1, dt * 3);
  camXs = Math.round(camX * PPM) / PPM;
  if (shakeT > 0) shakeT -= dt;
  if (netT > 0) netT -= dt;
  // Dribble sound on the floor contacts.
  for (const e of players) {
    if (!e.ball || !(e.tag.startsWith('Dribble') || e.tag.includes('_Ball') || e.tag === 'Back_Dribble')) continue;
    const n = Math.floor(e.t / 0.35);
    if (n !== lastBounce) { lastBounce = n; pxsfx.dribble(); }
  }
}
let lastBounce = -1;

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt * view.speed);
  render();
  requestAnimationFrame(loop);
}

/** Start drawing on this canvas (the atlas must be loaded). */
export function startScene(canvas: HTMLCanvasElement, word: HTMLElement) {
  g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  wordEl = word;
  fans.forEach((f) => anim(f, 'Idle', 110 + Math.random() * 40, true));
  requestAnimationFrame(loop);
}

/** The crowd jumps and roars. */
export function cheer() {
  pxsfx.crowd(1);
  fans.forEach((f, i) => { timers.push({ t: i * 0.06, fn: () => { anim(f, 'Jump', 70); jump(f, 0.25, 0.5); timers.push({ t: 1.0, fn: () => anim(f, 'Idle', 110, true) }); } }); });
}

