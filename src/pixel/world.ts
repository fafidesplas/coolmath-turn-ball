// Pixel-art renderer: a 264x234 scene drawn at native resolution and scaled by a whole number of device
// pixels (image-rendering: pixelated). Top-down court from the asset pack, side-view player sprites,
// hoop and net sprites, and pixel previews (dotted routes, rings, walls) for the decision UI.
// A camera crops the scene and enlarges it: close on a duel, wide for a play, back to the whole court
// between plays. Every change is a smooth eased move (no cuts); at rest the zoom is a whole number of
// device pixels per scene pixel and the view starts on a whole scene pixel, so the pixel art stays sharp.
// Three modes: full (up to 2x, frames every preview), soft (one gentle zoom on the duel, few moves) and off.
// Reduced motion never moves it. It offers the same calls the match code used on the 3D world, in court meters.
import { Vector3, type Curve } from 'three';
import { ZONES } from '../rules';
import { COURT_H, COURT_W, HOOP } from './court';
import { A, FEET, atlasImage, drawPiece, drawPlayer, hasPiece, pixText, pixTextW, tagFrame, type Look } from './sprites';
import type { FxStyle } from '../specials';
import { icon } from './pxicons';

/** Scene size in pixels (both divisible by 2 and 3, so every camera zoom covers it exactly). */
export const VIEW_W = 264;
export const VIEW_H = 234;
/** Pixels per meter: along the court (screen x), across it (screen y) and up (height). */
const KX = 15, KY = 11.1, KZ = 14.4;
/** Hoop floor point on screen. */
const HX = 184, HY = 114;
const COURT_OX = -30;
/** Largest camera zoom (full mode). */
export const MAX_ZOOM = 2;
/** Camera modes: full (frames every move, up to 2x), soft (gentle zoom on the duel only), off (whole court). */
export type CamMode = 'full' | 'soft' | 'off';
const MODE_ZOOM: Record<CamMode, number> = { full: 2, soft: 1.5, off: 1 };
const MODE_TIME: Record<CamMode, number> = { full: 0.55, soft: 0.65, off: 0.6 };
/** Ease in and out (cubic). */
const easeIO = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/** A camera view: top-left of the visible part of the scene (scene pixels) and its zoom. */
interface View { x: number; y: number; z: number }

export const project = (x: number, y: number, h = 0) => ({ x: HX - (y - HOOP.y) * KX, y: HY + (x - HOOP.x) * KY - h * KZ });
const fromWorld = (v: Vector3) => project(v.x + COURT_W / 2, v.z + COURT_H / 2, v.y);
const RIMP = project(HOOP.x, HOOP.y, 3.05);

export type Marker = 'home' | 'away';
export interface PixelLook extends Look { marker: Marker; num: number }

export interface PixelPose {
  x: number;
  y: number;
  face: number;
  moving: boolean;
  fast: boolean;
  /** A long move: runs (Run / Sprint) even on defense, instead of the short defensive slide. */
  run?: boolean;
  daze: boolean;
  /** This player holds the ball (drawn in the sprite when the frame has it). */
  carry: boolean;
  defending: boolean;
  deciding: boolean;
  /** One-shot animation (shot, dunk, block, steal...). */
  act: { tag: string; t: number; ms?: number } | null;
  open: boolean;
  showNum: boolean;
  /** Per-player animation style (which idle and dribble variants of the pack they use). */
  style?: number;
  /** Holding the ball at the post: back to the basket. */
  post?: boolean;
}

const IDLE_BALL = ['Idle_Ball_1', 'Idle_Ball_2', 'Idle_Ball_3', 'Idle_Ball_4', 'Switch_Dribble_2'];
const DRIBBLE_R = ['Dribble_1', 'Dribble_2'];
const DRIBBLE_L = ['Dribble_1_Left', 'Dribble_2_Left'];

interface PV { look: PixelLook; flip: boolean; clock: number; s: PixelPose | null; frame: number; ballDrawn: boolean }

type Ring = { x: number; y: number; rx: number; ry: number; color: string; pulse: boolean; style: 'target' | 'danger' | 'plain' };
/**
 * Shape of a preview path, so a path never reads by its color alone: a ball in the air is dots (hollow squares
 * for a lob), a player who runs is arrowheads pointing where he goes, a danger is crosses, a threat is dashes.
 */
export type DotShape = 'dot' | 'ring' | 'chev' | 'x' | 'dash';
type Dots = { curve: Curve<Vector3>; n: number; color: string; size: number; speed: number; phase: number; shape: DotShape };
/** A hatched floor area (scene pixels). The hatch pattern carries the meaning, not only the color. */
export type Hatch = 'cross' | 'lines' | 'diag' | 'dots';
type Area = { pts: { x: number; y: number }[]; color: string; hatch: Hatch };
/** Marking line from a defender to his man (court meters). */
export interface Tether { ax: number; ay: number; bx: number; by: number; strong: boolean; mine: boolean }
type Wall = { x: number; y: number; w: number; h: number; color: string };
type Ghost = { x: number; y: number; color: string };
interface Label { el: HTMLElement; x: number; y: number }
interface Floater { el: HTMLElement; x: number; y: number; t: number; hold?: number; life?: number }
/** Pixel particle (canvas pixels). */
interface Part { x: number; y: number; vx: number; vy: number; g: number; t: number; life: number; kind: 'flame' | 'spark' | 'smoke' | 'frost' | 'wind' | 'dust' | 'bolt' | 'ring'; size: number }
interface Aura { i: number; style: FxStyle; t: number }
interface Ghost2 { i: number; x: number; y: number; frame: number; flip: boolean; t: number; color: string }

/** Flame ramp by remaining life (light to dark): luminance carries the age, not only the hue. */
const FLAME = ['#fffbe0', '#ffe066', '#ffb02e', '#ff6a1a', '#d62f1f', '#7a1d2e', '#3b1630'];
const FX_COL: Record<FxStyle, string[]> = {
  fire: FLAME,
  bolt: ['#ffffff', '#fff3a0', '#ffd60a', '#b8a23a', '#4a4030'],
  frost: ['#ffffff', '#d8f6ff', '#8fe3ff', '#4aa8d8', '#24527a'],
  wind: ['#ffffff', '#eef7ff', '#bcd4e6', '#7f96ad', '#3e4c5e'],
  spark: ['#ffffff', '#ffd6f5', '#ff8fd8', '#c04ab0', '#5a2160'],
  quake: ['#fff1d6', '#d9b48a', '#a87c55', '#6e4b33', '#3a271c'],
};
const rampAt = (ramp: string[], k: number) => ramp[Math.min(ramp.length - 1, Math.max(0, Math.floor(k * ramp.length)))];

type Box = { l: number; t: number; w: number; h: number };
/**
 * Screen layout computed from the window size only (never from what is shown): HUD on top, the stage, and the
 * command window below the stage (stack) or beside it (side). Every box keeps its size until the window resizes.
 */
export interface Layout {
  side: boolean;
  hud: Box;
  court: Box;
  win: Box;
  /** The command window puts its info box beside the list (cols) or above it (rows). */
  cols: boolean;
  scale: number;
}
/** A point of the scene in pixels (for camera framing). */
export interface ScenePt { x: number; y: number }

const GOOD = '#3ddc97', BAD = '#ff4d6d';
const INK = '#1b1029';

export interface LabelSpec { pos: Vector3; html: string; cls?: string }

