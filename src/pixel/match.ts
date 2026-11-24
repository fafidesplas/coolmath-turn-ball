// Turn Ball Pixel: turn-based 3x3 match drawn with pixel-art sprites. Loop: decide -> watch the play -> decide again.
// Presentation fork of src/match.ts: the flow, options, odds and resolution are the same calls into rules.ts
// (the single source of truth, shared with the simulator); only the drawing and the sprite animations differ.
// All rules and odds come from rules.ts (shared with the headless simulator); this file only decides
// what to show: positions, previews, animations and the one-line causal explanation.
// Every action is done with a technique (jump shot, bank shot, bounce pass, crossover, pick and
// roll...) and every stance with a defensive technique; each one has its own preview and animation.
import { CatmullRomCurve3, Vector3, type Curve } from 'three';
import { sfx } from '../audio';
import type { Player, Stats } from '../data';
import { icon } from './pxicons';
import {
  actKey, actOdds, aiAttackDist, branches, clamp, defMovesFor, explain, famOf, gngPartner, Habits, helperFor, legalActs, MATCH_RULES,
  OpponentModel, pickBranch, Planner, planOf, readDefense, rng, sampleStance, sampleWeighted, screenerFor, setupPoss, SETUPS, shotChance,
  STANCES, toPercents, TUNE, ZONES, isoZones, PIXEL_MOVES, PIXEL_DEF,
  type Act, type ActKind, type Branch, type DefPlan, type Ev, type Matchup, type Poss, type Stance, type Weighted, type Zone,
} from '../rules';
import { TECHS, isDefTech, type TechId } from '../techs';
import { FIRE, SPECIALS, fireDelta, specialFor, type SpecialDef, type SpecialId } from '../specials';
import { ArcCurve, COURT_H, COURT_W, HOOP, RIM, RIM_H, w3 } from './court';
import { hairStyleFor, releaseIndex, tagLen, type Kit } from './sprites';
import { PixelWorld, type PixelLook, type ScenePt } from './world';

export { COURT_W, COURT_H, HOOP };

export interface TeamSetup {
  name: string;
  short: string;
  color: string;
  accent: string;
  shorts: string;
  /** Pixel kit (light home kit with stripes, dark away kit with headbands). */
  kit: Kit;
  marker: 'home' | 'away';
  players: Player[];
}

/** A one-shot sprite animation playing on a player. */
interface Act1 { tag: string; t: number; ms?: number; dur: number }

interface EntAnim { t: number; dur: number; path: (k: number) => { x: number; y: number } }

interface Ent {
  i: number;
  pl: Player;
  team: 0 | 1;
  slot: number;
  x: number; y: number;
  px: number; py: number;
  face: number;
  daze: number;
  jumpT: number; jumpDur: number; jumpH: number;
  armsT: number; arms: number;
  anim: EntAnim | null;
  act: Act1 | null;
  /** Moving at sprint speed (drives). */
  fast: boolean;
  /** Signature special. */
  sp: SpecialDef;
}

interface Flight { curve: ArcCurve; t: number; dur: number; onLand: () => void }

export interface HudInfo {
  score: [number, number];
  poss: [number, number];
  maxPoss: number;
  offense: 0 | 1;
  left: number;
  maxLeft: number;
  golden: boolean;
  /** Fire meter per team. */
  heat: [number, number];
  heatMax: number;
}
export interface PlayerLine { pts: number; duels: number; duelsWon: number; steals: number }
export interface MatchResult { score: [number, number]; won: boolean; lines: Record<string, PlayerLine>; quit?: boolean; tutorial?: boolean }

export type Tone = 'good' | 'mid' | 'bad';
export interface OddsItem { key: string; pct: number; tone: Tone; word: string; icon: string }
export interface Card { gain: string; risk: string; change: string }
export interface OptionInfo {
  id: string;
  kind: ActKind | Stance;
  /** Technique used (attack technique or defensive technique). */
  tech: TechId;
  act?: Act;
  /** Defensive technique (defense options). */
  dm?: TechId;
  label: string;
  /** Short destination / target tag for sub-options. */
  tag?: string;
  targetNum?: number;
  odds: OddsItem[];
  main: number;
  card: Card;
  disabled?: boolean;
  hint?: boolean;
  /** Signature special (needs a full Fire meter). */
  sp?: SpecialId;
  /** Grouping in the menu: the technique, or the special. */
  group?: string;
  /** Plain-language summary: what the option does. */
  what?: string;
  /** Reward and risk, 1 (low) to 3 (high), shown as icon pips. */
  reward?: number;
  risk?: number;
  /** Why the option is not available right now (shown greyed out, e.g. a dunk out of range). */
  locked?: string;
  /** Defense: how this move does against the attack's most likely action. */
  vsTop?: string;
  /** Against the opponent's tell: 1 this move beats it, -1 it loses to it, 0 neither. */
  edge?: -1 | 0 | 1;
  /** Short label for a target (receiver, destination) in the target list. */
  short?: string;
}

export interface DecisionInfo {
  side: 'att' | 'def';
  left: number;
  maxLeft: number;
  /** Attack: what the defense tends to do here (exact mix the AI samples from) and the technique per family. */
  lean?: DefPlan;
  /** Defense: what the AI attacker tends to do here, by action kind (exact mix it samples from). */
  attLean?: Record<ActKind, number>;
  /** Tutorial: the stance is shown in advance. */
  shown?: Stance;
  hint?: string;
  /** Your Fire meter is full: specials are on the menu. */
  fire: boolean;
  /** Defense: specials the attack can throw at you now (with the stance that counters each). */
  threats?: { num: number; name: string; counter: Stance; pct: number }[];
  /** One plain sentence: who has the ball, where, and what is going on. */
  situation: string;
  /** Defense: the attack's most likely actions in words. */
  threat?: string;
  /** Coach: first attack / first defense possession of the player's first real matches. */
  coach?: boolean;
  /** The opponent's tell: on attack the defense's most likely move, on defense the attack's most likely kind. */
  tell?: { icon: string; name: string };
}

/** What one duel came to, for the result card. */
export interface DuelInfo {
  you: { name: string; icon: string };
  them: { name: string; icon: string };
  /** From the human's side. */
  res: 'win' | 'lose' | 'even';
  head: string;
  why: string;
  /** Big result word ("SCORE!", "BLOCKED!", "STEAL!") and the points scored, if any. */
  word: string;
  pts: number;
  icon: string;
}

export interface MatchHooks {
  hud(h: HudInfo): void;
  decision(open: boolean): void;
  banner(text: string, color: string, sub?: string): void;
  explain(text: string, tone: Tone): void;
  end(r: MatchResult): void;
  /** Cut-in card for a signature special (pixel portrait, name). */
  special?(sp: SpecialDef, pl: Player, team: 0 | 1): void;
  /** Result card after each duel ("Your Block beats their Dunk"). */
  duel?(d: DuelInfo): void;
  /** The coach finished its attack or defense walkthrough (saved so it shows only once). */
  coached?(side: 'att' | 'def'): void;
}

/** One guided step of the tutorial (a decision inside a scripted possession). */
export interface GuideStep {
  allow: ActKind[];
  /** Restrict to these techniques. */
  techs?: TechId[];
  /** Restrict drives to these destinations. */
  zones?: Zone[];
  /** Restrict passes to the teammate freed by help. */
  toFreed?: boolean;
  /** The lesson's outcome (the roll lands on it). */
  outcome: Ev;
  hint: string;
}
export interface TutorialPoss { setup: Zone[]; handler: number; stance?: Stance; title: string; steps: GuideStep[] }

export interface MatchOptions {
  tier: number;
  tutorial?: TutorialPoss[];
  /** Override the equipped techniques per team (tutorial). */
  kits?: [TechId[][], TechId[][]];
  seed?: number;
  /** Show the short first-time hints. */
  hints?: boolean;
  /** Reduced motion: no slow motion, zoom, shake or flashes. */
  reduceFx?: boolean;
  /** Step-by-step coach on the first attack and the first defense possession. */
  coach?: { att: boolean; def: boolean };
}

type Phase = 'intro' | 'decide' | 'resolve' | 'over';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const ease = (k: number) => k * k * (3 - 2 * k);
const shotApex = (d: number) => 0.7 + d * 0.09;
const pct = (p: number) => Math.round(p * 100);
const ONE = (st: Stance) => ({ press: 0, space: 0, deny: 0, [st]: 1 });

export const STANCE_LABEL: Record<Stance, string> = { press: 'Press', space: 'Give space', deny: 'Deny pass' };
export const KIND_LABEL: Record<ActKind, string> = { shoot: 'Shoot', pass: 'Pass', drive: 'Dribble', cut: 'Play' };
export const KIND_ICON: Record<ActKind, string> = { shoot: 'shoot', pass: 'pass', drive: 'dribble', cut: 'cut' };
/** The big word shown when a duel resolves, and its icon. */
const RESULT_WORD: Record<Ev, { w: string; i: string }> = {
  make: { w: 'SCORE!', i: 'hoop' }, and1: { w: 'AND ONE!', i: 'hoop' }, miss: { w: 'MISS', i: 'cross' }, oreb: { w: 'REBOUND!', i: 'ball' },
  block: { w: 'BLOCKED!', i: 'block' }, catch: { w: 'CAUGHT', i: 'check' }, feed: { w: 'OPEN!', i: 'up' }, pick: { w: 'PICKED!', i: 'steal' },
  beat: { w: 'PAST HIM!', i: 'dribble' }, room: { w: 'SPACE!', i: 'up' }, held: { w: 'HELD', i: 'even' }, stopped: { w: 'STOPPED', i: 'even' },
  help: { w: 'MAN FREE!', i: 'pass' }, steal: { w: 'STEAL!', i: 'steal' }, open: { w: 'OPEN!', i: 'check' }, slip: { w: 'SLIP!', i: 'pass' },
  covered: { w: 'COVERED', i: 'even' }, charge: { w: 'CHARGE!', i: 't_charge' },
};

/** Plain-language defense guide: what each defensive move stops and what beats it (pixel edition set). */
export const DEF_GUIDE: Partial<Record<TechId, { does: string; stops: string; weak: string }>> = {
  press: { does: 'Stay tight on the ball.', stops: 'Shots, slow dribbles', weak: 'Crossover, quick drives' },
  hawk: { does: 'Reach in to rip the ball.', stops: 'Loose dribbles and passes', weak: 'Between the legs, spin, behind the back' },
  contest: { does: 'Hand up in the shooter\'s face.', stops: 'Jump shots and threes', weak: 'Drives, pump fake' },
  space: { does: 'Back off a step, stay in front.', stops: 'Drives', weak: 'Open jump shots, hesitation' },
  rim: { does: 'Wait at the rim to swat it.', stops: 'Dunks and layups', weak: 'Floater, threes, pump fake' },
  charge: { does: 'Plant in the lane, take the hit.', stops: 'Drives and dunks into you (foul on them)', weak: 'Jump shots, euro step' },
  deny: { does: 'Close the passing lanes.', stops: 'Passes and cuts', weak: 'Drives, behind the back' },
};
/** Defensive move names in this edition (the ball hawk is simply "Steal"). */
export const defName = (dm: TechId) => (dm === 'hawk' ? 'Steal' : TECHS[dm].name);
/** Order of the defensive moves in the menu. */
export const DEF_ORDER: TechId[] = ['press', 'hawk', 'contest', 'space', 'rim', 'charge', 'deny'];

/** Display name of a technique in context (a jump shot from the arc is a Three). */
export function moveName(t: TechId, zoneKind?: string, sp?: SpecialId): string {
  if (sp) return SPECIALS[sp].name;
  if (t === 'jumper' && zoneKind === 'three') return 'Three';
  if (t === 'dunk' && zoneKind === 'mid') return 'Running dunk';
  return TECHS[t].name;
}
export const moveIcon = (t: TechId, zoneKind?: string) => (t === 'jumper' && zoneKind === 'three' ? 't_three' : TECHS[t].icon);
/** 1-3 pips from a percentage. */
const lvl = (p: number, a: number, b: number) => (p < a ? 1 : p < b ? 2 : 3);
const FAM_COLOR: Record<Stance, string> = { press: '#f72585', space: '#4cc9f0', deny: '#ffd166' };
/** Point on the backboard used by bank shots (left or right of the square). */
const boardPoint = (fromX: number) => w3(HOOP.x + (fromX < HOOP.x ? -0.32 : 0.32), 1.27, RIM_H + 0.42);

export class Match {
  ents: Ent[] = [];
  phase: Phase = 'intro';
  offense: 0 | 1 = 0;
  poss: Poss | null = null;
  score: [number, number] = [0, 0];
  possN: [number, number] = [0, 0];
  golden = false;
  holder: Ent | null = null;
  /** Player still holding the ball in the sprite during a shot or pass wind-up (before the release). */
  private shooter: Ent | null = null;
  flight: Flight | null = null;
  paused = false;
  /** Animation speed multiplier (1 in play; automated tests raise it). */
  timeScale = 1;
  decisions = 0;
  lines: Record<string, PlayerLine> = {};
  world: PixelWorld;
  /** Event counters (debug / smoke tests). */
  stats: Record<string, number> = {};
  /** Last resolved decision (smoke tests). */
  lastRes: { act: Act; dm: TechId; ev: Ev; text: string } | null = null;
  lastDuel: DuelInfo | null = null;

  private rand: () => number;
  private m: [Matchup, Matchup];
  private planners: [Planner, Planner];
  private model: OpponentModel;
  private habits = new Habits();
  private smart: number;
  private temp: number;
  private timers: { t: number; fn: () => void }[] = [];
  private raf = 0;
  private last = 0;
  private destroyed = false;
  private ballPos = new Vector3();
  private looseBall: Vector3 | null = null;
  private plan: DefPlan | null = null;
  private attDist: Weighted<Act>[] | null = null;
  private opts: OptionInfo[] = [];
  private previewId: string | null = null;
  private freed: number | null = null;
  private tutIdx = -1;
  private stepIdx = 0;
  private hudKey = '';
  private shownStance: Stance | null = null;
  /** Fire meter per team, and whether this possession's special was already spent. */
  heat: [number, number] = [0, 0];
  private spent = false;
  /** Seconds of slow motion left (real time). */
  private slow = 0;
  /** Special being played (cinematic in progress). */
  private cine: SpecialDef | null = null;
  /** A dunk cinematic (zoom, letterbox) is running. */
  private fxOn = false;

