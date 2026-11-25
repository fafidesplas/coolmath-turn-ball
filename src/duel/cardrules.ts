// Turn Ball 1v1, card mode: the rules. Pure functions (run by the page and by the balance check).
//
// Each possession both players draw a hand of 4 from their deck, face up: the attacker move cards (with an
// energy cost), the defender stance cards. Every beat both play one card at the same time; then they are
// revealed and compared. No dice: the attacker's POWER against the defender's STOP for that kind of move.
//   power >= stop      it works          power >= stop + 2   it works great
//   power <  stop      it fails          a shot that falls 2 short is blocked; a move that fails into Reach is stolen
// Shooting is always possible and costs nothing; the last beat has to be a shot. Cards are spent, so the game is
// making him burn his best answer (Contest, Wall) before you go for it. The state from the other modes carries:
// zone (three, mid, paint), the defender's balance (guard), room after a step-back, and the beats left.
import type { Ev, MoveId, St, Stance } from './rules';

export type Kind = 'drive' | 'handle' | 'space' | 'fake' | 'shot';
export type ACardId = 'drive' | 'burst' | 'cross' | 'hesi' | 'spin' | 'step' | 'pump';
export type DCardId = 'press' | 'sag' | 'reach' | 'contest' | 'wall' | 'recover';
export type Play = ACardId | 'shoot';

export interface ACard { id: ACardId; name: string; cost: number; power: number; kind: Kind; text: string }
export interface DCard { id: DCardId; name: string; stop: Record<Kind, number>; text: string }

export const ACARDS: Record<ACardId, ACard> = {
  drive: { id: 'drive', name: 'Drive', cost: 1, power: 2, kind: 'drive', text: 'One zone closer. Great: and -1 balance.' },
  burst: { id: 'burst', name: 'Burst', cost: 2, power: 3, kind: 'drive', text: 'A harder drive. Great: and -1 balance.' },
  cross: { id: 'cross', name: 'Crossover', cost: 1, power: 2, kind: 'handle', text: '-1 balance. Great: -2.' },
  hesi: { id: 'hesi', name: 'Hesi', cost: 0, power: 1, kind: 'handle', text: '-1 balance. Your next card gets +1.' },
  spin: { id: 'spin', name: 'Spin', cost: 2, power: 3, kind: 'handle', text: '-1 balance and one zone closer.' },
  step: { id: 'step', name: 'Step-back', cost: 1, power: 2, kind: 'space', text: 'One zone back, with room: next shot +1.' },
  pump: { id: 'pump', name: 'Pump fake', cost: 1, power: 1, kind: 'fake', text: 'If he Contests he bites: -2 balance.' },
};
const S = (drive: number, handle: number, space: number, fake: number, shot: number) => ({ drive, handle, space, fake, shot });
export const DCARDS: Record<DCardId, DCard> = {
  press: { id: 'press', name: 'Press', stop: S(1, 2, 2, 2, 3), text: 'Up on him. Good on shots and space, weak on drives.' },
  sag: { id: 'sag', name: 'Sag', stop: S(3, 1, 0, 1, 1), text: 'Back off. Stops drives; gives up the shot.' },
  reach: { id: 'reach', name: 'Reach', stop: S(0, 3, 1, 1, 1), text: 'Go for the ball: a failed handle is a steal. Drives blow by.' },
  contest: { id: 'contest', name: 'Contest', stop: S(2, 1, 2, -9, 4), text: 'Jump at the shot: blocks it. Bites on a pump fake.' },
  wall: { id: 'wall', name: 'Wall', stop: S(4, 2, 0, 1, 2), text: 'Plant in the lane: drives bounce off.' },
  recover: { id: 'recover', name: 'Recover', stop: S(1, 1, 1, 1, 2), text: 'Get set again: +1 balance after the beat.' },
};
export const KIND_SHORT: Record<Kind, string> = { drive: 'DRV', handle: 'HND', space: 'SPC', fake: 'FAK', shot: 'SHT' };

/** Starting decks (later: the moves each player learns). */
export const ATT_DECK: ACardId[] = ['drive', 'drive', 'drive', 'burst', 'cross', 'cross', 'cross', 'hesi', 'hesi', 'spin', 'step', 'step', 'pump'];
export const DEF_DECK: DCardId[] = ['press', 'press', 'press', 'sag', 'sag', 'reach', 'reach', 'contest', 'contest', 'wall', 'recover'];

