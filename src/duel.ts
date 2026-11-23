// Duel resolution: rock-paper-scissors tilted by stats, techniques, context and a little dice.
// The same math powers the on-screen previews, so every number the player sees is the
// exact probability the resolution uses (rival choice distribution x dice x shot roll).
import {
  ACTION_INFO, ATTACK_ACTIONS, DEFEND_ACTIONS, MATRIX, TECHNIQUES,
  type Action, type AttackAction, type DefendAction, type Player, type Technique,
} from './data';

export interface DuelUnit {
  player: Player;
  energy: number;
}

export interface DuelContext {
  att: DuelUnit;
  def: DuelUnit;
  /** Distance from the ball handler to the hoop, in meters. */
  shotDist: number;
  isTwo: boolean;
  shotClock: number;
  /** Attacker bonus for open space (0-2). Contact duels have 0. */
  space: number;
  /** Make chance of a clean (duel won) and of a contested (stand-off) shot. */
  pOpen: number;
  pCont: number;
  /** Duel modifier per pass target index (e.g. -1 if a second defender lurks in the lane). */
  laneMods: number[];
  /** True when the AI attacker already intends to shoot (closeout situations). */
  shotIntent?: boolean;
}

export interface Choice<A extends Action = Action> {
  action: A;
  tech?: Technique;
  /** Pass target index (into the attacker's teammates list). */
  target?: number;
}

export type Winner = 'att' | 'def' | 'tie';
export type Outcome =
  | 'score' | 'miss' | 'blocked'
  | 'complete' | 'deflect' | 'intercept'
  | 'blowby' | 'standoff' | 'stolen'
  | 'shove' | 'trapped';

