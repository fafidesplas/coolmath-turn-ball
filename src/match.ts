// Real-time half-court 3x3 match in 3D. Free movement with an elevated camera; whenever the ball
// handler meets a defender (or you call a play) the game stops, the camera drops to third person
// and you pick a move while previews show what will happen and the exact odds.
import * as THREE from 'three';
import { sfx } from './audio';
import { type Action, type AttackAction, type DefendAction, type Player, type Technique } from './data';
import {
  aiAttackDist, aiDefendDist, attackOdds, bestTech, clamp, defenseOdds, HabitMemory, resolveDuel, sample, toPercents,
  type Choice, type DuelContext, type DuelResult, type Weighted,
} from './duel';
import { icon } from './icons';
import { ArcCurve, ARC_R, CORNER_DX, COURT_H, COURT_W, HOOP, RIM, World, w3, type PlayerLook } from './world';

export { COURT_W, COURT_H, HOOP };
export const MATCH_SECONDS = 150;
export const SHOT_CLOCK = 12;
export const WIN_SCORE = 11;
const DUEL_RANGE = 1.0;
const ACT_RANGE = 3.2;
const CLOSEOUT_RANGE = 1.8;
const CORNER_Y = HOOP.y + Math.sqrt(ARC_R * ARC_R - CORNER_DX * CORNER_DX);

export interface TeamSetup {
  name: string;
  short: string;
  color: string;
  accent: string;
  shorts: string;
  players: Player[];
}

interface EntAnim { t: number; dur: number; path: (k: number) => { x: number; y: number } }

interface Ent {
  i: number;
  pl: Player;
  team: 0 | 1;
  slot: number;
  x: number; y: number;
  tx: number; ty: number;
  px: number; py: number;
  energy: number;
  daze: number;
  boost: number;
  spotT: number;
  face: number;
  jumpT: number; jumpDur: number; jumpH: number;
  armsT: number; arms: number;
  anim: EntAnim | null;
}

interface Flight { curve: ArcCurve; t: number; dur: number; onLand: () => void }

export interface HudInfo { score: [number, number]; clock: number; shotClock: number; golden: boolean; offense: 0 | 1 }
export interface PlayerLine { pts: number; duels: number; duelsWon: number; steals: number }
export interface MatchResult { score: [number, number]; won: boolean; lines: Record<string, PlayerLine>; quit?: boolean }

export type Tone = 'good' | 'mid' | 'bad';
export interface OddsItem { key: string; pct: number; tone: Tone; word: string; icon: string }
export interface OptionInfo {
  id: string;
  action: Action;
  label: string;
  tech?: Technique;
  target?: number;
  targetNum?: number;
  odds: OddsItem[];
  main: number;
}

export interface DecisionInfo {
  side: 'att' | 'def';
  me: { name: string; num: number; energy: number; color: string };
  them: { name: string; num: number; color: string };
  special: boolean;
  specialAvailable: boolean;
  pts: number;
}

export interface MatchHooks {
  hud(h: HudInfo): void;
  mode(m: 'attack' | 'defend' | 'idle', canAct: boolean): void;
  decision(open: boolean): void;
  banner(text: string, color: string, sub?: string): void;
  end(r: MatchResult): void;
}

type Phase = 'check' | 'play' | 'decide' | 'resolve' | 'pause' | 'over';

interface Decision {
  side: 'att' | 'def';
  att: Ent;
  def: Ent;
  ctx: DuelContext;
  mates: Ent[];
  attDist: Weighted<Choice<AttackAction>>[];
  defDist: Weighted<Choice<DefendAction>>[];
  special: boolean;
  previewId: string | null;
}

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

const ease = (k: number) => k * k * (3 - 2 * k);
const shotApex = (d: number) => 0.7 + d * 0.09;

