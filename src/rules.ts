// Turn Ball possession engine. Pure TypeScript (no DOM, no Three.js) so the game and the headless
// simulator (`npm run sim`) share exactly the same rules and the same odds.
//
// A possession is a short chain of decisions. Each decision the attack picks one action (shoot, pass,
// drive with the ball, or cut a teammate without the ball) while the defense picks one of three
// stances without seeing it (press, give space, deny the pass). Every outcome of an
// (action, stance) pair is an explicit weighted branch, so the odds shown on screen are exact.
import type { Stats } from './data.ts';

// ---------------------------------------------------------------- court zones

export type Zone = 'cornerL' | 'wingL' | 'top' | 'wingR' | 'cornerR' | 'elbowL' | 'elbowR' | 'postL' | 'postR';
export type ZoneKind = 'three' | 'mid' | 'close';
export interface ZoneInfo { id: Zone; x: number; y: number; kind: ZoneKind; name: string }

/** Court coordinates in meters (x 0..15 across, y 0..11 from the baseline; hoop at 7.5, 1.575). */
export const ZONES: Record<Zone, ZoneInfo> = {
  cornerL: { id: 'cornerL', x: 0.75, y: 1.3, kind: 'three', name: 'Corner' },
  wingL: { id: 'wingL', x: 2.2, y: 6.7, kind: 'three', name: 'Wing' },
  top: { id: 'top', x: 7.5, y: 9.0, kind: 'three', name: 'Top' },
  wingR: { id: 'wingR', x: 12.8, y: 6.7, kind: 'three', name: 'Wing' },
  cornerR: { id: 'cornerR', x: 14.25, y: 1.3, kind: 'three', name: 'Corner' },
  elbowL: { id: 'elbowL', x: 5.3, y: 5.6, kind: 'mid', name: 'Elbow' },
  elbowR: { id: 'elbowR', x: 9.7, y: 5.6, kind: 'mid', name: 'Elbow' },
  postL: { id: 'postL', x: 5.75, y: 2.5, kind: 'close', name: 'Post' },
  postR: { id: 'postR', x: 9.25, y: 2.5, kind: 'close', name: 'Post' },
};
export const ZONE_IDS = Object.keys(ZONES) as Zone[];

const LINKS: [Zone, Zone][] = [
  ['cornerL', 'wingL'], ['cornerL', 'postL'], ['wingL', 'top'], ['wingL', 'elbowL'], ['wingL', 'postL'],
  ['top', 'wingR'], ['top', 'elbowL'], ['top', 'elbowR'], ['wingR', 'cornerR'], ['wingR', 'elbowR'], ['wingR', 'postR'],
  ['cornerR', 'postR'], ['elbowL', 'postL'], ['elbowR', 'postR'], ['elbowL', 'elbowR'], ['postL', 'postR'],
];
export const ROUTES: Record<Zone, Zone[]> = Object.fromEntries(ZONE_IDS.map((z) => [z, [] as Zone[]])) as unknown as Record<Zone, Zone[]>;
for (const [a, b] of LINKS) { ROUTES[a].push(b); ROUTES[b].push(a); }

export const zoneDist = (a: Zone, b: Zone) => Math.hypot(ZONES[a].x - ZONES[b].x, ZONES[a].y - ZONES[b].y);
export const zonePts = (z: Zone) => (ZONES[z].kind === 'three' ? 2 : 1);

// ---------------------------------------------------------------- tuning

