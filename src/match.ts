// Turn-based 3x3 match in 3D. Loop: decide -> watch the play -> decide again.
// All rules and odds come from rules.ts (shared with the headless simulator); this file only decides
// what to show: positions, previews, animations and the one-line causal explanation.
import * as THREE from 'three';
import { sfx } from './audio';
import type { Player, Stats } from './data';
import { icon } from './icons';
import {
  actKey, actOdds, aiAttackDist, branches, clamp, explain, Habits, helperFor, legalActs, MATCH_RULES, OpponentModel,
  pickBranch, Planner, readDefense, rng, sampleStance, sampleWeighted, setupPoss, SETUPS, shotChance, STANCES, stanceOdds,
  cutChance, driveChance, pickChance, toPercents, TUNE, ZONES,
  type Act, type ActKind, type Branch, type Ev, type Matchup, type Poss, type Stance, type StanceDist, type Weighted, type Zone,
} from './rules';
import { ArcCurve, COURT_H, COURT_W, HOOP, RIM, World, w3, type PlayerLook } from './world';

export { COURT_W, COURT_H, HOOP };

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
  px: number; py: number;
  face: number;
  daze: number;
  jumpT: number; jumpDur: number; jumpH: number;
  armsT: number; arms: number;
  anim: EntAnim | null;
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
}
export interface PlayerLine { pts: number; duels: number; duelsWon: number; steals: number }
export interface MatchResult { score: [number, number]; won: boolean; lines: Record<string, PlayerLine>; quit?: boolean; tutorial?: boolean }

export type Tone = 'good' | 'mid' | 'bad';
export interface OddsItem { key: string; pct: number; tone: Tone; word: string; icon: string }
export interface Card { gain: string; risk: string; change: string }
export interface OptionInfo {
  id: string;
  kind: ActKind | Stance;
  act?: Act;
  stance?: Stance;
  label: string;
  /** Short destination / target tag for sub-options. */
  tag?: string;
  targetNum?: number;
  odds: OddsItem[];
  main: number;
  card: Card;
  disabled?: boolean;
  hint?: boolean;
}

export interface DecisionInfo {
  side: 'att' | 'def';
  left: number;
  maxLeft: number;
  /** Attack: what the defense tends to do here (exact mix the AI samples from). */
  lean?: StanceDist;
  /** Defense: what the AI attacker tends to do here, by action kind (exact mix it samples from). */
  attLean?: Record<ActKind, number>;
  /** Tutorial: the stance is shown in advance. */
  shown?: Stance;
  hint?: string;
}

export interface MatchHooks {
  hud(h: HudInfo): void;
  decision(open: boolean): void;
  banner(text: string, color: string, sub?: string): void;
  explain(text: string, tone: Tone): void;
  end(r: MatchResult): void;
}

/** One guided step of the tutorial (a decision inside a scripted possession). */
export interface GuideStep {
  allow: ActKind[];
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
  seed?: number;
  /** Show the short first-time hints. */
  hints?: boolean;
}

type Phase = 'intro' | 'decide' | 'resolve' | 'over';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const ease = (k: number) => k * k * (3 - 2 * k);
const shotApex = (d: number) => 0.7 + d * 0.09;
const pct = (p: number) => Math.round(p * 100);
const ONE = (st: Stance): StanceDist => ({ press: 0, space: 0, deny: 0, [st]: 1 });

export const STANCE_LABEL: Record<Stance, string> = { press: 'Press', space: 'Give space', deny: 'Deny pass' };
export const KIND_LABEL: Record<ActKind, string> = { shoot: 'Shoot', pass: 'Pass', drive: 'Drive', cut: 'Cut' };
const STANCE_WORD: Record<Stance, string> = { press: 'PRESS', space: 'SPACE', deny: 'DENY' };

export class Match {
  ents: Ent[] = [];
  phase: Phase = 'intro';
  offense: 0 | 1 = 0;
  poss: Poss | null = null;
  score: [number, number] = [0, 0];
  possN: [number, number] = [0, 0];
  golden = false;
  holder: Ent | null = null;
  flight: Flight | null = null;
  paused = false;
  /** Animation speed multiplier (1 in play; automated tests raise it). */
  timeScale = 1;
  decisions = 0;
  lines: Record<string, PlayerLine> = {};
  world: World;
  /** Event counters (debug / smoke tests). */
  stats: Record<string, number> = {};
  /** Last resolved decision (smoke tests). */
  lastRes: { act: Act; stance: Stance; ev: Ev; text: string } | null = null;

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
  private ballPos = new THREE.Vector3();
  private looseBall: THREE.Vector3 | null = null;
  private dist: StanceDist | null = null;
  private attDist: Weighted<Act>[] | null = null;
  private opts: OptionInfo[] = [];
  private previewId: string | null = null;
  private freed: number | null = null;
  private tutIdx = -1;
  private stepIdx = 0;
  private hudKey = '';
  private shownStance: Stance | null = null;