  constructor(stage: HTMLElement, public teams: [TeamSetup, TeamSetup], private o: MatchOptions, private hooks: MatchHooks) {
    this.rand = rng(o.seed ?? (Date.now() & 0x7fffffff));
    const looks: PixelLook[] = [];
    teams.forEach((t, ti) => t.players.slice(0, 3).forEach((pl, slot) => {
      this.ents.push({
        i: this.ents.length, pl, team: ti as 0 | 1, slot, x: 7.5, y: 8, px: 7.5, py: 8, face: Math.PI,
        daze: 0, jumpT: 0, jumpDur: 0, jumpH: 0, armsT: 0, arms: 0, anim: null, act: null, fast: false, sp: SPECIALS[specialFor(pl.tid, slot)],
      });
      looks.push({ skin: pl.skin, hair: pl.hair, hairStyle: hairStyleFor(pl.tid), kit: t.kit, marker: t.marker, num: pl.num });
      this.lines[pl.uid] = { pts: 0, duels: 0, duelsWon: 0, steals: 0 };
    }));
    const st = (ti: number): Stats[] => teams[ti].players.slice(0, 3).map((p) => p.stats);
    // Everyone has the full move set (shots, dribble moves, defense), each tied to a pack animation;
    // learned techniques add passes and plays.
    const kit = (ti: number): TechId[][] => (o.kits?.[ti] ?? teams[ti].players.slice(0, 3).map((p) => [...(p.gear ?? [])]))
      .map((g) => [...new Set([...PIXEL_MOVES, ...g.filter((t) => !isDefTech(t))])]);
    const defKit = (_ti: number) => [...PIXEL_DEF];
    const sps = (ti: number) => teams[ti].players.slice(0, 3).map((p, slot) => specialFor(p.tid, slot));
    this.m = [
      { att: st(0), def: st(1), kit: kit(0), defKit: defKit(1), sp: sps(0) },
      { att: st(1), def: st(0), kit: kit(1), defKit: defKit(0), sp: sps(1) },
    ];
    this.planners = [new Planner(this.m[0], (s) => readDefense(this.m[0], s)), new Planner(this.m[1], (s) => readDefense(this.m[1], s))];
    this.model = new OpponentModel(this.planners[0]);
    this.smart = o.tutorial ? 0 : clamp(0.2 + o.tier * 0.08, 0, 0.6);
    this.temp = clamp(0.12 - o.tier * 0.015, 0.04, 0.12);
    this.world = new PixelWorld(stage, looks);
    this.world.reduce = !!o.reduceFx;
    this.world.canvas.addEventListener('pointerdown', this.onCanvasDown);
    this.offense = o.tutorial ? 0 : (this.rand() < 0.5 ? 0 : 1);
    this.startPossession(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.world.destroy();
  }

  /** Switch reduced motion during a match (pause menu). */
  setReduceFx(on: boolean) { this.o.reduceFx = on; this.world.reduce = on; if (on) { this.slow = 0; this.world.endCinematic(); } }

  quit(): MatchResult {
    return { score: [...this.score] as [number, number], won: false, lines: this.lines, quit: true, tutorial: !!this.o.tutorial };
  }

  private later(t: number, fn: () => void) { this.timers.push({ t, fn }); }
  private bump(k: string) { this.stats[k] = (this.stats[k] ?? 0) + 1; }

  // ---------------------------------------------------------------- helpers
  private att(i: number) { return this.ents[this.offense * 3 + i]; }
  private def(i: number) { return this.ents[(1 - this.offense) * 3 + i]; }
  private get mu(): Matchup { return this.m[this.offense]; }
  private get userAttacks() { return this.offense === 0; }
  private pos3(e: Ent, h = 0) { return w3(e.x, e.y, h + this.jumpOf(e)); }
  private jumpOf(e: Ent) { return e.jumpT > 0 ? Math.sin(Math.PI * (1 - e.jumpT / e.jumpDur)) * e.jumpH : 0; }
  private hand(e: Ent, h = 1.15) {
    const p = this.pos3(e, h);
    p.x += Math.sin(e.face) * 0.32 + Math.cos(e.face) * 0.2;
    p.z += Math.cos(e.face) * 0.32 - Math.sin(e.face) * 0.2;
    return p;
  }
  private jump(e: Ent, h: number, dur: number) { e.jumpH = h; e.jumpDur = dur; e.jumpT = dur; }
  /** Start a one-shot sprite animation (`ms` per frame). */
  private play(e: Ent, tag: string, ms = 80) { e.act = { tag, t: 0, ms, dur: (tagLen(tag) * ms) / 1000 }; }
  private faceTo(e: Ent, x: number, y: number) { e.face = Math.atan2(x - e.x, y - e.y); }
  private glide(e: Ent, x: number, y: number, dur: number, curve?: { x: number; y: number }) {
    const sx = e.x, sy = e.y;
    if (dist(sx, sy, x, y) < 0.03) { e.anim = null; return; }
    e.anim = {
      t: 0, dur, path: (k) => {
        const q = ease(k);
        if (!curve) return { x: sx + (x - sx) * q, y: sy + (y - sy) * q };
        const a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
        return { x: a * sx + b * curve.x + c * x, y: a * sy + b * curve.y + c * y };
      },
    };
  }
  private fly(from: Vector3, to: Vector3, apex: number, dur: number, onLand: () => void) {
    this.holder = null;
    this.shooter = null;
    this.looseBall = null;
    this.flight = { curve: new ArcCurve(from.clone(), to.clone(), apex), t: 0, dur, onLand };
  }

  /** Where defenders stand for a defensive move (null = neutral, used while the stance is still hidden). */
  private defSpot(s: Poss, i: number, dm: TechId | null): { x: number; y: number } {
    const stance = dm ? famOf(dm) : null;
    const z = ZONES[s.zones[i]];
    const b = ZONES[s.zones[s.ball]];
    const toward = (fx: number, fy: number, tx: number, ty: number, d: number) => {
      const l = Math.hypot(tx - fx, ty - fy) || 1;
      return { x: fx + ((tx - fx) / l) * d, y: fy + ((ty - fy) / l) * d };
    };
    const onBall = i === s.ball;
    if (s.adv[i] > 0) {
      // Beaten or helped away: trailing to the side.
      const p = toward(z.x, z.y, HOOP.x, HOOP.y, 1.6);
      const side = z.x < HOOP.x ? 1.4 : -1.4;
      return { x: clamp(p.x + side, 0.5, COURT_W - 0.5), y: p.y + 0.6 };
    }
    let p: { x: number; y: number };
    if (onBall) {
      const toRim = Math.hypot(HOOP.x - z.x, HOOP.y - z.y);
      const d = dm === 'hawk' ? 0.55 : dm === 'contest' ? 0.85 : stance === 'press' ? 0.75 : dm === 'rim' ? Math.max(0.8, toRim - 1.0)
        : dm === 'charge' ? Math.min(1.9, toRim * 0.5) : dm === 'float' ? 2.9 : stance === 'space' ? 2.3 : 1.25;
      p = toward(z.x, z.y, HOOP.x, HOOP.y, d);
    } else if (stance === 'deny') {
      const k = dm === 'jump' ? 0.42 : dm === 'switch' ? 0.18 : 0.28;
      const lane = { x: z.x + (b.x - z.x) * k, y: z.y + (b.y - z.y) * k };
      p = toward(lane.x, lane.y, HOOP.x, HOOP.y, 0.5);
    } else if (stance === 'space') {
      const k = dm === 'float' ? 0.6 : dm === 'recover' ? 0.32 : 0.45;
      p = { x: z.x + (HOOP.x - z.x) * k, y: z.y + (HOOP.y + 1.2 - z.y) * k };
    } else {
      const d = stance === 'press' ? 1.3 : 1.7;
      const q = toward(z.x, z.y, HOOP.x, HOOP.y, d);
      p = { x: q.x + (b.x - q.x) * 0.08, y: q.y + (b.y - q.y) * 0.08 };
    }
    return { x: clamp(p.x, 0.5, COURT_W - 0.5), y: clamp(p.y, 0.5, COURT_H - 0.5) };
  }

  private layout(s: Poss, dm: TechId | null, dur: number, skip: Ent[] = []) {
    for (let i = 0; i < 3; i++) {
      const a = this.att(i), d = this.def(i);
      const z = ZONES[s.zones[i]];
      if (!skip.includes(a)) this.glide(a, z.x, z.y, dur);
      const p = this.defSpot(s, i, dm);
      if (!skip.includes(d)) this.glide(d, p.x, p.y, dur);
    }
  }

  private snapLayout(s: Poss, dm: TechId | null) {
    for (let i = 0; i < 3; i++) {
      const a = this.att(i), d = this.def(i);
      const z = ZONES[s.zones[i]];
      a.x = z.x; a.y = z.y; a.anim = null;
      const p = this.defSpot(s, i, dm);
      d.x = p.x; d.y = p.y; d.anim = null;
      this.faceTo(a, HOOP.x, HOOP.y);
      this.faceTo(d, a.x, a.y);
    }
  }

  // ---------------------------------------------------------------- flow
  private startPossession(first = false) {
    const tut = this.o.tutorial;
    let s: Poss;
    this.shownStance = null;
    if (tut) {
      this.tutIdx++;
      this.stepIdx = 0;
      const t = tut[this.tutIdx];
      s = setupPoss(t.setup, t.handler);
      this.shownStance = t.stance ?? null;
      this.hooks.banner(t.title, '#ffd166', `${this.tutIdx + 1} / ${tut.length}`);
    } else {
      s = setupPoss(SETUPS[Math.floor(this.rand() * SETUPS.length)], Math.floor(this.rand() * 3));
      if (this.golden) this.hooks.banner('NEXT SCORE WINS', '#ffd60a');
      else this.hooks.banner(this.offense === 0 ? 'YOUR BALL' : 'DEFENSE', this.teams[this.offense].color);
    }
    this.poss = s;
    this.spent = false;
    this.cine = null;
    this.world.fxClear();
    this.world.clearMarks();
    this.world.overview();
    if (tut && this.tutIdx === tut.length - 1) this.heat[0] = FIRE.max;
    this.freed = null;
    this.holder = this.att(s.ball);
    this.flight = null;
    this.looseBall = null;
    for (const e of this.ents) { e.daze = 0; e.armsT = 0; }
    if (first) this.snapLayout(s, this.shownStance);
    else this.layout(s, this.shownStance, 0.8);
    this.phase = 'intro';
    sfx.whistle();
    this.pushHud();
    this.later(first ? 1.2 : 1.0, () => this.openDecision());
  }

  private openDecision() {
    const s = this.poss!;
    s.fire = this.heat[this.offense] >= FIRE.cost && !this.spent;
    this.phase = 'decide';
    this.previewId = null;
    if (this.userAttacks) {
      const v = this.o.tutorial ? this.planners[0].plan(s).v : this.pickDefMoves(s);
      if (this.o.tutorial) this.plan = this.shownStance ? planOf(ONE(this.shownStance)) : planOf(readDefense(this.mu, s), v);
      else this.plan = planOf(this.model.defend(this.mu, s, this.smart), v);
      this.attDist = null;
    } else {
      this.attDist = aiAttackDist(this.planners[1], s, this.habits, this.smart, this.temp);
      this.plan = null;
    }
    this.opts = this.buildOptions();
    for (let i = 0; i < 3; i++) { this.faceTo(this.att(i), HOOP.x, HOOP.y); this.faceTo(this.def(i), this.att(i).x, this.att(i).y); }
    // Battle camera: close on the two players facing off; the opponent's tell floats over their player.
    this.camDuel();
    this.world.clearMarks();
    const tell = this.tell();
    if (tell) {
      const who = this.userAttacks ? this.def(s.ball) : this.att(s.ball);
      this.world.mark(this.pos3(who, 3.2), icon(tell.icon, 16), `tell ${this.userAttacks ? 'def' : 'att'}`);
    }
    this.hooks.decision(true);
    this.pushHud();
  }

  // ---------------------------------------------------------------- camera
  /** Scene points of a player (feet and head), for camera framing. */
  private pts(e: Ent | { x: number; y: number }): ScenePt[] {
    const f = this.world.screenOf(e.x, e.y);
    return [f, { x: f.x - 10, y: f.y - 44 }, { x: f.x + 10, y: f.y - 44 }];
  }
  private rimPts(): ScenePt[] { const r = this.world.screenOf(HOOP.x, HOOP.y, RIM_H); return [r, { x: r.x, y: r.y - 10 }]; }
  /** Close on the ball handler and their defender. */
  camDuel() {
    const s = this.poss;
    if (!s) return;
    this.world.frame([...this.pts(this.att(s.ball)), ...this.pts(this.def(s.ball))], 3, 12);
  }
  /** Frame everything an action involves (the shooter and the rim, the passer and the receiver...). */
  private focusAct(a: Act) {
    const s = this.poss!;
    const h = this.att(s.ball), hd = this.def(s.ball);
    const P: ScenePt[] = [...this.pts(h), ...this.pts(hd)];
    if (a.k === 'shoot') P.push(...this.rimPts());
    else if (a.k === 'pass') P.push(...this.pts(this.att(a.to)), ...this.pts(this.def(a.to)));
    else if (a.k === 'drive') P.push(...this.pts(ZONES[a.z]));
    else {
      if (a.t === 'iso' || a.t === 'giveandgo') for (let j = 0; j < 3; j++) P.push(...this.pts(this.att(j)));
      P.push(...this.pts(this.att(a.who)), ...this.pts(this.def(a.who)), ...this.pts(ZONES[a.z]));
    }
    this.world.frame(P, 3, 14);
  }
  /** Frame a defensive move: the duel, plus the rim or the whole team when the move involves them. */
  private focusStance(dm: TechId) {
    const s = this.poss!;
    const P: ScenePt[] = [...this.pts(this.att(s.ball)), ...this.pts(this.def(s.ball))];
    const p = this.defSpot(s, s.ball, dm);
    P.push(...this.pts(p));
    if (dm === 'rim' || dm === 'charge') P.push(...this.rimPts());
    if (famOf(dm) === 'deny' || dm === 'hawk') for (let j = 0; j < 3; j++) { P.push(...this.pts(this.att(j)), ...this.pts(this.defSpot(s, j, dm))); }
    this.world.frame(P, 3, 14);
  }

  /** The opponent's most likely choice, shown as an icon over their player. */
  private tell(): { icon: string; name: string; st?: Stance; k?: ActKind } | null {
    if (this.userAttacks) {
      const plan = this.plan;
      if (!plan) return null;
      const st = this.shownStance ?? STANCES.slice().sort((a, b) => plan.dist[b] - plan.dist[a])[0];
      const dm = plan.v[st];
      return { icon: TECHS[dm].icon, name: defName(dm), st };
    }
    if (!this.attDist) return null;
    const by: Record<ActKind, number> = { shoot: 0, pass: 0, drive: 0, cut: 0 };
    for (const x of this.attDist) by[x.item.k] += x.w;
    const k = (Object.keys(by) as ActKind[]).sort((a, b) => by[b] - by[a])[0];
    return { icon: KIND_ICON[k], name: KIND_LABEL[k], k };
  }

  /**
   * The AI defense's move for each stance family. The planner's choice is the one that leaves the attack
   * the smallest best option; here any move close to it can be picked (softmax on that value), so Block,
   * Take the charge or Contest show up where they make sense (a big at the post, a driver in the lane).
   */
  private pickDefMoves(s: Poss): Record<Stance, TechId> {
    const pl = this.planners[0];
    const base = pl.plan(s).v;
    const acts = legalActs(s, this.mu);
    const v = { ...base };
    for (const st of STANCES) {
      const opts = defMovesFor(this.mu, st);
      if (opts.length < 2) continue;
      const vals = opts.map((dm) => Math.max(...acts.map((a) => pl.qPlan(s, a, { dist: ONE(st), v: { ...base, [st]: dm } }))));
      const min = Math.min(...vals);
      const ws = vals.map((x) => Math.exp(-(x - min) / 0.05));
      let r = this.rand() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < opts.length; i++) { r -= ws[i]; if (r <= 0) { v[st] = opts[i]; break; } }
    }
    return v;
  }

  private tutStep(): GuideStep | null {
    const t = this.o.tutorial?.[this.tutIdx];
    return t?.steps[this.stepIdx] ?? null;
  }

  decisionInfo(): DecisionInfo | null {
    const s = this.poss;
    if (!s || this.phase !== 'decide') return null;
    const step = this.userAttacks ? this.tutStep() : null;
    const side = this.userAttacks ? 'att' : 'def';
    return {
      side,
      situation: this.situation(),
      threat: this.attDist ? this.threatLine() : undefined,
      coach: !this.o.tutorial && !!this.o.coach?.[side],
      left: s.left,
      maxLeft: s.rebs > 0 ? TUNE.orebActions : TUNE.actions,
      lean: this.userAttacks ? this.plan ?? undefined : undefined,
      attLean: this.attDist ? this.attDist.reduce((acc, x) => { acc[x.item.k] += x.w; return acc; }, { shoot: 0, pass: 0, drive: 0, cut: 0 } as Record<ActKind, number>) : undefined,
      shown: this.shownStance ?? undefined,
      hint: step?.hint ?? (this.o.tutorial && s.fire && this.userAttacks ? 'Fire: use a special' : undefined),
      fire: !!s.fire && this.userAttacks,
      threats: this.attDist ? this.threats() : undefined,
      tell: this.tell() ?? undefined,
    };
  }