const OPT_LABEL: Record<Action, string> = {
  shoot: 'Shoot', pass: 'Pass', dribble: 'Drive', protect: 'Shield',
  steal: 'Steal', block: 'Block', press: 'Press', wait: 'Read',
};

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
  time = 0;
  aiT = 0;
  memory = new HabitMemory();
  lines: Record<string, PlayerLine> = {};
  decision: Decision | null = null;
  paused = false;
  decisions = 0;
  /** Event counters (debug / balance testing). */
  stats: Record<string, number> = {};
  private bump(k: string) { this.stats[k] = (this.stats[k] ?? 0) + 1; }
  world: World;
  private timers: { t: number; fn: () => void }[] = [];
  private raf = 0;
  private last = 0;
  private hudKey = '';
  private modeKey = '';
  private pointerDown = false;
  private destroyed = false;
  private ballPos = new THREE.Vector3();
  private previewOpt: OptionInfo | null = null;
  private looseBall: THREE.Vector3 | null = null;

  constructor(
    stage: HTMLElement,
    public teams: [TeamSetup, TeamSetup],
    private tier: number,
    private hooks: MatchHooks,
  ) {
    const looks: PlayerLook[] = [];
    teams.forEach((t, ti) => t.players.slice(0, 3).forEach((pl, slot) => {
      this.ents.push({
        i: this.ents.length, pl, team: ti as 0 | 1, slot, x: 7.5, y: 6, tx: 7.5, ty: 6, px: 7.5, py: 6, energy: 40, daze: 0, boost: 0,
        spotT: 0, face: 0, jumpT: 0, jumpDur: 0, jumpH: 0, armsT: 0, arms: 0, anim: null,
      });
      looks.push({ jersey: t.color, shorts: t.shorts, accent: t.accent, skin: pl.skin, hair: pl.hair, num: pl.num, team: ti as 0 | 1 });
      this.lines[pl.uid] = { pts: 0, duels: 0, duelsWon: 0, steals: 0 };
    }));
    this.world = new World(stage, looks);
    this.bindInput();
    this.setupCheck(0, 0, true);
    this.updateCamera(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.world.destroy();
  }

  private later(t: number, fn: () => void) { this.timers.push({ t, fn }); }

  // ---------------- input ----------------
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.phase === 'over' || this.paused || this.phase === 'decide') return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      this.keys.add(k);
      e.preventDefault();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      this.userAct();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const el = this.world.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.phase !== 'play' && this.phase !== 'check') return;
      const p = this.world.pickCourt(e.clientX, e.clientY);
      if (!p) return;
      this.pointerDown = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.setTarget(p.x, p.y);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const p = this.world.pickCourt(e.clientX, e.clientY);
      if (p) this.setTarget(p.x, p.y);
    });
    const up = () => { this.pointerDown = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private setTarget(x: number, y: number) {
    this.moveTarget = { x: clamp(x, 0.4, COURT_W - 0.4), y: clamp(y, 0.4, COURT_H - 0.4) };
    this.idleT = 0;
  }

  /** Main action button: call a play with the ball, or challenge the ball handler on defense. */
  userAct() {
    if (this.phase !== 'play' || !this.holder) return;
    if (this.offense === 0 && this.holder.team === 0) {
      const def = this.nearestFoe(this.holder);
      this.openDecision('att', this.holder, def, this.spaceBonus(dist(def.x, def.y, this.holder.x, this.holder.y), 2.5, 4));
    } else if (this.offense === 1) {
      const h = this.holder;
      const mine = this.ents.filter((e) => e.team === 0 && e.daze <= 0)
        .sort((a, b) => dist(a.x, a.y, h.x, h.y) - dist(b.x, b.y, h.x, h.y))[0];
      if (mine && dist(mine.x, mine.y, h.x, h.y) <= ACT_RANGE) this.openDecision('def', h, mine, 0);
    }
  }

  canAct(): boolean {
    if (this.phase !== 'play' || !this.holder) return false;
    if (this.offense === 0) return this.holder.team === 0;
    const h = this.holder;
    return this.ents.some((e) => e.team === 0 && e.daze <= 0 && dist(e.x, e.y, h.x, h.y) <= ACT_RANGE);
  }

  // ---------------- flow ----------------
  private setupCheck(offense: 0 | 1, handlerSlot: number, first = false) {
    this.offense = offense;
    this.flight = null;
    this.looseBall = null;
    this.shotClock = SHOT_CLOCK;
    const off = this.ents.filter((e) => e.team === offense);
    const def = this.ents.filter((e) => e.team !== offense);
    const handler = off.find((e) => e.slot === handlerSlot) ?? off[0];
    const wings = [{ x: 3.0, y: 5.6 }, { x: 12.0, y: 5.6 }];
    let wi = 0;
    for (const e of [...off, ...def]) { e.anim = null; e.daze = 0; e.boost = 0; e.arms = 0; e.armsT = 0; }
    for (const e of off) {
      const p = e === handler ? { x: 7.5, y: 9.3 } : wings[wi++];
      e.tx = p.x; e.ty = p.y;
      if (first) { e.x = p.x; e.y = p.y; }
    }
    for (const d of def) {
      const man = off.find((o) => o.slot === d.slot) ?? off[0];
      const p = this.markSpot(man.tx, man.ty, man === handler ? 2.6 : 1.7);
      d.tx = p.x; d.ty = p.y;
      if (first) { d.x = p.x; d.y = p.y; }
    }
    this.holder = handler;
    this.decision = null;
    this.world.clearPreview();
    this.moveTarget = null;
    this.controlled = offense === 0 ? handler : (def.find((d) => d.slot === handler.slot) ?? def[0]);
    this.phase = 'check';
    this.phaseT = first ? 1.8 : 1.3;
    this.duelCd = 1.2;
    if (this.golden) this.hooks.banner('GOLDEN BASKET', '#ffd60a', 'Next score wins');
    else if (offense === 0) this.hooks.banner('YOUR BALL', this.teams[0].color);
    else this.hooks.banner('DEFENSE', this.teams[1].color);
    sfx.whistle();
  }

  private pauseThen(t: number, fn: () => void) {
    this.phase = 'pause';
    this.phaseT = t;
    this.after = fn;
  }

  private turnover(newHolder: Ent) {
    this.holder = newHolder;
    this.flight = null;
    this.looseBall = null;
    this.lines[newHolder.pl.uid].steals++;
    const team = newHolder.team;
    this.pauseThen(0.9, () => this.setupCheck(team, newHolder.slot));
  }

  private markSpot(mx: number, my: number, sag: number) {
    const dx = HOOP.x - mx, dy = HOOP.y - my;
    const l = Math.hypot(dx, dy) || 1;
    return { x: mx + (dx / l) * sag, y: my + (dy / l) * sag };
  }

  private nearestFoe(e: Ent, exclude?: Ent): Ent {
    return this.ents.filter((o) => o.team !== e.team && o !== exclude)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
  }

  private spaceBonus(d: number, one: number, two: number) { return d > two ? 2 : d > one ? 1 : 0; }

  /** Make chance of a jump shot from the entity's spot. */
  shotChance(e: Ent, ignoreDefense = false): number {
    const d = dist(e.x, e.y, HOOP.x, HOOP.y);
    const two = isTwoPoint(e.x, e.y);
    let p = d < 2.2 ? 0.76 : d < 4.5 ? 0.62 : !two ? 0.52 : d < 8.5 ? 0.4 : 0.14;
    p += (e.pl.stats.sho - 5) * 0.045;
    if (!ignoreDefense) {
      let nd = 99;
      for (const o of this.ents) if (o.team !== e.team && o.daze <= 0) nd = Math.min(nd, dist(o.x, o.y, e.x, e.y));
      if (nd < 2.6) p -= (2.6 - nd) * 0.12;
    } else p += 0.06;
    if (e.boost > 0) p += 0.08;
    return clamp(p, 0.04, 0.93);
  }

  private laneRisk(from: Ent, to: Ent, exclude?: Ent): { risk: number; thief: Ent | null; d: number } {
    let best: Ent | null = null, bestD = 99;
    for (const o of this.ents) {
      if (o.team === from.team || o.daze > 0 || o === exclude) continue;
      const { d, t } = segDist(o.x, o.y, from.x, from.y, to.x, to.y);
      if (t > 0.08 && t < 0.97 && d < bestD) { bestD = d; best = o; }
    }
    if (!best || bestD > 0.95) return { risk: 0, thief: null, d: bestD };
    return { risk: clamp(0.4 + (best.pl.stats.def - from.pl.stats.pas) * 0.05 + (0.95 - bestD) * 0.4, 0.15, 0.85), thief: best, d: bestD };
  }

  private openness(e: Ent) {
    let nd = 99;
    for (const o of this.ents) if (o.team !== e.team && o.daze <= 0) nd = Math.min(nd, dist(o.x, o.y, e.x, e.y));
    return Math.min(nd, 5) - dist(e.x, e.y, HOOP.x, HOOP.y) * 0.15;
  }

  // ---------------- 3D helpers ----------------
  private pos3(e: Ent, h = 0) { return w3(e.x, e.y, h + this.jumpOf(e)); }
  private jumpOf(e: Ent) { return e.jumpT > 0 ? Math.sin(Math.PI * (1 - e.jumpT / e.jumpDur)) * e.jumpH : 0; }
  private hand(e: Ent, h = 1.15) {
    const p = this.pos3(e, h);
    p.x += Math.sin(e.face) * 0.32 + Math.cos(e.face) * 0.2;
    p.z += Math.cos(e.face) * 0.32 - Math.sin(e.face) * 0.2;
    return p;
  }
  private jump(e: Ent, h: number, dur: number) { e.jumpH = h; e.jumpDur = dur; e.jumpT = dur; }
  private faceTo(e: Ent, x: number, y: number) { e.face = Math.atan2(x - e.x, y - e.y); }

  private fly(from: THREE.Vector3, to: THREE.Vector3, apex: number, dur: number, onLand: () => void) {
    this.holder = null;
    this.looseBall = null;
    this.flight = { curve: new ArcCurve(from.clone(), to.clone(), apex), t: 0, dur, onLand };
  }

  // ---------------- free-play shots & passes (AI) ----------------
  private shoot(e: Ent, made: boolean, after?: () => void) {
    const pts = isTwoPoint(e.x, e.y) ? 2 : 1;
    const d = dist(e.x, e.y, HOOP.x, HOOP.y);
    this.faceTo(e, HOOP.x, HOOP.y);
    this.jump(e, 0.45, 0.6);
    e.armsT = 0.5;
    sfx.tap();
    this.holder = null;
    this.looseBall = this.hand(e, 2.0);
    this.later(0.22, () => {
      const from = this.hand(e, 2.1);
      if (made) {
        this.fly(from, RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), shotApex(d), 0.75 + d * 0.035, () => {
          this.world.kickNet();
          sfx.swish();
          this.fly(RIM.clone(), w3(HOOP.x, HOOP.y + 0.3, 0.2), 0, 0.35, () => this.scored(e, pts));
        });
      } else {
        const toward = new THREE.Vector3(e.x - HOOP.x, 0, e.y - HOOP.y).normalize();
        const front = RIM.clone().addScaledVector(toward, 0.24).add(new THREE.Vector3(0, 0.05, 0));
        this.fly(from, front, shotApex(d), 0.75 + d * 0.035, () => {
          this.world.kickRim();
          sfx.rim();
          this.world.callout(RIM.clone().add(new THREE.Vector3(0, 0.6, 0)), icon('cross', 26), 'bad');
          this.rebound(after);
        });
      }
    });
  }

  private scored(shooter: Ent, pts: number) {
    this.bump(`score${shooter.team}`);
    this.score[shooter.team] += pts;
    this.lines[shooter.pl.uid].pts += pts;
    if (shooter.team === 0) sfx.cheer();
    this.world.shake = 0.25;
    this.world.callout(RIM.clone().add(new THREE.Vector3(0, 0.9, 0)), `+${pts}`, shooter.team === 0 ? 'good big' : 'bad big');
    this.looseBall = w3(HOOP.x, HOOP.y + 0.6, 0.2);
    const over = this.golden || this.score[shooter.team] >= WIN_SCORE;
    const other = (1 - shooter.team) as 0 | 1;
    this.pauseThen(1.1, () => (over ? this.finish() : this.setupCheck(other, 0)));
  }

  private rebound(after?: () => void) {
    const offR = this.nearestTo(this.offense, HOOP.x, HOOP.y);
    const defR = this.nearestTo((1 - this.offense) as 0 | 1, HOOP.x, HOOP.y);
    const pOff = clamp(0.36 + ((offR.pl.stats.str + offR.pl.stats.blk) - (defR.pl.stats.str + defR.pl.stats.blk)) * 0.03, 0.12, 0.5);
    const win = Math.random() < pOff ? offR : defR;
    const ang = Math.random() * Math.PI;
    const spot = { x: clamp(HOOP.x + Math.cos(ang) * 2.4, 1, COURT_W - 1), y: HOOP.y + Math.sin(ang) * 2.2 + 0.6 };
    for (const e of [offR, defR]) { e.tx = spot.x; e.ty = spot.y; }
    this.phase = this.phase === 'resolve' ? 'resolve' : 'pause';
    this.phaseT = 99;
    this.fly(RIM.clone(), w3(spot.x, spot.y, 1.6), 0.9, 0.55, () => {
      this.jump(win, 0.35, 0.4);
      win.x = spot.x + (win.x - spot.x) * 0.3; win.y = spot.y + (win.y - spot.y) * 0.3;
      this.holder = win;
      if (win.team === this.offense) {
        this.shotClock = SHOT_CLOCK;
        this.world.callout(this.pos3(win, 2.6), icon('ball', 24), win.team === 0 ? 'good' : 'bad');
        if (this.offense === 0) { this.controlled = win; this.moveTarget = null; } else this.retargetDefense();
        this.duelCd = 1.0;
        this.phase = 'play';
        after?.();
      } else {
        this.world.callout(this.pos3(win, 2.6), icon('ball', 24), win.team === 0 ? 'good' : 'bad');
        const team = win.team;
        this.pauseThen(0.7, () => this.setupCheck(team, win.slot));
        after?.();
      }
    });
  }

  private nearestTo(team: 0 | 1, x: number, y: number) {
    return this.ents.filter((e) => e.team === team).sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0];
  }

  private passTo(from: Ent, to: Ent) {
    let thief: Ent | null = null;
    const lr = this.laneRisk(from, to);
    if (lr.thief && Math.random() < lr.risk) thief = lr.thief;
    this.faceTo(from, to.x, to.y);
    const end = thief ?? to;
    const d = dist(from.x, from.y, end.x, end.y);
    sfx.pass();
    this.fly(this.hand(from), this.pos3(end, 1.2), 0.3, 0.12 + d / 14, () => {
      if (thief) {
        sfx.steal();
        thief.armsT = 0.4;
        this.world.callout(this.pos3(thief, 2.6), icon('steal', 26), thief.team === 0 ? 'good' : 'bad');
        this.turnover(thief);
        return;
      }
      this.holder = to;
      this.retargetDefense();
    });
  }

  private retargetDefense() {
    if (this.offense === 1 && this.holder) {
      const marker = this.ents.find((e) => e.team === 0 && e.slot === this.holder!.slot);
      if (marker && this.idleT > 1.5) { this.controlled = marker; this.moveTarget = null; }
    }
    if (this.offense === 0 && this.holder?.team === 0) { this.controlled = this.holder; this.moveTarget = null; }
  }

  private finish() {
    this.phase = 'over';
    sfx.buzzer();
    const won = this.score[0] > this.score[1];
    this.hooks.banner(won ? 'VICTORY' : 'DEFEAT', won ? '#3ddc97' : '#ff4d6d', `${this.score[0]} - ${this.score[1]}`);
    this.later(1.8, () => this.hooks.end({ score: [...this.score] as [number, number], won, lines: this.lines }));
  }

  quit(): MatchResult {
    return { score: [...this.score] as [number, number], won: false, lines: this.lines, quit: true };
  }

  // ---------------- decisions ----------------
  private openDecision(side: 'att' | 'def', att: Ent, def: Ent, space: number, shotIntent = false) {
    this.phase = 'decide';
    this.moveTarget = null;
    this.keys.clear();
    this.decisions++;
    sfx.duel();
    this.controlled = side === 'att' ? att : def;
    this.faceTo(att, HOOP.x, HOOP.y);
    this.faceTo(def, att.x, att.y);
    const mates = this.ents.filter((e) => e.team === att.team && e !== att).sort((a, b) => a.slot - b.slot);
    const laneMods = mates.map((m) => {
      const lr = this.laneRisk(att, m, def);
      const far = dist(att.x, att.y, m.x, m.y) > 8;
      return (lr.thief ? -1 : 0) + (far ? -1 : 0);
    });
    const ctx: DuelContext = {
      att: { player: att.pl, energy: att.energy },
      def: { player: def.pl, energy: def.energy },
      shotDist: dist(att.x, att.y, HOOP.x, HOOP.y),
      isTwo: isTwoPoint(att.x, att.y),
      shotClock: this.shotClock,
      space,
      pOpen: this.shotChance(att, true),
      pCont: this.shotChance(att),
      laneMods,
      shotIntent,
    };
    const smart = 0.1 + this.tier * 0.09;
    this.decision = {
      side, att, def, ctx, mates,
      attDist: aiAttackDist(ctx, this.memory, smart),
      defDist: aiDefendDist(ctx, this.memory, smart),
      special: false,
      previewId: null,
    };
    this.world.callout(this.pos3(att, 2.9).lerp(this.pos3(def, 2.9), 0.5), icon('act', 34), 'flash');
    this.hooks.decision(true);
  }

  decisionInfo(): DecisionInfo | null {
    const d = this.decision;
    if (!d) return null;
    const me = d.side === 'att' ? d.att : d.def;
    const them = d.side === 'att' ? d.def : d.att;
    const unit = d.side === 'att' ? d.ctx.att : d.ctx.def;
    const acts: Action[] = d.side === 'att' ? ['shoot', 'pass', 'dribble', 'protect'] : ['steal', 'block', 'press', 'wait'];
    return {
      side: d.side,
      me: { name: me.pl.name, num: me.pl.num, energy: me.energy, color: this.teams[me.team].color },
      them: { name: them.pl.name, num: them.pl.num, color: this.teams[them.team].color },
      special: d.special,
      specialAvailable: acts.some((a) => !!bestTech(unit, a)),
      pts: d.ctx.isTwo ? 2 : 1,
    };
  }

  toggleSpecial() {
    const d = this.decision;
    if (!d || this.phase !== 'decide') return;
    d.special = !d.special;
    sfx.tap();
    const id = d.previewId;
    d.previewId = null;
    if (id) this.preview(id);
  }

  options(): OptionInfo[] {
    const d = this.decision;
    if (!d) return [];
    const out: OptionInfo[] = [];
    if (d.side === 'att') {
      const unit = d.ctx.att;
      const mk = (action: AttackAction, target?: number): OptionInfo => {
        const tech = d.special ? bestTech(unit, action) : undefined;
        const choice: Choice<AttackAction> = { action, tech, target };
        const pc = toPercents(attackOdds(d.ctx, choice, d.defDist));
        const odds = this.attackOddsItems(action, pc);
        return {
          id: target === undefined ? action : `${action}${target}`, action, label: OPT_LABEL[action], tech, target,
          targetNum: target === undefined ? undefined : d.mates[target].pl.num,
          odds, main: odds.filter((o) => o.tone === 'good').reduce((a, o) => a + o.pct, 0),
        };
      };
      out.push(mk('shoot'), ...d.mates.map((_, i) => mk('pass', i)), mk('dribble'), mk('protect'));
    } else {
      const unit = d.ctx.def;
      for (const action of ['steal', 'block', 'press', 'wait'] as DefendAction[]) {
        const tech = d.special ? bestTech(unit, action) : undefined;
        const o = toPercents(defenseOdds(d.ctx, { action, tech }, d.attDist));
        const odds: OddsItem[] = [
          { key: 'ball', pct: o.ball, tone: 'good', word: 'BALL', icon: 'ball' },
          { key: 'even', pct: o.even, tone: 'mid', word: 'EVEN', icon: 'even' },
          { key: 'beaten', pct: o.beaten, tone: 'bad', word: 'BEAT', icon: 'beaten' },
          { key: 'score', pct: o.score, tone: 'bad', word: 'SCORE', icon: 'hoop' },
        ];
        out.push({ id: action, action, label: OPT_LABEL[action], tech, odds, main: o.ball });
      }
    }
    return out;
  }

  private attackOddsItems(action: AttackAction, pc: Record<string, number>): OddsItem[] {
    switch (action) {
      case 'shoot': return [
        { key: 'score', pct: pc.score ?? 0, tone: 'good', word: 'IN', icon: 'check' },
        { key: 'miss', pct: pc.miss ?? 0, tone: 'mid', word: 'MISS', icon: 'cross' },
        { key: 'blocked', pct: pc.blocked ?? 0, tone: 'bad', word: 'BLOCK', icon: 'block' },
      ];
      case 'pass': return [
        { key: 'complete', pct: pc.complete ?? 0, tone: 'good', word: 'CATCH', icon: 'check' },
        { key: 'deflect', pct: pc.deflect ?? 0, tone: 'mid', word: 'TIPPED', icon: 'even' },
        { key: 'intercept', pct: pc.intercept ?? 0, tone: 'bad', word: 'PICKED', icon: 'steal' },
      ];
      case 'dribble': return [
        { key: 'blowby', pct: pc.blowby ?? 0, tone: 'good', word: 'PAST', icon: 'dribble' },
        { key: 'standoff', pct: pc.standoff ?? 0, tone: 'mid', word: 'HELD', icon: 'even' },
        { key: 'stolen', pct: pc.stolen ?? 0, tone: 'bad', word: 'STOLEN', icon: 'steal' },
      ];
      case 'protect': return [
        { key: 'shove', pct: pc.shove ?? 0, tone: 'good', word: 'SPACE', icon: 'protect' },
        { key: 'standoff', pct: pc.standoff ?? 0, tone: 'mid', word: 'HELD', icon: 'even' },
        { key: 'trapped', pct: pc.trapped ?? 0, tone: 'bad', word: 'TRAPPED', icon: 'press' },
      ];
    }
  }

  // ---------------- previews ----------------
  preview(id: string | null) {
    const d = this.decision;
    if (!d || this.phase !== 'decide' || d.previewId === id) return;
    d.previewId = id;
    this.world.clearPreview();
    if (!id) return;
    const opt = this.options().find((o) => o.id === id);
    if (!opt) return;
    this.previewOpt = opt;
    const W = this.world;
    const att = d.att, def = d.def;
    const A = this.pos3(att), D = this.pos3(def);
    const pct = (k: string) => opt.odds.find((o) => o.key === k)!;
    const lab = (k: string, pos: THREE.Vector3) => {
      const o = pct(k);
      W.label({ pos, html: `${icon(o.icon, 16)}<b>${o.pct}%</b><small>${o.word}</small>`, cls: `odds ${o.tone}` });
    };
    const towardHoop = new THREE.Vector3(HOOP.x - att.x, 0, HOOP.y - att.y).normalize();
    const side = new THREE.Vector3(-towardHoop.z, 0, towardHoop.x);
    if (opt.tech) W.label({ pos: this.pos3(d.side === 'att' ? att : def, 3.2), html: `${icon('star', 16)}<b>+${opt.tech.bonus}</b>`, cls: 'odds tech' });

    switch (opt.action) {
      case 'shoot': {
        const from = this.hand(att, 2.1);
        const dd = d.ctx.shotDist;
        const curve = new ArcCurve(from, RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), shotApex(dd));
        W.dots(curve, '#ffffff', 0.075, 0.34);
        W.ghostBall(RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), '#3ddc97');
        W.floorRing(w3(HOOP.x, HOOP.y), '#3ddc97', 0.5);
        W.wall(D.clone().addScaledVector(towardHoop, -0.1), towardHoop, '#ff4d6d', 1.0, 0.9, 2.0);
        lab('score', RIM.clone().add(new THREE.Vector3(0, 0.75, 0)));
        lab('miss', RIM.clone().addScaledVector(side, 1.3).add(new THREE.Vector3(0, -0.1, 0)));
        lab('blocked', D.clone().add(new THREE.Vector3(0, 3.1, 0)));
        W.label({ pos: curve.getPoint(0.5).add(new THREE.Vector3(0, 0.35, 0)), html: `<b>+${d.ctx.isTwo ? 2 : 1}</b>`, cls: 'pts' });
        break;
      }
      case 'pass': {
        const to = d.mates[opt.target!];
        const B = this.pos3(to, 1.2);
        const curve = new ArcCurve(this.hand(att), B, 0.35);
        W.dots(curve, '#9be7ff', 0.07, 0.32, 1.3);
        W.ghostBall(B, '#3ddc97');
        W.floorRing(this.pos3(to), '#3ddc97', 0.8);
        W.floorRing(D, '#ff4d6d', 0.7, false);
        const lane = this.laneRisk(att, to, def);
        if (lane.thief) W.floorRing(this.pos3(lane.thief), '#ff4d6d', 0.7);
        lab('complete', this.pos3(to, 2.6));
        lab('deflect', curve.getPoint(0.5).add(new THREE.Vector3(0, 0.7, 0)));
        lab('intercept', D.clone().add(new THREE.Vector3(0, 2.6, 0)));
        break;
      }
      case 'dribble': {
        const route = this.driveRoute(att, def);
        const pts = [0, 0.25, 0.5, 0.75, 1].map((k) => { const p = route(k); return w3(p.x, p.y, 0.08); });
        W.dots(new THREE.CatmullRomCurve3(pts), '#ffd166', 0.09, 0.3, 1.4);
        const end = route(1);
        W.floorRing(w3(end.x, end.y), '#3ddc97', 0.6);
        W.floorRing(D, '#ff4d6d', 0.7, false);
        lab('blowby', w3(end.x, end.y, 0.4));
        lab('standoff', A.clone().add(new THREE.Vector3(0, 2.7, 0)).addScaledVector(side, -0.6));
        lab('stolen', D.clone().add(new THREE.Vector3(0, 2.6, 0)));
        break;
      }
      case 'protect': {
        W.dome(A, '#4cc9f0', 1.05);
        const push = this.pushSpot(def, att, 1.8);
        const pts = [D.clone().setY(0.08), w3(push.x, push.y, 0.08)];
        W.dots(new THREE.CatmullRomCurve3(pts), '#4cc9f0', 0.08, 0.3, 1.2);
        lab('shove', w3(push.x, push.y, 1.4));
        lab('standoff', A.clone().add(new THREE.Vector3(0, 2.9, 0)).addScaledVector(side, -0.7));
        lab('trapped', D.clone().add(new THREE.Vector3(0, 2.6, 0)));
        W.label({ pos: A.clone().add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(side, -1.2), html: `${icon('energy', 16)}<b>+25</b>`, cls: 'odds energy' });
        break;
      }
      default:
        this.previewDefense(opt, A, D, side, lab);
    }
    this.updateCamera();
  }

  private previewDefense(opt: OptionInfo, A: THREE.Vector3, D: THREE.Vector3, side: THREE.Vector3, lab: (k: string, p: THREE.Vector3) => void) {
    const d = this.decision!;
    const W = this.world;
    const att = d.att;
    const ballP = this.hand(att);
    const toAtt = new THREE.Vector3(att.x - d.def.x, 0, att.y - d.def.y).normalize();
    switch (opt.action) {
      case 'steal': {
        const curve = new ArcCurve(this.pos3(d.def, 1.1), ballP, 0.25);
        W.dots(curve, '#ffd166', 0.08, 0.22, 1.6);
        W.ghostBall(ballP, '#3ddc97');
        break;
      }
      case 'block': {
        const toHoop = new THREE.Vector3(HOOP.x - att.x, 0, HOOP.y - att.y).normalize();
        W.wall(A.clone().addScaledVector(toHoop, 0.75), toHoop, '#ff8c42', 1.3, 1.1, 2.0);
        const curve = new ArcCurve(this.hand(att, 2.1), RIM.clone(), shotApex(d.ctx.shotDist));
        W.dots(curve, '#ffffff', 0.05, 0.45, 0.6);
        break;
      }
      case 'press': {
        W.floorRing(A, '#f72585', 1.25);
        W.floorRing(A, '#f72585', 0.85);
        const pts = [D.clone().setY(0.08), A.clone().setY(0.08).addScaledVector(toAtt, -0.4)];
        W.dots(new THREE.CatmullRomCurve3(pts), '#f72585', 0.08, 0.25, 1.4);
        break;
      }
      case 'wait': {
        W.sector(D, Math.atan2(toAtt.x, toAtt.z) - Math.PI / 2, 1.6, 3.2, '#4cc9f0');
        for (const m of d.mates) {
          W.dots(new ArcCurve(this.hand(att), this.pos3(m, 1.2), 0.3), '#4cc9f0', 0.05, 0.4, 0.6);
        }
        W.label({ pos: D.clone().add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(side, 1.0), html: `${icon('energy', 16)}<b>+25</b>`, cls: 'odds energy' });
        break;
      }
    }
    lab('ball', ballP.clone().add(new THREE.Vector3(0, 0.9, 0)).addScaledVector(side, 0.9));
    lab('even', A.clone().lerp(D, 0.5).add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(side, -1.4));
    lab('beaten', D.clone().addScaledVector(toAtt, -1.2).add(new THREE.Vector3(0, 0.5, 0)).addScaledVector(side, 1.2));
    lab('score', A.clone().add(new THREE.Vector3(0, 3.0, 0)).addScaledVector(side, 0.4));
  }

  private driveRoute(att: Ent, def: Ent) {
    const tx = HOOP.x - att.x, ty = HOOP.y - att.y;
    const l = Math.hypot(tx, ty) || 1;
    const fx = tx / l, fy = ty / l;
    // Go around the defender on the side with more room.
    const sx = -fy, sy = fx;
    const sideSign = (def.x - att.x) * sx + (def.y - att.y) * sy > 0 ? -1 : 1;
    const len = Math.min(3.6, Math.max(1.8, l - 1.4));
    const end = { x: clamp(att.x + fx * len, 0.6, COURT_W - 0.6), y: clamp(att.y + fy * len, 0.6, COURT_H - 0.6) };
    const mid = { x: att.x + fx * len * 0.5 + sx * sideSign * 1.3, y: att.y + fy * len * 0.5 + sy * sideSign * 1.3 };
    const sx0 = att.x, sy0 = att.y;
    return (k: number) => {
      const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
      return { x: a * sx0 + b * mid.x + c * end.x, y: a * sy0 + b * mid.y + c * end.y };
    };
  }

  private pushSpot(e: Ent, from: Ent, amount: number) {
    const dx = e.x - from.x, dy = e.y - from.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: clamp(e.x + (dx / l) * amount, 0.4, COURT_W - 0.4), y: clamp(e.y + (dy / l) * amount, 0.4, COURT_H - 0.4) };
  }

  /** Confirm the user's choice. */
  confirm(id: string) {
    const d = this.decision;
    if (!d || this.phase !== 'decide') return;
    const opt = this.options().find((o) => o.id === id);
    if (!opt) return;
    this.world.clearPreview();
    this.hooks.decision(false);
    let res: DuelResult;
    if (d.side === 'att') {
      const mine: Choice<AttackAction> = { action: opt.action as AttackAction, tech: opt.tech, target: opt.target };
      res = resolveDuel(d.ctx, mine, sample(d.defDist));
    } else {
      const ai = sample(d.attDist);
      if (ai.action === 'pass') {
        const best = [...d.mates].sort((a, b) => this.openness(b) - this.openness(a))[0];
        ai.target = d.mates.indexOf(best);
      }
      res = resolveDuel(d.ctx, ai, { action: opt.action as DefendAction, tech: opt.tech });
    }
    this.memory.push(d.side, d.side === 'att' ? res.att.action : res.def.action);
    this.bump(`${d.side}:${res.outcome}`);
    this.applyDuel(d, res);
  }

  private applyDuel(d: Decision, res: DuelResult) {
    const { att, def } = d;
    att.energy -= res.att.tech?.cost ?? 0;
    def.energy -= res.def.tech?.cost ?? 0;
    att.energy += 10 + (res.att.action === 'protect' ? 15 : 0);
    def.energy += 10 + (res.def.action === 'wait' ? 15 : 0);
    att.energy = clamp(att.energy, 0, 100);
    def.energy = clamp(def.energy, 0, 100);
    this.lines[att.pl.uid].duels++;
    this.lines[def.pl.uid].duels++;
    if (res.winner === 'att') this.lines[att.pl.uid].duelsWon++;
    if (res.winner === 'def') this.lines[def.pl.uid].duelsWon++;
    if (!this.golden) this.clock = Math.max(0, this.clock - 2);
    this.phase = 'resolve';
    this.phaseT = 99;
    this.duelCd = 2.0;
    const userGood = (res.winner === 'att') === (d.side === 'att');
    const tone = res.winner === 'tie' ? 'mid' : userGood ? 'good' : 'bad';
    // Reveal both moves above the players' heads.
    this.world.callout(this.pos3(att, 2.7), icon(res.att.action, 30) + (res.att.tech ? icon('star', 16) : ''), 'move');
    this.world.callout(this.pos3(def, 2.7), icon(res.def.action, 30) + (res.def.tech ? icon('star', 16) : ''), 'move');
    const back = (t = 0.5) => this.later(t, () => { if (this.phase === 'resolve') { this.phase = 'play'; this.decision = null; } });
    const done = () => { this.decision = null; };

    switch (res.outcome) {
      case 'score':
      case 'miss': {
        if (res.def.action === 'block') this.later(0.15, () => { this.jump(def, 0.5, 0.6); def.armsT = 0.6; });
        this.shoot(att, res.outcome === 'score', done);
        break;
      }
      case 'blocked': {
        this.jump(att, 0.4, 0.6);
        att.armsT = 0.4;
        this.later(0.1, () => { this.jump(def, 0.6, 0.6); def.armsT = 0.7; this.faceTo(def, att.x, att.y); });
        this.looseBall = this.hand(att, 2.0);
        this.holder = null;
        this.later(0.3, () => {
          sfx.clash();
          this.world.shake = 0.3;
          this.world.callout(this.pos3(def, 3.0), icon('block', 30), tone);
          const away = this.pushSpot(att, def, 2.5);
          this.fly(this.hand(att, 2.3), w3(away.x, away.y, 0.9), 0.8, 0.5, () => {
            this.decision = null;
            this.turnover(def);
          });
        });
        break;
      }
      case 'complete':
      case 'deflect':
      case 'intercept': {
        const to = res.att.target !== undefined ? d.mates[res.att.target] : d.mates[0];
        this.faceTo(att, to.x, to.y);
        sfx.pass();
        if (res.outcome === 'complete') {
          def.daze = 1.0;
          to.boost = 1.5;
          this.fly(this.hand(att), this.pos3(to, 1.2), 0.35, 0.15 + dist(att.x, att.y, to.x, to.y) / 14, () => {
            this.holder = to;
            this.world.callout(this.pos3(to, 2.6), icon('check', 26), tone);
            this.retargetDefense();
            this.decision = null;
            this.phase = 'play';
          });
        } else if (res.outcome === 'deflect') {
          const mid = this.pos3(att, 1.4).lerp(this.pos3(to, 1.4), 0.25);
          def.armsT = 0.4;
          this.fly(this.hand(att), mid, 0.2, 0.22, () => {
            sfx.clash();
            this.world.callout(mid.clone().add(new THREE.Vector3(0, 0.8, 0)), icon('even', 26), tone);
            this.fly(mid, this.hand(att), 0.3, 0.3, () => {
              this.holder = att;
              this.shotClock = Math.max(1, this.shotClock - 3);
              this.separate(att, def, 1.2);
              this.decision = null;
              this.phase = 'play';
            });
          });
        } else {
          const lp = { x: att.x + (to.x - att.x) * 0.35, y: att.y + (to.y - att.y) * 0.35 };
          const sx = def.x, sy = def.y;
          def.anim = { t: 0, dur: 0.3, path: (k) => ({ x: sx + (lp.x - sx) * ease(k), y: sy + (lp.y - sy) * ease(k) }) };
          this.jump(def, 0.35, 0.4);
          def.armsT = 0.4;
          this.fly(this.hand(att), w3(lp.x, lp.y, 1.5), 0.2, 0.32, () => {
            sfx.steal();
            this.world.callout(w3(lp.x, lp.y, 2.7), icon('steal', 28), tone);
            this.decision = null;
            this.turnover(def);
          });
        }
        break;
      }
      case 'blowby': {
        const route = this.driveRoute(att, def);
        att.anim = { t: 0, dur: 0.6, path: (k) => route(ease(k)) };
        def.daze = 2.5;
        att.boost = 2.0;
        sfx.whistle();
        this.later(0.2, () => this.world.callout(this.pos3(att, 2.7), icon('dribble', 28), tone));
        if (d.side === 'att') {
          // Chain straight into a follow-up decision with the defender beaten: the payoff of a good drive.
          this.later(0.7, () => {
            if (this.phase !== 'resolve' || this.holder !== att) return;
            this.decision = null;
            this.openDecision('att', att, def, 2);
          });
        } else back(0.7);
        break;
      }
      case 'standoff': {
        sfx.clash();
        this.separate(att, def, 1.4);
        this.shotClock = Math.max(1, this.shotClock - 2);
        this.world.callout(this.pos3(att, 2.4).lerp(this.pos3(def, 2.4), 0.5), icon('even', 28), 'mid');
        back(0.6);
        break;
      }
      case 'shove': {
        const p = this.pushSpot(def, att, 1.8);
        const sx = def.x, sy = def.y;
        def.anim = { t: 0, dur: 0.35, path: (k) => ({ x: sx + (p.x - sx) * ease(k), y: sy + (p.y - sy) * ease(k) }) };
        def.daze = 1.2;
        sfx.clash();
        this.world.callout(this.pos3(att, 2.7), icon('protect', 28), tone);
        back(0.6);
        break;
      }
      case 'stolen':
      case 'trapped': {
        const sx = def.x, sy = def.y;
        const p = { x: def.x + (att.x - def.x) * 0.35, y: def.y + (att.y - def.y) * 0.35 };
        def.anim = { t: 0, dur: 0.2, path: (k) => ({ x: sx + (p.x - sx) * k, y: sy + (p.y - sy) * k }) };
        def.armsT = 0.3;
        this.later(0.18, () => {
          sfx.steal();
          this.world.shake = 0.2;
          this.fly(this.hand(att), this.pos3(def, 1.2), 0.15, 0.22, () => {
            this.world.callout(this.pos3(def, 2.7), icon(res.outcome === 'stolen' ? 'steal' : 'press', 28), tone);
            this.decision = null;
            this.turnover(def);
          });
        });
        break;
      }
    }
  }

  private separate(a: Ent, b: Ent, amount: number) {
    for (const [e, from] of [[a, b], [b, a]] as [Ent, Ent][]) {
      const p = this.pushSpot(e, from, amount / 2);
      const sx = e.x, sy = e.y;
      e.anim = { t: 0, dur: 0.3, path: (k) => ({ x: sx + (p.x - sx) * ease(k), y: sy + (p.y - sy) * ease(k) }) };
    }
  }

  // ---------------- simulation ----------------
  private speed(e: Ent) {
    let v = 2.5 + e.pl.stats.spd * 0.22;
    if (e === this.holder) v *= 0.9;
    if (e.boost > 0) v *= 1.4;
    if (e.daze > 0) v *= 0.3;
    return v;
  }

  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused) this.update(dt);
    this.sync(this.paused ? 0 : dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Advance the simulation (exposed for tests). */
  update(dt: number) {
    this.time += dt;
    this.idleT += dt;
    if (this.phase !== 'decide') {
      const due = this.timers.filter((t) => (t.t -= dt) <= 0);
      this.timers = this.timers.filter((t) => t.t > 0);
      for (const t of due) t.fn();
    }
    for (const e of this.ents) {
      if (e.jumpT > 0) e.jumpT = Math.max(0, e.jumpT - dt);
      if (e.armsT > 0) e.armsT = Math.max(0, e.armsT - dt);
      e.arms += ((e.armsT > 0 ? 1 : 0) - e.arms) * Math.min(1, dt * 14);
      if (e.anim) {
        e.anim.t += dt;
        const k = Math.min(1, e.anim.t / e.anim.dur);
        const p = e.anim.path(k);
        if (Math.hypot(p.x - e.x, p.y - e.y) > 0.01) e.face = Math.atan2(p.x - e.x, p.y - e.y);
        e.x = p.x; e.y = p.y; e.tx = p.x; e.ty = p.y;
        if (k >= 1) e.anim = null;
      }
    }
    if (this.flight && this.phase !== 'decide') {
      const f = this.flight;
      f.t += dt;
      if (f.t >= f.dur) { this.flight = null; this.looseBall = f.curve.b.clone(); f.onLand(); }
    }

    switch (this.phase) {
      case 'check':
        this.phaseT -= dt;
        for (const e of this.ents) this.moveEnt(e, dt, 2.2);
        if (this.phaseT <= 0) this.phase = 'play';
        break;
      case 'pause':
        this.phaseT -= dt;
        for (const e of this.ents) this.moveEnt(e, dt, 0.5);
        if (this.phaseT <= 0 && this.after) { const fn = this.after; this.after = null; fn(); }
        break;
      case 'resolve':
        for (const e of this.ents) if (!e.anim) this.moveEnt(e, dt, 0.35);
        break;
      case 'play':
        this.tickPlay(dt);
        break;
      default:
        break;
    }
    this.pushHud();
  }

  private tickPlay(dt: number) {
    for (const e of this.ents) {
      e.daze = Math.max(0, e.daze - dt);
      e.boost = Math.max(0, e.boost - dt);
    }
    this.duelCd = Math.max(0, this.duelCd - dt);
    if (!this.golden) this.clock = Math.max(0, this.clock - dt);
    if (this.holder) this.shotClock -= dt;

    if (this.shotClock <= 0 && this.holder) {
      const h = this.holder;
      const thief = this.nearestFoe(h);
      sfx.buzzer();
      this.bump(`shotclock${h.team}`);
      this.world.callout(this.pos3(h, 2.7), icon('cross', 28), 'bad');
      this.turnover(thief);
      return;
    }
    if (this.clock <= 0 && !this.golden && !this.flight) {
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
    if (this.phase !== 'play') return;
    this.thinkDefense();
    this.userMove();
    for (const e of this.ents) if (!e.anim) this.moveEnt(e, dt, 1);
    this.separateAll();

    // Contact = decision.
    if (this.holder && this.duelCd <= 0 && !this.flight) {
      const h = this.holder;
      const d = this.ents.find((o) => o.team !== h.team && o.daze <= 0 && dist(o.x, o.y, h.x, h.y) < DUEL_RANGE);
      if (d) this.openDecision(h.team === 0 ? 'att' : 'def', h, d, 0);
    }
  }

  private userMove() {
    const c = this.controlled;
    if (!c || c.team !== 0 || c.anim) return;
    let kx = 0, ky = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) ky -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
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
    } else if (c === this.holder) {
      c.tx = c.x; c.ty = c.y;
    }
  }

  private thinkOffense(dt: number) {
    const off = this.ents.filter((e) => e.team === this.offense);
    for (const e of off) {
      if (e === this.holder || e.anim) continue;
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
    if (this.offense === 1 && this.holder && this.holder.team === 1 && !this.flight) this.aiHandler(dt, this.holder);
  }

  private aiHandler(dt: number, h: Ent) {
    if (h.anim) return;
    this.aiT -= dt;
    const nearest = this.nearestFoe(h);
    const nd = dist(nearest.x, nearest.y, h.x, h.y);
    if (this.aiT <= 0) {
      this.aiT = 0.3 + Math.random() * 0.25;
      const p = this.shotChance(h);
      const threshold = 0.38 - this.tier * 0.015;
      if ((p >= threshold && Math.random() < 0.7) || (this.shotClock < 2 && p > 0.15) || this.shotClock < 0.8) {
        if (nd <= CLOSEOUT_RANGE && this.duelCd <= 0 && nearest.daze <= 0) {
          // A defender can contest: the user decides how to close out.
          this.openDecision('def', h, nearest, 1, true);
        } else {
          this.bump('aiOpenShot');
          this.shoot(h, Math.random() < p);
          this.phase = 'pause';
          this.phaseT = 99;
        }
        return;
      }
      if (nd < 3 && Math.random() < 0.35 + this.tier * 0.03) {
        const mates = this.ents.filter((e) => e.team === h.team && e !== h)
          .map((m) => ({ m, s: this.openness(m) - this.laneRisk(h, m).risk * 4 }))
          .sort((a, b) => b.s - a.s);
        if (mates[0] && mates[0].s > 0.5) { this.bump('aiPass'); this.passTo(h, mates[0].m); return; }
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
    for (const d of def) {
      if (d.anim) continue;
      if (d === this.controlled && (this.moveTarget || this.idleT < 1.2)) continue;
      const man = off.find((o) => o.slot === d.slot) ?? off[0];
      if (d.team === 1 && man === this.holder) {
        const p = this.markSpot(man.x, man.y, 0.35);
        d.tx = p.x; d.ty = p.y;
      } else {
        const sag = man === this.holder ? 1.3 : 1.8;
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
    if (d > 0.08) e.face = Math.atan2(dx, dy);
  }

  private separateAll() {
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

  // ---------------- rendering sync ----------------
  private updateCamera(snap = false) {
    const W = this.world;
    const d = this.decision;
    if (d && (this.phase === 'decide' || this.phase === 'resolve')) {
      const me = d.side === 'att' ? d.att : d.def;
      const A = this.pos3(d.att, 1.0), D = this.pos3(d.def, 1.0);
      const pts = [A, D, RIM.clone()];
      const opt = d.previewId ? this.previewOpt : undefined;
      if (opt?.action === 'pass' && opt.target !== undefined) pts.push(this.pos3(d.mates[opt.target], 1.0));
      let dir: THREE.Vector3;
      if (d.side === 'att') {
        dir = new THREE.Vector3(HOOP.x - me.x, 0, HOOP.y - me.y);
        if (dir.lengthSq() < 1) dir.set(0, 0, -1);
        dir.normalize();
        W.frame(pts, dir, 22, 2.4, { side: 0.9, speed: 2.6, zoom: 0.92, lookBias: new THREE.Vector3(0, -0.7, 0) });
      } else {
        // Over the defender's shoulder, looking at the ball handler.
        dir = new THREE.Vector3(d.att.x - d.def.x, 0, d.att.y - d.def.y);
        if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
        dir.normalize();
        const dpts = [A, D];
        W.frame(dpts, dir, 27, 2.8, { side: W.camera.aspect < 0.8 ? 2.4 : 1.7, speed: 2.6, zoom: 1.2, lookBias: new THREE.Vector3(0, -0.5, 0) });
      }
    } else {
      const ball = this.ballPos.clone().setY(0);
      const ctrl = this.controlled ? this.pos3(this.controlled) : ball;
      const pts = [ball, ctrl, RIM.clone()];
      const dir = new THREE.Vector3(ball.x * 0.06, 0, -1).normalize();
      const portrait = W.camera.aspect < 0.8;
      W.frame(pts, dir, portrait ? 50 : 46, portrait ? 4.0 : 5.4, { speed: 2.2, zoom: portrait ? 0.92 : 1, lookBias: new THREE.Vector3(0, -0.6, portrait ? -1.3 : 0.4) });
    }
    if (snap) W.snapCamera();
  }

  private sync(dt: number) {
    const W = this.world;
    // Ball position.
    if (this.flight) {
      const f = this.flight;
      f.curve.getPoint(Math.min(1, f.t / f.dur), this.ballPos);
    } else if (this.holder) {
      const h = this.holder;
      const moving = Math.hypot(h.x - h.px, h.y - h.py) > 0.002;
      if (this.phase === 'decide' || h.jumpT > 0) this.ballPos.copy(this.hand(h, h.jumpT > 0 ? 2.0 : 1.2));
      else {
        const bounce = Math.abs(Math.sin(this.time * (moving ? 8 : 5)));
        const p = this.hand(h, 0.22 + bounce * 0.85);
        if (bounce < 0.08 && dt > 0 && Math.random() < 0.15) sfx.bounce();
        this.ballPos.copy(p);
      }
    } else if (this.looseBall) {
      this.ballPos.copy(this.looseBall);
    }
    W.setBall(this.ballPos, this.flight ? 0.25 : 0.05);

    for (const e of this.ents) {
      const moving = Math.hypot(e.x - e.px, e.y - e.py) > 0.004;
      e.px = e.x; e.py = e.y;
      if (this.phase === 'decide' && this.decision) {
        const d = this.decision;
        if (e === d.att) this.faceTo(e, HOOP.x, HOOP.y);
        if (e === d.def) this.faceTo(e, d.att.x, d.att.y);
      }
      W.setPlayer(e.i, { x: e.x, y: e.y, face: e.face, jump: this.jumpOf(e), armsUp: e.arms, daze: e.daze > 0, moving }, dt);
      const isCtrl = e === this.controlled;
      W.players[e.i].setRing(this.teams[e.team].color, isCtrl ? 1 : 0.55);
    }
    const h = this.holder;
    W.setHandler(h ? this.pos3(h) : null);
    const c = this.controlled;
    W.setControlled(c && c !== h && this.phase !== 'decide' ? this.pos3(c) : null);
    W.setMoveTarget(this.moveTarget && this.phase === 'play' ? w3(this.moveTarget.x, this.moveTarget.y) : null);
    this.updateCamera();
    W.render(dt);
    this.pushMode();
  }

  private pushHud() {
    const h: HudInfo = { score: this.score, clock: this.clock, shotClock: Math.max(0, this.shotClock), golden: this.golden, offense: this.offense };
    const key = `${h.score.join('-')}|${Math.ceil(h.clock)}|${Math.ceil(h.shotClock)}|${h.golden}|${h.offense}`;
    if (key !== this.hudKey) { this.hudKey = key; this.hooks.hud(h); }
  }

  private pushMode() {
    let m: 'attack' | 'defend' | 'idle' = 'idle';
    if (this.phase === 'play' || this.phase === 'check') m = this.offense === 0 ? 'attack' : 'defend';
    const can = this.canAct();
    const key = `${m}|${can}`;
    if (key !== this.modeKey) { this.modeKey = key; this.hooks.mode(m, can); }
  }
}