/** Every value that shapes the balance lives here so the simulator can report and tweak it. */
export const TUNE = {
  /** Decisions per possession (the last one can only be a shot). */
  actions: 4,
  /** Decisions granted after an offensive rebound. */
  orebActions: 2,
  /** How many decisions an advantage (beaten defender / open man) survives. */
  advTtl: 2,
  shotBase: { close: 0.53, mid: 0.43, three: 0.3 } as Record<ZoneKind, number>,
  shotSkill: { close: 0.03, mid: 0.035, three: 0.04 } as Record<ZoneKind, number>,
  cornerBonus: 0.03,
  openBonus: 0.2,
  defSkill: 0.015,
  /** Make-chance change caused by each stance, by shot distance. */
  stanceShot: {
    press: { close: -0.1, mid: -0.13, three: -0.13 },
    space: { close: -0.07, mid: 0.1, three: 0.12 },
    deny: { close: 0.05, mid: -0.03, three: -0.04 },
  } as Record<Stance, Record<ZoneKind, number>>,
  block: {
    press: { close: 0.1, mid: 0.06, three: 0.03 },
    space: { close: 0.06, mid: 0.01, three: 0 },
    deny: { close: 0.02, mid: 0.02, three: 0.01 },
  } as Record<Stance, Record<ZoneKind, number>>,
  oreb: 0.22,
  drive: {
    press: { beat: 0.45, steal: 0.14 },
    space: { beat: 0.12, steal: 0.04 },
    deny: { beat: 0.33, steal: 0.08 },
  } as Record<Stance, { beat: number; steal: number }>,
  driveSkill: 0.04,
  /** Chance that a help defender leaves their man when a drive reaches the paint against a sagging defense. */
  help: 0.6,
  pick: { press: 0.06, space: 0.03, deny: 0.18 } as Record<Stance, number>,
  pickLong: 0.07,
  cut: { press: 0.45, space: 0.3, deny: 0.7 } as Record<Stance, number>,
  cutSkill: 0.03,
  /** Steal chance on the ball handler while a teammate cuts against pressure. */
  holdStrip: 0.06,
};

/** Match format: first to `winScore`, or the leader once both teams had `maxPoss` possessions. */
export const MATCH_RULES = { winScore: 9, maxPoss: 9 };

// ---------------------------------------------------------------- state

export type Stance = 'press' | 'space' | 'deny';
export const STANCES: Stance[] = ['press', 'space', 'deny'];
export type StanceDist = Record<Stance, number>;

export type Act =
  | { k: 'shoot' }
  | { k: 'pass'; to: number }
  | { k: 'drive'; z: Zone }
  | { k: 'cut'; who: number; z: Zone };
export type ActKind = Act['k'];
export const ACT_KINDS: ActKind[] = ['shoot', 'pass', 'drive', 'cut'];

/** att[i] is guarded by def[i]. */
export interface Matchup { att: Stats[]; def: Stats[] }

export interface Poss {
  zones: Zone[];
  /** Advantage time-to-live per attacker (0 = guarded, >0 = open). */
  adv: number[];
  ball: number;
  /** Decisions left in this possession, including this one. */
  left: number;
  /** Offensive rebounds already taken this possession (capped so a possession always ends). */
  rebs: number;
}

export type Ev =
  | 'make' | 'miss' | 'oreb' | 'block'
  | 'catch' | 'pick'
  | 'beat' | 'held' | 'stopped' | 'help' | 'steal'
  | 'open' | 'covered';