  /** One plain sentence on the state of the possession. */
  private situation(): string {
    const s = this.poss!;
    const h = this.att(s.ball), d = this.def(s.ball);
    const z = ZONES[s.zones[s.ball]];
    const where = z.kind === 'three' ? `at the ${z.name.toLowerCase()}, behind the 3-point line (a make is worth 2)` : z.kind === 'mid' ? `at the ${z.name.toLowerCase()} (a make is worth 1)` : 'at the post, next to the rim (a make is worth 1)';
    const open = s.adv[s.ball] > 0;
    const freeMates = [0, 1, 2].filter((j) => j !== s.ball && s.adv[j] > 0).map((j) => `#${this.att(j).pl.num}`);
    const last = s.left <= 1 ? ' Last move: you must shoot.' : '';
    if (this.userAttacks) {
      const st = open ? `You beat #${d.pl.num}: you are OPEN.` : `#${d.pl.num} guards you.`;
      const fm = freeMates.length ? ` ${freeMates.join(' and ')} ${freeMates.length > 1 ? 'are' : 'is'} open.` : '';
      return `Your ball: #${h.pl.num} ${where}. ${st}${fm}${last}`;
    }
    const st = open ? `They beat your #${d.pl.num}: #${h.pl.num} is OPEN.` : `Your #${d.pl.num} guards #${h.pl.num}.`;
    const fm = freeMates.length ? ` ${freeMates.join(' and ')} ${freeMates.length > 1 ? 'are' : 'is'} open too.` : '';
    return `Their ball: #${h.pl.num} ${where}. ${st}${fm}${s.left <= 1 ? ' Last move: they must shoot.' : ''}`;
  }

  /** Name of an attack action in words ("Dunk", "Crossover to the elbow", "Pass to #11"). */
  private actWords(a: Act, s: Poss): string {
    const zk = ZONES[s.zones[s.ball]].kind;
    const n = moveName(a.t, a.k === 'shoot' ? zk : undefined, a.sp);
    if (a.k === 'pass') return `${n} to #${this.att(a.to).pl.num}`;
    if (a.k === 'drive' && a.z !== s.zones[s.ball]) return `${n} to the ${ZONES[a.z].name.toLowerCase()}`;
    if (a.k === 'cut' && a.who !== s.ball) return `${n} (#${this.att(a.who).pl.num})`;
    return n;
  }

  /** The attack's most likely kinds of action, in words, with the move they would most likely use. */
  private threatLine(): string {
    const s = this.poss!;
    const by = new Map<ActKind, { w: number; best: Act; bw: number }>();
    for (const x of this.attDist!) {
      const e = by.get(x.item.k) ?? { w: 0, best: x.item, bw: 0 };
      e.w += x.w;
      if (x.w > e.bw) { e.bw = x.w; e.best = x.item; }
      by.set(x.item.k, e);
    }
    const top = [...by.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, 2);
    return top.map(([k, e]) => `${KIND_LABEL[k]} ${Math.round(e.w * 100)}% (${this.actWords(e.best, s)})`).join(', ');
  }

  /** Specials the AI attack may use now, with their weight in its mix. */
  private threats() {
    const by = new Map<SpecialId, number>();
    for (const x of this.attDist!) if (x.item.sp) by.set(x.item.sp, (by.get(x.item.sp) ?? 0) + x.w);
    return [...by.entries()].map(([id, w]) => {
      const who = this.ents.find((e) => e.team === this.offense && e.sp.id === id)!;
      return { num: who.pl.num, name: SPECIALS[id].name, counter: SPECIALS[id].counter, pct: Math.max(1, Math.round(w * 100)) };
    });
  }

  options(): OptionInfo[] { return this.opts; }

  /** The coach walkthrough for this side is done (it shows once). */
  coachDone(side: 'att' | 'def') {
    if (!this.o.coach?.[side]) return;
    this.o.coach[side] = false;
    this.hooks.coached?.(side);
  }

  // ---------------------------------------------------------------- options & odds
  /** Best open-shot make chance for `who` in state n (any shot technique they know). */
  private openShot(n: Poss, who: number) {
    const m = this.mu;
    let best = 0;
    for (const a of legalActs({ ...n, ball: who, left: 1 }, m)) best = Math.max(best, shotChance(m, { ...n, ball: who }, who, null, a.t).make);
    return best;
  }

  private buildOptions(): OptionInfo[] {
    const s = this.poss!;
    const m = this.mu;
    if (!this.userAttacks) return this.stanceOptions();
    const plan = this.plan!;
    const step = this.tutStep();
    const out: OptionInfo[] = [];
    const nextShot = (n: Poss, who: number) => {
      // Make chance of `who`'s best shot in state n against what the defense would do there.
      const d = this.o.tutorial ? planOf(this.shownStance ? ONE(this.shownStance) : readDefense(m, n)) : planOf(readDefense(m, n), this.planners[0].plan(n).v);
      let best = 0;
      for (const a of legalActs({ ...n, ball: who, left: 1 }, m)) {
        let p = 0;
        for (const st of STANCES) p += d.dist[st] * shotChance(m, { ...n, ball: who }, who, d.v[st], a.t).make;
        best = Math.max(best, p);
      }
      return best;
    };
    const tick = (n: Partial<Poss>): Poss => ({ ...s, adv: s.adv.map((t) => Math.max(0, t - 1)), left: s.left - 1, ...n });
    for (const a of legalActs(s, m)) {
      const o = actOdds(m, s, a, plan);
      const pc = toPercents(o);
      const g = (k: Ev) => pc[k] ?? 0;
      const hzk = ZONES[s.zones[s.ball]].kind;
      const tn = moveName(a.t, a.k === 'shoot' ? hzk : undefined);
      const chargeOdd: OddsItem[] = g('charge') > 0 ? [{ key: 'charge', pct: g('charge'), tone: 'bad', word: 'CHARGE', icon: 't_charge' }] : [];
      let info: OptionInfo;
      switch (a.k) {
        case 'shoot': {
          const pts = ZONES[s.zones[s.ball]].kind === 'three' ? 2 : 1;
          const odds: OddsItem[] = [
            { key: 'make', pct: g('make'), tone: 'good', word: 'IN', icon: 'check' },
            ...(g('and1') > 0 ? [{ key: 'and1', pct: g('and1'), tone: 'good' as Tone, word: 'AND ONE', icon: 'up' }] : []),
            { key: 'miss', pct: g('miss') + g('oreb'), tone: 'mid', word: 'MISS', icon: 'cross' },
            { key: 'block', pct: g('block'), tone: 'bad', word: 'BLOCK', icon: 'block' },
            ...chargeOdd,
          ];
          const mk = g('make') + g('and1');
          info = {
            id: actKey(a), kind: 'shoot', tech: a.t, act: a, label: tn, odds, main: mk,
            card: {
              gain: g('and1') > 0 ? `+${pts} at ${mk}%, +1 more ${g('and1')}%` : `+${pts} at ${mk}%`,
              risk: g('block') >= 3 ? `Block ${g('block')}%` : g('charge') > 0 ? `Charge ${g('charge')}%` : `Miss ${g('miss') + g('oreb')}%`,
              change: 'Ends the possession',
            },
          };
          break;
        }
        case 'pass': {
          const to = this.att(a.to);
          const then = pct(nextShot(tick({ ball: a.to }), a.to));
          const open = pct(this.openShot(tick({ ball: a.to }), a.to));
          const odds: OddsItem[] = [
            { key: 'catch', pct: g('catch'), tone: 'good', word: 'CATCH', icon: 'check' },
            ...(g('feed') > 0 ? [{ key: 'feed', pct: g('feed'), tone: 'good' as Tone, word: 'OPEN', icon: 'up' }] : []),
            { key: 'pick', pct: g('pick'), tone: 'bad', word: 'PICKED', icon: 'steal' },
          ];
          info = {
            id: actKey(a), kind: 'pass', tech: a.t, act: a, label: tn, tag: `#${to.pl.num}`, targetNum: to.pl.num, odds, main: g('catch') + g('feed'),
            card: {
              gain: g('feed') > 0 ? `Open catch ${g('feed')}%: shoots ${open}%` : `#${to.pl.num} then shoots ${then}%`,
              risk: `Picked off ${g('pick')}%`,
              change: s.adv[a.to] > 0 ? 'To the open man' : `${tn} to #${to.pl.num}`,
            },
          };
          break;
        }
        case 'drive': {
          const z = ZONES[a.z];
          if (a.t === 'stepback' || a.t === 'pumpfake') {
            const then = pct(this.openShot(tick({ adv: s.adv.map((t, j) => (j === s.ball ? 1 : Math.max(0, t - 1))) }), s.ball));
            const odds: OddsItem[] = [
              { key: 'room', pct: g('room'), tone: 'good', word: 'ROOM', icon: a.t === 'pumpfake' ? 't_pump' : 't_stepback' },
              { key: 'held', pct: g('held'), tone: 'mid', word: 'HELD', icon: 'even' },
              { key: 'steal', pct: g('steal'), tone: 'bad', word: 'STOLEN', icon: 'steal' },
            ];
            info = {
              id: actKey(a), kind: 'drive', tech: a.t, act: a, label: tn, tag: 'Stay', odds, main: g('room'),
              card: { gain: `Room ${g('room')}%: open shot ${then}%`, risk: `Stolen ${g('steal')}%`, change: 'Stays here, uses 1 move' },
            };
            break;
          }
          const n = tick({ zones: s.zones.map((x, j) => (j === s.ball ? a.z : x)), adv: s.adv.map((t, j) => (j === s.ball ? 1 : Math.max(0, t - 1))) });
          const then = pct(this.openShot(n, s.ball));
          const freedNum = this.att(helperFor(s, a.z)).pl.num;
          const odds: OddsItem[] = [
            { key: 'beat', pct: g('beat'), tone: 'good', word: 'PAST', icon: 'dribble' },
            ...(g('help') > 0 ? [{ key: 'help', pct: g('help'), tone: 'good' as Tone, word: 'MATE FREE', icon: 'pass' }] : []),
            { key: 'held', pct: g('held') + g('stopped'), tone: 'mid', word: 'HELD', icon: 'even' },
            { key: 'steal', pct: g('steal'), tone: 'bad', word: 'STOLEN', icon: 'steal' },
            ...chargeOdd,
          ];
          info = {
            id: actKey(a), kind: 'drive', tech: a.t, act: a, label: tn, tag: z.name, odds, main: g('beat'),
            card: {
              gain: `Past ${g('beat')}%: then ${then}%`,
              risk: g('charge') > 0 ? `Stolen ${g('steal')}%, charge ${g('charge')}%` : `Stolen ${g('steal')}%`,
              change: g('help') > 0 ? `Help may free #${freedNum}` : `To the ${z.name.toLowerCase()}`,
            },
          };
          break;
        }
        case 'cut': {
          const who = this.att(a.who);
          const z = ZONES[a.z];
          if (a.t === 'pnr') {
            const odds: OddsItem[] = [
              { key: 'beat', pct: g('beat'), tone: 'good', word: 'FREE', icon: 'dribble' },
              { key: 'open', pct: g('open'), tone: 'good', word: 'ROLL', icon: 'check' },
              { key: 'covered', pct: g('covered'), tone: 'mid', word: 'COVERED', icon: 'even' },
              ...(g('steal') > 0 ? [{ key: 'steal', pct: g('steal'), tone: 'bad' as Tone, word: 'STOLEN', icon: 'steal' }] : []),
            ];
            info = {
              id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: `#${who.pl.num} roll`, targetNum: who.pl.num, odds, main: g('beat') + g('open'),
              card: { gain: `You free ${g('beat')}%, #${who.pl.num} rolls open ${g('open')}%`, risk: g('steal') > 0 ? `Stolen ${g('steal')}%` : 'Low turnover risk', change: `#${who.pl.num} screens, rolls to the ${z.name.toLowerCase()}` },
            };
            break;
          }
          if (a.t === 'iso') {
            const odds: OddsItem[] = [
              { key: 'room', pct: g('room'), tone: 'good', word: 'WINS 1v1', icon: 't_iso' },
              { key: 'held', pct: g('held'), tone: 'mid', word: 'HELD', icon: 'even' },
              { key: 'steal', pct: g('steal'), tone: 'bad', word: 'STOLEN', icon: 'steal' },
            ];
            const then = pct(this.openShot(tick({ zones: isoZones(s), adv: s.adv.map((t, j) => (j === s.ball ? TUNE.isoTtl : Math.max(0, t - 1))) }), s.ball));
            info = {
              id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: 'Clear', odds, main: g('room'),
              card: { gain: `Wins the 1 on 1 ${g('room')}%: open ${then}%`, risk: `Stolen ${g('steal')}%`, change: 'Mates clear to the corners' },
            };
            break;
          }
          if (a.t === 'handoff') {
            const odds: OddsItem[] = [
              { key: 'beat', pct: g('beat'), tone: 'good', word: 'OPEN', icon: 't_handoff' },
              { key: 'catch', pct: g('catch'), tone: 'mid', word: 'GUARDED', icon: 'even' },
              { key: 'steal', pct: g('steal'), tone: 'bad', word: 'STOLEN', icon: 'steal' },
            ];
            info = {
              id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: `#${who.pl.num}`, targetNum: who.pl.num, odds, main: g('beat'),
              card: { gain: `#${who.pl.num} comes off it open ${g('beat')}%`, risk: `Stolen ${g('steal')}%`, change: `Hand the ball to #${who.pl.num}` },
            };
            break;
          }
          if (a.t === 'pop') {
            const odds: OddsItem[] = [
              { key: 'open', pct: g('open'), tone: 'good', word: 'OPEN', icon: 't_pop' },
              { key: 'covered', pct: g('covered'), tone: 'mid', word: 'COVERED', icon: 'even' },
              ...(g('steal') > 0 ? [{ key: 'steal', pct: g('steal'), tone: 'bad' as Tone, word: 'STRIPPED', icon: 'steal' }] : []),
            ];
            info = {
              id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: `#${who.pl.num} pop`, targetNum: who.pl.num, odds, main: g('open'),
              card: { gain: `#${who.pl.num} pops open ${g('open')}%`, risk: g('steal') > 0 ? `Ball stripped ${g('steal')}%` : 'Low turnover risk', change: `#${who.pl.num} screens, pops to the ${z.name.toLowerCase()}` },
            };
            break;
          }
          if (a.t === 'giveandgo') {
            const mate = this.att(gngPartner(s));
            const odds: OddsItem[] = [
              { key: 'open', pct: g('open'), tone: 'good', word: 'OPEN', icon: 'check' },
              { key: 'covered', pct: g('covered'), tone: 'mid', word: 'COVERED', icon: 'even' },
              { key: 'pick', pct: g('pick'), tone: 'bad', word: 'PICKED', icon: 'steal' },
            ];
            info = {
              id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: z.name, odds, main: g('open'),
              card: { gain: `Back open at the ${z.name.toLowerCase()} ${g('open')}%`, risk: `Picked off ${g('pick')}%`, change: `Two passes with #${mate.pl.num}` },
            };
            break;
          }
          const odds: OddsItem[] = [
            { key: 'open', pct: g('open'), tone: 'good', word: 'OPEN', icon: 'check' },
            ...(g('slip') > 0 ? [{ key: 'slip', pct: g('slip'), tone: 'good' as Tone, word: 'SLIP', icon: 'pass' }] : []),
            { key: 'covered', pct: g('covered'), tone: 'mid', word: 'COVERED', icon: 'even' },
            ...(g('steal') > 0 ? [{ key: 'steal', pct: g('steal'), tone: 'bad' as Tone, word: 'STRIPPED', icon: 'steal' }] : []),
          ];
          const sc = a.t === 'screen' ? this.att(screenerFor(s, a.who)) : null;
          info = {
            id: actKey(a), kind: 'cut', tech: a.t, act: a, label: tn, tag: `#${who.pl.num} ${z.name}`, targetNum: who.pl.num, odds, main: g('open'),
            card: {
              gain: sc ? `#${who.pl.num} open ${g('open')}%, #${sc.pl.num} slips ${g('slip')}%` : `#${who.pl.num} open ${g('open')}%`,
              risk: g('steal') > 0 ? `Ball stripped ${g('steal')}%` : 'No turnover risk',
              change: sc ? `#${sc.pl.num} screens for #${who.pl.num}` : `#${who.pl.num} to the ${z.name.toLowerCase()}`,
            },
          };
          break;
        }
      }
      info.group = a.sp ?? a.t;
      // Plain summary, reward and risk pips (icons, not only numbers).
      const bad = info.odds.filter((x) => x.tone === 'bad').reduce((p, x) => p + x.pct, 0);
      const good = info.odds.filter((x) => x.tone === 'good').reduce((p, x) => p + x.pct, 0);
      if (a.k === 'shoot') {
        const pts = hzk === 'three' ? 2 : 1;
        info.reward = lvl(info.main * pts, 35, 55);
        info.risk = lvl(100 - info.main, 45, 62);
        info.what = `${pts === 2 ? '+2 from deep' : '+1'}. ${TECHS[a.t].line}`;
      } else {
        info.reward = lvl(good, 30, 55);
        info.risk = lvl(bad, 8, 16);
        info.what = TECHS[a.t].line;
      }
      if (a.sp) {
        const d = SPECIALS[a.sp];
        info.sp = a.sp;
        info.label = d.name;
        info.card = { ...info.card, change: `FIRE: ${d.name}. Countered by ${STANCE_LABEL[d.counter]}` };
      }
      info.edge = this.edgeAtt(a, plan);
      info.short = a.k === 'pass' ? `#${this.att(a.to).pl.num}` : a.k === 'drive' ? (a.t === 'stepback' || a.t === 'pumpfake' ? 'Here' : `${ZONES[a.z].name}${ZONES[a.z].x < HOOP.x ? ' L' : ' R'}`)
        : a.k === 'cut' ? (a.t === 'iso' ? 'Clear' : a.t === 'giveandgo' ? `${ZONES[a.z].name}` : `#${this.att(a.who).pl.num} ${ZONES[a.z].name}`) : undefined;
      if (step) {
        let ok = step.allow.includes(a.k);
        if (ok && step.techs) ok = step.techs.includes(a.t);
        if (ok && a.k === 'drive' && step.zones) ok = step.zones.includes(a.z);
        if (ok && a.k === 'pass' && step.toFreed) ok = a.to === this.freed;
        info.disabled = !ok;
        info.hint = ok;
      }
      out.push(info);
    }
    // The dunk is always on the Shoot menu: when it is out of reach it says why.
    if (!out.some((o) => o.tech === 'dunk')) {
      const h = this.att(s.ball);
      const z = ZONES[s.zones[s.ball]];
      const st = m.att[s.ball];
      const strong = z.kind === 'close' ? st.str + st.spd >= TUNE.dunk.post : st.str + st.spd >= TUNE.dunk.run;
      const why = !strong ? 'Not strong enough' : z.kind === 'three' ? 'Too far' : 'Beat him first';
      void h;
      out.unshift({ id: 'lock-dunk', kind: 'shoot', tech: 'dunk', label: 'Dunk', odds: [], main: 0, card: { gain: '', risk: '', change: '' }, disabled: true, locked: why, group: 'dunk', what: why });
    }
    return out;
  }