export class PixelWorld {
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private labelsEl: HTMLDivElement;
  private players: PV[] = [];
  private ball = { x: 0, y: 0, gx: 0, gy: 0, h: 0, spin: 0 };
  private handler: { x: number; y: number } | null = null;
  private rings: Ring[] = [];
  private dotPaths: Dots[] = [];
  private walls: Wall[] = [];
  private ghosts: Ghost[] = [];
  private labels: Label[] = [];
  private floaters: Floater[] = [];
  private time = 0;
  private netKick = 0;
  private rimKick = 0;
  private ro: ResizeObserver;
  /** CSS pixels per canvas pixel. */
  private k = 1;
  /** Camera: the view shown now, where it is going and the eased move between them. */
  private cam: View = { x: 0, y: 0, z: 1 };
  private camGoal: View = { x: 0, y: 0, z: 1 };
  private tween: { a: View; b: View; t: number; dur: number } | null = null;
  /** A short close-up (dunks, specials): the view to return to and the time left. */
  private zoom: { back: View; t: number; dur: number } | null = null;
  /** Camera mode (pause menu). */
  camMode: CamMode = 'soft';
  /** Device pixels per scene pixel at zoom 1 (the canvas is drawn at device resolution). */
  private S = 1;
  /** Light frame drawn around the two players of a duel (scene pixels), or null. */
  private duelBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Numbered step badges of a combo preview (alt: the other way the play can go, dashed frame). */
  private badges: { x: number; y: number; n: number; alt: boolean }[] = [];
  /** Hatched floor areas of a preview (what a defensive move covers, what it leaves open). */
  private areas: Area[] = [];
  /** Paths and warnings that previews do not clear (the attack's threat while you choose on defense). */
  private keepDots: Dots[] = [];
  private warns: { x: number; y: number }[] = [];
  /** Who guards whom (marking lines), and the human's own defender on defense (index, or -1). */
  private tethers: Tether[] | null = null;
  private mine = -1;
  /** Spectators: pack characters behind the baseline and on the bench (cheer on big plays). */
  private fans: { look: PixelLook; x: number; y: number; flip: boolean; clock: number; cheer: number }[] = [];
  /** Hit-stop: the picture holds for a few frames on a big impact (dunk, block). */
  private hold = 0;
  /** Hand cursor pointing at a scene point (target selection). */
  private hand: ScenePt | null = null;
  /** Persistent labels (the opponent's tell) that previews do not clear. */
  private marks: Label[] = [];
  shake = 0;
  showZones = true;
  /** Reduced motion: no shake, zoom, flashes or letterbox; few particles. */
  reduce = false;
  layout: Layout | null = null;
  onLayout: ((l: Layout) => void) | null = null;
  private view: HTMLCanvasElement;
  private vg: CanvasRenderingContext2D;
  private parts: Part[] = [];
  private auras: Aura[] = [];
  private ghosts2: Ghost2[] = [];
  private trail: { style: FxStyle; pts: { x: number; y: number; t: number }[] } | null = null;
  private flash = 0;
  private flashCol = '#ffffff';
  /** Letterbox bars (cinematics). */
  private bars = 0;
  private speedLines = 0;