  constructor(stage: HTMLElement, public teams: [TeamSetup, TeamSetup], private o: MatchOptions, private hooks: MatchHooks) {
    this.rand = rng(o.seed ?? (Date.now() & 0x7fffffff));
    const looks: PlayerLook[] = [];
    teams.forEach((t, ti) => t.players.slice(0, 3).forEach((pl, slot) => {
      this.ents.push({
        i: this.ents.length, pl, team: ti as 0 | 1, slot, x: 7.5, y: 8, px: 7.5, py: 8, face: Math.PI,
        daze: 0, jumpT: 0, jumpDur: 0, jumpH: 0, armsT: 0, arms: 0, anim: null,
      });
      looks.push({ jersey: t.color, shorts: t.shorts, accent: t.accent, skin: pl.skin, hair: pl.hair, num: pl.num, team: ti as 0 | 1 });
      this.lines[pl.uid] = { pts: 0, duels: 0, duelsWon: 0, steals: 0 };
    }));
    const st = (ti: number): Stats[] => teams[ti].players.slice(0, 3).map((p) => p.stats);
    this.m = [{ att: st(0), def: st(1) }, { att: st(1), def: st(0) }];
    this.planners = [new Planner(this.m[0], (s) => readDefense(this.m[0], s)), new Planner(this.m[1], (s) => readDefense(this.m[1], s))];
    this.model = new OpponentModel(this.planners[0]);
    this.smart = o.tutorial ? 0 : clamp(0.2 + o.tier * 0.08, 0, 0.6);
    this.temp = clamp(0.12 - o.tier * 0.015, 0.04, 0.12);
    this.world = new World(stage, looks);
    this.world.renderer.domElement.addEventListener('pointerdown', this.onCanvasDown);
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
  private fly(from: THREE.Vector3, to: THREE.Vector3, apex: number, dur: number, onLand: () => void) {
    this.holder = null;
    this.looseBall = null;
    this.flight = { curve: new ArcCurve(from.clone(), to.clone(), apex), t: 0, dur, onLand };
  }

  /** Where defenders stand for a stance (null = neutral, used while the stance is still hidden). */
  private defSpot(s: Poss, i: number, stance: Stance | null): { x: number; y: number } {
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
      const d = stance === 'press' ? 0.75 : stance === 'space' ? 2.3 : 1.25;
      p = toward(z.x, z.y, HOOP.x, HOOP.y, d);
    } else if (stance === 'deny') {
      const lane = { x: z.x + (b.x - z.x) * 0.28, y: z.y + (b.y - z.y) * 0.28 };
      p = toward(lane.x, lane.y, HOOP.x, HOOP.y, 0.5);
    } else if (stance === 'space') {
      p = { x: z.x + (HOOP.x - z.x) * 0.45, y: z.y + (HOOP.y + 1.2 - z.y) * 0.45 };
    } else {
      const d = stance === 'press' ? 1.3 : 1.7;
      const q = toward(z.x, z.y, HOOP.x, HOOP.y, d);
      p = { x: q.x + (b.x - q.x) * 0.08, y: q.y + (b.y - q.y) * 0.08 };
    }
    return { x: clamp(p.x, 0.5, COURT_W - 0.5), y: clamp(p.y, 0.5, COURT_H - 0.5) };
  }

  private layout(s: Poss, stance: Stance | null, dur: number, skip: Ent[] = []) {
    for (let i = 0; i < 3; i++) {
      const a = this.att(i), d = this.def(i);
      const z = ZONES[s.zones[i]];
      if (!skip.includes(a)) this.glide(a, z.x, z.y, dur);
      const p = this.defSpot(s, i, stance);
      if (!skip.includes(d)) this.glide(d, p.x, p.y, dur);
    }
  }