  /**
   * How an attack move does against the defense's tell, compared with the two other stances: 1 when it is
   * this move's best matchup (it beats the tell), -1 when it is its worst, 0 when the stance barely matters.
   */
  private edgeAtt(a: Act, plan: DefPlan): -1 | 0 | 1 {
    const t = this.tell();
    if (!t?.st) return 0;
    const s = this.poss!;
    const win = new Set<Ev>(['make', 'and1', 'beat', 'room', 'help', 'open', 'slip', 'feed', ...(a.k === 'pass' ? ['catch' as Ev] : [])]);
    const succ: Record<Stance, number> = { press: 0, space: 0, deny: 0 };
    for (const st of STANCES) {
      const o = actOdds(this.mu, s, a, planOf(ONE(st), plan.v));
      for (const [k, p] of Object.entries(o)) if (win.has(k as Ev)) succ[st] += p ?? 0;
    }
    const me = succ[t.st];
    const others = STANCES.filter((x) => x !== t.st).map((x) => succ[x]);
    const hi = Math.max(...others), lo = Math.min(...others);
    if (me >= hi - 0.02 && me - lo >= 0.06) return 1;
    if (me <= lo + 0.02 && hi - me >= 0.06) return -1;
    return 0;
  }

  private stanceOptions(): OptionInfo[] {
    const s = this.poss!;
    const m = this.mu;
    const attDist = this.attDist!;
    const handler = this.att(s.ball);
    const acts = legalActs(s, m);
    // The attack's most likely action: each option says how it does against it.
    const top = [...attDist].sort((x, y) => y.w - x.w)[0]?.item;
    const attWin = new Set<Ev>(['make', 'and1', 'beat', 'room', 'help', 'open', 'slip', 'feed']);
    const out: OptionInfo[] = [];
    const all = STANCES.flatMap((st) => defMovesFor(m, st));
    for (const dm of DEF_ORDER.filter((d) => all.includes(d))) {
      const st = famOf(dm);
      // Against the attack's exact mix: you take the ball, you hold them (no advantage), or they beat you.
      const raw = { ball: 0, held: 0, beat: 0 };
      for (const { item, w } of attDist) {
        for (const b of branches(m, s, item, dm)) {
          if (attWin.has(b.ev)) raw.beat += w * b.p;
          else if (!b.next) raw.ball += w * b.p;
          else raw.held += w * b.p;
        }
      }
      const o = toPercents(raw);
      const odds: OddsItem[] = [
        { key: 'ball', pct: o.ball, tone: 'good', word: 'YOUR BALL', icon: 'ball' },
        { key: 'held', pct: o.held, tone: 'mid', word: 'HELD', icon: 'even' },
        { key: 'beat', pct: o.beat, tone: 'bad', word: 'BEATEN', icon: 'beaten' },
      ];
      let shot = 0;
      for (const a of acts) if (a.k === 'shoot') shot = Math.max(shot, pct(shotChance(m, s, s.ball, dm, a.t).make));
      const guide = DEF_GUIDE[dm]!;
      let vsTop: string | undefined;
      let stopTop = 0;
      if (top) {
        // Against the attack's most likely kind of action (the tell), weighted by how they would play it.
        let wsum = 0;
        const tk = this.tell()?.k ?? top.k;
        for (const { item, w } of attDist) {
          if (item.k !== tk) continue;
          wsum += w;
          for (const b of branches(m, s, item, dm)) if (!attWin.has(b.ev)) stopTop += w * b.p;
        }
        stopTop = wsum > 0 ? stopTop / wsum : 0;
        vsTop = `${pct(stopTop)}`;
      }
      const card: Card = {
        gain: `Stops: ${guide.stops}`,
        risk: `Beaten by: ${guide.weak}`,
        change: `#${handler.pl.num} best shot vs this: ${shot}%`,
      };
      out.push({
        id: dm, kind: st, tech: dm, dm, label: defName(dm), odds, main: o.ball + o.held, card, group: dm,
        what: guide.does, reward: lvl(o.ball + o.held, 52, 68), risk: lvl(o.beat, 32, 48), vsTop, edge: 0,
      });
      (out[out.length - 1] as OptionInfo & { stopTop?: number }).stopTop = stopTop;
    }
    // Edge: how each move does against their tell, ranked among the seven.
    const vals = out.map((o) => (o as OptionInfo & { stopTop?: number }).stopTop ?? 0);
    const hi = Math.max(...vals), lo = Math.min(...vals);
    if (hi - lo >= 0.08) out.forEach((o, i) => { o.edge = vals[i] >= hi - 0.04 ? 1 : vals[i] <= lo + 0.04 ? -1 : 0; });
    return out;
  }

  // ---------------------------------------------------------------- previews
  preview(id: string | null) {
    if (this.phase !== 'decide' || this.previewId === id) return;
    this.previewId = id;
    const W = this.world;
    W.clearPreview();
    const s = this.poss!;
    if (!id) { this.showCategory(null); this.camDuel(); return; }
    const opt = this.opts.find((o) => o.id === id);
    if (!opt) return;
    // Previews are drawn, not written: routes, rings, the target hand. The numbers live in the command window.
    const lab = (_k: string, _pos: Vector3) => {};
    const techTag = (_pos: Vector3) => {
      if (opt.sp) W.floorRing(this.pos3(this.spActor(opt.act!)), '#ffb02e', 1.1);
    };
    const h = this.att(s.ball);
    const A = this.pos3(h);
    const toHoop = new Vector3(HOOP.x - h.x, 0, HOOP.y - h.y).normalize();
    const side = new Vector3(-toHoop.z, 0, toHoop.x);
    if (opt.dm) { this.previewStance(opt, lab); this.focusStance(opt.dm); return; }
    const a = opt.act!;
    this.focusAct(a);
    const tp = this.targetPos(a);
    if (tp) W.pointAt(tp.x, tp.y);
    techTag(A.clone().add(new Vector3(0, 3.5, 0)));
    switch (a.k) {
      case 'shoot': {
        const D = this.pos3(this.def(s.ball));
        const target = RIM.clone().add(new Vector3(0, 0.12, 0));
        let from = this.hand(h, 2.1);
        const dd = dist(h.x, h.y, HOOP.x, HOOP.y);
        if (a.t === 'fade') {
          // Step back away from the defender, then a higher arc.
          const back = A.clone().addScaledVector(toHoop, -1.0);
          W.dots(new CatmullRomCurve3([A.clone().setY(0.08), back.clone().setY(0.08)]), '#ffd166', 0.07, 0.25, 1.2);
          W.floorRing(back, '#ffd166', 0.45, false);
          from = back.clone().setY(2.4);
          W.dots(new ArcCurve(from, target, shotApex(dd) + 0.8), '#ffffff', 0.075, 0.34);
        } else if (a.t === 'bank') {
          const bp = boardPoint(h.x);
          W.dots(new ArcCurve(from, bp, shotApex(dd) * 0.8), '#ffffff', 0.075, 0.34);
          W.dots(new ArcCurve(bp, target, 0.05), '#9be7ff', 0.07, 0.18);
          W.floorRing(w3(HOOP.x, 1.3, 0.02), '#9be7ff', 0.5, false);
        } else if (a.t === 'layup' || a.t === 'dunk') {
          const near = w3(HOOP.x + (h.x - HOOP.x) * 0.35, HOOP.y + (h.y - HOOP.y) * 0.35);
          W.dots(new CatmullRomCurve3([A.clone().setY(0.08), near.clone().setY(0.08)]), '#ffd166', 0.08, 0.28, 1.4);
          W.dots(new ArcCurve(near.clone().setY(2.6), target, 0.35), '#ffffff', 0.075, 0.22);
          lab('and1', near.clone().add(new Vector3(0, 1.6, 0)).addScaledVector(side, -1.1));
        } else {
          W.dots(new ArcCurve(from, target, shotApex(dd)), '#ffffff', 0.075, 0.34);
        }
        W.ghostBall(target, '#3ddc97');
        if (!(s.adv[s.ball] > 0)) W.wall(D.clone().addScaledVector(toHoop, -0.1), toHoop, '#ff4d6d', a.t === 'fade' ? 0.6 : 1.0, 0.9, 2.0);
        lab('make', RIM.clone().add(new Vector3(0, 0.75, 0)));
        lab('miss', RIM.clone().addScaledVector(side, 1.3).add(new Vector3(0, -0.1, 0)));
        lab('block', D.clone().add(new Vector3(0, 3.0, 0)));
        break;
      }
      case 'pass': {
        const to = this.att(a.to);
        const B = this.pos3(to, a.t === 'lob' ? 2.3 : 1.2);
        const F = this.hand(h);
        if (a.t === 'bounce') {
          const mid = F.clone().lerp(B, 0.55).setY(0.05);
          W.dots(new CatmullRomCurve3([F, F.clone().lerp(mid, 0.5).setY(0.6), mid, mid.clone().lerp(B, 0.5).setY(0.7), B], false, 'catmullrom', 0.1), '#9be7ff', 0.07, 0.3, 1.3);
          W.floorRing(mid, '#9be7ff', 0.3, false);
        } else if (a.t === 'lob') {
          W.dots(new ArcCurve(F, B, 2.2), '#c3a6ff', 0.075, 0.32, 1.1);
        } else if (a.t === 'skip') {
          W.dots(new ArcCurve(F, B, 1.5), '#c3a6ff', 0.075, 0.36, 1.2);
        } else if (a.t === 'nolook') {
          W.dots(new ArcCurve(F, B, 0.3), '#ff9be0', 0.06, 0.24, 1.8);
        } else {
          W.dots(new ArcCurve(F, B, 0.35), '#9be7ff', 0.07, 0.32, 1.3);
        }
        W.ghostBall(B, '#3ddc97');
        W.floorRing(this.pos3(to), '#3ddc97', 0.8);
        W.floorRing(this.pos3(this.def(a.to)), '#ff4d6d', 0.7, false);
        lab('catch', this.pos3(to, 2.6));
        lab('feed', this.pos3(to, 3.4));
        lab('pick', this.pos3(this.def(a.to), 2.4));
        break;
      }
      case 'drive': {
        const z = ZONES[a.z];
        const hd = this.def(s.ball);
        if (a.t === 'pumpfake') {
          W.dots(new CatmullRomCurve3([A.clone().setY(1.6), A.clone().setY(2.8)]), '#ffd166', 0.08, 0.2, 1.4);
          W.floorRing(A, '#3ddc97', 0.55);
          W.floorRing(this.pos3(hd), '#ff4d6d', 0.7, false);
          lab('room', A.clone().add(new Vector3(0, 3.2, 0)).addScaledVector(side, 0.9));
          lab('held', A.clone().add(new Vector3(0, 2.7, 0)).addScaledVector(side, -1.0));
          lab('steal', this.pos3(hd, 2.5));
          break;
        }
        if (a.t === 'stepback') {
          const back = A.clone().addScaledVector(toHoop, -1.1);
          W.dots(new CatmullRomCurve3([A.clone().setY(0.08), back.clone().setY(0.08)]), '#ffd166', 0.09, 0.25, 1.4);
          W.floorRing(back, '#3ddc97', 0.55);
          W.floorRing(this.pos3(hd), '#ff4d6d', 0.7, false);
          lab('room', back.clone().add(new Vector3(0, 2.6, 0)));
          lab('held', A.clone().add(new Vector3(0, 2.7, 0)).addScaledVector(side, -1.0));
          lab('steal', this.pos3(hd, 2.5));
          break;
        }
        const route = this.driveCurve(a.t, h.x, h.y, z.x, z.y, hd);
        W.dots(route, a.t === 'drive' ? '#ffd166' : '#ffb347', 0.09, 0.3, 1.4);
        if (a.t === 'hesi') W.floorRing(route.getPoint(0.4), '#ffffff', 0.35, false);
        W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
        W.floorRing(this.pos3(hd), '#ff4d6d', 0.7, false);
        lab('beat', w3(z.x, z.y, 0.5));
        lab('held', A.clone().add(new Vector3(0, 2.7, 0)).addScaledVector(side, -0.7));
        lab('steal', this.pos3(hd, 2.5));
        if (opt.odds.some((x) => x.key === 'help')) {
          const fr = helperFor(s, a.z);
          W.floorRing(this.pos3(this.def(fr)), '#ff9f40', 0.7, false);
          W.floorRing(this.pos3(this.att(fr)), '#3ddc97', 0.75);
          lab('help', this.pos3(this.att(fr), 2.6));
        }
        break;
      }
      case 'cut': {
        const c = this.att(a.who);
        const z = ZONES[a.z];
        if (a.t === 'pnr') {
          const hd = this.def(s.ball);
          const scr = this.screenSpot(hd, h);
          W.dots(new CatmullRomCurve3([this.pos3(c, 0.08), w3(scr.x, scr.y, 0.08)]), '#7ef0c0', 0.07, 0.28, 1.3);
          W.wall(w3(scr.x, scr.y), toHoop, '#7ef0c0', 0.8, 1.2, 0.1);
          W.dots(this.routeCurve(scr.x, scr.y, z.x, z.y, hd), '#7ef0c0', 0.08, 0.3, 1.4);
          W.floorRing(A, '#3ddc97', 0.8);
          W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
          lab('beat', A.clone().add(new Vector3(0, 2.8, 0)));
          lab('open', w3(z.x, z.y, 0.6));
          lab('covered', this.pos3(this.def(a.who), 2.4));
          lab('steal', this.pos3(hd, 2.6).addScaledVector(side, 0.9));
          break;
        }
        if (a.t === 'iso') {
          const zs = isoZones(s);
          for (let j = 0; j < 3; j++) {
            if (j === s.ball || zs[j] === s.zones[j]) continue;
            const mt = this.att(j), q = ZONES[zs[j]];
            W.dots(this.routeCurve(mt.x, mt.y, q.x, q.y, this.def(j)), '#7ef0c0', 0.06, 0.3, 1.2);
            W.floorRing(w3(q.x, q.y), '#7ef0c0', 0.45, false);
          }
          W.floorRing(A, '#3ddc97', 1.3);
          W.floorRing(this.pos3(this.def(s.ball)), '#ff4d6d', 0.7, false);
          lab('room', A.clone().add(new Vector3(0, 3.0, 0)));
          lab('held', A.clone().add(new Vector3(0, 2.4, 0)).addScaledVector(side, -1.2));
          lab('steal', this.pos3(this.def(s.ball), 2.5));
          break;
        }
        if (a.t === 'handoff') {
          W.dots(this.routeCurve(c.x, c.y, h.x + (c.x - h.x) * 0.25, h.y + (c.y - h.y) * 0.25, this.def(a.who)), '#7ef0c0', 0.08, 0.3, 1.4);
          W.floorRing(this.pos3(c), '#3ddc97', 0.8);
          W.floorRing(this.pos3(this.def(a.who)), '#ff4d6d', 0.7, false);
          lab('beat', this.pos3(c, 2.8));
          lab('catch', A.clone().add(new Vector3(0, 2.6, 0)));
          lab('steal', this.pos3(this.def(s.ball), 2.5).addScaledVector(side, 0.9));
          break;
        }
        if (a.t === 'pop') {
          const hd = this.def(s.ball);
          const scr = this.screenSpot(hd, h);
          W.dots(new CatmullRomCurve3([this.pos3(c, 0.08), w3(scr.x, scr.y, 0.08)]), '#7ef0c0', 0.07, 0.28, 1.3);
          W.wall(w3(scr.x, scr.y), toHoop, '#7ef0c0', 0.8, 1.2, 0.1);
          W.dots(this.routeCurve(scr.x, scr.y, z.x, z.y, hd), '#c3a6ff', 0.08, 0.3, 1.4);
          W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
          lab('open', w3(z.x, z.y, 0.6));
          lab('covered', this.pos3(this.def(a.who), 2.4));
          lab('steal', this.pos3(hd, 2.6).addScaledVector(side, 0.9));
          break;
        }
        if (a.t === 'giveandgo') {
          const mate = this.att(gngPartner(s));
          const M = this.pos3(mate, 1.2);
          W.dots(new ArcCurve(this.hand(h), M, 0.3), '#9be7ff', 0.06, 0.3, 1.3);
          W.dots(this.routeCurve(h.x, h.y, z.x, z.y, this.def(s.ball)), '#7ef0c0', 0.08, 0.3, 1.4);
          W.dots(new ArcCurve(M, w3(z.x, z.y, 1.2), 0.3), '#9be7ff', 0.06, 0.3, 1.3);
          W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
          lab('open', w3(z.x, z.y, 0.6));
          lab('covered', A.clone().add(new Vector3(0, 2.6, 0)));
          lab('pick', this.pos3(mate, 2.6));
          break;
        }
        const cd = this.def(a.who);
        const route = a.t === 'backdoor' ? this.backdoorCurve(c.x, c.y, z.x, z.y) : this.routeCurve(c.x, c.y, z.x, z.y, cd);
        W.dots(route, a.t === 'backdoor' ? '#c3a6ff' : '#7ef0c0', 0.08, 0.3, 1.4);
        if (a.t === 'screen') {
          const sc = this.att(screenerFor(s, a.who));
          const spot = this.screenSpot(cd, c);
          W.dots(new CatmullRomCurve3([this.pos3(sc, 0.08), w3(spot.x, spot.y, 0.08)]), '#ffd166', 0.06, 0.26, 1.2);
          W.wall(w3(spot.x, spot.y), new Vector3(z.x - c.x, 0, z.y - c.y).normalize(), '#ffd166', 0.8, 1.2, 0.1);
          lab('slip', this.pos3(sc, 2.6));
        }
        W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
        W.floorRing(this.pos3(cd), '#ff4d6d', 0.7, false);
        lab('open', w3(z.x, z.y, 0.6));
        lab('covered', this.pos3(cd, 2.4));
        lab('steal', A.clone().add(new Vector3(0, 2.8, 0)));
        break;
      }
    }
  }