export const HAND = 4;
export const ENERGY = 3;
export const BEATS = 4;
export const WIN_SCORE = 7;

/** The duel state plus both hands. */
export interface CS extends St { energy: number; combo: number; hand: ACardId[]; dhand: DCardId[] }

export const canDunk = (s: St) => s.zone === 2 && s.guard <= 1;
export const ptsOf = (s: St) => (s.zone === 0 || canDunk(s) ? 2 : 1);
const guardBonus = (g: number) => (g <= 0 ? 2 : g === 1 ? 1 : 0);
export const SHOT_NAME = ['Three', 'Jumper', 'Layup'];
export const shotName = (s: St) => (canDunk(s) ? 'Dunk' : SHOT_NAME[s.zone]);

/** Power of a play in this state (combo and a shaken defender add to it). */
export function powerOf(cs: CS, p: Play): number {
  if (p === 'shoot') return (canDunk(cs) ? 4 : [1, 2, 3][cs.zone]) + (cs.space ? 1 : 0) + guardBonus(cs.guard) + cs.combo;
  const c = ACARDS[p];
  return c.power + cs.combo + (c.kind === 'drive' ? guardBonus(cs.guard) : 0);
}
export const kindOf = (p: Play): Kind => (p === 'shoot' ? 'shot' : ACARDS[p].kind);

export function legalPlays(cs: CS): Play[] {
  if (cs.clock <= 1) return ['shoot'];
  const out: Play[] = [];
  for (const id of cs.hand) {
    if (out.includes(id)) continue;
    const c = ACARDS[id];
    if (c.cost > cs.energy) continue;
    if ((c.kind === 'drive' || id === 'spin') && cs.zone === 2) continue;
    out.push(id);
  }
  out.push('shoot');
  return out;
}
export const defPlays = (cs: CS): DCardId[] => [...new Set(cs.dhand)];

export type Grade = 'great' | 'ok' | 'fail';
export interface Res {
  ev: Ev;
  grade: Grade;
  power: number;
  stop: number;
  next?: CS;
  pts?: number;
  /** For the animation: the move and the stance it looks like. */
  move: MoveId;
  stance: Stance;
}
export const looksLike = (d: DCardId): Stance => (d === 'reach' ? 'gamble' : d === 'press' || d === 'contest' ? 'press' : 'sag');

/** Compare a play with a defense card. */
export function clash(cs: CS, p: Play, d: DCardId): Res {
  const kind = kindOf(p);
  const power = powerOf(cs, p);
  const stop = DCARDS[d].stop[kind];
  const grade: Grade = power >= stop + 2 ? 'great' : power >= stop ? 'ok' : 'fail';
  const stance = looksLike(d);
  const hand = [...cs.hand];
  if (p !== 'shoot') hand.splice(hand.indexOf(p), 1);
  const dhand = [...cs.dhand];
  dhand.splice(dhand.indexOf(d), 1);
  const cost = p === 'shoot' ? 0 : ACARDS[p].cost;
  const base: CS = { ...cs, hand, dhand, energy: cs.energy - cost, clock: cs.clock - 1, space: false, combo: p === 'hesi' && grade !== 'fail' ? 1 : 0 };
  // Recover: the defender gets set again, unless he was beaten badly.
  const settle = (n: CS): CS => (d === 'recover' && grade !== 'great' ? { ...n, guard: Math.min(3, n.guard + 1) } : n);
  const r = (ev: Ev, next: CS | undefined, move: MoveId, pts?: number): Res => ({ ev, grade, power, stop, next: next && settle(next), pts, move, stance });
  if (p === 'shoot') {
    if (grade !== 'fail') return r('score', undefined, 'shoot', ptsOf(cs));
    return r(stop - power >= 2 ? 'block' : 'miss', undefined, 'shoot');
  }
  if (grade === 'fail') {
    if (d === 'reach' && kind === 'handle') return r('steal', undefined, 'cross');
    if (kind === 'drive') return r('stopped', base, 'drive');
    if (kind === 'space') return r('noroom', { ...base, zone: Math.max(0, cs.zone - 1) as 0 | 1 | 2 }, 'step');
    return r('read', base, 'cross');
  }
  const hurt = (n: number) => Math.max(0, cs.guard - n);
  if (kind === 'drive') {
    const g = grade === 'great' ? hurt(1) : cs.guard;
    return r(g === 0 && cs.guard > 0 ? 'burn' : 'beat', { ...base, zone: (cs.zone + 1) as 0 | 1 | 2, guard: g }, 'drive');
  }
  if (p === 'spin') return r('beat', { ...base, zone: (cs.zone + 1) as 0 | 1 | 2, guard: hurt(1) }, 'drive');
  if (kind === 'space') return r('room', { ...base, zone: Math.max(0, cs.zone - 1) as 0 | 1 | 2, space: true, guard: grade === 'great' ? hurt(1) : cs.guard }, 'step');
  const dmg = p === 'pump' ? (d === 'contest' ? 2 : 1) : grade === 'great' ? 2 : 1;
  const g = hurt(dmg);
  return r(g === 0 ? 'broke' : 'shook', { ...base, guard: g }, 'cross');
}