  private snapLayout(s: Poss, stance: Stance | null) {
    for (let i = 0; i < 3; i++) {
      const a = this.att(i), d = this.def(i);
      const z = ZONES[s.zones[i]];
      a.x = z.x; a.y = z.y; a.anim = null;
      const p = this.defSpot(s, i, stance);
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
    this.freed = null;
    this.holder = this.att(s.ball);
    this.flight = null;
    this.looseBall = null;
    for (const e of this.ents) { e.daze = 0; e.armsT = 0; }
    if (first) this.snapLayout(s, this.shownStance);
    else this.layout(s, this.shownStance, 0.8);
    this.phase = 'intro';
    sfx.whistle();
    this.updateCamera(first);
    this.pushHud();
    this.later(first ? 1.2 : 1.0, () => this.openDecision());
  }

  private openDecision() {
    const s = this.poss!;
    this.phase = 'decide';
    this.previewId = null;
    if (this.userAttacks) {
      if (this.o.tutorial) this.dist = this.shownStance ? ONE(this.shownStance) : readDefense(this.mu, s);
      else this.dist = this.model.defend(this.mu, s, this.smart);
      this.attDist = null;
    } else {
      this.attDist = aiAttackDist(this.planners[1], s, this.habits, this.smart, this.temp);
      this.dist = null;
    }
    this.opts = this.buildOptions();
    for (let i = 0; i < 3; i++) { this.faceTo(this.att(i), HOOP.x, HOOP.y); this.faceTo(this.def(i), this.att(i).x, this.att(i).y); }
    this.updateCamera();
    this.hooks.decision(true);
    this.pushHud();
  }

  private tutStep(): GuideStep | null {
    const t = this.o.tutorial?.[this.tutIdx];
    return t?.steps[this.stepIdx] ?? null;
  }

  decisionInfo(): DecisionInfo | null {
    const s = this.poss;
    if (!s || this.phase !== 'decide') return null;
    const step = this.userAttacks ? this.tutStep() : null;
    return {
      side: this.userAttacks ? 'att' : 'def',
      left: s.left,
      maxLeft: s.rebs > 0 ? TUNE.orebActions : TUNE.actions,
      lean: this.userAttacks ? this.dist ?? undefined : undefined,
      attLean: this.attDist ? this.attDist.reduce((acc, x) => { acc[x.item.k] += x.w; return acc; }, { shoot: 0, pass: 0, drive: 0, cut: 0 } as Record<ActKind, number>) : undefined,
      shown: this.shownStance ?? undefined,
      hint: step?.hint ?? (this.o.hints ? this.firstHint() : undefined),
    };
  }

  private firstHint(): string | undefined {
    if (this.decisions === 0 && this.userAttacks) return 'Pick a move. Odds are exact.';
    if (!this.userAttacks && this.stats.defHint === undefined) return 'Pick a stance. They move at the same time.';
    return undefined;
  }

  options(): OptionInfo[] { return this.opts; }

  // ---------------------------------------------------------------- options & odds
  private buildOptions(): OptionInfo[] {
    const s = this.poss!;
    const m = this.mu;
    if (!this.userAttacks) return this.stanceOptions();
    const dist = this.dist!;
    const step = this.tutStep();
    const out: OptionInfo[] = [];
    const nextShot = (n: Poss, who: number) => {
      // Make chance for `who` in state n against what the defense would do there.
      const d = this.o.tutorial ? (this.shownStance ? ONE(this.shownStance) : readDefense(m, n)) : readDefense(m, n);
      let p = 0;
      for (const st of STANCES) p += d[st] * shotChance(m, n, who, st).make;
      return p;
    };
    for (const a of legalActs(s)) {
      const o = actOdds(m, s, a, dist);
      const pc = toPercents(o);
      const g = (k: Ev) => pc[k] ?? 0;
      let info: OptionInfo;
      switch (a.k) {
        case 'shoot': {
          const pts = ZONES[s.zones[s.ball]].kind === 'three' ? 2 : 1;
          const odds: OddsItem[] = [
            { key: 'make', pct: g('make'), tone: 'good', word: 'IN', icon: 'check' },
            { key: 'miss', pct: g('miss') + g('oreb'), tone: 'mid', word: 'MISS', icon: 'cross' },
            { key: 'block', pct: g('block'), tone: 'bad', word: 'BLOCK', icon: 'block' },
          ];
          info = {
            id: actKey(a), kind: 'shoot', act: a, label: 'Shoot', odds, main: g('make'),
            card: {
              gain: `+${pts} at ${g('make')}%`,
              risk: g('block') >= 3 ? `Block ${g('block')}%` : `Miss ${g('miss') + g('oreb')}%`,
              change: 'Ends the possession',
            },
          };
          break;
        }
        case 'pass': {
          const to = this.att(a.to);
          const n: Poss = { ...s, ball: a.to, adv: s.adv.map((t) => Math.max(0, t - 1)), left: s.left - 1 };
          const then = pct(nextShot(n, a.to));
          const odds: OddsItem[] = [
            { key: 'catch', pct: g('catch'), tone: 'good', word: 'CATCH', icon: 'check' },
            { key: 'pick', pct: g('pick'), tone: 'bad', word: 'PICKED', icon: 'steal' },
          ];
          info = {
            id: actKey(a), kind: 'pass', act: a, label: 'Pass', tag: `#${to.pl.num}`, targetNum: to.pl.num, odds, main: g('catch'),
            card: { gain: `#${to.pl.num} then shoots ${then}%`, risk: `Picked off ${g('pick')}%`, change: s.adv[a.to] > 0 ? 'To the open man' : 'Uses 1 move' },
          };
          break;
        }
        case 'drive': {
          const z = ZONES[a.z];
          const n: Poss = { ...s, zones: s.zones.map((x, j) => (j === s.ball ? a.z : x)), adv: s.adv.map((t, j) => (j === s.ball ? 1 : Math.max(0, t - 1))), left: s.left - 1 };
          const then = pct(shotChance(m, n, s.ball, null).make);
          const helpPossible = z.kind !== 'three' && (dist.space ?? 0) > 0;
          const freedNum = this.att(helperFor(s, a.z)).pl.num;
          const odds: OddsItem[] = [
            { key: 'beat', pct: g('beat'), tone: 'good', word: 'PAST', icon: 'dribble' },
            ...(g('help') > 0 ? [{ key: 'help', pct: g('help'), tone: 'good' as Tone, word: 'MATE FREE', icon: 'pass' }] : []),
            { key: 'held', pct: g('held') + g('stopped'), tone: 'mid', word: 'HELD', icon: 'even' },
            { key: 'steal', pct: g('steal'), tone: 'bad', word: 'STOLEN', icon: 'steal' },
          ];
          info = {
            id: actKey(a), kind: 'drive', act: a, label: 'Drive', tag: z.name, odds, main: g('beat'),
            card: {
              gain: `Past ${g('beat')}%: then ${then}%`,
              risk: `Stolen ${g('steal')}%`,
              change: helpPossible ? `Help may free #${freedNum}` : `To the ${z.name.toLowerCase()}`,
            },
          };
          break;
        }
        case 'cut': {
          const who = this.att(a.who);
          const z = ZONES[a.z];
          const odds: OddsItem[] = [
            { key: 'open', pct: g('open'), tone: 'good', word: 'OPEN', icon: 'check' },
            { key: 'covered', pct: g('covered'), tone: 'mid', word: 'COVERED', icon: 'even' },
            ...(g('steal') > 0 ? [{ key: 'steal', pct: g('steal'), tone: 'bad' as Tone, word: 'STRIPPED', icon: 'steal' }] : []),
          ];
          info = {
            id: actKey(a), kind: 'cut', act: a, label: 'Cut', tag: `#${who.pl.num} ${z.name}`, targetNum: who.pl.num, odds, main: g('open'),
            card: {
              gain: `#${who.pl.num} open ${g('open')}%`,
              risk: g('steal') > 0 ? `Ball stripped ${g('steal')}%` : 'No turnover risk',
              change: `#${who.pl.num} to the ${z.name.toLowerCase()}`,
            },
          };
          break;
        }
      }
      if (step) {
        let ok = step.allow.includes(a.k);
        if (ok && a.k === 'drive' && step.zones) ok = step.zones.includes(a.z);
        if (ok && a.k === 'pass' && step.toFreed) ok = a.to === this.freed;
        info.disabled = !ok;
        info.hint = ok;
      }
      out.push(info);
    }
    return out;
  }

  private stanceOptions(): OptionInfo[] {
    const s = this.poss!;
    const m = this.mu;
    const attDist = this.attDist!;
    const handler = this.att(s.ball);
    const passes = legalActs(s).filter((a): a is Extract<Act, { k: 'pass' }> => a.k === 'pass');
    const cuts = legalActs(s).filter((a): a is Extract<Act, { k: 'cut' }> => a.k === 'cut');
    const bestCut = (st: Stance) => Math.max(0, ...cuts.map((c) => cutChance(m, c.who, st)));
    const bestPick = (st: Stance) => Math.max(0, ...passes.map((p) => pickChance(m, s, p.to, st)));
    return STANCES.map((st) => {
      const o = toPercents(stanceOdds(m, s, st, attDist));
      const odds: OddsItem[] = [
        { key: 'ball', pct: o.ball, tone: 'good', word: 'BALL', icon: 'ball' },
        { key: 'cont', pct: o.cont, tone: 'mid', word: 'GOES ON', icon: 'even' },
        { key: 'score', pct: o.score, tone: 'bad', word: 'SCORE', icon: 'hoop' },
      ];
      const shot = pct(shotChance(m, s, s.ball, st).make);
      const drive = driveChance(m, s, st);
      let card: Card;
      if (st === 'press') card = { gain: `#${handler.pl.num} shoots ${shot}%`, risk: s.left > 1 ? `Drive beats you ${pct(drive.beat)}%` : 'They must shoot now', change: 'Tight on the ball' };
      else if (st === 'space') card = { gain: s.left > 1 ? `Drive held ${pct(1 - drive.beat - drive.steal)}%` : 'Help in the paint', risk: `#${handler.pl.num} shoots ${shot}%`, change: 'Sag and help' };
      else card = { gain: passes.length && s.left > 1 ? `Pass picked ${pct(bestPick(st))}%` : 'Lanes closed', risk: cuts.length && s.left > 1 ? `Backdoor cut ${pct(bestCut(st))}%` : `#${handler.pl.num} shoots ${shot}%`, change: 'Close the lanes' };
      return { id: st, kind: st, stance: st, label: STANCE_LABEL[st], odds, main: o.ball, card };
    });
  }

  // ---------------------------------------------------------------- previews
  preview(id: string | null) {
    if (this.phase !== 'decide' || this.previewId === id) return;
    this.previewId = id;
    const W = this.world;
    W.clearPreview();
    const s = this.poss!;
    if (!id) { this.showCategory(null); this.updateCamera(); return; }
    const opt = this.opts.find((o) => o.id === id);
    if (!opt) return;
    const lab = (k: string, pos: THREE.Vector3) => {
      const o = opt.odds.find((x) => x.key === k);
      if (!o || o.pct <= 0) return;
      W.label({ pos, html: `${icon(o.icon, 16)}<b>${o.pct}%</b><small>${o.word}</small>`, cls: `odds ${o.tone}` });
    };
    const h = this.att(s.ball);
    const A = this.pos3(h);
    const toHoop = new THREE.Vector3(HOOP.x - h.x, 0, HOOP.y - h.y).normalize();
    const side = new THREE.Vector3(-toHoop.z, 0, toHoop.x);
    if (opt.stance) { this.previewStance(opt, lab); this.updateCamera(); return; }
    const a = opt.act!;
    switch (a.k) {
      case 'shoot': {
        const D = this.pos3(this.def(s.ball));
        const from = this.hand(h, 2.1);
        const dd = dist(h.x, h.y, HOOP.x, HOOP.y);
        const curve = new ArcCurve(from, RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), shotApex(dd));
        W.dots(curve, '#ffffff', 0.075, 0.34);
        W.ghostBall(RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), '#3ddc97');
        if (!(s.adv[s.ball] > 0)) W.wall(D.clone().addScaledVector(toHoop, -0.1), toHoop, '#ff4d6d', 1.0, 0.9, 2.0);
        lab('make', RIM.clone().add(new THREE.Vector3(0, 0.75, 0)));
        lab('miss', RIM.clone().addScaledVector(side, 1.3).add(new THREE.Vector3(0, -0.1, 0)));
        lab('block', D.clone().add(new THREE.Vector3(0, 3.0, 0)));
        W.label({ pos: curve.getPoint(0.5).add(new THREE.Vector3(0, 0.35, 0)), html: `<b>+${ZONES[s.zones[s.ball]].kind === 'three' ? 2 : 1}</b>`, cls: 'pts' });
        break;
      }
      case 'pass': {
        const to = this.att(a.to);
        const B = this.pos3(to, 1.2);
        const curve = new ArcCurve(this.hand(h), B, 0.35);
        W.dots(curve, '#9be7ff', 0.07, 0.32, 1.3);
        W.ghostBall(B, '#3ddc97');
        W.floorRing(this.pos3(to), '#3ddc97', 0.8);
        W.floorRing(this.pos3(this.def(a.to)), '#ff4d6d', 0.7, false);
        lab('catch', this.pos3(to, 2.6));
        lab('pick', this.pos3(this.def(a.to), 2.4));
        break;
      }
      case 'drive': {
        const z = ZONES[a.z];
        const route = this.routeCurve(h.x, h.y, z.x, z.y, this.def(s.ball));
        W.dots(route, '#ffd166', 0.09, 0.3, 1.4);
        W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
        W.floorRing(this.pos3(this.def(s.ball)), '#ff4d6d', 0.7, false);
        lab('beat', w3(z.x, z.y, 0.5));
        lab('held', A.clone().add(new THREE.Vector3(0, 2.7, 0)).addScaledVector(side, -0.7));
        lab('steal', this.pos3(this.def(s.ball), 2.5));
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
        const route = this.routeCurve(c.x, c.y, z.x, z.y, this.def(a.who));
        W.dots(route, '#7ef0c0', 0.08, 0.3, 1.4);
        W.floorRing(w3(z.x, z.y), '#3ddc97', 0.65);
        W.floorRing(this.pos3(this.def(a.who)), '#ff4d6d', 0.7, false);
        lab('open', w3(z.x, z.y, 0.6));
        lab('covered', this.pos3(this.def(a.who), 2.4));
        lab('steal', A.clone().add(new THREE.Vector3(0, 2.8, 0)));
        break;
      }
    }
    this.updateCamera();
  }

  private previewStance(opt: OptionInfo, lab: (k: string, p: THREE.Vector3) => void) {
    const s = this.poss!;
    const W = this.world;
    const st = opt.stance!;
    const color = st === 'press' ? '#f72585' : st === 'space' ? '#4cc9f0' : '#ffd166';
    for (let i = 0; i < 3; i++) {
      const p = this.defSpot(s, i, st);
      W.floorRing(w3(p.x, p.y), color, 0.55);
      const d = this.def(i);
      W.dots(new THREE.CatmullRomCurve3([this.pos3(d, 0.06), w3(p.x, p.y, 0.06)]), color, 0.06, 0.28, 1.2);
    }
    const h = this.att(s.ball);
    const H = this.pos3(h);
    if (st === 'press') W.floorRing(H, '#f72585', 1.25);
    if (st === 'space') W.floorRing(w3(HOOP.x, HOOP.y + 1.4), '#4cc9f0', 1.6, false);
    if (st === 'deny') {
      for (let j = 0; j < 3; j++) {
        if (j === s.ball) continue;
        W.dots(new ArcCurve(this.hand(h), this.pos3(this.att(j), 1.2), 0.3), '#ff4d6d', 0.05, 0.4, 0.6);
      }
    }
    lab('ball', H.clone().add(new THREE.Vector3(0, 2.9, 0)));
    lab('score', RIM.clone().add(new THREE.Vector3(0, 0.75, 0)));
    lab('cont', H.clone().add(new THREE.Vector3(1.3, 1.6, 0)));
  }

  /** Destination rings for a category (tap targets in the world). */
  showCategory(kind: ActKind | null) {
    if (this.phase !== 'decide' || this.previewId) return;
    const W = this.world;
    W.clearPreview();
    if (!kind) return;
    for (const o of this.opts) {
      if (o.kind !== kind || o.disabled || !o.act) continue;
      const a = o.act;
      const p = a.k === 'pass' ? this.pos3(this.att(a.to)) : a.k === 'drive' || a.k === 'cut' ? w3(ZONES[a.z].x, ZONES[a.z].y) : null;
      if (!p) continue;
      W.floorRing(p, a.k === 'cut' ? '#7ef0c0' : '#ffffff', 0.6);
      W.label({ pos: p.clone().add(new THREE.Vector3(0, 0.5, 0)), html: `<b>${o.main}%</b>`, cls: 'odds tag' });
    }
  }

  /** Option under a tap on the court (destination rings / receivers). */
  optionAt(x: number, y: number, kind: ActKind | null): string | null {
    if (this.phase !== 'decide' || !this.userAttacks) return null;
    let best: string | null = null, bd = 1.3;
    for (const o of this.opts) {
      if (!o.act || o.disabled || (kind && o.kind !== kind)) continue;
      const a = o.act;
      const p = a.k === 'pass' ? this.att(a.to) : a.k === 'drive' || a.k === 'cut' ? ZONES[a.z] : null;
      if (!p) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = o.id; }
    }
    return best;
  }

  onPick: ((id: string) => void) | null = null;
  private onCanvasDown = (e: PointerEvent) => {
    if (this.phase !== 'decide' || !this.userAttacks) return;
    const p = this.world.pickCourt(e.clientX, e.clientY);
    if (!p) return;
    const id = this.optionAt(p.x, p.y, null);
    if (id) this.onPick?.(id);
  };

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
    return new THREE.CatmullRomCurve3(pts);
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
    let act: Act, stance: Stance;
    if (this.userAttacks) {
      act = opt.act!;
      stance = sampleStance(this.dist!, this.rand());
      this.model.observe(m, s, this.dist!, act);
    } else {
      stance = opt.stance!;
      act = sampleWeighted(this.attDist!, this.rand());
      this.habits.addStance(stance);
      this.stats.defHint = 1;
    }
    const list = branches(m, s, act, stance);
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
    this.lastRes = { act, stance, ev: b.ev, text: explain(act, stance, b, this.userAttacks) };
    const handler = this.att(s.ball);
    this.lines[handler.pl.uid].duels++;
    const good = b.ev === 'make' || b.ev === 'beat' || b.ev === 'help' || b.ev === 'open' || b.ev === 'catch';
    if (good) this.lines[handler.pl.uid].duelsWon++;
    this.world.clearPreview();
    this.hooks.decision(false);
    this.phase = 'resolve';
    this.resolve(s, act, stance, b);
  }

  private resolve(s: Poss, act: Act, stance: Stance, b: Branch) {
    const userAtt = this.userAttacks;
    const tone = (ev: Ev): Tone => {
      const attGood = ev === 'make' || ev === 'beat' || ev === 'help' || ev === 'open' || ev === 'catch' || ev === 'oreb';
      const neutral = ev === 'held' || ev === 'covered' || ev === 'stopped';
      if (neutral) return 'mid';
      return attGood === userAtt ? 'good' : 'bad';
    };
    const t = tone(b.ev);
    // 1. Reveal the stance: the defense slides into it.
    const onBallDef = this.def(s.ball);
    this.world.callout(this.pos3(onBallDef, 2.8), `${icon(stance === 'space' ? 'space' : stance === 'press' ? 'press' : 'deny', 24)}<small>${STANCE_WORD[stance]}</small>`, 'move');
    this.layout({ ...s, adv: s.adv }, stance, 0.4, s.adv.map((x, i) => (x > 0 ? this.def(i) : null)).filter((x): x is Ent => !!x));
    sfx.duel();
    // 2. The action.
    this.later(0.5, () => this.animateAction(s, act, stance, b, t));
  }

  private animateAction(s: Poss, act: Act, stance: Stance, b: Branch, tone: Tone) {
    const h = this.att(s.ball);
    const hd = this.def(s.ball);
    const say = (delay: number) => this.later(delay, () => this.hooks.explain(this.lastRes!.text, tone));
    const next = (delay: number) => this.later(delay, () => this.afterAction(b));
    switch (act.k) {
      case 'shoot': {
        const pts = b.pts;
        this.faceTo(h, HOOP.x, HOOP.y);
        this.jump(h, 0.45, 0.6);
        h.armsT = 0.5;
        if (b.ev === 'block' || stance === 'press') this.later(0.1, () => { this.jump(hd, 0.55, 0.6); hd.armsT = 0.6; this.faceTo(hd, h.x, h.y); });
        this.holder = null;
        this.looseBall = this.hand(h, 2.0);
        const d = dist(h.x, h.y, HOOP.x, HOOP.y);
        this.later(0.22, () => {
          const from = this.hand(h, 2.1);
          if (b.ev === 'block') {
            sfx.clash();
            this.world.shake = 0.3;
            this.world.callout(this.pos3(hd, 3.0), icon('block', 30), tone);
            const away = { x: clamp(h.x + (h.x - HOOP.x) * 0.25, 1, COURT_W - 1), y: clamp(h.y + 1.8, 1, COURT_H - 1) };
            this.fly(from, w3(away.x, away.y, 0.9), 0.8, 0.5, () => { this.holder = hd; });
            say(0.6); next(1.9);
          } else if (b.ev === 'make') {
            this.fly(from, RIM.clone().add(new THREE.Vector3(0, 0.12, 0)), shotApex(d), 0.75 + d * 0.035, () => {
              this.world.kickNet();
              sfx.swish();
              if (h.team === 0) sfx.cheer();
              this.score[h.team] += pts;
              this.lines[h.pl.uid].pts += pts;
              this.world.shake = 0.2;
              this.world.callout(RIM.clone().add(new THREE.Vector3(0, 0.9, 0)), `+${pts}`, h.team === 0 ? 'good big' : 'bad big');
              this.pushHud();
              this.fly(RIM.clone(), w3(HOOP.x, HOOP.y + 0.3, 0.2), 0, 0.35, () => { this.looseBall = w3(HOOP.x, HOOP.y + 0.5, 0.2); });
            });
            say(1.2); next(2.4);
          } else {
            const toward = new THREE.Vector3(h.x - HOOP.x, 0, h.y - HOOP.y).normalize();
            const front = RIM.clone().addScaledVector(toward, 0.24).add(new THREE.Vector3(0, 0.05, 0));
            const reb = b.ev === 'oreb' ? this.att(b.next!.ball) : this.def(this.nearestDefToHoop());
            this.fly(from, front, shotApex(d), 0.75 + d * 0.035, () => {
              this.world.kickRim();
              sfx.rim();
              const spot = { x: clamp(HOOP.x + (reb.x - HOOP.x) * 0.5, 1, COURT_W - 1), y: clamp(HOOP.y + 1.6, 1, COURT_H - 1) };
              this.glide(reb, spot.x, spot.y, 0.45);
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
        sfx.pass();
        if (b.ev === 'catch') {
          this.fly(this.hand(h), this.pos3(to, 1.2), 0.35, 0.18 + dist(h.x, h.y, to.x, to.y) / 14, () => {
            this.holder = to;
            this.world.callout(this.pos3(to, 2.6), icon('check', 24), tone);
          });
          say(0.7); next(1.7);
        } else {
          const thief = this.def(act.to);
          const lp = { x: h.x + (to.x - h.x) * 0.6, y: h.y + (to.y - h.y) * 0.6 };
          this.glide(thief, lp.x, lp.y, 0.3);
          this.jump(thief, 0.35, 0.4);
          thief.armsT = 0.4;
          this.fly(this.hand(h), w3(lp.x, lp.y, 1.5), 0.25, 0.34, () => {
            sfx.steal();
            this.holder = thief;
            this.lines[thief.pl.uid].steals++;
            this.world.callout(this.pos3(thief, 2.7), icon('steal', 28), tone);
          });
          say(0.7); next(1.9);
        }
        break;
      }
      case 'drive': {
        const z = ZONES[act.z];
        const mid = this.routeMid(h.x, h.y, z.x, z.y, hd);
        if (b.ev === 'beat' || b.ev === 'held' || b.ev === 'help') {
          this.glide(h, z.x, z.y, 0.75, mid);
          if (b.ev === 'beat') {
            hd.daze = 1.6;
            const lag = { x: hd.x + (z.x - hd.x) * 0.3, y: hd.y + (z.y - hd.y) * 0.3 };
            this.glide(hd, lag.x, lag.y, 0.6);
            this.later(0.3, () => this.world.callout(this.pos3(h, 2.7), icon('dribble', 28), tone));
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
          say(0.9); next(2.0);
        } else if (b.ev === 'stopped') {
          const p = { x: h.x + (z.x - h.x) * 0.35, y: h.y + (z.y - h.y) * 0.35 };
          this.glide(h, p.x, p.y, 0.3);
          this.glide(hd, hd.x + (p.x - hd.x) * 0.4, hd.y + (p.y - hd.y) * 0.4, 0.3);
          this.later(0.35, () => { sfx.clash(); this.glide(h, ZONES[s.zones[s.ball]].x, ZONES[s.zones[s.ball]].y, 0.35); this.world.callout(this.pos3(h, 2.5).lerp(this.pos3(hd, 2.5), 0.5), icon('even', 26), 'mid'); });
          say(0.8); next(1.8);
        } else {
          const p = { x: h.x + (z.x - h.x) * 0.3, y: h.y + (z.y - h.y) * 0.3 };
          this.glide(h, p.x, p.y, 0.3);
          this.glide(hd, p.x + 0.4, p.y + 0.2, 0.25);
          hd.armsT = 0.3;
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
        const c = this.att(act.who);
        const cd = this.def(act.who);
        const z = ZONES[act.z];
        const mid = this.routeMid(c.x, c.y, z.x, z.y, cd);
        this.glide(c, z.x, z.y, 0.7, mid);
        if (b.ev === 'open') {
          cd.daze = 1.4;
          this.glide(cd, cd.x + (z.x - cd.x) * 0.25, cd.y + (z.y - cd.y) * 0.25, 0.6);
          this.later(0.6, () => this.world.callout(this.pos3(c, 2.6), icon('check', 24), tone));
        } else {
          const p = this.defSpot({ ...s, zones: s.zones.map((x, j) => (j === act.who ? act.z : x)) }, act.who, 'press');
          this.glide(cd, p.x, p.y, 0.7);
        }
        if (b.ev === 'steal') {
          this.glide(hd, h.x + 0.3, h.y - 0.3, 0.25);
          hd.armsT = 0.3;
          this.later(0.3, () => {
            sfx.steal();
            this.fly(this.hand(h), this.pos3(hd, 1.2), 0.15, 0.22, () => { this.holder = hd; this.lines[hd.pl.uid].steals++; });
            this.world.callout(this.pos3(hd, 2.7), icon('steal', 28), tone);
          });
        }
        say(0.8); next(1.9);
        break;
      }
    }
  }

  private nearestDefToHoop() {
    let best = 0, bd = 99;
    for (let i = 0; i < 3; i++) { const d = this.def(i); const dd = dist(d.x, d.y, HOOP.x, HOOP.y); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }

  private afterAction(b: Branch) {
    if (this.phase === 'over') return;
    if (b.next) {
      this.poss = b.next;
      if (b.ev === 'help') this.freed = b.freed ?? null;
      this.holder = this.att(b.next.ball);
      this.flight = null;
      this.looseBall = null;
      this.layout(b.next, this.shownStance, 0.45);
      this.pushHud();
      this.later(0.5, () => this.openDecision());
      return;
    }
    // Possession over.
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
    if (!this.paused) this.update(dt * this.timeScale);
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
        if (Math.hypot(p.x - e.x, p.y - e.y) > 0.01) e.face = Math.atan2(p.x - e.x, p.y - e.y);
        e.x = p.x; e.y = p.y;
        if (k >= 1) e.anim = null;
      }
    }
    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      if (f.t >= f.dur) { this.flight = null; this.looseBall = f.curve.b.clone(); f.onLand(); }
    }
  }

  // ---------------------------------------------------------------- camera & sync
  private updateCamera(snap = false) {
    const W = this.world;
    const s = this.poss;
    const portrait = W.camera.aspect < 0.8;
    if (s && this.phase === 'decide') {
      const h = this.att(s.ball);
      const pts = [this.pos3(h, 1), RIM.clone()];
      for (let i = 0; i < 3; i++) pts.push(this.pos3(this.att(i), 0.6));
      const opt = this.previewId ? this.opts.find((o) => o.id === this.previewId) : undefined;
      if (opt?.act && (opt.act.k === 'drive' || opt.act.k === 'cut')) pts.push(w3(ZONES[opt.act.z].x, ZONES[opt.act.z].y, 0.5));
      if (this.userAttacks) {
        const dir = new THREE.Vector3(HOOP.x - h.x, 0, HOOP.y - h.y);
        if (dir.lengthSq() < 1) dir.set(0, 0, -1);
        dir.normalize().lerp(new THREE.Vector3(0, 0, -1), 0.45).normalize();
        W.frame(pts, dir, portrait ? 52 : 40, 3.2, { side: 0.6, speed: 2.6, zoom: portrait ? 0.82 : 0.9, lookBias: new THREE.Vector3(0, -0.6, portrait ? 0.8 : 0.3) });
      } else {
        // Defense: the stance moves the whole team, so show everyone from above the arc, slightly
        // off to the ball side.
        for (let i = 0; i < 3; i++) pts.push(this.pos3(this.def(i), 0.6));
        const dir = new THREE.Vector3((HOOP.x - h.x) * 0.08, 0, -1).normalize();
        W.frame(pts, dir, portrait ? 54 : 46, 3.4, { speed: 2.6, zoom: portrait ? 0.8 : 0.88, lookBias: new THREE.Vector3(0, -0.6, portrait ? 0.8 : 0.3) });
      }
    } else {
      const pts = [RIM.clone(), ...this.ents.map((e) => this.pos3(e, 0.5)), this.ballPos.clone()];
      W.frame(pts, new THREE.Vector3(0, 0, -1), portrait ? 58 : 48, 3.5, { speed: 2.0, zoom: portrait ? 0.78 : 0.86, lookBias: new THREE.Vector3(0, -0.6, portrait ? 0.6 : 0.4) });
    }
    if (snap) W.snapCamera();
  }

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
    for (const e of this.ents) {
      const moving = Math.hypot(e.x - e.px, e.y - e.py) > 0.004;
      e.px = e.x; e.py = e.y;
      if (this.phase === 'decide' && !e.anim) {
        if (e.team === this.offense) this.faceTo(e, HOOP.x, HOOP.y);
        else this.faceTo(e, this.att(e.slot).x, this.att(e.slot).y);
      }
      W.setPlayer(e.i, { x: e.x, y: e.y, face: e.face, jump: this.jumpOf(e), armsUp: e.arms, daze: e.daze > 0, moving }, dt);
      const open = !!s && e.team === this.offense && s.adv[e.slot] > 0 && this.phase !== 'resolve';
      W.players[e.i].setRing(open ? '#3ddc97' : this.teams[e.team].color, open ? 1 : 0.6);
    }
    W.setHandler(this.holder && !this.flight ? this.pos3(this.holder) : null);
    W.setControlled(null);
    this.updateCamera();
    W.render(dt);
  }

  private pushHud() {
    const s = this.poss;
    const h: HudInfo = {
      score: this.score, poss: this.possN, maxPoss: MATCH_RULES.maxPoss, offense: this.offense,
      left: s ? s.left : 0, maxLeft: s && s.rebs > 0 ? TUNE.orebActions : TUNE.actions, golden: this.golden,
    };
    const key = JSON.stringify(h);
    if (key !== this.hudKey) { this.hudKey = key; this.hooks.hud(h); }
  }
}

const userTone = (userAttacks: boolean): Tone => (userAttacks ? 'good' : 'bad');

/** The guided tutorial: three lessons, then one possession without help. */
export const TUTORIAL: TutorialPoss[] = [
  {
    title: 'SPACE: SHOOT', setup: ['wingL', 'top', 'cornerR'], handler: 2, stance: 'space',
    steps: [{ allow: ['shoot'], outcome: 'make', hint: 'Your defender backs off. Space: shoot.' }],
  },
  {
    title: 'PRESSURE: DRIVE', setup: ['top', 'wingL', 'wingR'], handler: 0, stance: 'press',
    steps: [
      { allow: ['drive'], zones: ['elbowL', 'elbowR'], outcome: 'beat', hint: 'Pressed tight. Drive past to an elbow.' },
      { allow: ['shoot'], outcome: 'make', hint: 'Defender beaten. Shoot open.' },
    ],
  },
  {
    title: 'HELP: PASS', setup: ['top', 'cornerL', 'wingR'], handler: 0, stance: 'space',
    steps: [
      { allow: ['drive'], zones: ['elbowL', 'elbowR'], outcome: 'help', hint: 'They sag. Drive inside to pull help.' },
      { allow: ['pass'], toFreed: true, outcome: 'catch', hint: 'Help left a mate free. Pass.' },
      { allow: ['shoot'], outcome: 'make', hint: 'Open man. Shoot.' },
    ],
  },
  { title: 'YOUR CALL', setup: ['top', 'wingL', 'cornerR'], handler: 0, steps: [] },
];