  private previewStance(opt: OptionInfo, lab: (k: string, p: Vector3) => void) {
    const s = this.poss!;
    const W = this.world;
    const dm = opt.dm!;
    const st = famOf(dm);
    const color = FAM_COLOR[st];
    for (let i = 0; i < 3; i++) {
      const p = this.defSpot(s, i, dm);
      W.floorRing(w3(p.x, p.y), color, 0.55);
      const d = this.def(i);
      W.dots(new CatmullRomCurve3([this.pos3(d, 0.06), w3(p.x, p.y, 0.06)]), color, 0.06, 0.28, 1.2);
    }
    const h = this.att(s.ball);
    const H = this.pos3(h);
    if (st === 'press') W.floorRing(H, '#f72585', dm === 'hawk' ? 1.6 : 1.25);
    if (dm === 'hawk') {
      // Hands in the lanes: arrows from the off-ball defenders toward the passing lanes.
      for (let j = 0; j < 3; j++) {
        if (j === s.ball) continue;
        const a = this.att(j);
        const mid = { x: (a.x + h.x) / 2, y: (a.y + h.y) / 2 };
        W.dots(new CatmullRomCurve3([this.pos3(this.def(j), 0.06), w3(mid.x, mid.y, 0.06)]), '#ff4d6d', 0.05, 0.25, 1.6);
      }
    }
    if (st === 'space') W.floorRing(w3(HOOP.x, HOOP.y + 1.4), '#4cc9f0', dm === 'float' ? 2.3 : 1.6, false);
    if (dm === 'recover') {
      for (let j = 0; j < 3; j++) {
        if (j === s.ball) continue;
        const a = this.att(j);
        W.dots(new ArcCurve(w3(HOOP.x, HOOP.y + 1.6, 0.06), this.pos3(a, 0.06), 0.25), '#8fe3ff', 0.05, 0.3, 1.2);
      }
    }
    if (st === 'deny') {
      for (let j = 0; j < 3; j++) {
        if (j === s.ball) continue;
        W.dots(new ArcCurve(this.hand(h), this.pos3(this.att(j), 1.2), 0.3), '#ff4d6d', dm === 'jump' ? 0.08 : 0.05, 0.4, 0.6);
      }
      if (dm === 'switch') {
        const ds = [0, 1, 2].filter((j) => j !== s.ball).map((j) => this.defSpot(s, j, dm));
        W.dots(new ArcCurve(w3(ds[0].x, ds[0].y, 0.06), w3(ds[1].x, ds[1].y, 0.06), 0.4), '#ffd166', 0.06, 0.3, 1.4);
        W.dots(new ArcCurve(w3(ds[1].x, ds[1].y, 0.06), w3(ds[0].x, ds[0].y, 0.06), 0.8), '#ffd166', 0.06, 0.3, 1.4);
      }
    }
    const ob = this.defSpot(s, s.ball, dm);
    const toward = new Vector3(HOOP.x - h.x, 0, HOOP.y - h.y).normalize();
    if (dm === 'contest') W.wall(w3(ob.x, ob.y), toward, '#ff4d6d', 1.0, 0.9, 2.4);
    if (dm === 'rim') { W.wall(w3(HOOP.x, HOOP.y + 0.9), toward, '#4cc9f0', 1.2, 0.9, 2.8); W.floorRing(w3(HOOP.x, HOOP.y + 0.9), '#4cc9f0', 1.1, false); }
    if (dm === 'charge') { W.wall(w3(ob.x, ob.y), toward, '#ffd166', 1.1, 1.2, 0.15); W.dots(new CatmullRomCurve3([H.clone().setY(0.08), w3(ob.x, ob.y, 0.08)]), '#ffd166', 0.07, 0.3, 1.2); }
    lab('ball', H.clone().add(new Vector3(0, 2.9, 0)));
    lab('beat', RIM.clone().add(new Vector3(0, 0.75, 0)));
    lab('held', H.clone().add(new Vector3(1.3, 1.6, 0)));
  }

  /** Destination rings for a category and technique (tap targets in the world). */
  showCategory(kind: ActKind | null, group?: string) {
    if (this.phase !== 'decide' || this.previewId) return;
    const W = this.world;
    W.clearPreview();
    if (!kind) { this.camDuel(); return; }
    const s = this.poss!;
    const P: ScenePt[] = [...this.pts(this.att(s.ball)), ...this.pts(this.def(s.ball))];
    for (const o of this.opts) {
      if (o.kind !== kind || o.disabled || !o.act || (group && o.group !== group)) continue;
      if (kind === 'shoot') { P.push(...this.rimPts()); continue; }
      const p = this.targetPos(o.act);
      if (!p) continue;
      W.floorRing(w3(p.x, p.y), o.act.k === 'cut' ? '#7ef0c0' : '#ffffff', 0.6);
      P.push(...this.pts(p));
    }
    this.world.frame(P, 3, 14);
  }

  /** Court point that identifies an option (receiver, destination, or the mover for picks). */
  private targetPos(a: Act): { x: number; y: number } | null {
    if (a.k === 'pass') return this.att(a.to);
    if (a.k === 'drive') return ZONES[a.z];
    if (a.k === 'cut') return a.t === 'pnr' || a.t === 'handoff' || a.t === 'pop' ? this.att(a.who) : ZONES[a.z];
    return null;
  }

  /** The player who performs an action (shooter, passer, driver, the mover of a play). */
  private spActor(a: Act): Ent {
    const s = this.poss!;
    if (a.k === 'cut' && !['giveandgo', 'iso', 'handoff'].includes(a.t)) return this.att(a.who);
    return this.att(s.ball);
  }

  /**
   * Option under a tap, in canvas pixels: the tap can land on the ring or on the player's sprite above it.
   * Prefers the given kind and technique.
   */
  optionAt(x: number, y: number, kind: ActKind | null, group?: string): string | null {
    if (this.phase !== 'decide' || !this.userAttacks) return null;
    let best: string | null = null, bd = 1e9;
    for (const o of this.opts) {
      if (!o.act || o.disabled || (kind && o.kind !== kind) || (group && o.group !== group)) continue;
      const p = this.targetPos(o.act);
      if (!p) continue;
      const q = this.world.screenOf(p.x, p.y);
      if (x < q.x - 12 || x > q.x + 12 || y < q.y - 34 || y > q.y + 8) continue;
      const d = dist(q.x, q.y - 10, x, y);
      if (d < bd) { bd = d; best = o.id; }
    }
    return best;
  }

  onPick: ((x: number, y: number) => void) | null = null;
  private onCanvasDown = (e: PointerEvent) => {
    if (this.phase !== 'decide' || !this.userAttacks) return;
    const p = this.world.pickScreen(e.clientX, e.clientY);
    if (!p) return;
    this.onPick?.(p.x, p.y);
  };

  /** Spot where a screener stands: on the defender's side, between defender and the player screened for. */
  private screenSpot(def: Ent, forWho: Ent) {
    return { x: def.x + (forWho.x - def.x) * 0.35, y: def.y + (forWho.y - def.y) * 0.35 };
  }

