// Turn Ball 1v1: the duel rules. Pure functions, no drawing (run by the page and by the balance check).
//
// A possession is a short duel with state that builds up:
//   zone   where the attacker is: 0 three, 1 mid-range, 2 paint. Threes and dunks are worth 2, the rest 1
//   guard  the defender's balance, 3 (set) to 0 (broken: wide-open looks and the dunk)
//   space  the attacker made room with a step-back: his next shot is easier
//   clock  moves left; the last one has to be a shot
// Every beat the defense sets a stance first (Press, Sag, or Gamble, which looks exactly like Press), then the
// attacker picks Drive, Crossover, Step-back or Shoot seeing it. No dice: the human pulls the move off (or
// answers it on defense) with a timed press. The matchup only sets how wide the timing window is; the press
// lands MISS, GOOD or PERFECT, and each move has a fixed result for each.

export type Zone = 0 | 1 | 2;
export type Stance = 'press' | 'sag' | 'gamble';
/** What the attacker sees: Gamble looks like Press. */
export type Vis = 'press' | 'sag';
export type MoveId = 'drive' | 'cross' | 'step' | 'shoot';
export type Tier = 'miss' | 'good' | 'perfect';
/** Who presses: you attacking (your execution) or you defending (your reaction). */
export type Side = 'att' | 'def';
export const MOVES: MoveId[] = ['drive', 'cross', 'step', 'shoot'];
export const STANCES: Stance[] = ['press', 'sag', 'gamble'];
export const TIERS: Tier[] = ['perfect', 'good', 'miss'];

export interface St { zone: Zone; guard: number; space: boolean; clock: number }
export type Ev =
  | 'score' | 'miss' | 'block' | 'steal'
  | 'beat' | 'burn' | 'stopped'
  | 'shook' | 'broke' | 'read'
  | 'room' | 'noroom';
export interface Out { ev: Ev; next?: St; pts?: number }

export const CLOCK = 4;
export const GUARD = 3;
export const WIN_SCORE = 7;
export const start = (): St => ({ zone: 0, guard: GUARD, space: false, clock: CLOCK });

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const visOf = (st: Stance): Vis => (st === 'sag' ? 'sag' : 'press');
export const canDunk = (s: St) => s.zone === 2 && s.guard <= 1;
export const ptsOf = (s: St) => (s.zone === 0 || canDunk(s) ? 2 : 1);
export type ShotKind = 'three' | 'jumper' | 'layup' | 'dunk';
export function shotKind(s: St): ShotKind {
  return s.zone === 0 ? 'three' : s.zone === 1 ? 'jumper' : canDunk(s) ? 'dunk' : 'layup';
}
export function legal(s: St, m: MoveId): boolean {
  if (s.clock <= 1) return m === 'shoot';
  if (m === 'drive') return s.zone < 2;
  return true;
}

// ---------------------------------------------------------------- timing windows
/** Width of the GOOD window for the attacker (fraction of the timing bar), by move and stance. */
const ATT_W: Record<Exclude<MoveId, 'shoot'> | ShotKind, Record<Stance, number>> = {
  drive: { press: 0.32, sag: 0.13, gamble: 0.32 },
  cross: { press: 0.28, sag: 0.22, gamble: 0.14 },
  step: { press: 0.18, sag: 0.1, gamble: 0.16 },
  three: { press: 0.1, sag: 0.22, gamble: 0.12 },
  jumper: { press: 0.12, sag: 0.24, gamble: 0.14 },
  layup: { press: 0.26, sag: 0.15, gamble: 0.22 },
  dunk: { press: 0.3, sag: 0.24, gamble: 0.28 },
};
export interface Win { good: number; perfect: number }
/** The attacker's window: the matchup, plus what he has built (a shaken defender, room). */
export function attWindow(s: St, m: MoveId, st: Stance): Win {
  const k = m === 'shoot' ? shotKind(s) : m;
  let w = ATT_W[k][st];
  w += s.guard === 0 ? 0.16 : (GUARD - s.guard) * 0.05;
  if (m === 'shoot' && s.space) w += 0.08;
  // A step-back from behind the arc goes deeper still: harder to get clean.
  if (m === 'step' && s.zone === 0) w -= 0.06;
  w = clamp(w, 0.06, 0.4);
  return { good: w, perfect: w * 0.35 };
}
/** The defender's window: the other side of the same matchup. A Gamble has a wider PERFECT (the steal, the block). */
export function defWindow(s: St, m: MoveId, st: Stance): Win {
  const w = clamp(0.4 - attWindow(s, m, st).good, 0.06, 0.32);
  return { good: w, perfect: w * (st === 'gamble' ? 0.6 : 0.35) };
}
export const windowFor = (side: Side, s: St, m: MoveId, st: Stance) => (side === 'att' ? attWindow(s, m, st) : defWindow(s, m, st));