export interface Branch {
  p: number;
  ev: Ev;
  pts: number;
  /** State for the next decision, or null when the possession is over. */
  next: Poss | null;
  /** Attacker freed by a help rotation. */
  freed?: number;
  /** Make chance of the shot when this branch is a shot (for explanations). */
  shotP?: number;
  /** The shooter was open, so the stance did not matter. */
  open?: boolean;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function actKey(a: Act): string {
  switch (a.k) {
    case 'shoot': return 'shoot';
    case 'pass': return `pass${a.to}`;
    case 'drive': return `drive-${a.z}`;
    case 'cut': return `cut${a.who}-${a.z}`;
  }
}

export function startPoss(setup: Zone[], ball = 0, actions = TUNE.actions): Poss {
  return { zones: [...setup], adv: [0, 0, 0], ball, left: actions, rebs: 0 };
}

/** Starting formations (handler first). Chosen per possession for variety. */
export const SETUPS: Zone[][] = [
  ['top', 'wingL', 'wingR'],
  ['top', 'cornerL', 'wingR'],
  ['top', 'wingL', 'cornerR'],
  ['wingL', 'top', 'cornerR'],
  ['wingR', 'top', 'cornerL'],
];

/** Place the three attackers of a setup so attacker `handler` holds the ball at the setup's first zone. */
export function setupPoss(setup: Zone[], handler: number): Poss {
  const zones: Zone[] = [];
  const rest = setup.slice(1);
  for (let i = 0; i < 3; i++) zones[i] = i === handler ? setup[0] : rest.shift()!;
  return startPoss(zones, handler);
}

function tick(s: Poss): Poss {
  return { zones: [...s.zones], adv: s.adv.map((t) => Math.max(0, t - 1)), ball: s.ball, left: s.left - 1, rebs: s.rebs };
}

export function legalActs(s: Poss): Act[] {
  const out: Act[] = [{ k: 'shoot' }];
  if (s.left <= 1) return out;
  for (let j = 0; j < 3; j++) if (j !== s.ball) out.push({ k: 'pass', to: j });
  const taken = new Set(s.zones);
  for (const z of ROUTES[s.zones[s.ball]]) if (!taken.has(z)) out.push({ k: 'drive', z });
  for (let j = 0; j < 3; j++) {
    if (j === s.ball) continue;
    for (const z of ROUTES[s.zones[j]]) if (!taken.has(z)) out.push({ k: 'cut', who: j, z });
  }
  return out;
}

// ---------------------------------------------------------------- odds of a single action

export function shotChance(m: Matchup, s: Poss, who: number, stance: Stance | null): { make: number; block: number } {
  const z = ZONES[s.zones[who]];
  const a = m.att[who], d = m.def[who];
  const skill = z.kind === 'close' ? (a.sho + a.str) / 2 : a.sho;
  let p = TUNE.shotBase[z.kind] + (skill - 5) * TUNE.shotSkill[z.kind];
  if (z.id === 'cornerL' || z.id === 'cornerR') p += TUNE.cornerBonus;
  if (s.adv[who] > 0) return { make: clamp(p + TUNE.openBonus, 0.05, 0.9), block: 0 };
  p -= (d.def - 5) * TUNE.defSkill;
  if (!stance) return { make: clamp(p, 0.05, 0.9), block: 0 };
  p += TUNE.stanceShot[stance][z.kind];
  const block = TUNE.block[stance][z.kind] * (1 + (d.blk - 5) * 0.12);
  return { make: clamp(p, 0.05, 0.9), block: clamp(block, 0, 0.3) };
}

export function orebChance(m: Matchup): number {
  const best = (l: Stats[]) => Math.max(...l.map((x) => x.str + x.blk));
  return clamp(TUNE.oreb + (best(m.att) - best(m.def)) * 0.015, 0.1, 0.4);
}

function rebounder(s: Poss, m: Matchup): number {
  const rank = { close: 0, mid: 1, three: 2 };
  return [0, 1, 2].sort((a, b) => rank[ZONES[s.zones[a]].kind] - rank[ZONES[s.zones[b]].kind] || (m.att[b].str - m.att[a].str))[0];
}

export function driveChance(m: Matchup, s: Poss, stance: Stance) {
  const a = m.att[s.ball], d = m.def[s.ball];
  const diff = (a.spd - d.def) * TUNE.driveSkill;
  const t = TUNE.drive[stance];
  const beat = clamp(t.beat + (stance === 'space' ? diff * 0.5 : diff), 0.02, 0.9);
  const steal = clamp(t.steal - diff * 0.5, 0.01, 0.4);
  return { beat, steal };
}

export function pickChance(m: Matchup, s: Poss, to: number, stance: Stance): number {
  const a = m.att[s.ball], dj = m.def[to], db = m.def[s.ball];
  let p = TUNE.pick[stance];
  if (stance === 'deny') {
    p += (dj.def - a.pas) * 0.02;
    if (zoneDist(s.zones[s.ball], s.zones[to]) > 9) p += TUNE.pickLong;
    if (s.adv[to] > 0) p -= 0.1;
  } else if (stance === 'press') p += (db.def - a.pas) * 0.01;
  return clamp(p, 0.01, 0.5);
}

export function cutChance(m: Matchup, who: number, stance: Stance): number {
  return clamp(TUNE.cut[stance] + (m.att[who].spd - m.def[who].def) * TUNE.cutSkill, 0.05, 0.9);
}

/** Teammate whose defender would rotate to help on a drive that ends at `z`. */
export function helperFor(s: Poss, z: Zone): number {
  const mates = [0, 1, 2].filter((j) => j !== s.ball);
  return mates.sort((a, b) => zoneDist(s.zones[a], z) - zoneDist(s.zones[b], z))[0];
}

/** All outcomes of one action against one stance, with exact probabilities. */
export function branches(m: Matchup, s: Poss, act: Act, stance: Stance): Branch[] {
  const out: Branch[] = [];
  switch (act.k) {
    case 'shoot': {
      const { make, block } = shotChance(m, s, s.ball, stance);
      const pts = zonePts(s.zones[s.ball]);
      const ob = s.rebs >= 2 ? 0 : orebChance(m);
      const open = s.adv[s.ball] > 0;
      out.push({ p: block, ev: 'block', pts: 0, next: null, shotP: make, open });
      out.push({ p: (1 - block) * make, ev: 'make', pts, next: null, shotP: make, open });
      const r = rebounder(s, m);
      const next: Poss = { zones: [...s.zones], adv: [0, 0, 0], ball: r, left: TUNE.orebActions, rebs: s.rebs + 1 };
      out.push({ p: (1 - block) * (1 - make) * ob, ev: 'oreb', pts: 0, next, shotP: make, open });
      out.push({ p: (1 - block) * (1 - make) * (1 - ob), ev: 'miss', pts: 0, next: null, shotP: make, open });
      break;
    }
    case 'pass': {
      const pick = pickChance(m, s, act.to, stance);
      const n = tick(s);
      n.ball = act.to;
      out.push({ p: 1 - pick, ev: 'catch', pts: 0, next: n });
      out.push({ p: pick, ev: 'pick', pts: 0, next: null });
      break;
    }
    case 'drive': {
      const { beat, steal } = driveChance(m, s, stance);
      const rest = Math.max(0, 1 - beat - steal);
      const nb = tick(s);
      nb.zones[s.ball] = act.z;
      nb.adv[s.ball] = TUNE.advTtl;
      out.push({ p: beat, ev: 'beat', pts: 0, next: nb });
      out.push({ p: steal, ev: 'steal', pts: 0, next: null });
      if (stance === 'press') {
        out.push({ p: rest, ev: 'stopped', pts: 0, next: tick(s) });
      } else {
        const nh = tick(s);
        nh.zones[s.ball] = act.z;
        if (stance === 'space' && ZONES[act.z].kind !== 'three') {
          const freed = helperFor(s, act.z);
          const nf = tick(s);
          nf.zones[s.ball] = act.z;
          nf.adv[freed] = TUNE.advTtl;
          out.push({ p: rest * TUNE.help, ev: 'help', pts: 0, next: nf, freed });
          out.push({ p: rest * (1 - TUNE.help), ev: 'held', pts: 0, next: nh });
        } else out.push({ p: rest, ev: 'held', pts: 0, next: nh });
      }
      break;
    }
    case 'cut': {
      // While a teammate cuts, the handler holds the ball: pressure can strip it.
      const strip = stance === 'press' ? TUNE.holdStrip : 0;
      const open = cutChance(m, act.who, stance) * (1 - strip);
      const no = tick(s);
      no.zones[act.who] = act.z;
      no.adv[act.who] = TUNE.advTtl;
      const nc = tick(s);
      nc.zones[act.who] = act.z;
      out.push({ p: open, ev: 'open', pts: 0, next: no });
      out.push({ p: 1 - open - strip, ev: 'covered', pts: 0, next: nc });
      out.push({ p: strip, ev: 'steal', pts: 0, next: null });
      break;
    }
  }
  return out.filter((b) => b.p > 1e-9);
}

/** Outcome probabilities of an action against a stance distribution (exact). */
export function actOdds(m: Matchup, s: Poss, act: Act, dist: StanceDist): Partial<Record<Ev, number>> {
  const o: Partial<Record<Ev, number>> = {};
  for (const st of STANCES) {
    if (!dist[st]) continue;
    for (const b of branches(m, s, act, st)) o[b.ev] = (o[b.ev] ?? 0) + dist[st] * b.p;
  }
  return o;
}

/** Sample a branch with a uniform random number in [0, 1). */
export function pickBranch(list: Branch[], r: number): Branch {
  for (const b of list) { r -= b.p; if (r < 0) return b; }
  return list[list.length - 1];
}

export function sampleStance(dist: StanceDist, r: number): Stance {
  for (const st of STANCES) { r -= dist[st]; if (r < 0) return st; }
  return 'deny';
}

// ---------------------------------------------------------------- defense policies

export function normDist(w: Record<Stance, number>): StanceDist {
  const sum = STANCES.reduce((a, k) => a + Math.max(0, w[k]), 0) || 1;
  return { press: Math.max(0, w.press) / sum, space: Math.max(0, w.space) / sum, deny: Math.max(0, w.deny) / sum };
}

export const UNIFORM: StanceDist = { press: 1 / 3, space: 1 / 3, deny: 1 / 3 };

/**
 * "Reads the court": the default defense. Only uses public information (positions, open men,
 * shooter quality, decisions left), never the attacker's pending choice.
 */
export function readDefense(m: Matchup, s: Poss): StanceDist {
  const i = s.ball;
  const z = ZONES[s.zones[i]];
  const a = m.att[i];
  const w = { press: 1, space: 1, deny: 1 };
  if (s.left <= 1) w.press += 3;
  if (z.kind === 'three') { if (a.sho >= 6) w.press += 0.7; else w.space += 0.7; }
  if (z.kind === 'close') w.space += 0.6;
  if (a.spd >= 7) w.space += 0.4;
  if (s.adv.some((t, j) => t > 0 && j !== i)) w.deny += 0.9;
  return normDist(w);
}

/** The human's recent defensive stances, used by the AI attacker to guess the next one. */
export class Habits {
  stance: Record<Stance, number> = { press: 0, space: 0, deny: 0 };
  private recentS: Stance[] = [];
  addStance(st: Stance) {
    this.recentS.push(st);
    this.stance[st]++;
    if (this.recentS.length > 10) this.stance[this.recentS.shift()!]--;
  }
  stanceTotal() { return this.recentS.length; }
}

/** One-step value of an action: points now plus the shot value of the resulting state. */
export function quickQ(m: Matchup, s: Poss, act: Act, dist: StanceDist, nextDist: (s: Poss) => StanceDist = (x) => readDefense(m, x)): number {
  let v = 0;
  for (const st of STANCES) {
    if (!dist[st]) continue;
    for (const b of branches(m, s, act, st)) {
      v += dist[st] * b.p * (b.pts + (b.next ? shotEV(m, b.next, nextDist(b.next)) : 0));
    }
  }
  return v;
}

/** Expected points of shooting right now. */
export function shotEV(m: Matchup, s: Poss, dist: StanceDist): number {
  let v = 0;
  for (const st of STANCES) {
    if (!dist[st]) continue;
    for (const b of branches(m, s, { k: 'shoot' }, st)) {
      v += dist[st] * b.p * (b.pts + (b.next ? 0.5 : 0));
    }
  }
  return v;
}

/** Candidate models of how an attacker decides. The adaptive defense learns which one fits best. */
type AttackModel = (m: Matchup, s: Poss, dist: StanceDist, planner: Planner) => Act;
const ONE = (st: Stance): StanceDist => ({ press: 0, space: 0, deny: 0, [st]: 1 });
const argmax = (acts: Act[], f: (a: Act) => number) => {
  let best = acts[0], bv = -Infinity;
  for (const a of acts) { const v = f(a); if (v > bv) { bv = v; best = a; } }
  return best;
};
export const ATTACK_MODELS: Record<string, AttackModel> = {
  shootNow: () => ({ k: 'shoot' }),
  bestNow: (m, s, dist) => argmax(legalActs(s), (a) => quickQ(m, s, a, dist)),
  planner: (_m, s, dist, p) => argmax(legalActs(s), (a) => p.q(s, a, dist)),
  feedShooter: (m, s) => {
    const star = [0, 1, 2].sort((a, b) => m.att[b].sho - m.att[a].sho)[0];
    return s.ball !== star && s.left > 1 ? { k: 'pass', to: star } : { k: 'shoot' };
  },
  driveIn: (_m, s, dist, p) => {
    const drives = legalActs(s).filter((a) => a.k === 'drive');
    return drives.length ? argmax(drives, (a) => p.q(s, a, dist)) : { k: 'shoot' };
  },
  cutFirst: (_m, s, dist, p) => {
    const cuts = legalActs(s).filter((a) => a.k === 'cut');
    return cuts.length ? argmax(cuts, (a) => p.q(s, a, dist)) : { k: 'shoot' };
  },
};

/**
 * Adaptive defense. It watches the attacker's past decisions, scores how well each candidate model
 * would have predicted them, predicts the next action from the models that fit, and leans toward
 * the stance that answers it. It only uses history and the public state, never the pending choice.
 */
export class OpponentModel {
  score: Record<string, number> = Object.fromEntries(Object.keys(ATTACK_MODELS).map((k) => [k, 0.3]));
  seen = 0;
  planner: Planner;
  constructor(planner: Planner) { this.planner = planner; }
  observe(m: Matchup, s: Poss, dist: StanceDist, act: Act) {
    const key = actKey(act);
    for (const [name, f] of Object.entries(ATTACK_MODELS)) {
      const hit = actKey(f(m, s, dist, this.planner)) === key ? 1 : 0;
      this.score[name] = this.score[name] * 0.75 + hit * 0.25;
    }
    this.seen++;
  }
  defend(m: Matchup, s: Poss, smart: number): StanceDist {
    const base = readDefense(m, s);
    if (this.seen < 2 || smart <= 0) return base;
    const preds: { a: Act; w: number }[] = [];
    let wsum = 0;
    for (const [name, f] of Object.entries(ATTACK_MODELS)) {
      const w = this.score[name] ** 3;
      if (w < 1e-4) continue;
      preds.push({ a: f(m, s, base, this.planner), w });
      wsum += w;
    }
    if (!wsum) return base;
    const value: Record<Stance, number> = { press: 0, space: 0, deny: 0 };
    for (const { a, w } of preds) for (const st of STANCES) value[st] += (w / wsum) * this.planner.q(s, a, ONE(st));
    const min = Math.min(value.press, value.space, value.deny);
    const counter = normDist({
      press: Math.exp(-(value.press - min) * 10),
      space: Math.exp(-(value.space - min) * 10),
      deny: Math.exp(-(value.deny - min) * 10),
    });
    const conf = Math.max(...Object.values(this.score));
    const k = clamp(smart * conf, 0, 0.9);
    return normDist({
      press: base.press * (1 - k) + counter.press * k,
      space: base.space * (1 - k) + counter.space * k,
      deny: base.deny * (1 - k) + counter.deny * k,
    });
  }
}

// ---------------------------------------------------------------- planner (expected points with best play)

const keyOf = (s: Poss) => `${s.zones.join(',')}|${s.adv.join('')}|${s.ball}|${s.left}|${s.rebs}`;

/** Exact expectimax over the rest of the possession against a state-only stance policy. */
export class Planner {
  private memo = new Map<string, number>();
  m: Matchup;
  policy: (s: Poss) => StanceDist;
  constructor(m: Matchup, policy: (s: Poss) => StanceDist) { this.m = m; this.policy = policy; }
  value(s: Poss): number {
    const k = keyOf(s);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    let best = -1;
    for (const a of legalActs(s)) best = Math.max(best, this.q(s, a));
    this.memo.set(k, best);
    return best;
  }
  q(s: Poss, act: Act, dist = this.policy(s)): number {
    let v = 0;
    for (const st of STANCES) {
      if (!dist[st]) continue;
      for (const b of branches(this.m, s, act, st)) v += dist[st] * b.p * (b.pts + (b.next ? this.value(b.next) : 0));
    }
    return v;
  }
}

// ---------------------------------------------------------------- AI attack (when the human defends)

export interface Weighted<T> { item: T; w: number }

/**
 * AI attacker: softmax over planner values. It assumes the human defends like a mix of a uniform
 * guess and the human's own stance habits (weight `smart`), never the pending stance.
 */
export function aiAttackDist(planner: Planner, s: Poss, h: Habits, smart: number, temp: number): Weighted<Act>[] {
  const tot = h.stanceTotal();
  const k = tot >= 3 ? clamp(smart * Math.min(1, tot / 6), 0, 1) : 0;
  const belief: StanceDist = normDist({
    press: UNIFORM.press * (1 - k) + (tot ? h.stance.press / tot : 0) * k,
    space: UNIFORM.space * (1 - k) + (tot ? h.stance.space / tot : 0) * k,
    deny: UNIFORM.deny * (1 - k) + (tot ? h.stance.deny / tot : 0) * k,
  });
  const acts = legalActs(s);
  const qs = acts.map((a) => planner.q(s, a, belief));
  const max = Math.max(...qs);
  const ws = qs.map((q) => Math.exp((q - max) / temp));
  // Keep the menu short and readable: drop actions with negligible weight.
  const sum = ws.reduce((x, y) => x + y, 0);
  let list = acts.map((a, i) => ({ item: a, w: ws[i] / sum })).filter((x) => x.w >= 0.03);
  const s2 = list.reduce((x, y) => x + y.w, 0);
  list = list.map((x) => ({ item: x.item, w: x.w / s2 }));
  return list;
}

/** Defender view: outcome probabilities of one stance against the AI attacker's action distribution. */
export function stanceOdds(m: Matchup, s: Poss, stance: Stance, attDist: Weighted<Act>[]) {
  const o = { score: 0, ball: 0, cont: 0 };
  for (const { item, w } of attDist) {
    for (const b of branches(m, s, item, stance)) {
      if (b.ev === 'make') o.score += w * b.p;
      else if (b.next) o.cont += w * b.p;
      else o.ball += w * b.p;
    }
  }
  return o;
}

export function sampleWeighted<T>(list: Weighted<T>[], r: number): T {
  for (const x of list) { r -= x.w; if (r < 0) return x.item; }
  return list[list.length - 1].item;
}

// ---------------------------------------------------------------- rounding & randomness

/** Round probabilities to integer percentages that add up to exactly 100. */
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

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- causal explanation

const pc = (p: number) => `${Math.round(p * 100)}%`;

/**
 * One short sentence that says what caused the result, in attacker or defender voice.
 * It names the stance and the odds, so a lucky or unlucky roll never reads as certain.
 */
export function explain(act: Act, stance: Stance, b: Branch, userAttacks: boolean): string {
  const you = userAttacks;
  switch (b.ev) {
    case 'make':
    case 'miss':
    case 'oreb': {
      const p = b.shotP ?? 0;
      const hit = b.ev === 'make';
      const st = b.open ? (you ? 'Wide open: a' : 'They were open: a')
        : stance === 'press' ? (you ? 'Pressure cut the shot to' : 'Your pressure cut the shot to')
        : stance === 'space' ? (you ? 'Space gave a' : 'Your space gave them a')
          : (you ? 'Denial left a' : 'Your denial left a');
      const tail = stance === 'press' && !b.open ? ` ${pc(p)}` : ` ${pc(p)} look`;
      const res = hit ? (p < 0.35 ? 'It fell anyway.' : 'In.') : (p >= 0.5 ? 'It rimmed out.' : 'Missed.');
      const reb = b.ev === 'oreb' ? ' Offensive board.' : '';
      return `${st}${tail}. ${res}${reb}`;
    }
    case 'block':
      return stance === 'press' ? (you ? 'Tight pressure: blocked.' : 'Your pressure got the block.') : (you ? 'Help in the paint blocked it.' : 'Your help blocked it.');
    case 'catch':
      return stance === 'deny' ? (you ? 'Lane was closed, the pass still got through.' : 'They threaded the pass past your denial.') : (you ? 'Pass caught. The ball moves.' : 'They swung the ball.');
    case 'pick':
      return stance === 'deny' ? (you ? 'They were denying the pass: picked off.' : 'Denial paid off: picked off.') : (you ? 'Risky pass: picked off.' : 'Lucky tip: picked off.');
    case 'beat':
      return stance === 'press' ? (you ? 'Your defender pressed high, so you blew past.' : 'Pressing high let them blow past.') : stance === 'deny' ? (you ? 'No help behind the denial: you got by.' : 'Denying left no help: they got by.') : (you ? 'Quick first step: you got by.' : 'Quick first step beat your space.');
    case 'held':
      return stance === 'space' ? (you ? 'Your defender gave ground but stayed in front.' : 'You gave ground and stayed in front.') : (you ? 'You got there, still guarded.' : 'They moved, you stayed attached.');
    case 'stopped':
      return you ? 'The pressure stopped your drive.' : 'Your pressure stopped the drive.';
    case 'help':
      return you ? 'Help came to stop you: a teammate is free.' : 'Your help stopped the drive, but left a man free.';
    case 'steal':
      return stance === 'press' ? (you ? 'Pressure on the drive: stolen.' : 'Your pressure stole it.') : (you ? 'Stripped on the drive.' : 'You stripped the drive.');
    case 'open':
      return stance === 'deny' ? (you ? 'The defender overplayed the pass: backdoor, wide open.' : 'Overplaying the lane: backdoor, open man.') : (you ? 'The cut lost the defender.' : 'The cut lost your defender.');
    case 'covered':
      return stance === 'space' ? (you ? 'Sagging help saw the cut coming.' : 'Your help saw the cut coming.') : (you ? 'The defender stayed with the cut.' : 'You stayed with the cut.');
  }
  void act;
  return '';
}
