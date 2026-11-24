// Pixel-art renderer: a 262x230 canvas drawn at native resolution and scaled by a whole number of device
// pixels (image-rendering: pixelated). Top-down court from the asset pack, side-view player sprites,
// hoop and net sprites, and pixel previews (dotted routes, rings, walls) for the decision UI.
// It offers the same calls the match code used on the 3D world, in court meters.
import { Vector3, type Curve } from 'three';
import { ZONES } from '../rules';
import { COURT_H, COURT_W, HOOP } from './court';
import { A, FEET, atlasImage, drawPiece, drawPlayer, hasPiece, pixText, pixTextW, tagFrame, type Look } from './sprites';
import type { FxStyle } from '../specials';

export const VIEW_W = 262;
export const VIEW_H = 230;
/** Pixels per meter: along the court (screen x), across it (screen y) and up (height). */
const KX = 15, KY = 11.1, KZ = 14.4;
/** Hoop floor point on screen. */
const HX = 184, HY = 114;
const COURT_OX = -30;
/** Portrait window: x 26..250 keeps every spot players use plus the hoop stand. */
const CROP_X0 = 26, CROP_W = 224;

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
type Dots = { curve: Curve<Vector3>; n: number; color: string; size: number; speed: number; phase: number };
type Wall = { x: number; y: number; w: number; h: number; color: string };
type Ghost = { x: number; y: number; color: string };
interface Label { el: HTMLElement; x: number; y: number }
interface Floater { el: HTMLElement; x: number; y: number; t: number }
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

