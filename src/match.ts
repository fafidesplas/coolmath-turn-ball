// Real-time half-court 3x3 match. Contact between the ball handler and a defender
// pauses the action and opens a turn-based duel (handled by the UI through hooks).
import { sfx } from './audio';
import { type Player } from './data';
import {
  aiAttack, aiDefend, clamp, HabitMemory, type Choice, type DuelContext, type DuelResult,
} from './duel';

export const COURT_W = 15;
export const COURT_H = 11;
export const HOOP = { x: 7.5, y: 1.575 };
const ARC_R = 6.75;
const CORNER_DX = 6.6;
const CORNER_Y = HOOP.y + Math.sqrt(ARC_R * ARC_R - CORNER_DX * CORNER_DX);
export const MATCH_SECONDS = 150;
export const SHOT_CLOCK = 12;
export const WIN_SCORE = 11;
const DUEL_RANGE = 1.0;
const R = 0.48;

export interface TeamSetup {
  name: string;
  short: string;
  color: string;
  accent: string;
  players: Player[];
}

interface Ent {
  pl: Player;
  team: 0 | 1;
  slot: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  energy: number;
  daze: number;
  boost: number;
  spotT: number;
  face: number;
}

interface Flight {
  kind: 'pass' | 'shot';
  fx: number; fy: number;
  tx: number; ty: number;
  t: number; dur: number;
  to?: Ent;
  thief?: Ent;
  shooter?: Ent;
  made?: boolean;
  pts?: number;
}

interface Float { text: string; x: number; y: number; t: number; color: string; size: number }

export interface DuelSetup {
  ctx: DuelContext;
  userSide: 'att' | 'def';
  ai: Choice;
  attColor: string;
  defColor: string;
}

export interface HudInfo {
  score: [number, number];
  clock: number;
  shotClock: number;
  golden: boolean;
  offense: 0 | 1;
}

export interface ControlInfo {
  mode: 'attack' | 'defend' | 'wait';
  shootPct: number;
  isTwo: boolean;
  passes: { name: string; risky: boolean }[];
  controlledName: string;
  energy: number;
}

export interface PlayerLine { pts: number; duels: number; duelsWon: number; steals: number }
export interface MatchResult { score: [number, number]; won: boolean; lines: Record<string, PlayerLine>; quit?: boolean }

export interface MatchHooks {
  duel(setup: DuelSetup): Promise<DuelResult>;
  hud(h: HudInfo): void;
  controls(c: ControlInfo): void;
  banner(text: string, sub?: string, color?: string): void;
  end(r: MatchResult): void;
}

type Phase = 'check' | 'play' | 'flight' | 'duel' | 'pause' | 'over';

const SPOTS = [
  { x: 7.5, y: 8.6 }, { x: 2.6, y: 6.2 }, { x: 12.4, y: 6.2 }, { x: 1.2, y: 1.4 }, { x: 13.8, y: 1.4 },
  { x: 4.6, y: 2.8 }, { x: 10.4, y: 2.8 }, { x: 7.5, y: 5.0 }, { x: 4.0, y: 5.0 }, { x: 11.0, y: 5.0 },
];

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
export const isTwoPoint = (x: number, y: number) =>
  y < CORNER_Y ? Math.abs(x - HOOP.x) > CORNER_DX : dist(x, y, HOOP.x, HOOP.y) > ARC_R;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return { d: dist(px, py, ax + dx * t, ay + dy * t), t };
}

