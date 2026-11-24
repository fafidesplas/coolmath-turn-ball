// Pixel-art renderer: a 262x230 canvas drawn at native resolution and scaled by a whole number of device
// pixels (image-rendering: pixelated). Top-down court from the asset pack, side-view player sprites,
// hoop and net sprites, and pixel previews (dotted routes, rings, walls) for the decision UI.
// It offers the same calls the match code used on the 3D world, in court meters.
import { Vector3, type Curve } from 'three';
import { ZONES } from '../rules';
import { COURT_H, COURT_W, HOOP } from './court';
import { A, FEET, atlasImage, drawPiece, drawPlayer, hasPiece, pixText, pixTextW, tagFrame, type Look } from './sprites';

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
}

interface PV { look: PixelLook; flip: boolean; clock: number; s: PixelPose | null; frame: number; ballDrawn: boolean }

type Ring = { x: number; y: number; rx: number; ry: number; color: string; pulse: boolean; style: 'target' | 'danger' | 'plain' };
type Dots = { curve: Curve<Vector3>; n: number; color: string; size: number; speed: number; phase: number };
type Wall = { x: number; y: number; w: number; h: number; color: string };
type Ghost = { x: number; y: number; color: string };
interface Label { el: HTMLElement; x: number; y: number }
interface Floater { el: HTMLElement; x: number; y: number; t: number }

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

  constructor(private container: HTMLElement, looks: PixelLook[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'px-canvas';
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.g = this.canvas.getContext('2d')!;
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

  /** Whole-number scale in device pixels; landscape screens put the decision panel beside the court. */
  resize() {
    const W = this.container.clientWidth || 1, H = this.container.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    const screen = this.container.parentElement;
    const hud = 46;
    const sideW = Math.round(Math.min(430, Math.max(300, W * 0.36)));
    const sSide = Math.floor(Math.min(((W - sideW - 8) * dpr) / VIEW_W, ((H - 8) * dpr) / VIEW_H));
    const reserve = Math.min(H * 0.44, 360);
    const stackScale = (vw: number) => Math.floor(Math.min(((W - 4) * dpr) / vw, ((H - hud - reserve) * dpr) / VIEW_H));
    const sStack = stackScale(VIEW_W), sCrop = stackScale(CROP_W);
    const side = W > H * 1.15 && sSide >= sStack;
    const crop = !side && sCrop > sStack;
    this.x0 = crop ? CROP_X0 : 0;
    this.vw = crop ? CROP_W : VIEW_W;
    if (this.canvas.width !== this.vw) this.canvas.width = this.vw;
    this.g.imageSmoothingEnabled = false;
    const s = Math.max(1, side ? sSide : crop ? sCrop : sStack);
    const cw = (this.vw * s) / dpr, ch = (VIEW_H * s) / dpr;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const left = snap(side ? Math.max(4, (W - sideW - cw) / 2) : (W - cw) / 2);
    const top = snap(side ? Math.max(4, (H - ch) / 2) : hud);
    for (const el of [this.canvas, this.labelsEl]) {
      el.style.width = `${cw}px`;
      el.style.height = `${ch}px`;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    this.k = s / dpr;
    if (screen) {
      screen.classList.toggle('side', side);
      screen.style.setProperty('--panel-w', `${sideW}px`);
      screen.style.setProperty('--court-l', `${left}px`);
      screen.style.setProperty('--court-w', `${cw}px`);
      screen.style.setProperty('--court-top', `${top}px`);
      screen.style.setProperty('--court-bottom', `${top + ch}px`);
      screen.style.setProperty('--px', `${Math.max(2, Math.round(this.k))}px`);
    }
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
    g.fillStyle = '#2a1b3d';
    g.fillRect(0, 0, this.vw, VIEW_H);
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const s = Math.ceil(this.shake * 6);
      sx = Math.round((Math.random() - 0.5) * s); sy = Math.round((Math.random() - 0.5) * s);
    }
    g.setTransform(1, 0, 0, 1, sx - this.x0, sy);
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
        else if (s.carry) tag = s.deciding ? 'Idle_Ball_1' : 'Dribble_1';
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

    // Floating callouts rise in whole canvas pixels.
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      this.placeLabel(f.el, f.x, f.y - Math.floor(f.t * 12));
      f.el.style.opacity = f.t > 1.1 ? '0.5' : '1';
      if (f.t > 1.4) { f.el.remove(); return false; }
      return true;
    });
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
