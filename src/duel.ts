// Duel resolution: rock-paper-scissors tilted by stats, techniques, context and a little dice.
import {
  ACTION_INFO, ATTACK_ACTIONS, DEFEND_ACTIONS, MATRIX, MATCHUP_TEXT, TECHNIQUES,
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
}

export interface Choice<A extends Action = Action> {
  action: A;
  tech?: Technique;
  auto?: boolean;
}

export interface BreakdownLine {
  label: string;
  value: number;
  kind: 'stat' | 'match' | 'tech' | 'mod' | 'luck';
}

export interface DuelResult {
  att: Choice<AttackAction>;
  def: Choice<DefendAction>;
  lines: BreakdownLine[];
  total: number;
  dice: [number, number];
  winner: 'att' | 'def' | 'tie';
  headline: string;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function shotModifier(dist: number, isTwo: boolean): BreakdownLine | null {
  if (dist < 2.2) return { label: 'Right under the rim', value: 1, kind: 'mod' };
  if (isTwo) return { label: 'Deep two-pointer', value: -1, kind: 'mod' };
  return null;
}

export function techsFor(p: Player, action: Action, energy: number): { tech: Technique; ok: boolean }[] {
  return p.known
    .map((id) => TECHNIQUES[id])
    .filter((t) => t && t.action === action)
    .map((tech) => ({ tech, ok: energy >= tech.cost }));
}

const rollDie = () => Math.floor(Math.random() * 3) - 1; // -1, 0, +1

export function resolveDuel(
  ctx: DuelContext,
  att: Choice<AttackAction>,
  def: Choice<DefendAction>,
  dice: [number, number] = [rollDie(), rollDie()],
): DuelResult {
  const lines: BreakdownLine[] = [];
  const aInfo = ACTION_INFO[att.action];
  const dInfo = ACTION_INFO[def.action];
  const aStat = ctx.att.player.stats[aInfo.stat];
  const dStat = ctx.def.player.stats[dInfo.stat];
  const statEdge = clamp(aStat - dStat, -4, 4);
  lines.push({
    label: `${aInfo.stat.toUpperCase()} ${aStat} vs ${dInfo.stat.toUpperCase()} ${dStat}`,
    value: statEdge,
    kind: 'stat',
  });

  let m = MATRIX[att.action][def.action];
  const key = `${att.action}-${def.action}`;
  let mLabel = MATCHUP_TEXT[key] ?? (m > 0 ? 'Slight edge' : 'Slight disadvantage');
  if (m < 0 && att.tech?.pierce) {
    m = 0;
    mLabel = `${att.tech.name} pierces the counter`;
  } else if (m > 0 && def.tech?.pierce) {
    m = 0;
    mLabel = `${def.tech.name} pierces the counter`;
  }
  lines.push({ label: `${aInfo.label} vs ${dInfo.label}: ${mLabel}`, value: m, kind: 'match' });

  if (att.tech) lines.push({ label: `★ ${att.tech.name}`, value: att.tech.bonus, kind: 'tech' });
  if (def.tech) lines.push({ label: `★ ${def.tech.name}`, value: -def.tech.bonus, kind: 'tech' });

  if (att.action === 'shoot') {
    const mod = shotModifier(ctx.shotDist, ctx.isTwo);
    if (mod) lines.push(mod);
  }
  if (att.auto) lines.push({ label: 'Too slow! Auto-move', value: -1, kind: 'mod' });
  if (def.auto) lines.push({ label: 'Too slow! Auto-move', value: 1, kind: 'mod' });

  const luck = dice[0] + dice[1];
  lines.push({ label: 'Luck', value: luck, kind: 'luck' });

  const total = lines.reduce((a, l) => a + l.value, 0);
  const winner = total > 0 ? 'att' : total < 0 ? 'def' : 'tie';
  return { att, def, lines, total, dice, winner, headline: headlineFor(att.action, def.action, winner) };
}

function headlineFor(a: AttackAction, d: DefendAction, w: 'att' | 'def' | 'tie'): string {
  if (w === 'tie') return 'STAND-OFF!';
  if (w === 'att') {
    return { dribble: 'BLOWN BY!', pass: 'DIME DROPPED!', shoot: 'BUCKET!', protect: 'BALL SECURED!' }[a];
  }
  if (a === 'shoot') return d === 'block' ? 'REJECTED!' : 'SHOT DENIED!';
  if (a === 'pass') return 'INTERCEPTED!';
  return { steal: 'STOLEN!', block: 'STRIPPED!', press: 'TRAPPED!', wait: 'POKED AWAY!' }[d];
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

function weightedPick<T>(items: [T, number][]): T {
  const sum = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
  let r = Math.random() * sum;
  for (const [it, w] of items) {
    r -= Math.max(0, w);
    if (r <= 0) return it;
  }
  return items[items.length - 1][0];
}

function maybeTech(unit: DuelUnit, action: Action): Technique | undefined {
  const ok = techsFor(unit.player, action, unit.energy).filter((t) => t.ok);
  if (!ok.length || Math.random() > 0.65) return undefined;
  return ok[0].tech;
}

export function aiAttack(ctx: DuelContext, memory: HabitMemory, smart: number): Choice<AttackAction> {
  const p = ctx.att.player.stats;
  const fav = memory.favorite('def') as DefendAction | null;
  let action: AttackAction;
  if (fav && Math.random() < smart) {
    action = ATTACK_ACTIONS.find((a) => ACTION_INFO[a].beats === fav) ?? 'dribble';
  } else {
    const close = ctx.shotDist < 2.2 ? 0.8 : ctx.isTwo ? -0.3 : 0;
    action = weightedPick<AttackAction>([
      ['dribble', 1 + (p.spd - 5) * 0.15],
      ['pass', 1 + (p.pas - 5) * 0.15],
      ['shoot', 0.8 + (p.sho - 5) * 0.15 + close + (ctx.shotClock < 4 ? 1.5 : 0)],
      ['protect', 0.6 + (p.str - 5) * 0.12 + (ctx.att.energy < 30 ? 0.3 : 0)],
    ]);
  }
  return { action, tech: maybeTech(ctx.att, action) };
}

export function aiDefend(ctx: DuelContext, memory: HabitMemory, smart: number): Choice<DefendAction> {
  const p = ctx.def.player.stats;
  const fav = memory.favorite('att') as AttackAction | null;
  let action: DefendAction;
  if (fav && Math.random() < smart) {
    action = DEFEND_ACTIONS.find((a) => ACTION_INFO[a].beats === fav) ?? 'wait';
  } else {
    const close = ctx.shotDist < 2.2 ? 0.6 : 0;
    action = weightedPick<DefendAction>([
      ['steal', 1 + (p.def - 5) * 0.15],
      ['block', 0.9 + (p.blk - 5) * 0.15 + close + (ctx.shotClock < 4 ? 1 : 0)],
      ['press', 0.8 + (p.str - 5) * 0.12],
      ['wait', 0.8 + (ctx.def.energy < 30 ? 0.4 : 0)],
    ]);
  }
  return { action, tech: maybeTech(ctx.def, action) };
}