export class Match {
  ents: Ent[] = [];
  offense: 0 | 1 = 0;
  holder: Ent | null = null;
  flight: Flight | null = null;
  phase: Phase = 'pause';
  phaseT = 0;
  after: (() => void) | null = null;
  clock = MATCH_SECONDS;
  shotClock = SHOT_CLOCK;
  score: [number, number] = [0, 0];
  golden = false;
  duelCd = 0;
  controlled: Ent | null = null;
  moveTarget: { x: number; y: number } | null = null;
  idleT = 9;
  keys = new Set<string>();
  floats: Float[] = [];
  shake = 0;
  time = 0;
  aiT = 0;
  memory = new HabitMemory();
  lines: Record<string, PlayerLine> = {};
  private raf = 0;
  private last = 0;
  private ctx2d: CanvasRenderingContext2D;
  private scale = 30;
  private ox = 0;
  private portrait = false;
  private oy = 0;
  private dpr = 1;
  private ctrlKey = '';
  private hudKey = '';
  private pointerDown = false;
  private ro: ResizeObserver;
  private destroyed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    public teams: [TeamSetup, TeamSetup],
    private tier: number,
    private hooks: MatchHooks,
  ) {
    this.ctx2d = canvas.getContext('2d')!;
    teams.forEach((t, ti) => t.players.slice(0, 3).forEach((pl, slot) => {
      this.ents.push({ pl, team: ti as 0 | 1, slot, x: 7.5, y: 6, tx: 7.5, ty: 6, energy: 40, daze: 0, boost: 0, spotT: 0, face: 0 });
      this.lines[pl.uid] = { pts: 0, duels: 0, duelsWon: 0, steals: 0 };
    }));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.bindInput();
    this.setupCheck(0, 0, true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  // ---------------- input ----------------
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.phase === 'duel' || this.phase === 'over' || this.paused) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      this.userShoot();
    } else if (k === 'q' || k === '1') this.userPass(0);
    else if (k === 'e' || k === '2') this.userPass(1);
    else if (k === 'shift' || k === 'tab') {
      e.preventDefault();
      this.userSwitch();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const toCourt = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const a = (e.clientX - r.left - this.ox) / this.scale, b = (e.clientY - r.top - this.oy) / this.scale;
      return this.portrait ? { x: b, y: a } : { x: a, y: b };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = toCourt(e);
      this.pointerDown = true;
      this.canvas.setPointerCapture(e.pointerId);
      if (this.phase !== 'play' && this.phase !== 'flight' && this.phase !== 'check') return;
      // Tap on a teammate: pass (attack) or switch control (defense).
      const mates = this.ents.filter((en) => en.team === 0 && en !== this.controlled);
      const hit = mates.find((en) => dist(en.x, en.y, p.x, p.y) < 1.1);
      if (hit) {
        this.pointerDown = false;
        if (this.offense === 0 && this.holder === this.controlled) this.passTo(this.holder!, hit, false);
        else if (this.offense === 1) { this.controlled = hit; this.moveTarget = null; sfx.tap(); }
        return;
      }
      this.setTarget(p.x, p.y);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const p = toCourt(e);
      this.setTarget(p.x, p.y);
    });
    const up = () => { this.pointerDown = false; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  private setTarget(x: number, y: number) {
    this.moveTarget = { x: clamp(x, 0.4, COURT_W - 0.4), y: clamp(y, 0.4, COURT_H - 0.4) };
    this.idleT = 0;
  }

  userShoot() {
    if (this.phase !== 'play' || this.offense !== 0 || !this.holder || this.holder.team !== 0) return;
    this.shoot(this.holder, Math.random() < this.shotChance(this.holder));
  }

  userPass(i: number) {
    if ((this.phase !== 'play') || this.offense !== 0 || !this.holder || this.holder.team !== 0) return;
    const mates = this.ents.filter((e) => e.team === 0 && e !== this.holder).sort((a, b) => a.slot - b.slot);
    if (mates[i]) this.passTo(this.holder, mates[i], false);
  }

  userSwitch() {
    if (this.offense !== 1) return;
    const mine = this.ents.filter((e) => e.team === 0);
    const ballX = this.holder ? this.holder.x : HOOP.x, ballY = this.holder ? this.holder.y : HOOP.y;
    const sorted = mine.filter((e) => e !== this.controlled)
      .sort((a, b) => dist(a.x, a.y, ballX, ballY) - dist(b.x, b.y, ballX, ballY));
    if (sorted[0]) { this.controlled = sorted[0]; this.moveTarget = null; sfx.tap(); }
  }

  // ---------------- layout ----------------
  private resize() {
    const parent = this.canvas.parentElement!;
    const w = parent.clientWidth, h = parent.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Tall screens draw the court transposed (hoop on the left) so it fills the phone.
    this.portrait = h > w * 1.1;
    const cw = this.portrait ? COURT_H : COURT_W, ch = this.portrait ? COURT_W : COURT_H;
    this.scale = Math.min(w / (cw + 0.6), h / (ch + 0.6));
    this.ox = (w - cw * this.scale) / 2;
    this.oy = (h - ch * this.scale) / 2;
  }

  /** Court meters -> CSS pixels inside the canvas. */
  toScreen(x: number, y: number) {
    return this.portrait
      ? { x: this.ox + y * this.scale, y: this.oy + x * this.scale }
      : { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }

  // ---------------- flow ----------------
  private setupCheck(offense: 0 | 1, handlerSlot: number, first = false) {
    this.offense = offense;
    this.flight = null;
    this.shotClock = SHOT_CLOCK;
    const off = this.ents.filter((e) => e.team === offense);
    const def = this.ents.filter((e) => e.team !== offense);
    const handler = off.find((e) => e.slot === handlerSlot) ?? off[0];
    const wings = [{ x: 3.0, y: 5.6 }, { x: 12.0, y: 5.6 }];
    let wi = 0;
    for (const e of off) {
      const p = e === handler ? { x: 7.5, y: 9.3 } : wings[wi++];
      e.tx = p.x; e.ty = p.y; e.daze = 0; e.boost = 0;
      if (first) { e.x = p.x; e.y = p.y; }
    }
    for (const d of def) {
      const man = off.find((o) => o.slot === d.slot) ?? off[0];
      const p = this.markSpot(man.tx, man.ty, man === handler ? 2.6 : 1.7);
      d.tx = p.x; d.ty = p.y; d.daze = 0; d.boost = 0;
      if (first) { d.x = p.x; d.y = p.y; }
    }
    this.holder = handler;
    this.moveTarget = null;
    this.controlled = offense === 0 ? handler : (def.find((d) => d.slot === handler.slot) ?? def[0]);
    this.phase = 'check';
    this.phaseT = first ? 2.0 : 1.4;
    this.duelCd = 1.2;
    if (this.golden) this.hooks.banner('GOLDEN BASKET', 'Next score wins!', '#ffd60a');
    else if (offense === 0) this.hooks.banner('YOUR BALL', first ? 'Tap court to move · tap a teammate to pass' : 'Check it up!', this.teams[0].color);
    else this.hooks.banner('DEFENSE!', first ? 'Run into the ball handler to start a duel' : 'Stop them!', this.teams[1].color);
    sfx.whistle();
  }

  private pauseThen(t: number, fn: () => void) {
    this.phase = 'pause';
    this.phaseT = t;
    this.after = fn;
  }

  private turnover(newHolder: Ent, label: string, color = '#fff') {
    this.holder = newHolder;
    this.addFloat(label, newHolder.x, newHolder.y - 1, color, 1.0);
    this.lines[newHolder.pl.uid].steals++;
    const team = newHolder.team;
    this.pauseThen(0.9, () => this.setupCheck(team, newHolder.slot));
  }

  private markSpot(mx: number, my: number, sag: number) {
    const dx = HOOP.x - mx, dy = HOOP.y - my;
    const l = Math.hypot(dx, dy) || 1;
    return { x: mx + (dx / l) * sag, y: my + (dy / l) * sag };
  }

  shotChance(e: Ent): number {
    const d = dist(e.x, e.y, HOOP.x, HOOP.y);
    const two = isTwoPoint(e.x, e.y);
    let p = d < 2.2 ? 0.7 : d < 4.5 ? 0.56 : !two ? 0.46 : d < 8.5 ? 0.36 : 0.12;
    p += (e.pl.stats.sho - 5) * 0.045;
    let nd = 99;
    for (const o of this.ents) if (o.team !== e.team && o.daze <= 0) nd = Math.min(nd, dist(o.x, o.y, e.x, e.y));
    if (nd < 2.6) p -= (2.6 - nd) * 0.12;
    if (e.boost > 0) p += 0.08;
    return clamp(p, 0.04, 0.93);
  }

  private laneRisk(from: Ent, to: Ent): { risk: number; thief: Ent | null } {
    let best: Ent | null = null, bestD = 99;
    for (const o of this.ents) {
      if (o.team === from.team || o.daze > 0) continue;
      const { d, t } = segDist(o.x, o.y, from.x, from.y, to.x, to.y);
      if (t > 0.08 && t < 0.97 && d < bestD) { bestD = d; best = o; }
    }
    if (!best || bestD > 0.95) return { risk: 0, thief: null };
    return { risk: clamp(0.4 + (best.pl.stats.def - from.pl.stats.pas) * 0.05 + (0.95 - bestD) * 0.4, 0.15, 0.85), thief: best };
  }

  private passTo(from: Ent, to: Ent, safe: boolean) {
    if (this.phase !== 'play' && this.phase !== 'duel') return;
    let thief: Ent | null = null;
    if (!safe) {
      const lr = this.laneRisk(from, to);
      if (lr.thief && Math.random() < lr.risk) thief = lr.thief;
    }
    const end = thief ?? to;
    const d = dist(from.x, from.y, end.x, end.y);
    this.flight = { kind: 'pass', fx: from.x, fy: from.y, tx: end.x, ty: end.y, t: 0, dur: 0.08 + d / 14, to, thief: thief ?? undefined };
    this.holder = null;
    this.phase = 'flight';
    sfx.pass();
  }

  private shoot(e: Ent, made: boolean) {
    const pts = isTwoPoint(e.x, e.y) ? 2 : 1;
    this.flight = { kind: 'shot', fx: e.x, fy: e.y, tx: HOOP.x, ty: HOOP.y, t: 0, dur: 0.75 + dist(e.x, e.y, HOOP.x, HOOP.y) * 0.03, shooter: e, made, pts };
    this.holder = null;
    this.phase = 'flight';
    sfx.tap();
  }

  private landFlight(f: Flight) {
    this.flight = null;
    if (f.kind === 'pass') {
      if (f.thief) {
        sfx.steal();
        this.turnover(f.thief, 'PICKED OFF!', '#ff4d6d');
        return;
      }
      this.holder = f.to!;
      if (this.offense === 0) { this.controlled = f.to!; this.moveTarget = null; }
      else this.retargetDefense();
      this.phase = 'play';
      return;
    }
    const shooter = f.shooter!;
    if (f.made) {
      this.score[shooter.team] += f.pts!;
      this.lines[shooter.pl.uid].pts += f.pts!;
      sfx.swish();
      if (shooter.team === 0) sfx.cheer();
      this.shake = 0.25;
      this.addFloat(f.pts === 2 ? '+2 DEEP!' : '+1', HOOP.x, HOOP.y + 1.2, shooter.team === 0 ? this.teams[0].accent : this.teams[1].color, 1.3);
      const over = this.golden || this.score[shooter.team] >= WIN_SCORE;
      const other = (1 - shooter.team) as 0 | 1;
      this.pauseThen(1.1, () => (over ? this.finish() : this.setupCheck(other, 0)));
      return;
    }
    sfx.rim();
    this.addFloat('CLANK!', HOOP.x, HOOP.y + 1, '#ddd', 0.9);
    // Rebound battle: strength + blocking near the rim.
    const near = (team: number) => this.ents.filter((e) => e.team === team)
      .sort((a, b) => dist(a.x, a.y, HOOP.x, HOOP.y) - dist(b.x, b.y, HOOP.x, HOOP.y))[0];
    const offR = near(this.offense), defR = near(1 - this.offense);
    const pOff = clamp(0.3 + ((offR.pl.stats.str + offR.pl.stats.blk) - (defR.pl.stats.str + defR.pl.stats.blk)) * 0.03, 0.12, 0.5);
    if (Math.random() < pOff) {
      this.holder = offR;
      offR.x = HOOP.x + (offR.x - HOOP.x) * 0.5; offR.y = HOOP.y + 1.2;
      this.shotClock = SHOT_CLOCK;
      this.addFloat('OFFENSIVE BOARD!', offR.x, offR.y - 1, '#fff', 0.9);
      if (this.offense === 0) { this.controlled = offR; this.moveTarget = null; } else this.retargetDefense();
      this.duelCd = 1.0;
      this.phase = 'play';
    } else {
      this.holder = defR;
      this.addFloat('REBOUND', defR.x, defR.y - 1, '#fff', 0.8);
      const team = defR.team;
      this.pauseThen(0.7, () => this.setupCheck(team, defR.slot));
    }
  }

  private retargetDefense() {
    if (this.offense === 1 && this.holder) {
      const marker = this.ents.find((e) => e.team === 0 && e.slot === this.holder!.slot);
      if (marker && this.idleT > 1.5) { this.controlled = marker; this.moveTarget = null; }
    }
  }

  private finish() {
    this.phase = 'over';
    sfx.buzzer();
    const won = this.score[0] > this.score[1];
    this.hooks.banner(won ? 'VICTORY!' : 'DEFEAT', `${this.score[0]} – ${this.score[1]}`, won ? '#3ddc97' : '#ff4d6d');
    setTimeout(() => { if (!this.destroyed) this.hooks.end({ score: [...this.score] as [number, number], won, lines: this.lines }); }, 1800);
  }

  quit(): MatchResult {
    return { score: [...this.score] as [number, number], won: false, lines: this.lines, quit: true };
  }

  // ---------------- duels ----------------
  private async runDuel(att: Ent, def: Ent) {
    this.phase = 'duel';
    this.moveTarget = null;
    this.keys.clear();
    sfx.duel();
    const ctx: DuelContext = {
      att: { player: att.pl, energy: att.energy },
      def: { player: def.pl, energy: def.energy },
      shotDist: dist(att.x, att.y, HOOP.x, HOOP.y),
      isTwo: isTwoPoint(att.x, att.y),
      shotClock: this.shotClock,
    };
    const userSide = att.team === 0 ? 'att' : 'def';
    const smart = 0.1 + this.tier * 0.09;
    const ai = userSide === 'att' ? aiDefend(ctx, this.memory, smart) : aiAttack(ctx, this.memory, smart);
    const res = await this.hooks.duel({
      ctx, userSide, ai,
      attColor: this.teams[att.team].color, defColor: this.teams[def.team].color,
    });
    if (this.destroyed) return;
    this.applyDuel(att, def, res, userSide);
  }

  private applyDuel(att: Ent, def: Ent, res: DuelResult, userSide: 'att' | 'def') {
    this.memory.push(userSide, userSide === 'att' ? res.att.action : res.def.action);
    att.energy -= res.att.tech?.cost ?? 0;
    def.energy -= res.def.tech?.cost ?? 0;
    att.energy += 10 + (res.att.action === 'protect' ? 15 : 0);
    def.energy += 10 + (res.def.action === 'wait' ? 15 : 0);
    att.energy = clamp(att.energy, 0, 100);
    def.energy = clamp(def.energy, 0, 100);
    this.lines[att.pl.uid].duels++;
    this.lines[def.pl.uid].duels++;
    this.clock = Math.max(0, this.clock - 2);
    this.duelCd = 1.1;
    this.phase = 'play';
    const userWon = (res.winner === 'att') === (userSide === 'att') && res.winner !== 'tie';
    const color = res.winner === 'tie' ? '#fff' : userWon ? '#3ddc97' : '#ff4d6d';
    const push = (e: Ent, from: Ent, amount: number) => {
      const dx = e.x - from.x, dy = e.y - from.y;
      const l = Math.hypot(dx, dy) || 1;
      e.x = clamp(e.x + (dx / l) * amount, 0.4, COURT_W - 0.4);
      e.y = clamp(e.y + (dy / l) * amount, 0.4, COURT_H - 0.4);
    };
    if (res.winner === 'att') {
      this.lines[att.pl.uid].duelsWon++;
      this.addFloat(res.headline, att.x, att.y - 1.1, color, 1.0);
      switch (res.att.action) {
        case 'dribble':
          def.daze = 2.5; att.boost = 2.0; push(def, att, 1.0); sfx.whistle();
          break;
        case 'pass': {
          def.daze = 1.2;
          const mates = this.ents.filter((e) => e.team === att.team && e !== att);
          const best = mates.sort((a, b) => this.openness(b) - this.openness(a))[0];
          best.boost = 1.5;
          this.passTo(att, best, true);
          break;
        }
        case 'shoot':
          this.shoot(att, true);
          break;
        case 'protect':
          def.daze = 1.2; push(def, att, 1.8);
          break;
      }
    } else if (res.winner === 'tie') {
      this.addFloat('STAND-OFF', att.x, att.y - 1.1, color, 0.9);
      push(def, att, 1.4);
      this.shotClock = Math.max(1, this.shotClock - 2);
    } else {
      this.lines[def.pl.uid].duelsWon++;
      sfx.clash();
      this.shake = 0.3;
      if (res.att.action === 'shoot') sfx.rim();
      this.turnover(def, res.headline, color);
    }
  }

  private openness(e: Ent) {
    let nd = 99;
    for (const o of this.ents) if (o.team !== e.team && o.daze <= 0) nd = Math.min(nd, dist(o.x, o.y, e.x, e.y));
    return Math.min(nd, 5) - dist(e.x, e.y, HOOP.x, HOOP.y) * 0.15;
  }

  // ---------------- simulation ----------------
  private speed(e: Ent) {
    let v = 2.5 + e.pl.stats.spd * 0.22;
    if (e === this.holder) v *= 0.9;
    if (e.boost > 0) v *= 1.4;
    if (e.daze > 0) v *= 0.3;
    return v;
  }

  paused = false;

  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.floats = this.floats.filter((f) => (f.t += dt) < 1.4);
    this.idleT += dt;

    switch (this.phase) {
      case 'check':
        this.phaseT -= dt;
        for (const e of this.ents) this.moveEnt(e, dt, 2.2);
        if (this.phaseT <= 0) this.phase = 'play';
        break;
      case 'pause':
        this.phaseT -= dt;
        for (const e of this.ents) this.moveEnt(e, dt, 0.4);
        if (this.phaseT <= 0 && this.after) { const fn = this.after; this.after = null; fn(); }
        break;
      case 'play':
      case 'flight':
        this.tickPlay(dt);
        break;
      default:
        break;
    }
    this.pushHud();
    this.pushControls();
  }

  private tickPlay(dt: number) {
    for (const e of this.ents) {
      e.daze = Math.max(0, e.daze - dt);
      e.boost = Math.max(0, e.boost - dt);
    }
    this.duelCd = Math.max(0, this.duelCd - dt);
    if (!this.golden) this.clock = Math.max(0, this.clock - dt);
    if (this.phase === 'play') this.shotClock -= dt;

    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      if (f.kind === 'pass' && f.to && !f.thief) { f.tx = f.to.x; f.ty = f.to.y; }
      if (f.t >= f.dur) this.landFlight(f);
    }
    if (this.phase === 'play' && this.shotClock <= 0 && this.holder) {
      const thief = this.ents.filter((e) => e.team !== this.offense)
        .sort((a, b) => dist(a.x, a.y, this.holder!.x, this.holder!.y) - dist(b.x, b.y, this.holder!.x, this.holder!.y))[0];
      sfx.buzzer();
      this.turnover(thief, 'SHOT CLOCK!', '#ffd60a');
      return;
    }
    if (this.clock <= 0 && this.phase === 'play' && !this.golden) {
      if (this.score[0] === this.score[1]) {
        this.golden = true;
        sfx.buzzer();
        this.pauseThen(1.0, () => this.setupCheck(this.offense, this.holder?.slot ?? 0));
      } else {
        this.finish();
      }
      return;
    }

    this.thinkOffense(dt);
    this.thinkDefense();
    this.userMove();
    for (const e of this.ents) this.moveEnt(e, dt, 1);
    this.separate();

    // Contact = duel.
    if (this.phase === 'play' && this.holder && this.duelCd <= 0) {
      const h = this.holder;
      const d = this.ents.find((o) => o.team !== h.team && o.daze <= 0 && dist(o.x, o.y, h.x, h.y) < DUEL_RANGE);
      if (d) void this.runDuel(h, d);
    }
  }

  private userMove() {
    const c = this.controlled;
    if (!c || c.team !== 0) return;
    let kx = 0, ky = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) ky -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
    if (this.portrait) [kx, ky] = [ky, kx];
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      this.moveTarget = { x: clamp(c.x + (kx / l) * 1.2, 0.4, COURT_W - 0.4), y: clamp(c.y + (ky / l) * 1.2, 0.4, COURT_H - 0.4) };
      this.idleT = 0;
    }
    if (this.moveTarget) {
      c.tx = this.moveTarget.x; c.ty = this.moveTarget.y;
      if (dist(c.x, c.y, c.tx, c.ty) < 0.1 && !this.pointerDown && !(kx || ky)) this.moveTarget = null;
    } else if (c !== this.holder && this.idleT < 1.2) {
      c.tx = c.x; c.ty = c.y;
    }
  }

  private thinkOffense(dt: number) {
    const off = this.ents.filter((e) => e.team === this.offense);
    for (const e of off) {
      if (e === this.holder) continue;
      e.spotT -= dt;
      if (e.spotT <= 0) {
        e.spotT = 1.2 + Math.random() * 0.8;
        const ref = this.holder ?? e;
        let best = SPOTS[0], bestS = -99;
        for (const sp of SPOTS) {
          let nd = 99;
          for (const o of this.ents) if (o.team !== e.team) nd = Math.min(nd, dist(o.x, o.y, sp.x, sp.y));
          const mateTaken = off.some((m) => m !== e && m !== this.holder && dist(m.tx, m.ty, sp.x, sp.y) < 2);
          const sc = Math.min(nd, 4) + Math.min(dist(ref.x, ref.y, sp.x, sp.y), 5) * 0.5 - (mateTaken ? 5 : 0) + Math.random();
          if (sc > bestS) { bestS = sc; best = sp; }
        }
        e.tx = best.x; e.ty = best.y;
      }
    }
    if (this.offense === 1 && this.holder && this.phase === 'play') this.aiHandler(dt, this.holder);
  }

  private aiHandler(dt: number, h: Ent) {
    this.aiT -= dt;
    const foes = this.ents.filter((e) => e.team !== h.team);
    const nearest = foes.sort((a, b) => dist(a.x, a.y, h.x, h.y) - dist(b.x, b.y, h.x, h.y))[0];
    const nd = dist(nearest.x, nearest.y, h.x, h.y);
    if (this.aiT <= 0) {
      this.aiT = 0.3 + Math.random() * 0.25;
      const p = this.shotChance(h);
      const threshold = 0.5 - this.tier * 0.015;
      if ((p >= threshold && Math.random() < 0.55) || (this.shotClock < 2 && p > 0.15) || this.shotClock < 0.8) {
        this.shoot(h, Math.random() < p);
        return;
      }
      if (nd < 2.4 && Math.random() < 0.22 + this.tier * 0.03) {
        const mates = this.ents.filter((e) => e.team === h.team && e !== h)
          .map((m) => ({ m, s: this.openness(m) - this.laneRisk(h, m).risk * 4 }))
          .sort((a, b) => b.s - a.s);
        if (mates[0] && mates[0].s > 1) { this.passTo(h, mates[0].m, false); return; }
      }
    }
    // Drive toward a scoring spot while steering around the nearest defender.
    const goal = { x: HOOP.x + (h.slot - 1) * 1.6, y: HOOP.y + 1.6 };
    let gx = goal.x - h.x, gy = goal.y - h.y;
    const gl = Math.hypot(gx, gy) || 1;
    gx /= gl; gy /= gl;
    if (nd < 3.2) {
      const ax = h.x - nearest.x, ay = h.y - nearest.y;
      const al = Math.hypot(ax, ay) || 1;
      const w = (3.2 - nd) * 0.7;
      gx += (ax / al) * w; gy += (ay / al) * w;
    }
    const l = Math.hypot(gx, gy) || 1;
    h.tx = clamp(h.x + (gx / l) * 1.5, 0.5, COURT_W - 0.5);
    h.ty = clamp(h.y + (gy / l) * 1.5, 0.5, COURT_H - 0.5);
  }

  private thinkDefense() {
    const def = this.ents.filter((e) => e.team !== this.offense);
    const off = this.ents.filter((e) => e.team === this.offense);
    const ball = this.holder ?? (this.flight?.to ?? null);
    for (const d of def) {
      if (d === this.controlled && (this.moveTarget || this.idleT < 1.2)) continue;
      const man = off.find((o) => o.slot === d.slot) ?? off[0];
      if (d.team === 1 && man === this.holder) {
        // AI on-ball defender closes out to force duels.
        const p = this.markSpot(man.x, man.y, 0.35);
        d.tx = p.x; d.ty = p.y;
      } else {
        const sag = man === ball ? 1.3 : 1.8;
        const p = this.markSpot(man.x, man.y, sag);
        d.tx = p.x; d.ty = p.y;
      }
    }
  }

  private moveEnt(e: Ent, dt: number, mult: number) {
    const dx = e.tx - e.x, dy = e.ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.02) return;
    let v = this.speed(e) * mult;
    if (e.team === 1 && this.offense === 0 && e.slot === this.holder?.slot) v *= 0.8 + this.tier * 0.035;
    if (e.team === 0 && this.offense === 1 && e !== this.controlled) v *= 0.85;
    const step = Math.min(d, v * dt);
    e.x += (dx / d) * step;
    e.y += (dy / d) * step;
    e.face = Math.atan2(dy, dx);
  }

  private separate() {
    for (let i = 0; i < this.ents.length; i++) {
      for (let j = i + 1; j < this.ents.length; j++) {
        const a = this.ents[i], b = this.ents[j];
        if (this.duelCd <= 0 && a.team !== b.team && (a === this.holder || b === this.holder)) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < 0.95 && d > 0.001) {
          const push = (0.95 - d) / 2;
          const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
          a.x += nx * push; a.y += ny * push;
          b.x -= nx * push; b.y -= ny * push;
        }
      }
    }
    for (const e of this.ents) {
      e.x = clamp(e.x, 0.4, COURT_W - 0.4);
      e.y = clamp(e.y, 0.4, COURT_H - 0.4);
    }
  }

  private addFloat(text: string, x: number, y: number, color: string, size: number) {
    this.floats.push({ text, x, y, t: 0, color, size });
  }

  // ---------------- UI sync ----------------
  private pushHud() {
    const h: HudInfo = { score: this.score, clock: this.clock, shotClock: Math.max(0, this.shotClock), golden: this.golden, offense: this.offense };
    const key = `${h.score.join('-')}|${Math.ceil(h.clock)}|${Math.ceil(h.shotClock)}|${h.golden}|${h.offense}`;
    if (key !== this.hudKey) { this.hudKey = key; this.hooks.hud(h); }
  }

  private pushControls() {
    let c: ControlInfo;
    const ctrl = this.controlled;
    if (this.phase === 'over' || this.phase === 'duel' || !ctrl) {
      c = { mode: 'wait', shootPct: 0, isTwo: false, passes: [], controlledName: '', energy: 0 };
    } else if (this.offense === 0 && this.holder && this.holder.team === 0) {
      const mates = this.ents.filter((e) => e.team === 0 && e !== this.holder).sort((a, b) => a.slot - b.slot);
      c = {
        mode: 'attack',
        shootPct: Math.round(this.shotChance(this.holder) * 100),
        isTwo: isTwoPoint(this.holder.x, this.holder.y),
        passes: mates.map((m) => ({ name: m.pl.name.split(' ')[0], risky: this.laneRisk(this.holder!, m).risk > 0 })),
        controlledName: this.holder.pl.name, energy: this.holder.energy,
      };
    } else if (this.offense === 1) {
      c = { mode: 'defend', shootPct: 0, isTwo: false, passes: [], controlledName: ctrl.pl.name, energy: ctrl.energy };
    } else {
      c = { mode: 'wait', shootPct: 0, isTwo: false, passes: [], controlledName: ctrl.pl.name, energy: ctrl.energy };
    }
    const key = JSON.stringify(c);
    if (key !== this.ctrlKey) { this.ctrlKey = key; this.hooks.controls(c); }
  }

  // ---------------- rendering ----------------
  private render() {
    const g = this.ctx2d;
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#2a1b3d';
    g.fillRect(0, 0, W, H);
    this.drawCrowd(g, W, H);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 20 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 20 : 0;
    const k = this.dpr * this.scale;
    // Court space (meters). Portrait swaps the axes.
    if (this.portrait) g.setTransform(0, k, k, 0, this.dpr * (this.ox + sx), this.dpr * (this.oy + sy));
    else g.setTransform(k, 0, 0, k, this.dpr * (this.ox + sx), this.dpr * (this.oy + sy));
    this.drawCourt(g);

    // Hints: pass lanes / duel zone.
    if ((this.phase === 'play' || this.phase === 'check') && this.holder) {
      if (this.offense === 0 && this.holder.team === 0) {
        for (const m of this.ents.filter((e) => e.team === 0 && e !== this.holder)) {
          const risky = this.laneRisk(this.holder, m).risk > 0;
          g.setLineDash([0.18, 0.14]);
          g.strokeStyle = risky ? 'rgba(255,77,109,0.8)' : 'rgba(61,220,151,0.8)';
          g.lineWidth = 0.06;
          g.beginPath(); g.moveTo(this.holder.x, this.holder.y); g.lineTo(m.x, m.y); g.stroke();
          g.setLineDash([]);
        }
      } else if (this.offense === 1) {
        const pulse = 0.5 + Math.sin(this.time * 8) * 0.5;
        g.strokeStyle = `rgba(255,77,109,${0.35 + pulse * 0.4})`;
        g.lineWidth = 0.08;
        g.beginPath(); g.arc(this.holder.x, this.holder.y, DUEL_RANGE + 0.1, 0, Math.PI * 2); g.stroke();
      }
    }
    if (this.moveTarget && this.controlled) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.06;
      const r = 0.25 + Math.sin(this.time * 10) * 0.05;
      g.beginPath(); g.arc(this.moveTarget.x, this.moveTarget.y, r, 0, Math.PI * 2); g.stroke();
    }

    // Sprites are drawn upright in screen space, sized in meters.
    const sprite = (x: number, y: number) => {
      const p = this.toScreen(x, y);
      g.setTransform(k, 0, 0, k, this.dpr * (p.x + sx), this.dpr * (p.y + sy));
    };
    const sorted = [...this.ents].sort((a, b) => this.toScreen(a.x, a.y).y - this.toScreen(b.x, b.y).y);
    for (const e of sorted) { sprite(e.x, e.y); this.drawEnt(g, e); }
    this.drawBall(g, sprite);

    for (const f of this.floats) {
      sprite(f.x, f.y);
      const a = 1 - f.t / 1.4;
      g.save();
      g.globalAlpha = Math.max(0, a);
      g.font = `900 ${0.62 * f.size}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 0.14;
      g.strokeStyle = '#1b1029';
      const y = -1 - f.t * 0.9;
      g.strokeText(f.text, 0, y);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, y);
      g.restore();
    }
  }

  private drawCrowd(g: CanvasRenderingContext2D, W: number, H: number) {
    const cols = ['#ff7a1a', '#ffd166', '#4cc9f0', '#f72585', '#7b2cbf', '#3ddc97'];
    const s = 9;
    const cw = (this.portrait ? COURT_H : COURT_W) * this.scale, ch = (this.portrait ? COURT_W : COURT_H) * this.scale;
    g.globalAlpha = 0.25;
    for (let y = 6; y < H; y += s * 1.6) {
      for (let x = 6 + ((y / s) % 2) * 5; x < W; x += s * 1.4) {
        const inCourt = x > this.ox - 6 && x < this.ox + cw + 6 && y > this.oy - 6 && y < this.oy + ch + 6;
        if (inCourt) continue;
        const i = Math.floor(x * 7 + y * 13) % cols.length;
        const bob = this.score[0] + this.score[1] > 0 ? Math.sin(this.time * 6 + x) * 1.2 : 0;
        g.fillStyle = cols[i];
        g.beginPath(); g.arc(x, y + bob, 3, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  private drawCourt(g: CanvasRenderingContext2D) {
    const wood = g.createLinearGradient(0, 0, 0, COURT_H);
    wood.addColorStop(0, '#f2c27b');
    wood.addColorStop(1, '#e0a35c');
    g.fillStyle = wood;
    g.fillRect(0, 0, COURT_W, COURT_H);
    g.strokeStyle = 'rgba(150,90,30,0.18)';
    g.lineWidth = 0.03;
    for (let x = 0.75; x < COURT_W; x += 0.75) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, COURT_H); g.stroke(); }
    // Paint.
    g.fillStyle = this.teams[0].color + '55';
    g.fillRect(5.05, 0, 4.9, 5.8);
    g.strokeStyle = '#fff';
    g.lineWidth = 0.09;
    g.strokeRect(0, 0, COURT_W, COURT_H);
    g.strokeRect(5.05, 0, 4.9, 5.8);
    g.beginPath(); g.arc(7.5, 5.8, 1.8, 0, Math.PI); g.stroke();
    // Three-point (2-pt in 3x3) line.
    g.beginPath();
    g.moveTo(HOOP.x - CORNER_DX, 0);
    g.lineTo(HOOP.x - CORNER_DX, CORNER_Y);
    const a0 = Math.atan2(CORNER_Y - HOOP.y, -CORNER_DX);
    const a1 = Math.atan2(CORNER_Y - HOOP.y, CORNER_DX);
    g.arc(HOOP.x, HOOP.y, ARC_R, a0, a1, true);
    g.lineTo(HOOP.x + CORNER_DX, 0);
    g.stroke();
    // No-charge arc.
    g.beginPath(); g.arc(HOOP.x, HOOP.y, 1.25, 0, Math.PI); g.stroke();
    // Logo.
    if (!this.portrait) {
    g.save();
    g.globalAlpha = 0.22;
    g.fillStyle = '#7a3e00';
    g.font = '900 1.1px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('TURN BALL', 7.5, 10.3);
    g.restore();
    }
    // Hoop.
    g.fillStyle = '#fff';
    g.fillRect(6.6, 1.1, 1.8, 0.12);
    g.strokeStyle = '#ff4d1a';
    g.lineWidth = 0.08;
    g.beginPath(); g.arc(HOOP.x, HOOP.y, 0.25, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.03;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(HOOP.x + Math.cos(a) * 0.25, HOOP.y + Math.sin(a) * 0.25);
      g.lineTo(HOOP.x + Math.cos(a) * 0.12, HOOP.y + 0.18 + Math.sin(a) * 0.08);
      g.stroke();
    }
  }

  /** Facing direction in screen space. */
  private faceVec(e: Ent) {
    const c = Math.cos(e.face), sn = Math.sin(e.face);
    return this.portrait ? { x: sn, y: c } : { x: c, y: sn };
  }

  private drawEnt(g: CanvasRenderingContext2D, e: Ent) {
    const team = this.teams[e.team];
    const isCtrl = e === this.controlled && this.phase !== 'over';
    const fv = this.faceVec(e);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(0, 0.32, R * 0.95, R * 0.45, 0, 0, Math.PI * 2); g.fill();
    if (isCtrl) {
      g.strokeStyle = '#fff';
      g.lineWidth = 0.08;
      const r = R + 0.16 + Math.sin(this.time * 6) * 0.04;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    }
    // Energy ring.
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 0.09;
    g.beginPath(); g.arc(0, 0, R + 0.05, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = e.energy >= 40 ? '#ffd60a' : '#bba15a';
    g.beginPath(); g.arc(0, 0, R + 0.05, -Math.PI / 2, -Math.PI / 2 + (e.energy / 100) * Math.PI * 2); g.stroke();
    // Body.
    g.fillStyle = team.color;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1029';
    g.lineWidth = 0.05;
    g.stroke();
    // Head with hair.
    const hx = fv.x * 0.08, hy = -0.12 + fv.y * 0.05;
    g.fillStyle = e.pl.skin;
    g.beginPath(); g.arc(hx, hy, 0.24, 0, Math.PI * 2); g.fill();
    g.fillStyle = e.pl.hair;
    g.beginPath(); g.arc(hx, hy, 0.25, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    g.fillStyle = '#1b1029';
    const look = e.daze > 0 ? 0 : 0.04;
    g.beginPath(); g.arc(hx - 0.08 + fv.x * look, hy + 0.02, 0.035, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(hx + 0.08 + fv.x * look, hy + 0.02, 0.035, 0, Math.PI * 2); g.fill();
    // Jersey number.
    g.fillStyle = team.accent;
    g.font = '900 0.3px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(e.pl.num), 0, 0.38);
    if (e.daze > 0) {
      g.fillStyle = '#ffd60a';
      g.font = '0.3px system-ui';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        g.fillText('★', Math.cos(a) * 0.45, -0.6 + Math.sin(a) * 0.15);
      }
    }
    if (e.boost > 0) {
      g.strokeStyle = 'rgba(255,214,10,0.8)';
      g.lineWidth = 0.05;
      const px = -fv.y, py = fv.x;
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * 0.18;
        g.beginPath();
        g.moveTo(-fv.x * 0.6 + px * o, -fv.y * 0.6 + py * o);
        g.lineTo(-fv.x * 1.0 + px * o, -fv.y * 1.0 + py * o);
        g.stroke();
      }
    }
    if (isCtrl) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(0, -R - 0.25);
      g.lineTo(-0.18, -R - 0.5);
      g.lineTo(0.18, -R - 0.5);
      g.fill();
    }
  }

  private drawBall(g: CanvasRenderingContext2D, sprite: (x: number, y: number) => void) {
    let z = 0, dx = 0, dy = 0;
    if (this.flight) {
      const f = this.flight;
      const t = clamp(f.t / f.dur, 0, 1);
      sprite(f.fx + (f.tx - f.fx) * t, f.fy + (f.ty - f.fy) * t);
      z = f.kind === 'shot' ? Math.sin(t * Math.PI) * 2.2 : Math.sin(t * Math.PI) * 0.5;
    } else if (this.holder) {
      const h = this.holder;
      sprite(h.x, h.y);
      const fv = this.faceVec(h);
      dx = fv.x * 0.35 + 0.25; dy = 0.1;
      z = Math.abs(Math.sin(this.time * 9)) * 0.35;
    } else return;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(dx, dy + 0.15, 0.17, 0.08, 0, 0, Math.PI * 2); g.fill();
    const r = 0.19 + z * 0.06;
    const y = dy - z;
    g.fillStyle = '#ff7f11';
    g.beginPath(); g.arc(dx, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5a2a00';
    g.lineWidth = 0.03;
    g.stroke();
    g.beginPath(); g.moveTo(dx - r, y); g.lineTo(dx + r, y); g.stroke();
    g.beginPath(); g.arc(dx, y, r * 0.55, -Math.PI / 2, Math.PI / 2); g.stroke();
  }
}