// ---------------------------------------------------------------- results
/** What a move does, given how the human's press landed (attacking: his execution; defending: his reaction). */
export function result(s: St, m: MoveId, st: Stance, side: Side, t: Tier): Out {
  const tick = (o: Partial<St>): St => ({ ...s, space: false, clock: s.clock - 1, ...o });
  // From the attack's point of view: 2 = great for him, 1 = it works, 0 = it fails, -1 = he loses the ball.
  const a = side === 'att'
    ? (t === 'perfect' ? 2 : t === 'good' ? 1 : st === 'gamble' ? -1 : 0)
    : (t === 'perfect' ? (st === 'sag' ? 0 : -1) : t === 'good' ? 0 : st === 'gamble' ? 2 : 1);
  if (m === 'drive') {
    const z = (s.zone + 1) as Zone;
    if (a === -1) return { ev: 'steal' };
    if (a === 0) return s.guard === 0 ? { ev: 'beat', next: tick({ zone: z }) } : { ev: 'stopped', next: tick({}) };
    if (a === 2) return st === 'gamble' ? { ev: 'burn', next: tick({ zone: z, guard: 0 }) } : { ev: 'beat', next: tick({ zone: z, guard: Math.max(0, s.guard - 1) }) };
    return { ev: 'beat', next: tick({ zone: z }) };
  }
  if (m === 'cross') {
    if (a === -1) return { ev: 'steal' };
    if (a === 0) return { ev: 'read', next: tick({}) };
    // Defending, a missed press against a Crossover hurts more if you were up on him.
    const dmg = a === 2 || (side === 'def' && st !== 'sag') ? 2 : 1;
    const g = Math.max(0, s.guard - dmg);
    return { ev: g === 0 ? 'broke' : 'shook', next: tick({ guard: g }) };
  }
  if (m === 'step') {
    const z = Math.max(0, s.zone - 1) as Zone;
    if (a <= 0) return { ev: 'noroom', next: tick({ zone: z }) };
    return { ev: 'room', next: tick({ zone: z, space: true, guard: a === 2 ? Math.max(0, s.guard - 1) : s.guard }) };
  }
  if (a === -1) return { ev: 'block' };
  if (a === 0) return { ev: 'miss' };
  return { ev: 'score', pts: ptsOf(s) };
}

// ---------------------------------------------------------------- planning (the AI's view)
/**
 * How often a human lands each tier for a window (the model the AI plans with): a wider window is hit more,
 * PERFECT about as often as a window of its width.
 */
export function tierOdds(w: Win): Record<Tier, number> {
  const hit = (x: number) => clamp(0.12 + 2.1 * x, 0.04, 0.94);
  const good = hit(w.good);
  const perfect = Math.min(good, hit(w.perfect) * 0.55);
  return { perfect, good: good - perfect, miss: 1 - good };
}
/** Results of a move against a stance, weighted by how the human's press would land. */
export function outcomes(s: St, m: MoveId, st: Stance, side: Side): (Out & { p: number; t: Tier })[] {
  const o = tierOdds(windowFor(side, s, m, st));
  return TIERS.map((t) => ({ ...result(s, m, st, side, t), p: o[t], t })).filter((x) => x.p > 0);
}