/** Screen layout computed from the window: court and panel side by side (landscape) or stacked (portrait). */
export interface Layout {
  side: boolean;
  court: { l: number; t: number; w: number; h: number };
  panel: { l: number; t: number; w: number; h: number };
  hud: { l: number; t: number; w: number };
  scale: number;
}

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
  /** Visible window of the scene: portrait screens drop the unused side margins to get a bigger whole-number scale. */
  private x0 = 0;
  private vw = VIEW_W;
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
  /** Integer zoom on a canvas point (cinematics); `bars` = letterbox. */
  private zoom: { x: number; y: number; t: number; dur: number } | null = null;
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
    this.container.innerHTML = '';
  }

  /**
   * Whole-number scale in device pixels. Landscape: the court and the panel form one centered block that fills
   * the height (the panel takes the rest of the width, between a readable minimum and a maximum). Portrait: the
   * HUD on top, the court (side margins cropped when that buys a bigger scale), the panel below.
   */
  resize() {
    const screen = this.container.parentElement;
    const W = (screen?.clientWidth || this.container.clientWidth) || 1, H = (screen?.clientHeight || this.container.clientHeight) || 1;
    const dpr = window.devicePixelRatio || 1;
    const pad = W < 600 || H < 500 ? 4 : 10;
    const gap = W < 900 ? 6 : 12;
    const minPanel = W < 700 ? 280 : 330, maxPanel = 560;
    const fit = (vw: number, availW: number, availH: number) => Math.max(1, Math.floor(Math.min((availW * dpr) / vw, (availH * dpr) / VIEW_H)));
    // Landscape candidate (full width or cropped scene, whichever is bigger).
    const sideFor = (vw: number) => fit(vw, W - 2 * pad - gap - minPanel, H - 2 * pad);
    const sSideFull = sideFor(VIEW_W), sSideCrop = sideFor(CROP_W);
    // Portrait candidate: HUD on top, the panel keeps at least ~40% of the height.
    const hudH = 50;
    const minPanelH = Math.max(250, Math.round(H * 0.4));
    const stackFor = (vw: number) => fit(vw, W - 2 * pad, H - hudH - minPanelH - pad);
    const sStackFull = stackFor(VIEW_W), sStackCrop = stackFor(CROP_W);
    const landscape = W > H * 1.1;
    const side = landscape && W - Math.min(sSideFull, sSideCrop) >= minPanel;
    let crop: boolean, s: number;
    if (side) { crop = sSideCrop > sSideFull; s = crop ? sSideCrop : sSideFull; }
    else { crop = sStackCrop > sStackFull; s = crop ? sStackCrop : sStackFull; }
    this.x0 = crop ? CROP_X0 : 0;
    this.vw = crop ? CROP_W : VIEW_W;
    if (this.canvas.width !== this.vw) this.canvas.width = this.vw;
    this.vg.imageSmoothingEnabled = false;
    const cw = (this.vw * s) / dpr, ch = (VIEW_H * s) / dpr;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    let L: Layout;
    if (side) {
      const pw = Math.round(Math.min(maxPanel, Math.max(minPanel, W - 2 * pad - gap - cw)));
      const groupW = cw + gap + pw;
      const left = snap(Math.max(pad, (W - groupW) / 2));
      const top = snap((H - ch) / 2);
      const ph = H - 2 * pad;
      const pt = pad;
      L = { side, scale: s / dpr, court: { l: left, t: top, w: cw, h: ch }, panel: { l: Math.round(left + cw + gap), t: pt, w: pw, h: ph }, hud: { l: Math.round(left + cw + gap), t: pt, w: pw } };
    } else {
      const left = snap((W - cw) / 2);
      const top = snap(hudH + 2);
      const pt = Math.round(top + ch + gap / 2);
      const pw = Math.min(W - 2 * pad, 640);
      L = { side, scale: s / dpr, court: { l: left, t: top, w: cw, h: ch }, panel: { l: Math.round((W - pw) / 2), t: pt, w: pw, h: Math.max(0, H - pt - pad) }, hud: { l: pad, t: 4, w: W - 2 * pad } };
    }
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
      const v = (k: string, n: number) => screen.style.setProperty(k, `${Math.round(n * 100) / 100}px`);
      v('--court-l', L.court.l); v('--court-w', L.court.w); v('--court-top', L.court.t); v('--court-h', L.court.h);
      v('--court-bottom', L.court.t + L.court.h);
      v('--panel-l', L.panel.l); v('--panel-t', L.panel.t); v('--panel-w', L.panel.w); v('--panel-h', L.panel.h);
      v('--hud-l', L.hud.l); v('--hud-t', L.hud.t); v('--hud-w', L.hud.w);
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
    return { x: ((clientX - r.left) / r.width) * this.vw + this.x0, y: ((clientY - r.top) / r.height) * VIEW_H };
  }

  // ---------------------------------------------------------------- previews
  clearPreview() {
    this.rings = []; this.dotPaths = []; this.walls = []; this.ghosts = [];
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  dots(curve: Curve<Vector3>, color: string, radius = 0.07, spacing = 0.32, speed = 0.9) {
    const len = curve.getLength();
    this.dotPaths.push({ curve, n: Math.max(3, Math.round(len / (spacing * 1.15))), color, size: radius >= 0.075 ? 2 : 1, speed, phase: 0 });
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
    const cx = Math.min(this.x0 + this.vw - 8, Math.max(this.x0 + 8, x)) - this.x0;
    const cy = Math.max(14, y);
    el.style.transform = `translate(${Math.round(cx * this.k)}px, ${Math.round(cy * this.k)}px) translate(-50%, -100%)`;
  }
  private placeLabels() { for (const l of this.labels) this.placeLabel(l.el, l.x, l.y); }

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
    drawPiece(g, sheet, 'bench3', 40, 210);
    drawPiece(g, sheet, 'trash', 76, 207);
    drawPiece(g, sheet, 'bench1', 100, 210);
    drawPiece(g, sheet, 'bottle', 134, 212);
    drawPiece(g, sheet, 'skate', 30, 6);
    drawPiece(g, sheet, 'bench2', 110, 4);

    if (this.showZones) this.drawZones();

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
        if (s.moving) tag = s.carry ? (s.fast ? 'Sprint_Ball' : 'Run_Ball') : s.defending ? 'Slide' : 'Run';
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
    for (const d of this.dotPaths) {
      d.phase = (d.phase + dt * d.speed) % 1;
      for (let i = 0; i < d.n; i++) {
        const k = Math.min(1, (i + d.phase) / d.n);
        const q = fromWorld(d.curve.getPointAt(k));
        const x = Math.round(q.x), y = Math.round(q.y);
        this.px(x, y + 1, INK, d.size, d.size);
        this.px(x, y, d.color, d.size, d.size);
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

    // Overlays: handler arrow, numbers, dazed stars.
    for (const pv of this.players) {
      const s = pv.s;
      if (!s) continue;
      const p = project(s.x, s.y);
      const top = Math.round(p.y) - 34;
      if (s.showNum) {
        const label = String(pv.look.num);
        const w = pixTextW(label);
        pixText(g, label, Math.round(p.x - w / 2), top - 6, pv.look.marker === 'home' ? '#fff7ea' : '#ffd166');
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
      const y = Math.round(h.y) - 44 + b;
      // Down-pointing arrow: dark outline, gold fill.
      const cx = Math.round(h.x);
      for (let i = 0; i < 5; i++) this.px(cx - 4 + i, y - 1 + i, INK, 9 - 2 * i, 1);
      for (let i = 0; i < 3; i++) this.px(cx - 2 + i, y + i, '#ffd60a', 5 - 2 * i, 1);
    }

    this.netKick = Math.max(0, this.netKick - dt * 2.5);
    this.rimKick = Math.max(0, this.rimKick - dt * 4);

    this.drawFx(dt);
    this.blit(dt);

    // Floating callouts rise in whole canvas pixels.
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      this.placeLabel(f.el, f.x, f.y - Math.floor(f.t * 12));
      f.el.style.opacity = f.t > 1.1 ? '0.5' : '1';
      if (f.t > 1.4) { f.el.remove(); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------------- effects (cinematics)
  /** Clear every running effect (new possession, destroy). */
  fxClear() {
    this.parts = []; this.auras = []; this.ghosts2 = []; this.trail = null;
    this.zoom = null; this.bars = 0; this.flash = 0; this.speedLines = 0;
    this.labelsEl.classList.remove('hide');
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
  /** Snap a 2x zoom (whole number: pixels stay square) on a court point, with letterbox bars. */
  cinematic(x: number | null, y = 0, h = 1, dur = 1.2) {
    if (x === null) { this.zoom = null; this.labelsEl.classList.remove('hide'); return; }
    this.bars = 1;
    if (this.reduce) return;
    const p = project(x, y, h);
    this.zoom = { x: p.x, y: p.y, t: 0, dur };
    this.labelsEl.classList.add('hide');
  }
  cutInLines(dur = 0.8) { if (!this.reduce) this.speedLines = dur; }
  endCinematic() { this.zoom = null; this.bars = 0; this.labelsEl.classList.remove('hide'); }

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

  /** Copy the scene to the screen: shake, 2x zoom, letterbox, cut-in speed lines, flash. */
  private blit(dt: number) {
    const v = this.vg;
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.fillStyle = '#1b1029';
    v.fillRect(0, 0, this.vw, VIEW_H);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      if (!this.reduce) {
        const m = Math.ceil(this.shake * 8);
        sx = Math.round((Math.random() - 0.5) * m); sy = Math.round((Math.random() - 0.5) * m);
      }
    }
    if (this.zoom) {
      const z = this.zoom;
      z.t += dt;
      const w = Math.floor(this.vw / 2), h = Math.floor(VIEW_H / 2);
      const x = Math.round(Math.min(this.x0 + this.vw - w, Math.max(this.x0, z.x - w / 2)));
      const y = Math.round(Math.min(VIEW_H - h, Math.max(0, z.y - h * 0.62)));
      v.drawImage(this.view, x, y, w, h, sx, sy, w * 2, h * 2);
      if (z.t >= z.dur) { this.zoom = null; this.labelsEl.classList.remove('hide'); }
    } else v.drawImage(this.view, this.x0, 0, this.vw, VIEW_H, sx, sy, this.vw, VIEW_H);
    if (this.speedLines > 0) {
      this.speedLines -= dt;
      const cx = this.vw / 2, cy = VIEW_H / 2;
      v.fillStyle = '#fff7ea';
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = 70 + Math.random() * 40, r1 = r0 + 30 + Math.random() * 40;
        for (let r = r0; r < r1; r += 2) v.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), 1, 1);
      }
    }
    if (this.bars > 0 && !this.reduce) {
      const bh = 14;
      v.fillStyle = '#0a0612';
      v.fillRect(0, 0, this.vw, bh);
      v.fillRect(0, VIEW_H - bh, this.vw, bh);
    }
    if (this.flash > 0) {
      v.globalAlpha = Math.min(0.7, this.flash);
      v.fillStyle = this.flashCol;
      v.fillRect(0, 0, this.vw, VIEW_H);
      v.globalAlpha = 1;
      this.flash = Math.max(0, this.flash - dt * 4);
    }
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