export interface DuelResult {
  att: Choice<AttackAction>;
  def: Choice<DefendAction>;
  total: number;
  dice: [number, number];
  winner: Winner;
  outcome: Outcome;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Luck = two dice of -1/0/+1. */
const LUCK: [number, number][] = [[-2, 1 / 9], [-1, 2 / 9], [0, 3 / 9], [1, 2 / 9], [2, 1 / 9]];

export function shotModifier(dist: number, isTwo: boolean): number {
  if (dist < 2.2) return 1;
  if (isTwo) return -1;
  return 0;
}

export function techsFor(p: Player, action: Action, energy: number): { tech: Technique; ok: boolean }[] {
  return p.known
    .map((id) => TECHNIQUES[id])
    .filter((t) => t && t.action === action)
    .map((tech) => ({ tech, ok: energy >= tech.cost }));
}

/** First affordable technique for an action, if any. */
export function bestTech(unit: DuelUnit, action: Action): Technique | undefined {
  return techsFor(unit.player, action, unit.energy).find((t) => t.ok)?.tech;
}

/** Deterministic part of the duel total (attacker's point of view). */
export function baseTotal(ctx: DuelContext, att: Choice<AttackAction>, def: Choice<DefendAction>): number {
  const aStat = ctx.att.player.stats[ACTION_INFO[att.action].stat];
  const dStat = ctx.def.player.stats[ACTION_INFO[def.action].stat];
  let total = clamp(aStat - dStat, -4, 4);
  let m = MATRIX[att.action][def.action];
  if (m < 0 && att.tech?.pierce) m = 0;
  else if (m > 0 && def.tech?.pierce) m = 0;
  total += m;
  if (att.tech) total += att.tech.bonus;
  if (def.tech) total -= def.tech.bonus;
  if (att.action === 'shoot') total += shotModifier(ctx.shotDist, ctx.isTwo);
  if (att.action === 'pass' && att.target !== undefined) total += ctx.laneMods[att.target] ?? 0;
  total += ctx.space;
  return total;
}

export function winProbs(base: number): Record<Winner, number> {
  const r = { att: 0, def: 0, tie: 0 };
  for (const [l, w] of LUCK) {
    const t = base + l;
    if (t > 0) r.att += w; else if (t < 0) r.def += w; else r.tie += w;
  }
  return r;
}

function outcomeFor(a: AttackAction, w: Winner): Outcome {
  switch (a) {
    case 'shoot': return w === 'def' ? 'blocked' : 'score'; // score/miss decided by the shot roll
    case 'pass': return w === 'att' ? 'complete' : w === 'tie' ? 'deflect' : 'intercept';
    case 'dribble': return w === 'att' ? 'blowby' : w === 'tie' ? 'standoff' : 'stolen';
    case 'protect': return w === 'att' ? 'shove' : w === 'tie' ? 'standoff' : 'trapped';
  }
}

const rollDie = () => Math.floor(Math.random() * 3) - 1;

export function resolveDuel(
  ctx: DuelContext,
  att: Choice<AttackAction>,
  def: Choice<DefendAction>,
  dice: [number, number] = [rollDie(), rollDie()],
  shotRoll = Math.random(),
): DuelResult {
  const total = baseTotal(ctx, att, def) + dice[0] + dice[1];
  const winner: Winner = total > 0 ? 'att' : total < 0 ? 'def' : 'tie';
  let outcome = outcomeFor(att.action, winner);
  if (att.action === 'shoot' && winner !== 'def') {
    const p = winner === 'att' ? ctx.pOpen : ctx.pCont;
    outcome = shotRoll < p ? 'score' : 'miss';
  }
  return { att, def, total, dice, winner, outcome };
}

// ---------- exact outcome probabilities (used by previews) ----------

export interface Weighted<T> { item: T; w: number }

/** Attacker-view probabilities for one attacker choice against a rival defense distribution. */
export function attackOdds(ctx: DuelContext, att: Choice<AttackAction>, defDist: Weighted<Choice<DefendAction>>[]) {
  const o: Partial<Record<Outcome, number>> = {};
  const add = (k: Outcome, v: number) => { o[k] = (o[k] ?? 0) + v; };
  for (const { item, w } of defDist) {
    const p = winProbs(baseTotal(ctx, att, item));
    if (att.action === 'shoot') {
      add('score', w * (p.att * ctx.pOpen + p.tie * ctx.pCont));
      add('miss', w * (p.att * (1 - ctx.pOpen) + p.tie * (1 - ctx.pCont)));
      add('blocked', w * p.def);
    } else {
      add(outcomeFor(att.action, 'att'), w * p.att);
      add(outcomeFor(att.action, 'tie'), w * p.tie);
      add(outcomeFor(att.action, 'def'), w * p.def);
    }
  }
  return o;
}

export type DefOutcome = 'ball' | 'even' | 'beaten' | 'score';

/** Defender-view probabilities for one defensive choice against a rival attack distribution. */
export function defenseOdds(ctx: DuelContext, def: Choice<DefendAction>, attDist: Weighted<Choice<AttackAction>>[]) {
  const o: Record<DefOutcome, number> = { ball: 0, even: 0, beaten: 0, score: 0 };
  for (const { item, w } of attDist) {
    const p = winProbs(baseTotal(ctx, item, def));
    o.ball += w * p.def;
    if (item.action === 'shoot') {
      const made = p.att * ctx.pOpen + p.tie * ctx.pCont;
      o.score += w * made;
      o.even += w * (p.att + p.tie - made);
    } else {
      o.beaten += w * p.att;
      o.even += w * p.tie;
    }
  }
  return o;
}

/** Round a set of probabilities to integer percentages that add up to exactly 100. */
export function toPercents<K extends string>(probs: Partial<Record<K, number>>): Record<K, number> {
  const keys = Object.keys(probs) as K[];
  const raw = keys.map((k) => (probs[k] ?? 0) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; floors[i]++; left--; }
  const out = {} as Record<K, number>;
  keys.forEach((k, i) => { out[k] = floors[i]; });
  return out;
}

// ---------- AI ----------

/** Remembers what the human tends to pick so smarter rivals can counter it. */
export class HabitMemory {
  att: AttackAction[] = [];
  def: DefendAction[] = [];
  push(side: 'att' | 'def', a: Action) {
    const list = (side === 'att' ? this.att : this.def) as Action[];
    list.push(a);
    if (list.length > 8) list.shift();
  }
  favorite(side: 'att' | 'def'): Action | null {
    const list = (side === 'att' ? this.att : this.def) as Action[];
    if (list.length < 2) return null;
    const counts = new Map<Action, number>();
    for (const a of list) counts.set(a, (counts.get(a) ?? 0) + 1);
    let best: Action | null = null;
    let bc = 0;
    for (const [a, c] of counts) if (c > bc) { best = a; bc = c; }
    return best;
  }
}

const TECH_USE = 0.65;

function normalize<T>(list: Weighted<T>[]): Weighted<T>[] {
  const sum = list.reduce((a, x) => a + Math.max(0, x.w), 0) || 1;
  return list.map((x) => ({ item: x.item, w: Math.max(0, x.w) / sum }));
}

/** Expand action weights into (action, technique?) choices with the AI's technique habit. */
function withTechs<A extends Action>(unit: DuelUnit, weights: [A, number][]): Weighted<Choice<A>>[] {
  const out: Weighted<Choice<A>>[] = [];
  for (const [action, w] of weights) {
    const tech = bestTech(unit, action);
    if (tech) {
      out.push({ item: { action, tech }, w: w * TECH_USE });
      out.push({ item: { action }, w: w * (1 - TECH_USE) });
    } else out.push({ item: { action }, w });
  }
  return normalize(out);
}

/** Full probability distribution of the AI defender's choice. */
export function aiDefendDist(ctx: DuelContext, memory: HabitMemory, smart: number): Weighted<Choice<DefendAction>>[] {
  const p = ctx.def.player.stats;
  const close = ctx.shotDist < 2.2 ? 0.6 : 0;
  const base: [DefendAction, number][] = [
    ['steal', 1 + (p.def - 5) * 0.15],
    ['block', 0.9 + (p.blk - 5) * 0.15 + close + (ctx.shotClock < 4 ? 1 : 0)],
    ['press', 0.8 + (p.str - 5) * 0.12],
    ['wait', 0.8 + (ctx.def.energy < 30 ? 0.4 : 0)],
  ];
  const fav = memory.favorite('att') as AttackAction | null;
  const counter = fav ? DEFEND_ACTIONS.find((a) => ACTION_INFO[a].beats === fav) : undefined;
  return mixCounter(base, counter, smart, ctx.def);
}

/** Full probability distribution of the AI attacker's choice. */
export function aiAttackDist(ctx: DuelContext, memory: HabitMemory, smart: number): Weighted<Choice<AttackAction>>[] {
  const p = ctx.att.player.stats;
  const close = ctx.shotDist < 2.2 ? 0.8 : ctx.isTwo ? -0.3 : 0;
  const base: [AttackAction, number][] = [
    ['dribble', 1 + (p.spd - 5) * 0.15],
    ['pass', 1 + (p.pas - 5) * 0.15],
    ['shoot', 0.8 + (p.sho - 5) * 0.15 + close + (ctx.shotClock < 4 ? 1.5 : 0) + (ctx.shotIntent ? 0.5 : 0)],
    ['protect', 0.6 + (p.str - 5) * 0.12 + (ctx.att.energy < 30 ? 0.3 : 0)],
  ];
  const fav = memory.favorite('def') as DefendAction | null;
  const counter = fav ? ATTACK_ACTIONS.find((a) => ACTION_INFO[a].beats === fav) : undefined;
  return mixCounter(base, counter, smart, ctx.att);
}

function mixCounter<A extends Action>(base: [A, number][], counter: A | undefined, smart: number, unit: DuelUnit) {
  const sum = base.reduce((a, [, w]) => a + Math.max(0, w), 0) || 1;
  const s = counter ? smart : 0;
  const weights = base.map(([a, w]) => [a, (1 - s) * (Math.max(0, w) / sum) + (a === counter ? s : 0)] as [A, number]);
  return withTechs(unit, weights);
}

export function sample<T>(dist: Weighted<T>[]): T {
  let r = Math.random();
  for (const x of dist) {
    r -= x.w;
    if (r <= 0) return x.item;
  }
  return dist[dist.length - 1].item;
}