// ---------------------------------------------------------------- the AI: each beat is a small zero-sum game
/** Value and mixed strategies of a matrix game (rows maximize), by fictitious play. */
export function solveMatrix(M: number[][]): { v: number; x: number[]; y: number[] } {
  const R = M.length, C = M[0].length;
  const xs = new Array(R).fill(0), ys = new Array(C).fill(0);
  const rowSum = new Array(R).fill(0), colSum = new Array(C).fill(0);
  let i = 0, j = 0;
  const N = 300;
  for (let t = 0; t < N; t++) {
    xs[i]++; ys[j]++;
    for (let c = 0; c < C; c++) colSum[c] += M[i][c];
    for (let r = 0; r < R; r++) rowSum[r] += M[r][j];
    i = rowSum.indexOf(Math.max(...rowSum));
    j = colSum.indexOf(Math.min(...colSum));
  }
  const x = xs.map((v) => v / N), y = ys.map((v) => v / N);
  let v = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) v += x[r] * y[c] * M[r][c];
  return { v, x, y };
}

interface Node { v: number; A: Play[]; D: DCardId[]; x: number[]; y: number[] }
const memo = new Map<string, Node>();
const key = (cs: CS) => `${cs.zone}${cs.guard}${cs.space ? 1 : 0}${cs.clock}${cs.energy}${cs.combo}|${[...cs.hand].sort().join(',')}|${[...cs.dhand].sort().join(',')}`;
/** Expected points for the attack from here, with both sides playing their equilibrium mix. */
export function solveBeat(cs: CS): Node {
  const k = key(cs);
  const hit = memo.get(k);
  if (hit) return hit;
  const A = legalPlays(cs), D = defPlays(cs);
  const M: number[][] = A.map((p) => D.map((d): number => { const r = clash(cs, p, d); return (r.pts ?? 0) + (r.next ? solveBeat(r.next).v : 0); }));
  const res: Node = { ...solveMatrix(M), A, D };
  if (memo.size > 200000) memo.clear();
  memo.set(k, res);
  return res;
}
/** Sample a play for the AI from its equilibrium mix. */
export function aiPlay(cs: CS, r: number): Play {
  const { A, x } = solveBeat(cs);
  let t = r;
  for (let i = 0; i < A.length; i++) { t -= x[i]; if (t <= 0) return A[i]; }
  return A[A.length - 1];
}
export function aiDef(cs: CS, r: number): DCardId {
  const { D, y } = solveBeat(cs);
  let t = r;
  for (let i = 0; i < D.length; i++) { t -= y[i]; if (t <= 0) return D[i]; }
  return D[D.length - 1];
}

/** A deck that draws hands and reshuffles its discards. */
export class Deck<T> {
  private pile: T[] = [];
  private cards: T[];
  private rnd: () => number;
  constructor(cards: T[], rnd: () => number) { this.cards = cards; this.rnd = rnd; }
  draw(n: number): T[] {
    const out: T[] = [];
    while (out.length < n) {
      if (!this.pile.length) {
        this.pile = [...this.cards];
        for (let i = this.pile.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [this.pile[i], this.pile[j]] = [this.pile[j], this.pile[i]]; }
      }
      out.push(this.pile.pop()!);
    }
    return out;
  }
}
export const startCS = (hand: ACardId[], dhand: DCardId[]): CS => ({ zone: 0, guard: 3, space: false, clock: BEATS, energy: ENERGY, combo: 0, hand, dhand });