const memo = new Map<string, { v: number; pi: Record<Stance, number> }>();
const key = (s: St, side: Side) => `${side}${s.zone}${s.guard}${s.space ? 1 : 0}${s.clock}`;

/** Expected points of a move once the attacker sees `vis`, with belief `bg` that Press is really Gamble. */
export function q(s: St, m: MoveId, vis: Vis, bg: number, side: Side): number {
  const mix: [Stance, number][] = vis === 'sag' ? [['sag', 1]] : [['press', 1 - bg], ['gamble', bg]];
  let v = 0;
  for (const [st, w] of mix) {
    if (w <= 0) continue;
    for (const o of outcomes(s, m, st, side)) v += w * o.p * ((o.pts ?? 0) + (o.next ? solve(o.next, side).v : 0));
  }
  return v;
}
export const bestMove = (s: St, vis: Vis, bg: number, side: Side) =>
  MOVES.filter((m) => legal(s, m)).map((m) => ({ m, v: q(s, m, vis, bg, side) })).sort((a, b) => b.v - a.v)[0];

/** Belief an attacker has that Press is Gamble, before reading anyone. */
export const PRIOR_GAMBLE = 0.25;

/** The defense's mix in a state (a softmax toward the stances that give up least) and the attack's value. */
export function solve(s: St, side: Side): { v: number; pi: Record<Stance, number> } {
  const k = key(s, side);
  const hit = memo.get(k);
  if (hit) return hit;
  const vp = bestMove(s, 'press', 0, side).v;
  const vs = bestMove(s, 'sag', 0, side).v;
  const mg = bestMove(s, 'press', PRIOR_GAMBLE, side).m;
  const vg = q(s, mg, 'press', 1, side);
  const T = 0.12;
  const lo = Math.min(vp, vs, vg);
  let wp = Math.exp(-(vp - lo) / T), ws = Math.exp(-(vs - lo) / T), wg = Math.exp(-(vg - lo) / T) * 0.35;
  const sum = wp + ws + wg;
  wp /= sum; ws /= sum; wg /= sum;
  const bg = wp + wg > 0 ? wg / (wp + wg) : 0;
  const r = { v: (wp + wg) * bestMove(s, 'press', bg, side).v + ws * bestMove(s, 'sag', 0, side).v, pi: { press: wp, sag: ws, gamble: wg } };
  memo.set(k, r);
  return r;
}

/** Sample from weights. */
export function pick<T>(items: [T, number][], r: number): T {
  const tot = items.reduce((a, x) => a + x[1], 0);
  let x = r * tot;
  for (const [it, w] of items) { x -= w; if (x <= 0) return it; }
  return items[items.length - 1][0];
}
/** The AI attacker's move (you defend): near-best, a little noise so it is not a script. */
export function aiMove(s: St, vis: Vis, bg: number, r: number, temp = 0.06): MoveId {
  const ms = MOVES.filter((m) => legal(s, m)).map((m) => ({ m, v: q(s, m, vis, bg, 'def') }));
  const hi = Math.max(...ms.map((x) => x.v));
  return pick(ms.map((x) => [x.m, Math.exp((x.v - hi) / temp)] as [MoveId, number]), r);
}
/** The AI defense's stance (you attack). */
export const aiStance = (s: St, r: number): Stance => pick(STANCES.map((st) => [st, solve(s, 'att').pi[st]] as [Stance, number]), r);

/** A window in words: how hard the press is. */
export const ease = (w: Win): 'EASY' | 'OK' | 'HARD' => (w.good >= 0.24 ? 'EASY' : w.good >= 0.14 ? 'OK' : 'HARD');