  constructor(private container: HTMLElement, looks: PixelLook[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'px-canvas';
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.vg = this.canvas.getContext('2d')!;
    this.vg.imageSmoothingEnabled = false;
    // The scene is drawn into an offscreen buffer, then copied (or zoomed by a whole number) to the screen.
    this.view = document.createElement('canvas');
    this.view.width = VIEW_W;
    this.view.height = VIEW_H;
    this.g = this.view.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
    this.labelsEl = document.createElement('div');
    this.labelsEl.className = 'px-labels';
    container.append(this.canvas, this.labelsEl);
    this.players = looks.map((look) => ({ look, flip: false, clock: Math.random() * 3, s: null, frame: 0, ballDrawn: false }));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
    this.marks = [];
    this.container.innerHTML = '';
  }

  /**
   * Whole-number scale in device pixels, from the window size only. Stack: HUD, stage, command window below
   * (the classic battle screen). Side: HUD, then stage and command window side by side (short landscape
   * screens). Whichever gives the bigger scale wins; on a tie the window goes below. The whole scene always
   * fits: nothing of the court is ever cropped.
   */
  resize() {
    const screen = this.container.parentElement;
    const W = (screen?.clientWidth || this.container.clientWidth) || 1, H = (screen?.clientHeight || this.container.clientHeight) || 1;
    const dpr = window.devicePixelRatio || 1;
    const small = W < 700 || H < 520;
    const pad = small ? 6 : 14, gap = small ? 6 : 12;
    const hudH = small ? 52 : 64;
    const rowH = small ? 46 : 54;
    const infoRowsH = small ? 84 : 96;
    // Smallest command window: five rows (defense has five commands), borders and padding.
    const minWinH = 5 * rowH + 28;
    const fit = (availW: number, availH: number) => Math.max(1, Math.floor(Math.min((availW * dpr) / VIEW_W, (availH * dpr) / VIEW_H)));
    const sStack = fit(W - 2 * pad, H - 2 * pad - hudH - 2 * gap - minWinH);
    const minSideW = 300;
    const sSide = fit(W - 2 * pad - gap - minSideW, H - 2 * pad - hudH - gap);
    const side = sSide > sStack;
    const s = side ? sSide : sStack;
    const cw = (VIEW_W * s) / dpr, ch = (VIEW_H * s) / dpr;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    let L: Layout;
    if (!side) {
      const winW = Math.round(Math.min(W - 2 * pad, Math.max(cw, Math.min(900, W - 2 * pad))));
      // The window takes what is left below the stage, up to seven rows.
      const spare = H - 2 * pad - hudH - 2 * gap - ch;
      const cols = winW >= 560;
      const maxWinH = (cols ? 7 * rowH : 6 * rowH + infoRowsH) + 28;
      const winH = Math.round(Math.max(minWinH, Math.min(spare, maxWinH)));
      const groupH = hudH + gap + ch + gap + winH;
      const top = Math.max(pad, Math.round((H - groupH) / 2));
      const hudW = Math.round(Math.min(W - 2 * pad, Math.max(cw, winW)));
      L = {
        side, cols, scale: s / dpr,
        hud: { l: Math.round((W - hudW) / 2), t: top, w: hudW, h: hudH },
        court: { l: snap((W - cw) / 2), t: snap(top + hudH + gap), w: cw, h: ch },
        win: { l: Math.round((W - winW) / 2), t: Math.round(top + hudH + gap + ch + gap), w: winW, h: winH },
      };
    } else {
      const winW = Math.round(Math.min(560, Math.max(minSideW, W - 2 * pad - gap - cw)));
      const groupW = cw + gap + winW;
      const left = snap(Math.max(pad, (W - groupW) / 2));
      const bodyH = Math.max(ch, Math.min(H - 2 * pad - hudH - gap, minWinH + 2 * rowH));
      const groupH = hudH + gap + bodyH;
      const top = Math.max(pad, Math.round((H - groupH) / 2));
      const bodyT = top + hudH + gap;
      L = {
        side, cols: winW >= 560, scale: s / dpr,
        hud: { l: Math.round(left), t: top, w: Math.round(groupW), h: hudH },
        court: { l: left, t: snap(bodyT + (bodyH - ch) / 2), w: cw, h: ch },
        win: { l: Math.round(left + cw + gap), t: Math.round(bodyT), w: winW, h: Math.round(bodyH) },
      };
    }
    // The canvas is drawn at device resolution: s device pixels per scene pixel at zoom 1.
    if (this.canvas.width !== VIEW_W * s || this.canvas.height !== VIEW_H * s) {
      this.canvas.width = VIEW_W * s;
      this.canvas.height = VIEW_H * s;
      this.vg.imageSmoothingEnabled = false;
    }
    this.S = s;
    for (const el of [this.canvas, this.labelsEl]) {
      el.style.width = `${L.court.w}px`;
      el.style.height = `${L.court.h}px`;
      el.style.left = `${L.court.l}px`;
      el.style.top = `${L.court.t}px`;
    }
    this.k = s / dpr;
    this.layout = L;
    if (screen) {
      screen.classList.toggle('side', side);
      screen.classList.toggle('stack', !side);
      screen.classList.toggle('small', small);
      const v = (k: string, n: number) => screen.style.setProperty(k, `${Math.round(n * 100) / 100}px`);
      v('--court-l', L.court.l); v('--court-w', L.court.w); v('--court-top', L.court.t); v('--court-h', L.court.h);
      v('--hud-l', L.hud.l); v('--hud-t', L.hud.t); v('--hud-w', L.hud.w); v('--hud-h', L.hud.h);
      v('--win-l', L.win.l); v('--win-t', L.win.t); v('--win-w', L.win.w); v('--win-h', L.win.h);
      v('--row-h', rowH); v('--info-h', infoRowsH);
      screen.classList.toggle('wcols', L.cols);
      screen.style.setProperty('--px', `${Math.max(2, Math.round(this.k))}px`);
    }
    this.onLayout?.(L);
    this.placeLabels();
  }

  // ---------------------------------------------------------------- per-frame state
  setPlayer(i: number, s: PixelPose, dt: number) {
    const pv = this.players[i];
    pv.clock += dt;
    pv.s = s;
    const c = Math.cos(s.face);
    if (Math.abs(c) > 0.2) pv.flip = c > 0;
  }

  setBall(p: Vector3, spin: number) {
    const sp = fromWorld(p);
    const gp = project(p.x + COURT_W / 2, p.z + COURT_H / 2, 0);
    this.ball.x = sp.x; this.ball.y = sp.y; this.ball.gx = gp.x; this.ball.gy = gp.y; this.ball.h = p.y;
    this.ball.spin += spin;
  }

  setHandler(pos: Vector3 | null) { this.handler = pos ? project(pos.x + COURT_W / 2, pos.z + COURT_H / 2, 0) : null; }
  kickNet() { this.netKick = 1; }
  kickRim() { this.rimKick = 1; }

  /** Screen point (canvas pixels) of a court point. */
  screenOf(x: number, y: number, h = 0) { return project(x, y, h); }

  /** Canvas pixel under a client point. */
  pickScreen(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return null;
    const c = this.view0();
    return { x: c.x + ((clientX - r.left) / r.width) * (VIEW_W / c.z), y: c.y + ((clientY - r.top) / r.height) * (VIEW_H / c.z) };
  }

  // ---------------------------------------------------------------- previews
  clearPreview() {
    this.rings = []; this.dotPaths = []; this.walls = []; this.ghosts = [];
    this.badges = []; this.areas = [];
    this.hand = null;
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  /** A label that stays until clearMarks (the opponent's tell over a player). */
  mark(pos: Vector3, html: string, cls = '') {
    const el = document.createElement('div');
    el.className = `wlabel ${cls}`;
    el.innerHTML = html;
    this.labelsEl.appendChild(el);
    const s = fromWorld(pos);
    const l = { el, x: Math.round(s.x), y: Math.round(s.y) };
    this.marks.push(l);
    this.placeLabel(l.el, l.x, l.y);
  }
  clearMarks() { for (const l of this.marks) l.el.remove(); this.marks = []; this.keepDots = []; this.warns = []; }

  /** Marking lines (defender to his man), or none. */
  setTethers(t: Tether[] | null) { this.tethers = t; }
  /** The human's own defender (shield over him), or -1. */
  setMine(i: number) { this.mine = i; }
  /** A threat: a path the attack is likely to take, kept until clearMarks, with a warning sign at its end. */
  threat(curve: Curve<Vector3>, shape: DotShape = 'dash') {
    const len = curve.getLength();
    this.keepDots.push({ curve, n: Math.max(4, Math.round(len / 0.34)), color: '#ffb02e', size: 2, speed: 1.1, phase: 0, shape });
    const e = fromWorld(curve.getPointAt(1));
    this.warns.push({ x: Math.round(e.x), y: Math.round(e.y) });
  }
  /** A warning sign (threat) over a court point, kept until clearMarks. */
  warnAt(p: Vector3) { const s = fromWorld(p); this.warns.push({ x: Math.round(s.x), y: Math.round(s.y) }); }
  /** A hatched floor area: a polygon in court meters. */
  area(poly: { x: number; y: number }[], color: string, hatch: Hatch) {
    this.areas.push({ pts: poly.map((q) => { const s = project(q.x, q.y); return { x: Math.round(s.x), y: Math.round(s.y) }; }), color, hatch });
  }
  /** A hatched disc on the floor (court meters). */
  disc(x: number, y: number, r: number, color: string, hatch: Hatch) {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }); }
    this.area(pts, color, hatch);
  }
  /**
   * Beat 3 of a duel: a big icon (and at most one word) over the player who decided it. It holds still while
   * the action pauses, then rises and fades.
   */
  stamp(pos: Vector3, ic: string, tone: string, word = '') {
    const el = document.createElement('div');
    el.className = `callout stamp ${tone}${this.reduce ? ' calm' : ''}`;
    el.innerHTML = `${icon(ic, 48)}${word ? `<small>${word}</small>` : ''}`;
    this.labelsEl.appendChild(el);
    const s = fromWorld(pos);
    this.floaters.push({ el, x: Math.round(s.x), y: Math.round(s.y), t: 0, hold: 0.9, life: 2.0 });
  }

  /** Point the hand cursor at a court point (meters), or hide it. */
  pointAt(x: number | null, y = 0) { this.hand = x === null ? null : project(x, y); }

  // ---------------------------------------------------------------- camera
  /** Largest zoom of the current mode, as a whole number of device pixels per scene pixel. */
  private maxZoom(cap = MAX_ZOOM) {
    if (this.reduce || this.camMode === 'off') return 1;
    return this.quant(Math.min(cap, MODE_ZOOM[this.camMode]));
  }
  /** Round a zoom down so one scene pixel covers a whole number of device pixels. */
  private quant(z: number) { return Math.max(1, Math.floor(this.S * z + 1e-6) / this.S); }
  /**
   * Frame a set of scene points: the biggest zoom (up to `maxZ` and the mode's limit) that keeps them all in view
   * with a margin, centered on them. Soft mode moves as little as it can: one gentle zoom on the duel, and for
   * previews (`keep`) it stays put if the points are in view, else it opens to the whole court. Off and reduced
   * motion keep the whole court.
   */
  frame(pts: ScenePt[], maxZ = MAX_ZOOM, margin = 14, keep = false) {
    if (!pts.length || this.reduce || this.camMode === 'off') { this.overview(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    x0 -= margin; x1 += margin; y0 -= margin; y1 += margin;
    if (this.camMode === 'soft' && keep) {
      // Previews in soft mode: stay if everything is in view, else open to the whole court (never a new close-up).
      const g = this.camGoal, w = VIEW_W / g.z, h = VIEW_H / g.z;
      if (!(x0 >= g.x && y0 >= g.y && x1 <= g.x + w && y1 <= g.y + h)) this.overview();
      return;
    }
    let z = this.maxZoom(maxZ);
    const fit = Math.min(VIEW_W / Math.max(1, x1 - x0), VIEW_H / Math.max(1, y1 - y0));
    if (fit < z) z = this.quant(fit);
    if (this.camMode === 'soft' && z < this.maxZoom(maxZ)) z = 1;
    this.goTo(this.clampCam((x0 + x1) / 2, (y0 + y1) / 2, z));
  }
  /** The whole court. */
  overview() { this.goTo({ x: 0, y: 0, z: 1 }); }
  /** Current zoom (tests). */
  get zoomLevel() { return this.cam.z; }
  /** The camera is moving (tests, shake). */
  get camMoving() { return !!this.tween; }
  /** Change the camera mode: the view eases to what the mode allows. */
  setCamMode(m: CamMode) {
    this.camMode = m;
    const g = this.camGoal;
    if (m === 'off') this.overview();
    else if (g.z > this.maxZoom()) this.goTo(this.clampCam(g.x + VIEW_W / g.z / 2, g.y + VIEW_H / g.z / 2, this.maxZoom()));
  }
  private clampCam(cx: number, cy: number, z: number): View {
    const w = VIEW_W / z, h = VIEW_H / z;
    return { x: Math.floor(Math.min(VIEW_W - w, Math.max(0, Math.round(cx - w / 2)))), y: Math.floor(Math.min(VIEW_H - h, Math.max(0, Math.round(cy - h / 2)))), z };
  }
  /** Ease the camera to a view (reduced motion: no move at all, the court stays whole). */
  private goTo(v: View) {
    const g = this.camGoal;
    if (this.zoom) { this.zoom.back = v; return; }
    if (g.x === v.x && g.y === v.y && g.z === v.z) return;
    this.camGoal = v;
    if (this.reduce) { this.cam = { ...v }; this.tween = null; return; }
    // Small pans at the same zoom (a few pixels) are not worth a move: they would only wobble.
    if (!this.tween && v.z === this.cam.z && Math.abs(v.x - this.cam.x) <= 2 && Math.abs(v.y - this.cam.y) <= 2) { this.cam = { ...v }; return; }
    this.tween = { a: { ...this.cam }, b: { ...v }, t: 0, dur: MODE_TIME[this.camMode] };
  }
  /** The view used this frame. */
  private view0(): View { return this.cam; }
  /** Advance the eased move: the center moves along a straight line, the zoom on a log scale (steady growth). */
  private stepCam(dt: number) {
    if (this.zoom) {
      this.zoom.t += dt;
      if (this.zoom.t >= this.zoom.dur) { const back = this.zoom.back; this.zoom = null; this.labelsEl.classList.remove('hide'); this.goTo(back); }
    }
    const tw = this.tween;
    if (!tw) return;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    if (k >= 1) { this.cam = { ...tw.b }; this.tween = null; return; }
    const e = easeIO(k);
    const z = tw.a.z * Math.pow(tw.b.z / tw.a.z, e);
    const ca = { x: tw.a.x + VIEW_W / tw.a.z / 2, y: tw.a.y + VIEW_H / tw.a.z / 2 };
    const cb = { x: tw.b.x + VIEW_W / tw.b.z / 2, y: tw.b.y + VIEW_H / tw.b.z / 2 };
    const cx = ca.x + (cb.x - ca.x) * e, cy = ca.y + (cb.y - ca.y) * e;
    const w = VIEW_W / z, h = VIEW_H / z;
    this.cam = { x: Math.min(VIEW_W - w, Math.max(0, cx - w / 2)), y: Math.min(VIEW_H - h, Math.max(0, cy - h / 2)), z };
  }

  /** Light corner brackets around the duel (scene points), or none. */
  setDuelBox(pts: ScenePt[] | null) {
    if (!pts?.length) { this.duelBox = null; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    this.duelBox = { x0: Math.round(x0 - 6), y0: Math.round(y0 - 4), x1: Math.round(x1 + 6), y1: Math.round(y1 + 6) };
  }
  /** Numbered badge of a combo step at a court point (meters, height in meters). */
  badge(p: Vector3, n: number, alt = false) { const s = fromWorld(p); this.badges.push({ x: Math.round(s.x), y: Math.round(s.y), n, alt }); }
  /** Hold the picture for a moment (hit-stop on a big impact). */
  hitStop(t = 0.08) { if (!this.reduce) this.hold = Math.max(this.hold, t); }
  /** The picture is holding (the match pauses its clock too). */
  get holding() { return this.hold > 0; }
  /** Spectators cheer (big plays). */
  cheer(k = 1) { for (const f of this.fans) f.cheer = Math.max(f.cheer, 0.6 + Math.random() * 0.5 * k); }
  /** Spectators: a few pack characters behind the baseline and behind the bench. */
  setFans(looks: PixelLook[]) {
    const spots = [{ x: 252, y: 96 }, { x: 247, y: 128 }, { x: 254, y: 160 }, { x: 52, y: 214 }, { x: 118, y: 214 }];
    this.fans = spots.slice(0, looks.length).map((p, i) => ({ look: looks[i], x: p.x, y: p.y, flip: p.x < 200, clock: Math.random() * 3, cheer: 0 }));
  }

  dots(curve: Curve<Vector3>, color: string, radius = 0.07, spacing = 0.32, speed = 0.9, shape: DotShape = 'dot') {
    const len = curve.getLength();
    const k = shape === 'chev' ? 1.7 : 1.15;
    this.dotPaths.push({ curve, n: Math.max(3, Math.round(len / (spacing * k))), color, size: radius >= 0.075 ? 2 : 1, speed, phase: 0, shape });
  }

  ghostBall(p: Vector3, color = '#ffffff') { const s = fromWorld(p); this.ghosts.push({ x: s.x, y: s.y, color }); }

  floorRing(p: Vector3, color: string, r = 0.75, pulse = true) {
    const s = project(p.x + COURT_W / 2, p.z + COURT_H / 2, 0);
    const style = color === BAD ? 'danger' : color === GOOD ? 'target' : 'plain';
    this.rings.push({ x: s.x, y: s.y, rx: Math.max(4, r * KY * 1.1), ry: Math.max(2, r * KY * 0.5), color, pulse, style });
  }

  wall(a: Vector3, _facing: Vector3, color: string, wdt = 1.3, hgt = 1.6, baseH = 1.8) {
    const s = project(a.x + COURT_W / 2, a.z + COURT_H / 2, baseH + hgt);
    this.walls.push({ x: s.x, y: s.y, w: Math.max(3, Math.round(wdt * 5)), h: Math.round(hgt * KZ), color });
  }

  label(spec: LabelSpec) {
    const el = document.createElement('div');
    el.className = `wlabel ${spec.cls ?? ''}`;
    el.innerHTML = spec.html;
    this.labelsEl.appendChild(el);
    const s = fromWorld(spec.pos);
    const l = { el, x: Math.round(s.x), y: Math.round(s.y) };
    this.labels.push(l);
    this.placeLabel(l.el, l.x, l.y);
  }

  callout(pos: Vector3, html: string, cls = '') {
    const el = document.createElement('div');
    el.className = `callout ${cls}`;
    el.innerHTML = html;
    this.labelsEl.appendChild(el);
    const s = fromWorld(pos);
    this.floaters.push({ el, x: Math.round(s.x), y: Math.round(s.y), t: 0 });
  }

  private placeLabel(el: HTMLElement, x: number, y: number) {
    const c = this.view0();
    const sx = (x - c.x) * c.z, sy = (y - c.y) * c.z;
    const cx = Math.min(VIEW_W - 8, Math.max(8, sx));
    const cy = Math.max(14, Math.min(VIEW_H, sy));
    el.style.transform = `translate(${Math.round(cx * this.k)}px, ${Math.round(cy * this.k)}px) translate(-50%, -100%)`;
  }
  private placeLabels() { for (const l of this.labels) this.placeLabel(l.el, l.x, l.y); for (const l of this.marks) this.placeLabel(l.el, l.x, l.y); }

  // ---------------------------------------------------------------- drawing helpers
  private px(x: number, y: number, c: string, w = 1, h = 1) { this.g.fillStyle = c; this.g.fillRect(Math.round(x), Math.round(y), w, h); }

  /** One-pixel ellipse outline (optionally dashed). */
  private ellipse(cx: number, cy: number, rx: number, ry: number, c: string, dash = 0, phase = 0) {
    const pts = new Set<number>();
    const steps = Math.ceil((rx + ry) * 4);
    this.g.fillStyle = c;
    for (let i = 0; i < steps; i++) {
      if (dash && Math.floor((i / steps) * dash * 2 + phase) % 2) continue;
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
      const key = x * 1000 + y;
      if (pts.has(key)) continue;
      pts.add(key);
      this.g.fillRect(x, y, 1, 1);
    }
  }

  private diamond(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.g.fillStyle = c;
    for (let i = 0; i <= rx; i++) {
      const dy = Math.round((1 - i / rx) * ry);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.g.fillRect(Math.round(cx + sx * i), Math.round(cy + sy * dy), 1, 1);
    }
  }

  /** Home: a hollow light ring. Away: a solid dark diamond with a light rim. Shape and luminance both differ. */
  private teamMarker(x: number, y: number, m: Marker) {
    if (m === 'home') {
      this.ellipse(x, y + 1, 8, 4, INK);
      this.ellipse(x, y, 8, 4, '#fff7ea');
      this.ellipse(x, y, 7, 3, '#fff7ea');
    } else {
      for (let r = 8; r >= 0; r--) this.diamond(x, y, r, (r * 4) / 8, r >= 7 ? '#fff7ea' : INK);
    }
  }

  // ---------------------------------------------------------------- frame
  render(dt: number) {
    // Hit-stop: the picture holds still for a few frames.
    if (this.hold > 0) { this.hold = Math.max(0, this.hold - dt); this.blit(0); return; }
    this.time += dt;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#2a1b3d';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    const sheet = atlasImage();
    // Ground: grass strip behind the baseline, the court, props.
    for (let y = 0; y < VIEW_H; y += 16) for (let x = 238; x < VIEW_W; x += 48) drawPiece(g, sheet, 'grass', x, y);
    drawPiece(g, sheet, 'court', COURT_OX, 0);
    drawPiece(g, sheet, 'fence', 240, 2);
    drawPiece(g, sheet, 'fence', 240, 176);
    // Spectators (pack characters): idle, jumping while they cheer.
    for (const f of this.fans) {
      f.clock += dt;
      f.cheer = Math.max(0, f.cheer - dt);
      const fr = f.cheer > 0 ? tagFrame('Jump', f.clock, true, 70) : tagFrame('Idle', f.clock, true);
      drawPlayer(g, f.look, fr, f.x - FEET.x, f.y - FEET.y, f.flip, false);
    }
    drawPiece(g, sheet, 'bench3', 40, 210);
    drawPiece(g, sheet, 'trash', 76, 207);
    drawPiece(g, sheet, 'bench1', 100, 210);
    drawPiece(g, sheet, 'bottle', 134, 212);
    drawPiece(g, sheet, 'skate', 30, 6);
    drawPiece(g, sheet, 'bench2', 110, 4);

    if (this.showZones) this.drawZones();
    for (const a of this.areas) this.drawArea(a);
    if (this.tethers) for (const t of this.tethers) this.drawTether(t);

    // Floor previews.
    const pulse = Math.sin(this.time * 6) > 0 ? 1 : 0;
    for (const r of this.rings) {
      const e = r.pulse ? pulse : 0;
      if (r.style === 'danger') {
        this.ellipse(r.x, r.y + 1, r.rx, r.ry, INK, 8, this.time * 2);
        this.ellipse(r.x, r.y, r.rx, r.ry, '#ff5c7a', 8, this.time * 2);
        // Cross mark: danger is never told by color alone.
        const cx = Math.round(r.x + r.rx + 2), cy = Math.round(r.y - r.ry - 2);
        for (let i = -2; i <= 2; i++) { this.px(cx + i, cy + i, INK, 2, 2); this.px(cx + i, cy - i, INK, 2, 2); }
        for (let i = -2; i <= 2; i++) { this.px(cx + i, cy + i, '#ff5c7a'); this.px(cx + i, cy - i, '#ff5c7a'); }
      } else if (r.style === 'target') {
        this.ellipse(r.x, r.y + 1, r.rx + e, r.ry + e * 0.5, INK);
        this.ellipse(r.x, r.y, r.rx + e, r.ry + e * 0.5, '#b7ffd9');
        this.ellipse(r.x, r.y, Math.max(2, r.rx - 3 + e), Math.max(1, r.ry - 2 + e * 0.5), '#b7ffd9');
      } else {
        this.ellipse(r.x, r.y + 1, r.rx + e, r.ry, INK);
        this.ellipse(r.x, r.y, r.rx + e, r.ry, r.color);
      }
    }

    // Player floor markers (team shape, open man, ball handler).
    for (const pv of this.players) {
      const s = pv.s;
      if (!s) continue;
      const p = project(s.x, s.y);
      if (s.open) { this.ellipse(p.x, p.y, 11, 5, INK, 6, this.time * 3); this.ellipse(p.x, p.y - 1, 11, 5, '#b7ffd9', 6, this.time * 3); }
      this.teamMarker(p.x, p.y, pv.look.marker);
    }
    if (this.handler) {
      const h = this.handler, e = Math.sin(this.time * 6) > 0 ? 1 : 0;
      this.ellipse(h.x, h.y + 1, 10 + e, 5, INK);
      this.ellipse(h.x, h.y, 10 + e, 5, '#ffd60a');
      this.ellipse(h.x, h.y, 11 + e, 5, '#ffd60a');
    }

    // Hoop stand behind the baseline.
    drawPiece(g, sheet, 'stand', Math.round(RIMP.x) - 6, Math.round(RIMP.y) - 26);

    // Players, back to front.
    const order = this.players.map((pv, i) => ({ pv, i })).filter((o) => o.pv.s).sort((a, b) => a.pv.s!.x - b.pv.s!.x);
    let ballShown = false;
    for (const { pv } of order) {
      const s = pv.s!;
      let tag: string, t: number, loop = true, ms: number | undefined;
      if (s.act) { tag = s.act.tag; t = s.act.t; loop = false; ms = s.act.ms; }
      else {
        t = pv.clock;
        if (s.moving) tag = s.carry ? (s.fast ? 'Sprint_Ball' : 'Run_Ball') : s.fast ? 'Sprint' : s.defending && !s.run ? 'Slide' : 'Run';
        else if (s.carry) {
          const k = s.style ?? 0;
          if (s.post) tag = s.deciding ? (k % 2 ? 'Back_Idle' : 'Back_Idle_2') : 'Back_Dribble';
          else if (s.deciding) tag = IDLE_BALL[k % IDLE_BALL.length];
          else tag = ((k >>> 5) % 3 === 0 ? DRIBBLE_L : DRIBBLE_R)[(k >>> 2) % 2];
        }
        else tag = s.defending ? 'Idle_2' : 'Idle';
      }
      const f = tagFrame(tag, t, loop, ms);
      pv.frame = f;
      const p = project(s.x, s.y);
      const ox = Math.round(p.x) - FEET.x, oy = Math.round(p.y) - FEET.y;
      const withBall = s.carry && hasPiece(`ball:${f}`);
      pv.ballDrawn = withBall;
      if (withBall) ballShown = true;
      drawPlayer(g, pv.look, f, ox, oy, pv.flip, withBall);
    }

    // Rim and net (the ball passes between them when it goes in).
    const rk = this.rimKick > 0 ? (Math.sin(this.time * 60) > 0 ? 1 : 0) : 0;
    const rx = Math.round(RIMP.x) - 8 + rk, ry = Math.round(RIMP.y) - 5;
    drawPiece(g, sheet, 'rim', rx, ry);
    const nearRim = Math.abs(this.ball.x - RIMP.x) < 10 && this.ball.y > RIMP.y - 6 && this.ball.y < RIMP.y + 16;
    if (!ballShown && nearRim) this.drawBall();
    // Net: the bottom half stretches down for a moment on a make.
    const nx = Math.round(RIMP.x) - 7, ny = Math.round(RIMP.y) - 2;
    const stretch = Math.round(this.netKick * 3);
    if (stretch) {
      g.drawImage(sheet, ...this.netSlice(0, 6), nx, ny, 14, 6);
      g.drawImage(sheet, ...this.netSlice(6, 7), nx, ny + 6 + stretch, 14, 7);
      for (let i = 0; i < stretch; i++) g.drawImage(sheet, ...this.netSlice(5, 1), nx, ny + 6 + i, 14, 1);
    } else drawPiece(g, sheet, 'net', nx, ny);
    if (!ballShown && !nearRim) this.drawBall();

    // Air previews.
    for (const d of [...this.dotPaths, ...this.keepDots]) {
      d.phase = (d.phase + dt * d.speed) % 1;
      for (let i = 0; i < d.n; i++) {
        const k = Math.min(1, (i + d.phase) / d.n);
        const q = fromWorld(d.curve.getPointAt(k));
        if (d.shape === 'dot') {
          const x = Math.round(q.x), y = Math.round(q.y);
          this.px(x, y + 1, INK, d.size, d.size);
          this.px(x, y, d.color, d.size, d.size);
          continue;
        }
        const q2 = fromWorld(d.curve.getPointAt(Math.min(1, k + 0.02)));
        const q0 = fromWorld(d.curve.getPointAt(Math.max(0, k - 0.02)));
        this.mark2(q.x, q.y, q2.x - q0.x, q2.y - q0.y, d.shape, d.color);
      }
    }
    for (const w of this.walls) {
      const x0 = Math.round(w.x - w.w / 2), y0 = Math.round(w.y);
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
        const edge = x === 0 || y === 0 || x === w.w - 1 || y === w.h - 1;
        if (edge || (x + y) % 3 === 0) this.px(x0 + x, y0 + y, edge ? w.color : w.color);
      }
    }
    for (const gb of this.ghosts) {
      this.ellipse(gb.x, gb.y + 1, 5, 5, INK);
      this.ellipse(gb.x, gb.y, 5, 5, gb.color === GOOD ? '#b7ffd9' : gb.color);
    }
    // Combo steps: numbered square badges (dark box, light digit) along the routes.
    for (const b of this.badges) {
      const label = String(b.n);
      const w = pixTextW(label) + 6;
      this.px(b.x - Math.ceil(w / 2) - 1, b.y - 6, INK, w + 2, 11);
      this.px(b.x - Math.ceil(w / 2), b.y - 5, '#fff7ea', w, 9);
      this.px(b.x - Math.ceil(w / 2) + 1, b.y - 4, INK, w - 2, 7);
      // The other way the play can go: a dashed frame (every other pixel of the light rim is dark).
      if (b.alt) for (let i = 0; i < w; i += 2) { this.px(b.x - Math.ceil(w / 2) + i, b.y - 5, INK); this.px(b.x - Math.ceil(w / 2) + i, b.y + 3, INK); }
      pixText(g, label, b.x - Math.floor(pixTextW(label) / 2), b.y - 3, '#ffd166');
    }
    // Duel frame: light corner brackets around the two players facing off (the duel stays on the court).
    if (this.duelBox) {
      const d = this.duelBox, L = 6;
      const corner = (x: number, y: number, sx: number, sy: number, c: string, o: number) => {
        this.px(Math.min(x, x + sx * (L - 1)) + o, y + o, c, L, 1);
        this.px(x + o, Math.min(y, y + sy * (L - 1)) + o, c, 1, L);
      };
      for (const [c, o] of [[INK, 1], ['#fff7ea', 0]] as [string, number][]) {
        corner(d.x0, d.y0, 1, 1, c, o); corner(d.x1, d.y0, -1, 1, c, o);
        corner(d.x0, d.y1, 1, -1, c, o); corner(d.x1, d.y1, -1, -1, c, o);
      }
    }

    // Overlays: handler arrow, numbers, dazed stars.
    for (const pv of this.players) {
      const s = pv.s;
      if (!s) continue;
      const p = project(s.x, s.y);
      const top = Math.round(p.y) - 34;
      if (s.showNum) {
        // Home: dark digits on a light plate. Away: light digits on a dark plate with notched corners.
        const label = String(pv.look.num);
        const w = pixTextW(label);
        const x0 = Math.round(p.x - w / 2) - 2, y0 = top - 8;
        const home = pv.look.marker === 'home';
        this.px(x0 - 1, y0 - 1, INK, w + 6, 11);
        this.px(x0, y0, home ? '#fff7ea' : '#3b2a48', w + 4, 9);
        if (!home) { this.px(x0, y0, INK); this.px(x0 + w + 3, y0, INK); this.px(x0, y0 + 8, INK); this.px(x0 + w + 3, y0 + 8, INK); }
        pixText(g, label, x0 + 2, y0 + 2, home ? INK : '#fff7ea');
      }
      if (s.daze) {
        for (let i = 0; i < 3; i++) {
          const a = this.time * 5 + (i * Math.PI * 2) / 3;
          this.px(p.x + Math.cos(a) * 6, top + 2 + Math.sin(a) * 2, '#ffd60a', 2, 2);
        }
      }
    }
    if (this.handler) {
      const h = this.handler;
      const b = Math.sin(this.time * 5) > 0 ? 1 : 0;
      const y = Math.round(h.y) - 51 + b;
      // Down-pointing arrow: dark outline, gold fill.
      const cx = Math.round(h.x);
      for (let i = 0; i < 5; i++) this.px(cx - 4 + i, y - 1 + i, INK, 9 - 2 * i, 1);
      for (let i = 0; i < 3; i++) this.px(cx - 2 + i, y + i, '#ffd60a', 5 - 2 * i, 1);
    }
    if (this.mine >= 0) this.drawMine(this.players[this.mine]);
    for (const w of this.warns) this.drawWarn(w.x, w.y - 12 + (Math.sin(this.time * 6) > 0 ? 1 : 0));
    if (this.hand) this.drawHand(Math.round(this.hand.x), Math.round(this.hand.y) - 50 + (Math.sin(this.time * 7) > 0 ? 1 : 0));

    this.netKick = Math.max(0, this.netKick - dt * 2.5);
    this.rimKick = Math.max(0, this.rimKick - dt * 4);

    this.drawFx(dt);
    this.blit(dt);

    // Labels follow the camera.
    this.placeLabels();
    // Floating callouts rise in whole canvas pixels.
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      const hold = f.hold ?? 0, life = f.life ?? 1.4;
      this.placeLabel(f.el, f.x, f.y - Math.floor(Math.max(0, f.t - hold) * 12));
      f.el.style.opacity = f.t > life - 0.3 ? '0.5' : '1';
      if (f.t > life) { f.el.remove(); return false; }
      return true;
    });
  }

  /** The ball is always on screen: if it leaves the view the camera opens to the whole court. */
  private keepBall() {
    if (this.reduce || this.camMode === 'off' || this.zoom) return;
    const g = this.camGoal;
    if (g.z <= 1) return;
    const m = 6, w = VIEW_W / g.z, h = VIEW_H / g.z, b = this.ball;
    if (b.x < g.x + m || b.x > g.x + w - m || b.y < g.y + m || b.y > g.y + h - m) this.overview();
  }

  /** One mark of a shaped path at (x, y) heading along (dx, dy): arrowhead, hollow square, cross or dash. */
  private mark2(x: number, y: number, dx: number, dy: number, shape: DotShape, c: string) {
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const X = Math.round(x), Y = Math.round(y);
    const both = (f: (col: string, o: number) => void) => { f(INK, 1); f(c, 0); };
    if (shape === 'ring') both((col, o) => { this.px(X - 1, Y - 1 + o, col, 3, 1); this.px(X - 1, Y + 1 + o, col, 3, 1); this.px(X - 1, Y + o, col); this.px(X + 1, Y + o, col); });
    else if (shape === 'x') both((col, o) => { for (let i = -1; i <= 1; i++) { this.px(X + i, Y + i + o, col); this.px(X + i, Y - i + o, col); } });
    else if (shape === 'dash') both((col, o) => { for (let i = -1; i <= 1; i++) this.px(X + ux * i, Y + uy * i + o, col, 2, 2); });
    else {
      // Arrowhead: the tip ahead, two arms going back at 45 degrees on each side.
      both((col, o) => {
        this.px(X + ux, Y + uy + o, col);
        for (let i = 1; i <= 2; i++) {
          this.px(X + ux - ux * i - uy * i, Y + uy - uy * i + ux * i + o, col);
          this.px(X + ux - ux * i + uy * i, Y + uy - uy * i - ux * i + o, col);
        }
      });
    }
  }

  /** Hatched polygon on the floor: hatch inside (pattern by meaning) and a dashed outline. */
  private drawArea(a: Area) {
    const P = a.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of P) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(VIEW_W - 1, x1); y1 = Math.min(VIEW_H - 1, y1);
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    if (W <= 0 || H <= 0) return;
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const pi = P[i], pj = P[j];
        if ((pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) c = !c;
      }
      return c;
    };
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = inside(x0 + x + 0.5, y0 + y + 0.5) ? 1 : 0;
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
    const ph = Math.floor(this.time * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      const X = x0 + x, Y = y0 + y;
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
      if (edge) { if ((X + Y + ph) % 4 < 2) this.px(X, Y, a.color); continue; }
      const hit = a.hatch === 'cross' ? (X + Y) % 4 === 0 || (X - Y + 400) % 4 === 0
        : a.hatch === 'lines' ? Y % 3 === 0
        : a.hatch === 'diag' ? (X + Y) % 4 === 0
        : X % 3 === 0 && Y % 3 === 0;
      if (hit) this.px(X, Y, a.color);
    }
  }

  /** Marking line from a defender to his man: a dotted line on the floor, a small arrowhead at the man. */
  private drawTether(t: Tether) {
    const a = project(t.ax, t.ay), b = project(t.bx, t.by);
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    if (l < 14) return;
    const ux = dx / l, uy = dy / l;
    const step = t.strong ? 3 : 4, sz = t.strong ? 2 : 1;
    const ph = t.mine ? Math.floor(this.time * 8) % step : 0;
    const col = t.mine ? '#ffd60a' : '#fff7ea';
    for (let d = 8 + ph; d < l - 9; d += step) {
      const x = a.x + ux * d, y = a.y + uy * d;
      if (t.strong) this.px(x, y + 1, INK, sz, sz);
      this.px(x, y, col, sz, sz);
    }
    if (t.strong) this.mark2(b.x - ux * 9, b.y - uy * 9, dx, dy, 'chev', col);
  }

  /** The human's own defender: a shield over his head (the handler gets the gold arrow, you get the shield). */
  private drawMine(pv: PV) {
    const s = pv.s;
    if (!s) return;
    const p = project(s.x, s.y);
    const x = Math.round(p.x), y = Math.round(p.y) - 52 + (Math.sin(this.time * 5) > 0 ? 1 : 0);
    // A light shield with a dark emblem: taller and lighter than the handler's gold arrow, so the two never mix up.
    const rows = [
      'XXXXXXXXXXX',
      'XWWWWWWWWWX',
      'XWWWWXWWWWX',
      'XWWWXXXWWWX',
      'XWWWWXWWWWX',
      'XWWWWXWWWWX',
      '.XWWWXWWWX.',
      '.XWWWWWWWX.',
      '..XWWWWWX..',
      '...XWWWX...',
      '....XWX....',
      '.....X.....',
    ];
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const c = rows[j][i];
      if (c === '.') continue;
      this.px(x - 5 + i, y - 3 + j, c === 'X' ? INK : '#fff7ea');
    }
    // Brackets on the floor around his feet (light, dark shadow).
    const L = 4;
    for (const [col, o] of [[INK, 1], ['#fff7ea', 0]] as [string, number][]) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = x + sx * 12, cy = Math.round(p.y) + sy * 6 + o;
      this.px(Math.min(cx, cx - sx * (L - 1)), cy, col, L, 1);
      this.px(cx, Math.min(cy, cy - sy * (L - 1)), col, 1, L);
    }
  }

  /** Warning sign (a threat): a dark triangle with a light rim and an exclamation mark. */
  private drawWarn(x: number, y: number) {
    for (let j = 0; j < 8; j++) {
      const half = Math.floor(j / 1.6) + 1;
      this.px(x - half - 1, y + j, INK, 2 * half + 3, 1);
      this.px(x - half, y + j, j === 7 ? INK : '#ffb02e', 2 * half + 1, 1);
    }
    this.px(x, y + 2, INK, 1, 3);
    this.px(x, y + 6, INK);
  }

  // ---------------------------------------------------------------- effects (cinematics)
  /** Clear every running effect (new possession, destroy). */
  fxClear() {
    this.parts = []; this.auras = []; this.ghosts2 = []; this.trail = null;
    if (this.zoom) { const back = this.zoom.back; this.zoom = null; this.goTo(back); }
    this.bars = 0; this.flash = 0; this.speedLines = 0; this.hold = 0;
    this.labelsEl.classList.remove('hide');
  }

  /** Pixel hand cursor (white glove, dark outline) pointing down at (x, y + 9). */
  private drawHand(x: number, y: number) {
    const rows = [
      '..XXX.....',
      '.XWWWX....',
      '.XWWWXXX..',
      '.XWWWWWWX.',
      'XXWWWWWWWX',
      'XWWWWWWWWX',
      'XWWWWWWWX.',
      '.XWWWWWX..',
      '..XWWWX...',
      '...XWX....',
      '....X.....',
    ];
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const c = rows[j][i];
      if (c === '.') continue;
      this.px(x - 4 + i, y + j, c === 'X' ? INK : '#fff7ea');
    }
  }

  private spawn(kind: Part['kind'], x: number, y: number, vx: number, vy: number, life: number, size = 1, gr = 0) {
    if (this.parts.length > (this.reduce ? 80 : 420)) return;
    this.parts.push({ x, y, vx, vy, g: gr, t: 0, life, kind, size });
  }

  /** A burst of particles at a court point (meters, height in meters). */
  burst(x: number, y: number, h: number, style: FxStyle, power = 1) {
    const p = project(x, y, h);
    const n = Math.round((this.reduce ? 6 : 26) * power);
    const R = () => Math.random() - 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 60 * power;
      // Every special burns: flames rise from every burst, then the style's own shape.
      this.spawn('flame', p.x + R() * 6, p.y + R() * 4, Math.cos(a) * v * 0.4, -20 - Math.random() * 40, 0.5 + Math.random() * 0.5, Math.random() < 0.5 ? 2 : 1, -30);
      const kind: Part['kind'] = style === 'bolt' ? 'spark' : style === 'frost' ? 'frost' : style === 'wind' ? 'wind' : style === 'quake' ? 'dust' : style === 'spark' ? 'spark' : 'flame';
      if (i % 2 === 0) this.spawn(kind, p.x, p.y, Math.cos(a) * v, Math.sin(a) * v * 0.6, 0.35 + Math.random() * 0.4, 1, kind === 'dust' ? 80 : 0);
    }
    if (style === 'bolt') for (let i = 0; i < (this.reduce ? 1 : 4); i++) this.spawn('bolt', p.x, p.y, R() * 2, -1, 0.22, 1);
    if (style === 'quake' || style === 'fire') this.spawn('ring', project(x, y, 0).x, project(x, y, 0).y, 0, 0, 0.45, 1);
    if (!this.reduce) for (let i = 0; i < 6; i++) this.spawn('smoke', p.x + R() * 10, p.y + R() * 4, R() * 8, -12 - Math.random() * 10, 0.9 + Math.random() * 0.5, 2);
  }

  /** Player `i` burns while the special plays (flames at the feet, afterimages when moving). */
  aura(i: number, style: FxStyle, dur: number) { this.auras = this.auras.filter((a) => a.i !== i); this.auras.push({ i, style, t: dur }); }
  /** The ball leaves a burning trail while it flies. */
  ballTrail(style: FxStyle | null) { this.trail = style ? { style, pts: [] } : null; }
  flashNow(color = '#ffffff', k = 0.7) { if (this.reduce) return; this.flash = k; this.flashCol = color; }
  /**
   * A close-up on a court point (dunks, specials), with letterbox bars. Full camera only: it eases in and back
   * out like every other camera move. Soft and off keep the view; reduced motion has no bars either.
   */
  cinematic(x: number | null, y = 0, h = 1, dur = 1.2) {
    if (x === null) { this.endCinematic(); return; }
    if (this.reduce) return;
    this.bars = 1;
    if (this.camMode !== 'full') return;
    const p = project(x, y, h);
    const back = this.zoom ? this.zoom.back : { ...this.camGoal };
    this.zoom = null;
    const z = this.maxZoom();
    this.goTo(this.clampCam(p.x, p.y + (VIEW_H / z) * 0.12, z));
    this.zoom = { back, t: 0, dur };
    this.labelsEl.classList.add('hide');
  }
  cutInLines(dur = 0.8) { if (!this.reduce) this.speedLines = dur; }
  endCinematic() {
    if (this.zoom) { const back = this.zoom.back; this.zoom = null; this.goTo(back); }
    this.bars = 0;
    this.labelsEl.classList.remove('hide');
  }

  private drawFx(dt: number) {
    const g = this.g;
    // Auras: flames at the feet and afterimages of the moving player.
    for (const a of this.auras) {
      a.t -= dt;
      const pv = this.players[a.i];
      const s = pv?.s;
      if (!s) continue;
      const p = project(s.x, s.y);
      const k = this.reduce ? 0.25 : 1;
      if (Math.random() < 0.9 * k) this.spawn('flame', p.x + (Math.random() - 0.5) * 12, p.y - Math.random() * 6, (Math.random() - 0.5) * 8, -25 - Math.random() * 30, 0.45 + Math.random() * 0.4, Math.random() < 0.4 ? 2 : 1, -20);
      if (Math.random() < 0.35 * k) {
        const kind: Part['kind'] = a.style === 'frost' ? 'frost' : a.style === 'wind' ? 'wind' : a.style === 'quake' ? 'dust' : 'spark';
        this.spawn(kind, p.x + (Math.random() - 0.5) * 14, p.y - 8 - Math.random() * 22, (Math.random() - 0.5) * 20, -10 - Math.random() * 20, 0.4, 1);
      }
      if (!this.reduce && s.moving && Math.floor(this.time * 20) !== Math.floor((this.time - dt) * 20)) {
        this.ghosts2.push({ i: a.i, x: Math.round(p.x) - FEET.x, y: Math.round(p.y) - FEET.y, frame: pv.frame, flip: pv.flip, t: 0.3, color: FX_COL[a.style][2] });
      }
    }
    this.auras = this.auras.filter((a) => a.t > 0);
    // Afterimages: a flat silhouette in the style's color, fading in steps.
    for (const gh of this.ghosts2) {
      gh.t -= dt;
      if (gh.t <= 0) continue;
      this.silhouette(gh, gh.t > 0.15 ? 0.55 : 0.28);
    }
    this.ghosts2 = this.ghosts2.filter((x) => x.t > 0);
    // Ball trail.
    if (this.trail) {
      const tr = this.trail;
      tr.pts.push({ x: this.ball.x, y: this.ball.y, t: 0 });
      for (const q of tr.pts) q.t += dt;
      tr.pts = tr.pts.filter((q) => q.t < 0.35);
      for (let i = 0; i < tr.pts.length; i++) {
        const q = tr.pts[i];
        const k = q.t / 0.35;
        const sz = k < 0.3 ? 3 : k < 0.65 ? 2 : 1;
        this.px(q.x - 1, q.y - 1, rampAt(FX_COL[tr.style], k * 0.9), sz, sz);
      }
      if (!this.reduce && Math.random() < 0.8) this.spawn('flame', this.ball.x, this.ball.y, (Math.random() - 0.5) * 10, -10, 0.35, 1, -10);
    }
    // Particles.
    for (const q of this.parts) {
      q.t += dt;
      q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      const k = q.t / q.life;
      if (k >= 1) continue;
      const x = Math.round(q.x), y = Math.round(q.y);
      switch (q.kind) {
        case 'flame': {
          const c = rampAt(FLAME, k);
          this.px(x, y, c, q.size, q.size + (k < 0.4 ? 1 : 0));
          break;
        }
        case 'smoke': g.globalAlpha = 0.5 * (1 - k); this.px(x, y, '#3b2a48', q.size, q.size); g.globalAlpha = 1; break;
        case 'spark': {
          const c = k < 0.5 ? '#ffffff' : '#ffd166';
          this.px(x, y, c); if (k < 0.6) { this.px(x - 1, y, c); this.px(x + 1, y, c); this.px(x, y - 1, c); this.px(x, y + 1, c); }
          break;
        }
        case 'frost': { const c = rampAt(FX_COL.frost, k); this.px(x, y - 1, c); this.px(x - 1, y, c); this.px(x + 1, y, c); this.px(x, y + 1, c); break; }
        case 'wind': { const c = rampAt(FX_COL.wind, k); this.px(x - 3, y, c, 6, 1); break; }
        case 'dust': this.px(x, y, rampAt(FX_COL.quake, k), 2, 2); break;
        case 'bolt': {
          // A jagged bolt from above down to the point.
          let bx = x, by = y - 40;
          const c = k < 0.5 ? '#ffffff' : '#ffd60a';
          while (by < y) { const nx = bx + Math.round((Math.random() - 0.5) * 6), ny = by + 4; for (let j = 0; j <= 4; j++) this.px(Math.round(bx + ((nx - bx) * j) / 4), by + j, c); bx = nx; by = ny; }
          break;
        }
        case 'ring': this.ellipse(x, y, 4 + k * 26, 2 + k * 11, k < 0.5 ? '#ffe066' : '#ff6a1a', 10, this.time * 4); break;
      }
    }
    this.parts = this.parts.filter((q) => q.t < q.life);
  }

  private tint: HTMLCanvasElement | null = null;
  private silhouette(gh: Ghost2, alpha: number) {
    const pv = this.players[gh.i];
    if (!this.tint) { this.tint = document.createElement('canvas'); this.tint.width = 64; this.tint.height = 64; }
    const t = this.tint.getContext('2d')!;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, 64, 64);
    drawPlayer(t, pv.look, gh.frame, 0, 0, gh.flip, false);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = gh.color;
    t.fillRect(0, 0, 64, 64);
    this.g.globalAlpha = alpha;
    this.g.drawImage(this.tint, gh.x, gh.y);
    this.g.globalAlpha = 1;
  }

  /**
   * Copy the scene to the screen (device resolution): camera, shake, letterbox, cut-in speed lines, flash.
   * At rest the zoom is a whole number of device pixels per scene pixel and the offset a whole device pixel.
   */
  private blit(dt: number) {
    const v = this.vg, S = this.S;
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.fillStyle = '#1b1029';
    v.fillRect(0, 0, VIEW_W * S, VIEW_H * S);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      // No shake while the camera moves (that is where it makes people dizzy), less of it in soft mode, none when off.
      const amp = this.reduce || this.camMode === 'off' || this.tween ? 0 : this.camMode === 'soft' ? 3 : 8;
      if (amp) {
        const m = Math.ceil(this.shake * amp);
        sx = Math.round((Math.random() - 0.5) * m); sy = Math.round((Math.random() - 0.5) * m);
      }
    }
    if (dt > 0) { this.stepCam(dt); this.keepBall(); }
    const c = this.view0();
    const k = S * c.z;
    v.imageSmoothingEnabled = false;
    v.setTransform(k, 0, 0, k, Math.round(-c.x * k) + sx * S, Math.round(-c.y * k) + sy * S);
    v.drawImage(this.view, 0, 0);
    // Overlays in screen space, one scene pixel = S device pixels.
    v.setTransform(S, 0, 0, S, 0, 0);
    if (this.speedLines > 0) {
      this.speedLines -= dt;
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      v.fillStyle = '#fff7ea';
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = 70 + Math.random() * 40, r1 = r0 + 30 + Math.random() * 40;
        for (let r = r0; r < r1; r += 2) v.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 1, 1);
      }
    }
    if (this.bars > 0 && !this.reduce) {
      const bh = 15;
      v.fillStyle = '#0a0612';
      v.fillRect(0, 0, VIEW_W, bh);
      v.fillRect(0, VIEW_H - bh, VIEW_W, bh);
    }
    if (this.flash > 0) {
      v.globalAlpha = Math.min(0.7, this.flash);
      v.fillStyle = this.flashCol;
      v.fillRect(0, 0, VIEW_W, VIEW_H);
      v.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 4);
    }
    v.setTransform(1, 0, 0, 1, 0, 0);
  }

  private netSlice(y: number, h: number): [number, number, number, number] {
    const n = A.p.net;
    return [n[0], n[1] + y, n[2], h];
  }

  private drawBall() {
    const g = this.g, b = this.ball, sheet = atlasImage();
    if (b.h > 0.35) { this.px(b.gx - 2, b.gy, '#00000055', 5, 1); }
    const f = Math.floor(Math.abs(b.spin) * 2) % 3;
    drawPiece(g, sheet, `b${f}`, Math.round(b.x) - 5, Math.round(b.y) - 5);
  }

  private drawZones() {
    for (const z of Object.values(ZONES)) {
      const p = project(z.x, z.y);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (z.kind === 'three') {
        // Two-point spots: hollow light squares.
        this.px(x - 3, y - 2, INK, 7, 5);
        this.px(x - 2, y - 1, '#fff7ea', 5, 3);
        this.px(x - 1, y, INK, 3, 1);
      } else {
        // One-point spots: small dark dots.
        this.px(x - 2, y - 1, INK, 5, 3);
        this.px(x - 1, y - 2, INK, 3, 5);
      }
    }
  }
}