  private driveCurve(t: TechId, x0: number, y0: number, x1: number, y1: number, around: Ent): Curve<Vector3> {
    if (t === 'cross') {
      // Fake one way, go the other: a zigzag start.
      const mid = this.routeMid(x0, y0, x1, y1, around);
      const dx = x1 - x0, dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const s = (mid.x - (x0 + x1) / 2) * nx + (mid.y - (y0 + y1) / 2) * ny > 0 ? -1 : 1;
      const p1 = { x: x0 + dx * 0.15 + nx * s * 0.8, y: y0 + dy * 0.15 + ny * s * 0.8 };
      return new CatmullRomCurve3([w3(x0, y0, 0.08), w3(p1.x, p1.y, 0.08), w3(mid.x, mid.y, 0.08), w3(x1, y1, 0.08)]);
    }
    if (t === 'spin') {
      const mid = this.routeMid(x0, y0, x1, y1, around);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const k = i / 24;
        const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
        let x = a * x0 + b * mid.x + c * x1, y = a * y0 + b * mid.y + c * y1;
        if (k > 0.3 && k < 0.7) { const q = (k - 0.3) / 0.4 * Math.PI * 2; x += Math.sin(q) * 0.5; y += (1 - Math.cos(q)) * 0.35; }
        pts.push(w3(x, y, 0.08));
      }
      return new CatmullRomCurve3(pts);
    }
    return this.routeCurve(x0, y0, x1, y1, around);
  }

  /** Backdoor: the route dips toward the baseline behind the defender. */
  private backdoorCurve(x0: number, y0: number, x1: number, y1: number) {
    const mid = { x: (x0 + x1) / 2, y: Math.min(y0, y1) - 0.9 };
    return new CatmullRomCurve3([w3(x0, y0, 0.08), w3(mid.x, Math.max(0.6, mid.y), 0.08), w3(x1, y1, 0.08)]);
  }

  private routeCurve(x0: number, y0: number, x1: number, y1: number, around: Ent) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const sideSign = (around.x - mx) * nx + (around.y - my) * ny > 0 ? -1 : 1;
    const bend = Math.min(1.2, l * 0.18);
    const mid = { x: mx + nx * sideSign * bend, y: my + ny * sideSign * bend };
    const pts = [0, 0.25, 0.5, 0.75, 1].map((k) => {
      const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
      return w3(a * x0 + b * mid.x + c * x1, a * y0 + b * mid.y + c * y1, 0.08);
    });
    return new CatmullRomCurve3(pts);
  }

  private routeMid(x0: number, y0: number, x1: number, y1: number, around: Ent) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const sideSign = (around.x - mx) * nx + (around.y - my) * ny > 0 ? -1 : 1;
    const bend = Math.min(1.2, l * 0.18);
    return { x: mx + nx * sideSign * bend, y: my + ny * sideSign * bend };
  }

  // ---------------------------------------------------------------- resolution
  confirm(id: string) {
    if (this.phase !== 'decide') return;
    const opt = this.opts.find((o) => o.id === id);
    if (!opt || opt.disabled) return;
    const s = this.poss!;
    const m = this.mu;
    let act: Act, dm: TechId;
    if (this.userAttacks) {
      act = opt.act!;
      const st = sampleStance(this.plan!.dist, this.rand());
      dm = this.plan!.v[st];
      this.model.observe(m, s, this.plan!, act);
    } else {
      dm = opt.dm!;
      act = sampleWeighted(this.attDist!, this.rand());
      this.habits.addStance(dm);
      this.stats.defHint = 1;
    }
    const list = branches(m, s, act, dm);
    const step = this.userAttacks ? this.tutStep() : null;
    let r = this.rand();
    if (step) {
      // Guided lesson: land the roll on the outcome being taught (the odds shown are unchanged).
      let acc = 0;
      for (const b of list) {
        if (b.ev === step.outcome) { r = acc + b.p / 2; break; }
        acc += b.p;
      }
    }
    const b = pickBranch(list, r);
    this.decisions++;
    this.stepIdx++;
    this.bump(`${this.userAttacks ? 'att' : 'def'}:${act.k}:${b.ev}`);
    this.bump(`tech:${act.t}`);
    this.bump(`dm:${dm}`);
    this.lastRes = { act, dm, ev: b.ev, text: explain(act, dm, b, this.userAttacks) };
    this.lastDuel = this.duelInfo(s, act, dm, b);
    this.pushHud();
    const handler = this.att(s.ball);
    this.lines[handler.pl.uid].duels++;
    const good = b.ev === 'make' || b.ev === 'and1' || b.ev === 'beat' || b.ev === 'room' || b.ev === 'help' || b.ev === 'open' || b.ev === 'slip' || b.ev === 'catch' || b.ev === 'feed';
    if (good) this.lines[handler.pl.uid].duelsWon++;
    // Fire: a special spends the meter; duels won fill it, turnovers drain it.
    const off = this.offense, before = [...this.heat];
    if (act.sp) { this.heat[off] -= FIRE.cost; this.spent = true; this.bump(`sp:${act.sp}`); }
    const fd = fireDelta(b.ev);
    this.heat[off] = clamp(this.heat[off] + fd.att, 0, FIRE.max);
    this.heat[1 - off] = clamp(this.heat[1 - off] + fd.def, 0, FIRE.max);
    for (const t of [0, 1] as const) if (this.heat[t] >= FIRE.cost && before[t] < FIRE.cost) this.later(1.4, () => { if (t === 0) sfx.levelUp(); this.hooks.banner('FIRE READY', '#ffb02e', t === 0 ? 'Your specials are on' : 'Their specials are on'); });
    this.world.clearPreview();
    this.world.clearMarks();
    this.hooks.decision(false);
    this.phase = 'resolve';
    this.focusAct(act);
    this.resolve(s, act, dm, b);
  }

  /** "Your Block beats their Dunk": both moves, who won, and why. */
  private duelInfo(s: Poss, act: Act, dm: TechId, b: Branch): DuelInfo {
    const zk = ZONES[s.zones[s.ball]].kind;
    const att = { name: moveName(act.t, act.k === 'shoot' ? zk : undefined, act.sp), icon: act.sp ? 'fire' : moveIcon(act.t, act.k === 'shoot' ? zk : undefined) };
    const def = { name: defName(dm), icon: TECHS[dm].icon };
    const attGood = ['make', 'and1', 'beat', 'room', 'help', 'open', 'slip', 'feed', 'oreb'].includes(b.ev);
    const neutral = ['held', 'covered', 'stopped', 'catch'].includes(b.ev);
    const you = this.userAttacks ? att : def, them = this.userAttacks ? def : att;
    const res: DuelInfo['res'] = neutral ? 'even' : attGood === this.userAttacks ? 'win' : 'lose';
    const outcome: Partial<Record<Ev, string>> = {
      make: 'Bucket', and1: 'Bucket plus a foul shot', miss: 'Missed', oreb: 'Missed, offensive board', block: 'Blocked',
      steal: 'Stolen', pick: 'Pass picked off', charge: 'Offensive foul (charge)', beat: 'Got past', room: 'Made room',
      help: 'Help came, a mate is free', open: 'Open', slip: 'Screener free', feed: 'Open catch', held: 'Held', covered: 'Covered',
      stopped: 'Stopped', catch: 'Caught',
    };
    const word = outcome[b.ev] ?? '';
    const head = res === 'win' ? `Your ${you.name} beats their ${them.name}` : res === 'lose' ? `Their ${them.name} beats your ${you.name}` : `${you.name} vs ${them.name}: even`;
    const big = RESULT_WORD[b.ev];
    return { you, them, res, head: `${head}. ${word}.`, why: this.lastRes!.text, word: big.w, icon: big.i, pts: b.ev === 'make' || b.ev === 'and1' ? b.pts : 0 };
  }

  private resolve(s: Poss, act: Act, dm: TechId, b: Branch) {
    const userAtt = this.userAttacks;
    const tone = (ev: Ev): Tone => {
      const attGood = ev === 'make' || ev === 'and1' || ev === 'beat' || ev === 'room' || ev === 'help' || ev === 'open' || ev === 'slip' || ev === 'catch' || ev === 'feed' || ev === 'oreb';
      const neutral = ev === 'held' || ev === 'covered' || ev === 'stopped';
      if (neutral) return 'mid';
      return attGood === userAtt ? 'good' : 'bad';
    };
    const t = tone(b.ev);
    // 1. Reveal the defensive move: the defense slides into it, its icon pops over the on-ball defender.
    const onBallDef = this.def(s.ball);
    const st = famOf(dm);
    this.world.callout(this.pos3(onBallDef, 2.8), `${icon(TECHS[dm].icon, 24)}<small>${defName(dm).toUpperCase()}</small>`, `move ${st}`);
    this.layout({ ...s, adv: s.adv }, dm, 0.4, s.adv.map((x, i) => (x > 0 ? this.def(i) : null)).filter((x): x is Ent => !!x));
    sfx.duel();
    // 2. A special: cut-in card and speed lines, then the action in slow motion with fire.
    if (act.sp) {
      const sd = SPECIALS[act.sp];
      const actor = this.spActor(act);
      this.cine = sd;
      this.hooks.special?.(sd, actor.pl, actor.team);
      this.world.cutInLines(0.8);
      this.world.aura(actor.i, sd.fx, 3.2);
      sfx.levelUp();
      const pre = this.o.reduceFx ? 0.6 : 1.1;
      this.later(pre, () => {
        this.world.cinematic(actor.x, actor.y, 1.4, 1.5);
        if (!this.o.reduceFx) this.slow = 0.9;
        this.world.ballTrail(sd.fx);
        this.animateAction(s, act, dm, b, t);
        // Impact: the special lands (or fails) with a burst on the actor.
        this.later(0.75, () => {
          const good = t === 'good' ? true : t === 'bad' ? !this.userAttacks : false;
          if (b.ev !== 'make' && b.ev !== 'and1') this.world.burst(actor.x, actor.y, 1.2, sd.fx, good || this.userAttacks === (t === 'good') ? 1 : 0.5);
        });
      });
      return;
    }
    // 2. The technique name over the attacker, then the action.
    if (!TECHS[act.t].base) {
      const who = act.k === 'cut' && act.t !== 'giveandgo' ? this.att(act.who) : this.att(s.ball);
      this.later(0.25, () => this.world.callout(this.pos3(who, 3.1), `${icon(TECHS[act.t].icon, 22)}<small>${TECHS[act.t].name.toUpperCase()}</small>`, 'tech'));
    }
    this.later(0.5, () => this.animateAction(s, act, dm, b, t));
  }

  private animateAction(s: Poss, act: Act, dm: TechId, b: Branch, tone: Tone) {
    const h = this.att(s.ball);
    const hd = this.def(s.ball);
    const say = (delay: number) => this.later(delay, () => { this.hooks.explain(this.lastRes!.text, tone); if (this.lastDuel) this.hooks.duel?.(this.lastDuel); });
    const next = (delay: number) => this.later(delay, () => this.afterAction(b));
    const stance = famOf(dm);
    switch (act.k) {
      case 'shoot': {
        const pts = b.pts;
        this.faceTo(h, HOOP.x, HOOP.y);
        let lead = 0;
        const sd = act.sp ? SPECIALS[act.sp] : null;
        const zk = ZONES[s.zones[s.ball]].kind;
        if (b.ev === 'charge') { this.animateCharge(s, h, hd, tone, say, next, true); break; }
        // Sprite for the shot: every shot type has its own pack animation. A dunk is the player's own dunk
        // (standing at the post, a flying one from the elbow); a layup special dunks when it goes in.
        const spDunk = !!sd && act.t === 'layup' && (b.ev === 'make' || b.ev === 'and1');
        const dunk = act.t === 'dunk' || spDunk;
        const running = dunk && zk !== 'close';
        const tag = sd ? (spDunk || act.t !== 'layup' ? sd.anim : b.ev === 'block' ? 'Layup' : 'Double_Clutch')
          : act.t === 'dunk' ? this.dunkTag(h, running)
          : act.t === 'layup' ? (b.ev === 'and1' ? 'Double_Clutch' : 'Layup')
          : act.t === 'fade' ? 'Fadeaway_Left' : act.t === 'floater' ? 'Floater' : act.t === 'bank' ? 'Jumpshot' : zk === 'three' ? 'Jumpshot_2' : 'Jumpshot';
        const ms = sd ? (sd.anim === 'Dunk_3' || sd.anim === 'Fake_Fadeaway_Right' ? 55 : 70) : dunk ? (running ? 55 : 65) : act.t === 'fade' ? 75 : act.t === 'layup' ? 80 : 70;
        const wind = Math.max(1, releaseIndex(tag)) * ms / 1000;
        const toRim = act.t === 'layup' || dunk;
        if (toRim) {
          // Steps to the rim, then a high finish (right under the rim for a dunk; a long run from the elbow).
          const k = dunk ? 0.12 : 0.35;
          const near = { x: HOOP.x + (h.x - HOOP.x) * k, y: HOOP.y + (h.y - HOOP.y) * k };
          const dur = running ? 0.6 : 0.4;
          h.fast = true;
          this.glide(h, near.x, near.y, dur);
          if (dm !== 'rim') this.glide(hd, hd.x + (near.x - hd.x) * 0.6, hd.y + (near.y - hd.y) * 0.6, dur);
          lead = dur - 0.02;
          if (dunk && !sd) { this.world.aura(h.i, 'fire', lead + wind + 0.4); this.world.ballTrail('fire'); }
        } else if (act.t === 'fade') {
          const l = dist(h.x, h.y, HOOP.x, HOOP.y) || 1;
          this.later(0.2, () => this.glide(h, h.x + ((h.x - HOOP.x) / l) * 0.9, h.y + ((h.y - HOOP.y) / l) * 0.9, 0.6));
        }
        this.later(lead, () => {
          h.fast = false;
          this.faceTo(h, HOOP.x, HOOP.y);
          this.play(h, tag, ms);
          this.jump(h, dunk ? (running ? 1.05 : 0.9) : act.t === 'layup' ? 0.75 : act.t === 'fade' ? 0.55 : 0.45, dunk ? 0.75 : act.t === 'fade' ? 0.75 : 0.6);
          h.armsT = 0.5;
          // A dunk in slow motion, the camera on the rim (skipped with reduced effects).
          if (dunk && !sd && !this.o.reduceFx) { this.slow = Math.max(this.slow, 0.55); this.world.cinematic(HOOP.x, HOOP.y + 0.5, 2.0, 1.1); this.fxOn = true; }
        });
        // The defender's answer, with its own animation: Contest = hand up (Block_2), Block = wait at the rim
        // and swat (Block_1, Block_3 on a block), Press = jump at the shot.
        const swat = b.ev === 'block';
        const defTag = swat ? (dm === 'rim' || dunk ? 'Block_3' : 'Block_1') : dm === 'contest' ? 'Block_2' : dm === 'rim' && toRim ? 'Block_1' : stance === 'press' ? 'Block_1' : null;
        if (defTag) {
          this.later(Math.max(0, lead + wind - (dm === 'rim' ? 0.3 : 0.24)), () => {
            this.faceTo(hd, h.x, h.y);
            if (dm === 'rim' && toRim) this.glide(hd, HOOP.x + (h.x - HOOP.x) * 0.3, HOOP.y + (h.y - HOOP.y) * 0.3 + 0.2, 0.2);
            this.play(hd, defTag, 70);
            this.jump(hd, dm === 'rim' ? 0.85 : 0.55, 0.6);
            hd.armsT = 0.6;
          });
        }
        this.holder = null;
        this.shooter = h;
        this.looseBall = this.hand(h, 2.0);
        this.later(lead + wind, () => {
          const from = dunk ? w3(HOOP.x + (h.x - HOOP.x) * 0.3, HOOP.y + (h.y - HOOP.y) * 0.3, RIM_H + 0.45) : this.hand(h, act.t === 'layup' ? 2.5 : 2.1);
          const d = dist(h.x, h.y, HOOP.x, HOOP.y);
          const apex = dunk ? 0 : act.t === 'fade' ? shotApex(d) + 0.8 : act.t === 'layup' ? 0.35 : act.t === 'floater' ? shotApex(d) + 1.2 : sd ? shotApex(d) + 1.4 : shotApex(d);
          const dur = dunk ? 0.14 : act.t === 'layup' ? 0.4 : 0.75 + d * 0.035;
          // Bank shots go off the glass first.
          const viaBoard = (to: Vector3, onLand: () => void) => {
            if (act.t !== 'bank') { this.fly(from, to, apex, dur, onLand); return; }
            const bp = boardPoint(h.x);
            this.fly(from, bp, apex * 0.8, dur * 0.85, () => { sfx.rim(); this.fly(bp, to, 0.05, 0.18, onLand); });
          };
          if (b.ev === 'block') {
            sfx.clash();
            this.world.shake = dunk ? 0.5 : 0.3;
            this.world.burst(hd.x, hd.y, 2.6, 'spark', dunk ? 0.8 : 0.5);
            if (!this.o.reduceFx) this.slow = Math.max(this.slow, 0.35);
            this.world.callout(this.pos3(hd, 3.0), `${icon('block', 30)}<small>${dunk ? 'STUFFED' : 'BLOCKED'}</small>`, tone);
            const away = { x: clamp(h.x + (h.x - HOOP.x) * 0.25, 1, COURT_W - 1), y: clamp(h.y + 1.8, 1, COURT_H - 1) };
            this.fly(from, w3(away.x, away.y, 0.9), 0.8, 0.5, () => { this.holder = hd; });
            this.later(0.3, () => { this.faceTo(hd, away.x, away.y); this.glide(hd, away.x, away.y, 0.25); this.later(0.25, () => this.play(hd, 'Rebound_3', 70)); });
            say(0.6); next(1.9);
          } else if (b.ev === 'make' || b.ev === 'and1') {
            viaBoard(RIM.clone().add(new Vector3(0, 0.12, 0)), () => {
              this.world.kickNet();
              sfx.swish();
              if (h.team === 0) sfx.cheer();
              this.score[h.team] += pts;
              this.lines[h.pl.uid].pts += pts;
              this.world.shake = sd ? 0.7 : dunk ? 0.6 : act.t === 'layup' ? 0.35 : 0.2;
              if (dunk) { this.world.kickRim(); sfx.clash(); }
              if (sd) { this.world.burst(HOOP.x, HOOP.y, RIM_H, sd.fx, 1.6); this.world.flashNow(); }
              else if (dunk) { this.world.burst(HOOP.x, HOOP.y, RIM_H, 'fire', running ? 1.3 : 1.0); this.world.flashNow('#ffe066', 0.5); }
              else if (pts > 1) this.world.burst(HOOP.x, HOOP.y, RIM_H, 'spark', 0.5);
              const word = b.ev === 'and1' ? 'AND ONE' : dunk ? 'SLAM' : pts > 1 ? 'SPLASH' : '';
              this.world.callout(RIM.clone().add(new Vector3(0, 0.9, 0)), `+${pts}${word ? `<small>${word}</small>` : ''}`, h.team === 0 ? 'good big' : 'bad big');
              this.pushHud();
              this.celebrate(h);
              // And-one: the free throw after the foul (the pack's Free_Throw).
              if (b.ev === 'and1') this.later(0.5, () => { this.play(h, 'Free_Throw', 80); });
              this.fly(RIM.clone(), w3(HOOP.x, HOOP.y + 0.3, 0.2), 0, 0.35, () => { this.looseBall = w3(HOOP.x, HOOP.y + 0.5, 0.2); });
            });
            say(1.2); next(2.4);
          } else {
            const toward = new Vector3(h.x - HOOP.x, 0, h.y - HOOP.y).normalize();
            const front = RIM.clone().addScaledVector(toward, 0.24).add(new Vector3(0, 0.05, 0));
            const reb = b.ev === 'oreb' ? this.att(b.next!.ball) : this.def(this.nearestDefToHoop());
            viaBoard(front, () => {
              this.world.kickRim();
              sfx.rim();
              const spot = { x: clamp(HOOP.x + (reb.x - HOOP.x) * 0.5, 1, COURT_W - 1), y: clamp(HOOP.y + 1.6, 1, COURT_H - 1) };
              this.glide(reb, spot.x, spot.y, 0.45);
              // Offensive boards and defensive boards use different rebound animations from the pack.
              this.later(0.3, () => { this.faceTo(reb, HOOP.x, HOOP.y); this.play(reb, b.ev === 'oreb' ? 'Rebound_2' : 'Rebound_1', 70); });
              this.fly(RIM.clone(), w3(spot.x, spot.y, 1.8), 0.9, 0.5, () => {
                this.jump(reb, 0.35, 0.4);
                this.holder = reb;
                this.world.callout(this.pos3(reb, 2.6), icon('ball', 24), reb.team === 0 ? 'good' : 'bad');
              });
            });
            say(1.3); next(2.6);
          }
        });
        break;
      }
      case 'pass': {
        const to = this.att(act.to);
        this.faceTo(h, to.x, to.y);
        if (act.t === 'nolook') this.faceTo(h, HOOP.x, HOOP.y);
        sfx.pass();
        const B = this.pos3(to, act.t === 'lob' ? 2.3 : 1.2);
        const d = dist(h.x, h.y, to.x, to.y);
        // Wind-up on the sprite: a push pass (Jab frames) or an overhead throw for the lob.
        const ptag = act.t === 'lob' || act.t === 'skip' ? 'Free_Throw' : 'Jab';
        const ri = releaseIndex(ptag);
        const wait = (ri > 0 ? ri : 3) * 0.06;
        this.play(h, ptag, 60);
        this.shooter = h;
        this.holder = null;
        const throwNow = (target: Vector3, onLand: () => void, frac = 1) => this.later(wait, () => throwTo(target, onLand, frac));
        const throwTo = (target: Vector3, onLand: () => void, frac = 1) => {
          const from = this.hand(h);
          if (act.t === 'bounce') {
            const mid = from.clone().lerp(target, 0.55 * Math.min(1, 1 / frac)).setY(0.12);
            this.fly(from, mid, 0.05, 0.16 + d / 30, () => this.fly(mid, target, 0.25, 0.14 + d / 30, onLand));
          } else if (act.t === 'lob') {
            this.fly(from, target, 2.2, 0.55 + d / 25, onLand);
          } else if (act.t === 'skip') {
            this.fly(from, target, 1.5, 0.5 + d / 25, onLand);
          } else {
            this.fly(from, target, act.t === 'nolook' ? 0.25 : 0.35, (act.t === 'nolook' ? 0.14 : 0.18) + d / 14, onLand);
          }
        };
        if (b.ev === 'catch' || b.ev === 'feed') {
          if (act.t === 'lob') this.later(wait + 0.3, () => { this.play(to, 'Jump_TwoFeet_Ball', 80); this.jump(to, 0.6, 0.5); to.armsT = 0.5; });
          throwNow(B, () => {
            this.holder = to;
            this.world.callout(this.pos3(to, 2.6), icon(b.ev === 'feed' ? 'up' : 'check', 24), tone);
            if (b.ev === 'feed') { const td = this.def(act.to); td.daze = 1.2; }
          });
          say(0.8 + wait); next(1.8 + wait);
        } else {
          const thief = this.def(act.to);
          const lp = { x: h.x + (to.x - h.x) * 0.6, y: h.y + (to.y - h.y) * 0.6 };
          this.later(wait * 0.5, () => { this.glide(thief, lp.x, lp.y, 0.3); this.play(thief, act.t === 'lob' ? 'Block_1' : 'Steal', 60); });
          this.jump(thief, act.t === 'lob' ? 0.7 : 0.35, 0.45);
          thief.armsT = 0.4;
          throwNow(w3(lp.x, lp.y, act.t === 'lob' ? 2.4 : 1.5), () => {
            sfx.steal();
            this.holder = thief;
            this.lines[thief.pl.uid].steals++;
            this.world.callout(this.pos3(thief, 2.7), icon('steal', 28), tone);
          }, 0.6);
          say(0.8 + wait); next(1.9 + wait);
        }
        break;
      }
      case 'drive': {
        const z = ZONES[act.z];
        if (act.t === 'pumpfake') {
          this.play(h, 'Jump_OneFeet_Ball', 120);
          this.glide(hd, h.x + (HOOP.x - h.x) * 0.1, h.y + (HOOP.y - h.y) * 0.1, 0.2);
          if (b.ev === 'room') {
            this.later(0.15, () => { this.play(hd, dm === 'contest' ? 'Block_2' : 'Block_1', 70); this.jump(hd, dm === 'rim' || dm === 'contest' ? 0.8 : 0.6, 0.6); hd.armsT = 0.6; });
            this.later(0.5, () => this.world.burst(hd.x, hd.y, 0.2, 'wind', 0.4));
            this.later(0.7, () => { hd.daze = 1.4; this.world.callout(this.pos3(h, 2.7), icon('t_pump', 26), tone); });
          } else if (b.ev === 'steal') {
            this.later(0.2, () => this.play(hd, 'Steal', 60));
            this.later(0.35, () => {
              sfx.steal();
              hd.armsT = 0.3;
              this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); });
            });
          } else this.later(0.5, () => this.world.callout(this.pos3(h, 2.5).lerp(this.pos3(hd, 2.5), 0.5), icon('even', 26), 'mid'));
          say(0.9); next(1.9);
          break;
        }
        if (act.t === 'stepback') {
          const l = dist(h.x, h.y, HOOP.x, HOOP.y) || 1;
          const back = { x: h.x + ((h.x - HOOP.x) / l) * 1.1, y: h.y + ((h.y - HOOP.y) / l) * 1.1 };
          this.glide(hd, h.x + (HOOP.x - h.x) * 0.06, h.y + (HOOP.y - h.y) * 0.06, 0.25);
          this.play(h, 'Dribbble_3_Left', 70);
          this.later(0.2, () => this.glide(h, back.x, back.y, 0.3));
          if (b.ev === 'room') {
            hd.daze = 1.4;
            this.later(0.5, () => this.world.callout(this.pos3(h, 2.7), icon('t_stepback', 26), tone));
          } else if (b.ev === 'steal') {
            this.later(0.15, () => this.play(hd, 'Steal', 60));
            this.later(0.3, () => {
              sfx.steal();
              hd.armsT = 0.3;
              this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); });
            });
          } else {
            this.later(0.45, () => { const p = this.defSpot(s, s.ball, 'press'); this.glide(hd, p.x + (back.x - h.x), p.y + (back.y - h.y), 0.3); });
          }
          say(0.9); next(1.9);
          break;
        }
        if (b.ev === 'charge') { this.animateCharge(s, h, hd, tone, say, next, false, act.z); break; }
        const route = this.driveCurve(act.t, h.x, h.y, z.x, z.y, hd);
        const along = (dur: number, until = 1, delay = 0) => {
          const start = { k0: 0 };
          const go = () => { h.anim = { t: 0, dur, path: (k) => { const p = route.getPoint(start.k0 + (until - start.k0) * ease(k)); return { x: p.x + COURT_W / 2, y: p.z + COURT_H / 2 }; } }; };
          if (delay) this.later(delay, go); else go();
        };
        // Dribble move on the sprite; the base drive is a sprint with the ball.
        const moveTag = act.sp ? SPECIALS[act.sp].anim : DRIVE_TAG[act.t] ?? null;
        h.fast = act.t !== 'backdown';
        // Defenders show their move while the drive happens (slide, reach, wait at the rim, plant).
        if (dm === 'hawk' && b.ev !== 'steal') this.later(0.2, () => { this.play(hd, 'Steal', 60); hd.armsT = 0.3; });
        else if (dm === 'charge') this.later(0.1, () => this.play(hd, 'Idle_2', 120));
        if (b.ev === 'beat' || b.ev === 'held' || b.ev === 'help') {
          if (moveTag) this.play(h, moveTag, act.t === 'spin' ? 95 : act.t === 'hesi' ? 100 : act.t === 'backdown' ? 150 : 90);
          if (act.t === 'spin') {
            // Back to the defender (Back_Dribble), then turn and go: the sprite flips mid-move.
            h.face = Math.atan2(h.x - HOOP.x, h.y - HOOP.y);
            this.later(0.3, () => { this.faceTo(h, z.x, z.y); this.world.burst(h.x, h.y, 0.3, 'wind', 0.35); });
          }
          if (act.t === 'backdown') this.later(0.75, () => this.play(h, 'Back_Dribble', 110));
          if (act.t === 'hesi') {
            // Go, freeze, go again.
            h.anim = { t: 0, dur: 0.3, path: (k) => { const p = route.getPoint(0.4 * ease(k)); return { x: p.x + COURT_W / 2, y: p.z + COURT_H / 2 }; } };
            this.later(0.55, () => { h.anim = { t: 0, dur: 0.45, path: (k) => { const p = route.getPoint(0.4 + 0.6 * ease(k)); return { x: p.x + COURT_W / 2, y: p.z + COURT_H / 2 }; } }; });
          } else along(act.t === 'spin' ? 0.95 : act.t === 'backdown' ? 1.3 : 0.75);
          if (b.ev === 'beat') {
            hd.daze = 1.6;
            const lag = { x: hd.x + (z.x - hd.x) * 0.3, y: hd.y + (z.y - hd.y) * 0.3 };
            this.glide(hd, lag.x, lag.y, act.t === 'backdown' ? 1.2 : 0.6);
            // Ankle breaker: a dribble move that wins gets its own beat (trail, dust, a short slow motion).
            const handle = ['cross', 'between', 'behind', 'spin', 'hesi', 'euro'].includes(act.t) && !act.sp;
            if (handle) {
              this.world.aura(h.i, 'wind', 0.9);
              this.later(0.3, () => { this.world.burst(hd.x, hd.y, 0.1, 'wind', 0.6); this.world.shake = 0.15; if (!this.o.reduceFx) this.slow = Math.max(this.slow, 0.3); });
            }
            if (act.t === 'backdown') this.later(0.6, () => { this.world.burst(hd.x, hd.y, 0.1, 'quake', 0.5); this.world.shake = 0.25; });
            this.later(0.4, () => this.world.callout(this.pos3(h, 2.7), `${icon(TECHS[act.t].icon, 28)}${handle ? '<small>ANKLES</small>' : ''}`, tone));
          } else {
            const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === s.ball ? act.z : x)) }, s.ball, 'press');
            this.glide(hd, p.x, p.y, 0.75);
            if (b.ev === 'help' && b.freed !== undefined) {
              const helper = this.def(b.freed);
              const hp = { x: z.x + (HOOP.x - z.x) * 0.25 + (helper.x > z.x ? 0.6 : -0.6), y: z.y + 0.2 };
              this.later(0.25, () => this.glide(helper, hp.x, hp.y, 0.5));
              this.later(0.8, () => this.world.callout(this.pos3(this.att(b.freed!), 2.6), icon('check', 24), userTone(this.userAttacks)));
            }
          }
          sfx.whistle();
          say(1.0); next(2.1);
        } else if (b.ev === 'stopped') {
          const p = { x: h.x + (z.x - h.x) * 0.35, y: h.y + (z.y - h.y) * 0.35 };
          this.glide(h, p.x, p.y, 0.3);
          this.glide(hd, hd.x + (p.x - hd.x) * 0.4, hd.y + (p.y - hd.y) * 0.4, 0.3);
          this.later(0.3, () => { h.fast = false; this.play(h, 'Jab', 60); });
          this.later(0.35, () => { sfx.clash(); this.glide(h, ZONES[s.zones[s.ball]].x, ZONES[s.zones[s.ball]].y, 0.35); this.world.callout(this.pos3(h, 2.5).lerp(this.pos3(hd, 2.5), 0.5), icon('even', 26), 'mid'); });
          say(0.8); next(1.8);
        } else {
          along(0.3, 0.3);
          if (moveTag) this.play(h, moveTag, 90);
          this.glide(hd, h.x + (z.x - h.x) * 0.3 + 0.4, h.y + (z.y - h.y) * 0.3 + 0.2, 0.25);
          hd.armsT = 0.3;
          this.play(hd, 'Steal', 60);
          this.later(0.25, () => {
            sfx.steal();
            this.world.shake = 0.2;
            this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => {
              this.holder = hd;
              this.lines[hd.pl.uid].steals++;
              this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone);
            });
          });
          say(0.8); next(1.9);
        }
        break;
      }
      case 'cut': {
        const z = ZONES[act.z];
        if (act.t === 'pnr') {
          const sc = this.att(act.who);
          const scd = this.def(act.who);
          const spot = this.screenSpot(hd, h);
          this.glide(sc, spot.x, spot.y, 0.4);
          this.glide(scd, spot.x + 0.5, spot.y + 0.3, 0.45);
          this.later(0.45, () => {
            // The handler comes off the screen, the screener rolls.
            const off = { x: h.x + (HOOP.x - h.x) * 0.15 + (spot.x > h.x ? -0.7 : 0.7), y: h.y + (HOOP.y - h.y) * 0.15 };
            this.glide(h, off.x, off.y, 0.4);
            this.glide(sc, z.x, z.y, 0.6, this.routeMid(spot.x, spot.y, z.x, z.y, scd));
            if (b.ev === 'beat') { hd.daze = 1.4; this.later(0.4, () => this.world.callout(this.pos3(h, 2.7), icon('check', 24), tone)); }
            else if (b.ev === 'open') { scd.daze = 1.2; this.later(0.6, () => this.world.callout(this.pos3(sc, 2.6), icon('check', 24), tone)); }
            else if (b.ev === 'steal') {
              hd.armsT = 0.3;
              this.play(hd, 'Steal', 60);
              this.later(0.2, () => { sfx.steal(); this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); }); });
            } else {
              const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === act.who ? act.z : x)) }, act.who, 'press');
              this.glide(scd, p.x, p.y, 0.6);
              if (dm === 'switch') this.world.callout(this.pos3(hd, 2.6).lerp(this.pos3(scd, 2.6), 0.5), icon('t_switch', 24), 'mid');
            }
          });
          say(1.2); next(2.3);
          break;
        }
        if (act.t === 'iso') {
          const zs = isoZones(s);
          for (let j = 0; j < 3; j++) {
            if (j === s.ball || zs[j] === s.zones[j]) continue;
            const q = ZONES[zs[j]];
            this.glide(this.att(j), q.x, q.y, 0.7, this.routeMid(this.att(j).x, this.att(j).y, q.x, q.y, this.def(j)));
            const dp = this.defSpot({ ...s, zones: zs }, j, null);
            this.later(0.1, () => this.glide(this.def(j), dp.x, dp.y, 0.7));
          }
          this.later(0.5, () => this.play(h, 'Pocket_Dribble', 90));
          this.later(0.9, () => {
            if (b.ev === 'room') { this.play(h, 'Crossover', 80); hd.daze = 1.4; this.glide(hd, hd.x + (h.x - hd.x) * -0.3, hd.y + 0.6, 0.4); this.later(0.4, () => this.world.callout(this.pos3(h, 2.7), icon('t_iso', 26), tone)); }
            else if (b.ev === 'steal') {
              this.play(hd, 'Steal', 60); hd.armsT = 0.3;
              this.later(0.2, () => { sfx.steal(); this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); }); });
            } else this.world.callout(this.pos3(h, 2.5).lerp(this.pos3(hd, 2.5), 0.5), icon('even', 26), 'mid');
          });
          say(1.5); next(2.5);
          break;
        }
        if (act.t === 'handoff') {
          const mate = this.att(act.who), md = this.def(act.who);
          const meet = { x: h.x + (mate.x - h.x) * 0.25, y: h.y + (mate.y - h.y) * 0.25 };
          this.glide(mate, meet.x, meet.y, 0.45, this.routeMid(mate.x, mate.y, meet.x, meet.y, md));
          this.glide(md, md.x + (meet.x - md.x) * 0.5, md.y + (meet.y - md.y) * 0.5, 0.5);
          this.later(0.45, () => {
            if (b.ev === 'steal') {
              this.play(hd, 'Steal', 60); hd.armsT = 0.3;
              sfx.steal();
              this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); });
              return;
            }
            this.play(h, 'Jab', 45);
            this.fly(this.hand(h), this.hand(mate), 0.1, 0.12, () => { this.holder = mate; });
            const back = ZONES[s.zones[act.who]];
            mate.fast = true;
            this.later(0.15, () => this.glide(mate, back.x + (HOOP.x - back.x) * 0.15, back.y + (HOOP.y - back.y) * 0.15, 0.55));
            if (b.ev === 'beat') { md.daze = 1.4; this.later(0.6, () => this.world.callout(this.pos3(mate, 2.6), icon('t_handoff', 24), tone)); }
            else this.later(0.3, () => { const p = this.defSpot(s, act.who, 'press'); this.glide(md, p.x, p.y, 0.5); });
          });
          say(1.2); next(2.2);
          break;
        }
        if (act.t === 'pop') {
          const sc = this.att(act.who);
          const scd = this.def(act.who);
          const spot = this.screenSpot(hd, h);
          this.glide(sc, spot.x, spot.y, 0.4);
          this.glide(scd, spot.x + 0.5, spot.y + 0.3, 0.45);
          this.later(0.45, () => {
            const off = { x: h.x + (HOOP.x - h.x) * 0.15 + (spot.x > h.x ? -0.7 : 0.7), y: h.y + (HOOP.y - h.y) * 0.15 };
            this.glide(h, off.x, off.y, 0.4);
            this.glide(sc, z.x, z.y, 0.6, this.routeMid(spot.x, spot.y, z.x, z.y, scd));
            if (b.ev === 'open') { scd.daze = 1.2; this.later(0.6, () => this.world.callout(this.pos3(sc, 2.6), icon('t_pop', 24), tone)); }
            else if (b.ev === 'steal') {
              hd.armsT = 0.3; this.play(hd, 'Steal', 60);
              this.later(0.2, () => { sfx.steal(); this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone); }); });
            } else { const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === act.who ? act.z : x)) }, act.who, 'press'); this.glide(scd, p.x, p.y, 0.6); }
          });
          say(1.2); next(2.3);
          break;
        }
        if (act.t === 'giveandgo') {
          const mate = this.att(gngPartner(s));
          sfx.pass();
          this.play(h, 'Jab', 45);
          this.fly(this.hand(h), this.pos3(mate, 1.2), 0.3, 0.25, () => { this.holder = mate; });
          this.glide(h, z.x, z.y, 0.7, this.routeMid(h.x, h.y, z.x, z.y, hd));
          if (b.ev === 'open') { hd.daze = 1.4; this.glide(hd, hd.x + (z.x - hd.x) * 0.3, hd.y + (z.y - hd.y) * 0.3, 0.6); }
          else { const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === s.ball ? act.z : x)) }, s.ball, 'press'); this.glide(hd, p.x, p.y, 0.7); }
          this.later(0.65, () => {
            sfx.pass();
            const target = w3(z.x, z.y, 1.2);
            if (b.ev === 'pick') {
              const thief = hd;
              const lp = { x: mate.x + (z.x - mate.x) * 0.5, y: mate.y + (z.y - mate.y) * 0.5 };
              this.glide(thief, lp.x, lp.y, 0.25);
              this.play(thief, 'Steal', 60);
              this.play(mate, 'Jab', 45);
              thief.armsT = 0.4;
              this.fly(this.hand(mate), w3(lp.x, lp.y, 1.4), 0.2, 0.25, () => { sfx.steal(); this.holder = thief; this.lines[thief.pl.uid].steals++; this.world.callout(this.pos3(thief, 2.7), icon('steal', 28), tone); });
            } else {
              this.play(mate, 'Jab', 45);
              this.fly(this.hand(mate), target, 0.3, 0.25, () => { this.holder = h; if (b.ev === 'open') this.world.callout(this.pos3(h, 2.6), icon('check', 24), tone); });
            }
          });
          say(1.2); next(2.3);
          break;
        }
        const c = this.att(act.who);
        const cd = this.def(act.who);
        let delay = 0;
        if (act.t === 'screen') {
          const sc = this.att(screenerFor(s, act.who));
          const spot = this.screenSpot(cd, c);
          this.glide(sc, spot.x, spot.y, 0.35);
          delay = 0.35;
          if (b.ev === 'slip' && b.freed !== undefined) {
            this.later(0.75, () => { this.glide(sc, sc.x + (HOOP.x - sc.x) * 0.3, sc.y + (HOOP.y - sc.y) * 0.3, 0.4); this.def(b.freed!).daze = 1.2; });
            this.later(1.0, () => this.world.callout(this.pos3(sc, 2.6), icon('check', 24), userTone(this.userAttacks)));
          }
        }
        if (act.sp) c.fast = true;
        this.later(delay, () => {
          if (act.t === 'backdoor') {
            const curve = this.backdoorCurve(c.x, c.y, z.x, z.y);
            c.anim = { t: 0, dur: 0.75, path: (k) => { const p = curve.getPoint(ease(k)); return { x: p.x + COURT_W / 2, y: p.z + COURT_H / 2 }; } };
          } else this.glide(c, z.x, z.y, 0.7, this.routeMid(c.x, c.y, z.x, z.y, cd));
          if (b.ev === 'open') {
            cd.daze = 1.4;
            this.glide(cd, cd.x + (z.x - cd.x) * 0.25, cd.y + (z.y - cd.y) * 0.25, 0.6);
            this.later(0.6, () => this.world.callout(this.pos3(c, 2.6), icon('check', 24), tone));
          } else {
            const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === act.who ? act.z : x)) }, act.who, 'press');
            this.glide(cd, p.x, p.y, 0.7);
          }
        });
        if (b.ev === 'steal') {
          this.glide(hd, h.x + 0.3, h.y - 0.3, 0.25);
          this.play(hd, 'Steal', 60);
          hd.armsT = 0.3;
          this.later(0.3, () => {
            sfx.steal();
            this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; });
            this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone);
          });
        }
        say(0.9 + delay); next(1.9 + delay);
        break;
      }
    }
  }

  private dunkTag(e: Ent, running: boolean) {
    const n = styleOf(e.pl.tid);
    return running ? RUN_DUNKS[n % RUN_DUNKS.length] : POST_DUNKS[(n >>> 3) % POST_DUNKS.length];
  }

  /** Teammates of a scorer celebrate (the pack's Jump). */
  private celebrate(scorer: Ent) {
    for (const e of this.ents) {
      if (e.team !== scorer.team || e === scorer) continue;
      this.later(0.1 + Math.random() * 0.2, () => { this.play(e, 'Jump', 60); });
    }
  }

  /** Take the charge: the attacker runs into the planted defender, who goes down; offensive foul. */
  private animateCharge(s: Poss, h: Ent, hd: Ent, tone: Tone, say: (d: number) => void, next: (d: number) => void, finish: boolean, z?: Zone) {
    const goal = z ? ZONES[z] : { x: HOOP.x, y: HOOP.y };
    const spot = { x: h.x + (goal.x - h.x) * 0.5, y: h.y + (goal.y - h.y) * 0.5 };
    this.glide(hd, spot.x, spot.y, 0.25);
    this.play(hd, 'Idle_2', 140);
    h.fast = true;
    this.later(0.1, () => { this.play(h, finish ? 'Jump_OneFeet_Ball' : 'Sprint_Ball', 90); this.glide(h, spot.x + (h.x - spot.x) * 0.15, spot.y + (h.y - spot.y) * 0.15, 0.4); });
    this.later(0.5, () => {
      sfx.clash();
      sfx.whistle();
      this.world.shake = 0.4;
      this.world.burst(spot.x, spot.y, 0.2, 'quake', 0.6);
      // The defender takes the hit: knocked back, dazed (the pack has no fall animation).
      const l = Math.hypot(hd.x - h.x, hd.y - h.y) || 1;
      this.glide(hd, hd.x + ((hd.x - h.x) / l) * 0.8, hd.y + ((hd.y - h.y) / l) * 0.8, 0.3);
      hd.daze = 1.2;
      h.fast = false;
      this.world.callout(this.pos3(hd, 2.8), `${icon('t_charge', 28)}<small>CHARGE</small>`, tone);
      this.later(0.4, () => { this.fly(this.hand(h), this.pos3(hd, 1.2), 0.3, 0.3, () => { this.holder = hd; }); });
    });
    void s;
    say(1.0); next(2.1);
  }

  private nearestDefToHoop() {
    let best = 0, bd = 99;
    for (let i = 0; i < 3; i++) { const d = this.def(i); const dd = dist(d.x, d.y, HOOP.x, HOOP.y); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }

  private afterAction(b: Branch) {
    if (this.phase === 'over') return;
    if (this.cine || this.fxOn) { this.cine = null; this.fxOn = false; this.world.endCinematic(); }
    this.world.ballTrail(null);
    if (b.next) {
      this.poss = b.next;
      if (b.ev === 'help' || b.ev === 'slip') this.freed = b.freed ?? null;
      this.holder = this.att(b.next.ball);
      this.flight = null;
      this.looseBall = null;
      this.layout(b.next, this.shownStance, 0.45);
      this.world.overview();
      this.pushHud();
      this.later(0.7, () => this.openDecision());
      return;
    }
    // Possession over.
    this.world.overview();
    this.possN[this.offense]++;
    this.poss = null;
    this.pushHud();
    if (this.o.tutorial) {
      if (this.tutIdx + 1 >= this.o.tutorial.length) { this.finish(); return; }
      this.later(0.3, () => this.startPossession());
      return;
    }
    const [a, c] = this.score;
    const max = MATCH_RULES.maxPoss;
    if (this.score[this.offense] >= MATCH_RULES.winScore || (this.golden && this.possN[0] === this.possN[1] && a !== c)) { this.finish(); return; }
    if (this.possN[0] === this.possN[1] && this.possN[0] >= max) {
      if (a !== c) { this.finish(); return; }
      if (!this.golden) { this.golden = true; sfx.buzzer(); }
    }
    this.offense = (1 - this.offense) as 0 | 1;
    this.later(0.3, () => this.startPossession());
  }

  private finish() {
    this.phase = 'over';
    sfx.buzzer();
    const won = this.score[0] > this.score[1];
    if (this.o.tutorial) {
      this.hooks.banner('READY', '#3ddc97', 'Tutorial complete');
      this.later(1.6, () => this.hooks.end({ score: [...this.score] as [number, number], won: true, lines: this.lines, tutorial: true }));
      return;
    }
    this.hooks.banner(won ? 'VICTORY' : 'DEFEAT', won ? '#3ddc97' : '#ff4d6d', `${this.score[0]} - ${this.score[1]}`);
    this.later(1.8, () => this.hooks.end({ score: [...this.score] as [number, number], won, lines: this.lines }));
  }

  // ---------------------------------------------------------------- loop
  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let k = this.timeScale;
    if (this.slow > 0 && !this.paused) { this.slow -= dt; k *= 0.4; }
    if (!this.paused) this.update(dt * k);
    this.sync(this.paused ? 0 : dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Advance animations and timers (exposed for tests). */
  update(dt: number) {
    const due = this.timers.filter((t) => (t.t -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();
    for (const e of this.ents) {
      if (e.jumpT > 0) e.jumpT = Math.max(0, e.jumpT - dt);
      if (e.armsT > 0) e.armsT = Math.max(0, e.armsT - dt);
      if (e.daze > 0) e.daze = Math.max(0, e.daze - dt);
      e.arms += ((e.armsT > 0 ? 1 : 0) - e.arms) * Math.min(1, dt * 14);
      if (e.anim) {
        e.anim.t += dt;
        const k = Math.min(1, e.anim.t / e.anim.dur);
        const p = e.anim.path(k);
        // Shots keep facing the rim while drifting (fadeaway); everything else faces where it goes.
        if (Math.hypot(p.x - e.x, p.y - e.y) > 0.01 && !(e.act && KEEP_FACE.some((k) => e.act!.tag.startsWith(k)))) e.face = Math.atan2(p.x - e.x, p.y - e.y);
        e.x = p.x; e.y = p.y;
        if (k >= 1) { e.anim = null; e.fast = false; }
      }
      if (e.act) {
        e.act.t += dt;
        if (e.act.t >= e.act.dur) e.act = null;
      }
    }
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      if (f.t >= f.dur) { this.flight = null; this.looseBall = f.curve.b.clone(); f.onLand(); }
    }
  }

  // ---------------------------------------------------------------- sync
  private sync(dt: number) {
    const W = this.world;
    if (this.flight) {
      const f = this.flight;
      f.curve.getPoint(Math.min(1, f.t / f.dur), this.ballPos);
    } else if (this.holder) {
      const h = this.holder;
      const moving = !!h.anim;
      if (this.phase === 'decide' || h.jumpT > 0) this.ballPos.copy(this.hand(h, h.jumpT > 0 ? 2.0 : 1.2));
      else {
        const bounce = Math.abs(Math.sin(performance.now() / 1000 * (moving ? 8 : 5)));
        this.ballPos.copy(this.hand(h, 0.22 + bounce * 0.85));
      }
    } else if (this.looseBall) this.ballPos.copy(this.looseBall);
    W.setBall(this.ballPos, this.flight ? 0.25 : 0.05);
    const s = this.poss;
    const carrier = this.flight ? null : this.shooter ?? this.holder;
    for (const e of this.ents) {
      const moving = Math.hypot(e.x - e.px, e.y - e.py) > 0.004;
      e.px = e.x; e.py = e.y;
      if (this.phase === 'decide' && !e.anim) {
        if (e.team === this.offense) this.faceTo(e, HOOP.x, HOOP.y);
        else this.faceTo(e, this.att(e.slot).x, this.att(e.slot).y);
      }
      const open = !!s && e.team === this.offense && s.adv[e.slot] > 0 && this.phase !== 'resolve';
      W.setPlayer(e.i, {
        x: e.x, y: e.y, face: e.face, moving, fast: e.fast, daze: e.daze > 0, carry: e === carrier,
        defending: e.team !== this.offense, deciding: this.phase === 'decide',
        act: e.act ? { tag: e.act.tag, t: e.act.t, ms: e.act.ms } : null,
        open, showNum: this.phase === 'decide',
        style: styleOf(e.pl.tid), post: !!s && e === this.holder && e.team === this.offense && ZONES[s.zones[e.slot]].kind === 'close' && !e.anim,
      }, dt);
    }
    W.setHandler(this.holder && !this.flight ? this.pos3(this.holder) : null);
    W.render(dt);
  }

  private pushHud() {
    const s = this.poss;
    const h: HudInfo = {
      score: this.score, poss: this.possN, maxPoss: MATCH_RULES.maxPoss, offense: this.offense,
      left: s ? s.left : 0, maxLeft: s && s.rebs > 0 ? TUNE.orebActions : TUNE.actions, golden: this.golden,
      heat: [...this.heat] as [number, number], heatMax: FIRE.max,
    };
    const key = JSON.stringify(h);
    if (key !== this.hudKey) { this.hudKey = key; this.hooks.hud(h); }
  }
}

const userTone = (userAttacks: boolean): Tone => (userAttacks ? 'good' : 'bad');

/** Pack animation of each dribble move. */
const DRIVE_TAG: Partial<Record<TechId, string>> = {
  cross: 'Crossover', between: 'Between', behind: 'Behind_Back', spin: 'Back_Dribble', euro: 'Side_Step', hesi: 'Hesi', backdown: 'Back_Down',
};
/** Animations that keep the facing while the player drifts (fadeaway, back to the basket). */
const KEEP_FACE = ['Fade', 'Back_', 'Dunk', 'Layup'];
/** Each player's own dunks (standing at the post, flying from the elbow), picked by their id. */
const POST_DUNKS = ['Dunk_1', 'Dunk_2', 'Dunk_4', 'Dunk_7'];
const RUN_DUNKS = ['Dunk_3', 'Dunk_5', 'Dunk_6'];
/** Stable small number per player id (animation style). */
export const styleOf = (tid: string) => { let h = 7; for (const c of tid) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h; };

/** Techniques the tutorial team knows on top of the shared move set (dunks, layups, floaters, dribble moves). */
export const TUTORIAL_KITS: [TechId[][], TechId[][]] = [[[], [], []], [[], [], []]];

/** The guided tutorial: three lessons, then one possession without help. */
export const TUTORIAL: TutorialPoss[] = [
  {
    title: 'SPACE: SHOOT', setup: ['wingL', 'top', 'cornerR'], handler: 2, stance: 'space',
    steps: [{ allow: ['shoot'], outcome: 'make', hint: 'Shoot: Three' }],
  },
  {
    title: 'PRESSURE: CROSSOVER, THEN DUNK', setup: ['top', 'wingL', 'wingR'], handler: 0, stance: 'press',
    steps: [
      { allow: ['drive'], techs: ['cross'], zones: ['elbowL', 'elbowR'], outcome: 'beat', hint: 'Dribble: Crossover' },
      { allow: ['shoot'], techs: ['dunk', 'jumper'], outcome: 'make', hint: 'Shoot: Dunk' },
    ],
  },
  {
    title: 'HELP: PASS', setup: ['top', 'cornerL', 'wingR'], handler: 0, stance: 'space',
    steps: [
      { allow: ['drive'], techs: ['drive'], zones: ['elbowL', 'elbowR'], outcome: 'help', hint: 'Dribble: Drive' },
      { allow: ['pass'], techs: ['chest'], toFreed: true, outcome: 'catch', hint: 'Pass: open man' },
      { allow: ['shoot'], outcome: 'make', hint: 'Shoot' },
    ],
  },
  { title: 'YOUR CALL', setup: ['top', 'wingL', 'cornerR'], handler: 0, steps: [] },
];
