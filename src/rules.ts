// Turn Ball possession engine. Pure TypeScript (no DOM, no Three.js) so the game and the headless
// simulator (`npm run sim`) share exactly the same rules and the same odds.
//
// A possession is a short chain of decisions. Each decision the attack picks one action (shoot, pass,
// drive with the ball, or a play) done with one technique (jump shot, bank shot, bounce pass,
// crossover, pick and roll...). Shots, passes and drives use the ball handler's techniques; plays use
// the techniques of the player who moves. The defense picks one of three stance families
// without seeing it (press, give space, deny the pass) and plays it with one of the team's defensive
// techniques (press or ball hawk, give space / float / help and recover, deny / jump lanes / switch).
// Every outcome of an (action, technique, defensive move) triple is an explicit weighted branch, so
// the odds shown on screen are exact.
import type { Stats } from './data.ts';
import { BASE_TECH, TECHS, type TechId } from './techs.ts';

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
const HOOP_XY = { x: 7.5, y: 1.575 };

const LINKS: [Zone, Zone][] = [
  ['cornerL', 'wingL'], ['cornerL', 'postL'], ['wingL', 'top'], ['wingL', 'elbowL'], ['wingL', 'postL'],
  ['top', 'wingR'], ['top', 'elbowL'], ['top', 'elbowR'], ['wingR', 'cornerR'], ['wingR', 'elbowR'], ['wingR', 'postR'],
  ['cornerR', 'postR'], ['elbowL', 'postL'], ['elbowR', 'postR'], ['elbowL', 'elbowR'], ['postL', 'postR'],
];
export const ROUTES: Record<Zone, Zone[]> = Object.fromEntries(ZONE_IDS.map((z) => [z, [] as Zone[]])) as unknown as Record<Zone, Zone[]>;
for (const [a, b] of LINKS) { ROUTES[a].push(b); ROUTES[b].push(a); }

export const zoneDist = (a: Zone, b: Zone) => Math.hypot(ZONES[a].x - ZONES[b].x, ZONES[a].y - ZONES[b].y);
export const rimDist = (z: Zone) => Math.hypot(ZONES[z].x - HOOP_XY.x, ZONES[z].y - HOOP_XY.y);
export const zonePts = (z: Zone) => (ZONES[z].kind === 'three' ? 2 : 1);

// ---------------------------------------------------------------- tuning

export type Stance = 'press' | 'space' | 'deny';
export const STANCES: Stance[] = ['press', 'space', 'deny'];
export type StanceDist = Record<Stance, number>;

/** Everything one defensive move (a stance family played with one technique) changes. */
export interface DefMove {
  fam: Stance;
  /** Make-chance change on contested shots, by distance. */
  shot: Record<ZoneKind, number>;
  block: Record<ZoneKind, number>;
  drive: { beat: number; steal: number };
  /** Base pick chance on passes. */
  pick: number;
  /** Base open chance on cuts. */
  cut: number;
  /** Steal chance on the holder while a play develops. */
  strip: number;
  /** Chance that a help defender leaves their man on a drive into the paint. */
  help: number;
  /** Screen: open chance for the cutter / chance the screener slips free when it fails. */
  screen: number; slip: number;
  /** Pick and roll: handler free / roller open / strip. */
  pnr: { h: number; r: number; steal: number };
  /** Give and go: open chance when the return pass gets there. */
  gng: number;
  /** Step-back: chance to make room. */
  room: number;
}

const D = (fam: Stance, shot: [number, number, number], block: [number, number, number], beat: number, steal: number, pick: number, cut: number,
  rest: Omit<DefMove, 'fam' | 'shot' | 'block' | 'drive' | 'pick' | 'cut'>): DefMove => ({
  fam, shot: { close: shot[0], mid: shot[1], three: shot[2] }, block: { close: block[0], mid: block[1], three: block[2] },
  drive: { beat, steal }, pick, cut, ...rest,
});

/** One row per defensive technique. Base rows (press, space, deny) are the v3 numbers. */
export const DEF_MOVES: Partial<Record<TechId, DefMove>> = {
  press: D('press', [-0.1, -0.13, -0.13], [0.1, 0.06, 0.03], 0.45, 0.14, 0.06, 0.45,
    { strip: 0.06, help: 0, screen: 0.66, slip: 0.2, pnr: { h: 0.32, r: 0.24, steal: 0.05 }, gng: 0.6, room: 0.4 }),
  hawk: D('press', [-0.05, -0.06, -0.06], [0.08, 0.04, 0.02], 0.56, 0.19, 0.1, 0.5,
    { strip: 0.1, help: 0, screen: 0.7, slip: 0.2, pnr: { h: 0.36, r: 0.26, steal: 0.08 }, gng: 0.66, room: 0.46 }),
  space: D('space', [-0.07, 0.1, 0.12], [0.06, 0.01, 0], 0.12, 0.04, 0.03, 0.3,
    { strip: 0, help: 0.6, screen: 0.32, slip: 0.2, pnr: { h: 0.34, r: 0.1, steal: 0.02 }, gng: 0.26, room: 0.12 }),
  float: D('space', [-0.15, 0.08, 0.1], [0.1, 0.01, 0], 0.05, 0.03, 0.02, 0.22,
    { strip: 0, help: 0.55, screen: 0.3, slip: 0.18, pnr: { h: 0.42, r: 0.05, steal: 0.02 }, gng: 0.2, room: 0.15 }),
  recover: D('space', [-0.04, 0.08, 0.1], [0.05, 0.01, 0], 0.26, 0.04, 0.04, 0.28,
    { strip: 0, help: 0.35, screen: 0.3, slip: 0.15, pnr: { h: 0.3, r: 0.08, steal: 0.02 }, gng: 0.22, room: 0.14 }),
  deny: D('deny', [0.05, -0.03, -0.04], [0.02, 0.02, 0.01], 0.33, 0.08, 0.18, 0.7,
    { strip: 0, help: 0, screen: 0.55, slip: 0.2, pnr: { h: 0.22, r: 0.32, steal: 0.02 }, gng: 0.34, room: 0.3 }),
  jump: D('deny', [0.07, -0.01, -0.02], [0.02, 0.01, 0.01], 0.38, 0.09, 0.25, 0.78,
    { strip: 0, help: 0, screen: 0.56, slip: 0.2, pnr: { h: 0.24, r: 0.36, steal: 0.02 }, gng: 0.3, room: 0.3 }),
  switch: D('deny', [0.1, 0.02, -0.05], [0.03, 0.02, 0.01], 0.3, 0.07, 0.1, 0.45,
    { strip: 0, help: 0, screen: 0.22, slip: 0.42, pnr: { h: 0.1, r: 0.12, steal: 0.02 }, gng: 0.28, room: 0.26 }),
};
export const famOf = (dm: TechId): Stance => DEF_MOVES[dm]!.fam;

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
  oreb: 0.22,
  driveSkill: 0.04,
  pickLong: 0.07,
  cutSkill: 0.03,
  /** Shot techniques: base make change, and how much of the defensive effect (negative / positive) and the block chance they keep. */
  shotTech: {
    jumper: { base: 0, neg: 1, pos: 1, block: 1 },
    bank: { base: 0, neg: 0.4, pos: 0.5, block: 0.6 },
    fade: { base: -0.05, neg: 0, pos: 0.3, block: 0.2 },
    layup: { base: 0.12, neg: 1.8, pos: 1, block: 2 },
  } as Record<string, { base: number; neg: number; pos: number; block: number }>,
  /** Bounce pass: pick multiplier against Deny, pick added against Press. */
  /** Layup: chance that a make comes with a foul and one extra point (contested / open). */
  andOne: { contested: 0.22, open: 0.12 },
  /** Bank shots need an angle: wings, elbows and posts. */
  bankZones: ['wingL', 'wingR', 'elbowL', 'elbowR', 'postL', 'postR'] as Zone[],
  bounce: { deny: 0.4, press: 0.05 },
  /** Lob: pick change by family. */
  lob: { press: 0.03, space: 0.16, deny: -0.08 } as Record<Stance, number>,
  /** Lob: share of catches that leave the catcher open (to the post every catch is an open finish). */
  lobFeedMid: 0.2,
  lobFeedPost: 0.7,
  /** No-look: extra pick chance, and share of catches that leave the catcher open, by family. */
  nolook: { pick: 0.05, feed: { press: 0.35, space: 0.28, deny: 0.22 } as Record<Stance, number> },
  /** Crossover: beat multiplier against Press, steal added otherwise. */
  cross: { pressBeat: 1.45, steal: 0.04 },
  /** Hesitation: beat change by family, extra steal against Press. */
  hesi: { press: -0.15, space: 0.2, deny: 0, pressSteal: 0.03 } as Record<string, number>,
  /** Spin move: beat and steal multipliers by family. */
  spin: { press: [0.8, 0.4], space: [0.45, 0.9], deny: [0.6, 0.65] } as Record<Stance, [number, number]>,
  /** Backdoor: open-chance multiplier by family. */
  backdoor: { press: 1.1, space: 0.5, deny: 1.35 } as Record<Stance, number>,
};

/** Match format: first to `winScore`, or the leader once both teams had `maxPoss` possessions. */
export const MATCH_RULES = { winScore: 9, maxPoss: 9 };

// ---------------------------------------------------------------- state

export type Act =
  | { k: 'shoot'; t: TechId }
  | { k: 'pass'; to: number; t: TechId }
  | { k: 'drive'; z: Zone; t: TechId }
  | { k: 'cut'; who: number; z: Zone; t: TechId };
export type ActKind = Act['k'];
export const ACT_KINDS: ActKind[] = ['shoot', 'pass', 'drive', 'cut'];

/**
 * att[i] is guarded by def[i]. kit[i] = equipped (non-base) techniques of attacker i; defKit = the
 * defending team's equipped defensive techniques. Base techniques are always available.
 */
export interface Matchup { att: Stats[]; def: Stats[]; kit?: TechId[][]; defKit?: TechId[] }

/** The defense's plan for one decision: the stance-family mix and the technique used for each family. */
export interface DefPlan { dist: StanceDist; v: Record<Stance, TechId> }
export const BASE_V: Record<Stance, TechId> = { press: 'press', space: 'space', deny: 'deny' };
export const planOf = (dist: StanceDist, v: Record<Stance, TechId> = BASE_V): DefPlan => ({ dist, v });

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
  | 'make' | 'and1' | 'miss' | 'oreb' | 'block'
  | 'catch' | 'feed' | 'pick'
  | 'beat' | 'room' | 'held' | 'stopped' | 'help' | 'steal'
  | 'open' | 'slip' | 'covered';

export interface Branch {
  p: number;
  ev: Ev;
  pts: number;
  /** State for the next decision, or null when the possession is over. */
  next: Poss | null;
  /** Attacker freed by a help rotation or a slipped screen. */
  freed?: number;
  /** Make chance of the shot when this branch is a shot (for explanations). */
  shotP?: number;
  /** The shooter was open, so the stance did not matter. */
  open?: boolean;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function actKey(a: Act): string {
  switch (a.k) {
    case 'shoot': return `shoot-${a.t}`;
    case 'pass': return `pass${a.to}-${a.t}`;
    case 'drive': return `drive-${a.z}-${a.t}`;
    case 'cut': return `cut${a.who}-${a.z}-${a.t}`;
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

/** Techniques of one kind the attacker can use: the base one plus the equipped ones. */
export function techsFor(m: Matchup | undefined, who: number, kind: ActKind): TechId[] {
  const out: TechId[] = [BASE_TECH[kind]];
  for (const t of m?.kit?.[who] ?? []) if (TECHS[t].kind === kind && !out.includes(t)) out.push(t);
  return out;
}

/** Defensive moves of one family the defending team can use. */
export function defMovesFor(m: Matchup | undefined, fam: Stance): TechId[] {
  const out: TechId[] = [fam];
  for (const t of m?.defKit ?? []) if (DEF_MOVES[t]?.fam === fam && !out.includes(t)) out.push(t);
  return out;
}

/** Where the roller of a pick and roll goes: the free post (or elbow) nearest the handler. */
export function rollZone(s: Poss): Zone | null {
  const taken = new Set(s.zones);
  const h = s.zones[s.ball];
  const free = ZONE_IDS.filter((z) => !taken.has(z) && ZONES[z].kind !== 'three');
  if (!free.length) return null;
  const close = free.filter((z) => ZONES[z].kind === 'close');
  const pool = close.length ? close : free;
  return pool.sort((a, b) => zoneDist(a, h) - zoneDist(b, h))[0];
}

/** Teammate who gives and gets the ball back on a give and go (the nearest one). */
export function gngPartner(s: Poss): number {
  return [0, 1, 2].filter((j) => j !== s.ball).sort((a, b) => zoneDist(s.zones[a], s.zones[s.ball]) - zoneDist(s.zones[b], s.zones[s.ball]))[0];
}

/** The teammate who sets the off-ball screen for a cutter. */
export const screenerFor = (s: Poss, who: number) => [0, 1, 2].find((j) => j !== s.ball && j !== who)!;

export function legalActs(s: Poss, m?: Matchup): Act[] {
  const i = s.ball;
  const hz = s.zones[i];
  const out: Act[] = [];
  for (const t of techsFor(m, i, 'shoot')) {
    if (t === 'layup' && ZONES[hz].kind !== 'close') continue;
    if (t === 'bank' && !TUNE.bankZones.includes(hz)) continue;
    out.push({ k: 'shoot', t });
  }
  if (s.left <= 1) return out;
  const taken = new Set(s.zones);
  for (const t of techsFor(m, i, 'pass')) {
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      if (t === 'bounce' && zoneDist(hz, s.zones[j]) > 9) continue;
      if (t === 'lob' && ZONES[s.zones[j]].kind === 'three') continue;
      out.push({ k: 'pass', to: j, t });
    }
  }
  for (const t of techsFor(m, i, 'drive')) {
    if (t === 'stepback') { if (ZONES[hz].kind !== 'close') out.push({ k: 'drive', z: hz, t }); continue; }
    for (const z of ROUTES[hz]) if (!taken.has(z)) out.push({ k: 'drive', z, t });
  }
  // Plays belong to the player who moves: the cutter, the screener who rolls, or the handler on a give and go.
  for (const t of techsFor(m, i, 'cut')) {
    if (t !== 'giveandgo') continue;
    for (const z of ROUTES[hz]) if (!taken.has(z) && rimDist(z) < rimDist(hz) - 0.5) out.push({ k: 'cut', who: i, z, t });
  }
  const roll = rollZone(s);
  for (let j = 0; j < 3; j++) {
    if (j === i) continue;
    for (const t of techsFor(m, j, 'cut')) {
      if (t === 'giveandgo') continue;
      if (t === 'pnr') { if (roll) out.push({ k: 'cut', who: j, z: roll, t }); continue; }
      for (const z of ROUTES[s.zones[j]]) {
        if (taken.has(z)) continue;
        if (t === 'backdoor' && !(rimDist(z) < rimDist(s.zones[j]) - 0.5)) continue;
        out.push({ k: 'cut', who: j, z, t });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- odds of a single action

export function shotChance(m: Matchup, s: Poss, who: number, dm: TechId | null, t: TechId = 'jumper'): { make: number; block: number } {
  const z = ZONES[s.zones[who]];
  const a = m.att[who], d = m.def[who];
  const tt = TUNE.shotTech[t] ?? TUNE.shotTech.jumper;
  const skill = z.kind === 'close' ? (a.sho + a.str) / 2 : a.sho;
  let p = TUNE.shotBase[z.kind] + (skill - 5) * TUNE.shotSkill[z.kind] + tt.base;
  if (z.id === 'cornerL' || z.id === 'cornerR') p += TUNE.cornerBonus;
  if (s.adv[who] > 0) return { make: clamp(p + TUNE.openBonus, 0.05, 0.92), block: 0 };
  p -= (d.def - 5) * TUNE.defSkill;
  if (!dm) return { make: clamp(p, 0.05, 0.92), block: 0 };
  const row = DEF_MOVES[dm]!;
  const eff = row.shot[z.kind];
  p += eff < 0 ? eff * tt.neg : eff * tt.pos;
  const block = row.block[z.kind] * (1 + (d.blk - 5) * 0.12) * tt.block;
  return { make: clamp(p, 0.05, 0.92), block: clamp(block, 0, 0.35) };
}

export function orebChance(m: Matchup): number {
  const best = (l: Stats[]) => Math.max(...l.map((x) => x.str + x.blk));
  return clamp(TUNE.oreb + (best(m.att) - best(m.def)) * 0.015, 0.1, 0.4);
}

function rebounder(s: Poss, m: Matchup): number {
  const rank = { close: 0, mid: 1, three: 2 };
  return [0, 1, 2].sort((a, b) => rank[ZONES[s.zones[a]].kind] - rank[ZONES[s.zones[b]].kind] || (m.att[b].str - m.att[a].str))[0];
}

export function driveChance(m: Matchup, s: Poss, dm: TechId, t: TechId = 'drive') {
  const a = m.att[s.ball], d = m.def[s.ball];
  const row = DEF_MOVES[dm]!;
  const fam = row.fam;
  const diff = (a.spd - d.def) * TUNE.driveSkill;
  if (t === 'stepback') {
    const beat = clamp(row.room + diff * 0.5, 0.02, 0.9);
    const steal = clamp(0.05 - diff * 0.25, 0.01, 0.3);
    return { beat, steal };
  }
  let beat = row.drive.beat + (fam === 'space' ? diff * 0.5 : diff);
  let steal = row.drive.steal - diff * 0.5;
  if (t === 'cross') { if (fam === 'press') beat *= TUNE.cross.pressBeat; else steal += TUNE.cross.steal; }
  if (t === 'hesi') { beat += TUNE.hesi[fam]; if (fam === 'press') steal += TUNE.hesi.pressSteal; }
  if (t === 'spin') { beat *= TUNE.spin[fam][0]; steal *= TUNE.spin[fam][1]; }
  return { beat: clamp(beat, 0.02, 0.9), steal: clamp(steal, 0.01, 0.4) };
}

export function pickChance(m: Matchup, s: Poss, to: number, dm: TechId, t: TechId = 'chest'): number {
  const a = m.att[s.ball], dj = m.def[to], db = m.def[s.ball];
  const row = DEF_MOVES[dm]!;
  let p = row.pick;
  if (row.fam === 'deny') {
    p += (dj.def - a.pas) * 0.02;
    if (zoneDist(s.zones[s.ball], s.zones[to]) > 9) p += TUNE.pickLong;
    if (s.adv[to] > 0) p -= 0.1;
  } else if (row.fam === 'press') p += (db.def - a.pas) * 0.01;
  if (t === 'bounce') { if (row.fam === 'deny') p *= TUNE.bounce.deny; if (row.fam === 'press') p += TUNE.bounce.press; }
  if (t === 'lob') p += TUNE.lob[row.fam];
  if (t === 'nolook') p += TUNE.nolook.pick;
  return clamp(p, 0.01, 0.5);
}

export function cutChance(m: Matchup, who: number, dm: TechId, t: TechId = 'cut'): number {
  const row = DEF_MOVES[dm]!;
  let base = row.cut;
  if (t === 'backdoor') base *= TUNE.backdoor[row.fam];
  if (t === 'screen') base = row.screen;
  if (t === 'giveandgo') base = row.gng;
  return clamp(base + (m.att[who].spd - m.def[who].def) * TUNE.cutSkill, 0.03, 0.92);
}

/** Teammate whose defender would rotate to help on a drive that ends at `z`. */
export function helperFor(s: Poss, z: Zone): number {
  const mates = [0, 1, 2].filter((j) => j !== s.ball);
  return mates.sort((a, b) => zoneDist(s.zones[a], z) - zoneDist(s.zones[b], z))[0];
}

/** All outcomes of one action against one defensive move, with exact probabilities. */
export function branches(m: Matchup, s: Poss, act: Act, dm: TechId): Branch[] {
  const out: Branch[] = [];
  const row = DEF_MOVES[dm]!;
  switch (act.k) {
    case 'shoot': {
      const { make, block } = shotChance(m, s, s.ball, dm, act.t);
      const pts = zonePts(s.zones[s.ball]);
      const ob = s.rebs >= 2 ? 0 : orebChance(m);
      const open = s.adv[s.ball] > 0;
      out.push({ p: block, ev: 'block', pts: 0, next: null, shotP: make, open });
      const and1 = act.t === 'layup' ? (open ? TUNE.andOne.open : TUNE.andOne.contested) : 0;
      if (and1 > 0) out.push({ p: (1 - block) * make * and1, ev: 'and1', pts: pts + 1, next: null, shotP: make, open });
      out.push({ p: (1 - block) * make * (1 - and1), ev: 'make', pts, next: null, shotP: make, open });
      const r = rebounder(s, m);
      const next: Poss = { zones: [...s.zones], adv: [0, 0, 0], ball: r, left: TUNE.orebActions, rebs: s.rebs + 1 };
      out.push({ p: (1 - block) * (1 - make) * ob, ev: 'oreb', pts: 0, next, shotP: make, open });
      out.push({ p: (1 - block) * (1 - make) * (1 - ob), ev: 'miss', pts: 0, next: null, shotP: make, open });
      break;
    }
    case 'pass': {
      const pick = pickChance(m, s, act.to, dm, act.t);
      const n = tick(s);
      n.ball = act.to;
      let feed = 0;
      if (act.t === 'lob') feed = ZONES[s.zones[act.to]].kind === 'close' ? TUNE.lobFeedPost : TUNE.lobFeedMid;
      if (act.t === 'nolook') feed = TUNE.nolook.feed[row.fam];
      if (feed > 0) {
        const nf = tick(s);
        nf.ball = act.to;
        nf.adv[act.to] = Math.max(nf.adv[act.to], 1);
        out.push({ p: (1 - pick) * feed, ev: 'feed', pts: 0, next: nf });
      }
      out.push({ p: (1 - pick) * (1 - feed), ev: 'catch', pts: 0, next: n });
      out.push({ p: pick, ev: 'pick', pts: 0, next: null });
      break;
    }
    case 'drive': {
      const { beat, steal } = driveChance(m, s, dm, act.t);
      const rest = Math.max(0, 1 - beat - steal);
      if (act.t === 'stepback') {
        const nb = tick(s);
        nb.adv[s.ball] = Math.max(nb.adv[s.ball], 1);
        out.push({ p: beat, ev: 'room', pts: 0, next: nb });
        out.push({ p: steal, ev: 'steal', pts: 0, next: null });
        out.push({ p: rest, ev: 'held', pts: 0, next: tick(s) });
        break;
      }
      const nb = tick(s);
      nb.zones[s.ball] = act.z;
      nb.adv[s.ball] = TUNE.advTtl;
      out.push({ p: beat, ev: 'beat', pts: 0, next: nb });
      out.push({ p: steal, ev: 'steal', pts: 0, next: null });
      if (row.fam === 'press') {
        out.push({ p: rest, ev: 'stopped', pts: 0, next: tick(s) });
      } else {
        const nh = tick(s);
        nh.zones[s.ball] = act.z;
        if (row.help > 0 && act.t !== 'spin' && ZONES[act.z].kind !== 'three') {
          const freed = helperFor(s, act.z);
          const nf = tick(s);
          nf.zones[s.ball] = act.z;
          nf.adv[freed] = TUNE.advTtl;
          out.push({ p: rest * row.help, ev: 'help', pts: 0, next: nf, freed });
          out.push({ p: rest * (1 - row.help), ev: 'held', pts: 0, next: nh });
        } else out.push({ p: rest, ev: 'held', pts: 0, next: nh });
      }
      break;
    }
    case 'cut': {
      if (act.t === 'pnr') {
        const a = m.att[s.ball], d = m.def[s.ball];
        const h = clamp(row.pnr.h + (a.spd - d.def) * TUNE.cutSkill, 0.02, 0.8);
        const r = clamp(row.pnr.r + (m.att[act.who].str - m.def[act.who].def) * TUNE.cutSkill, 0.02, 0.8);
        const steal = row.pnr.steal;
        const nh = tick(s);
        nh.zones[act.who] = act.z;
        nh.adv[s.ball] = TUNE.advTtl;
        const nr = tick(s);
        nr.zones[act.who] = act.z;
        nr.adv[act.who] = TUNE.advTtl;
        const nc = tick(s);
        nc.zones[act.who] = act.z;
        out.push({ p: h, ev: 'beat', pts: 0, next: nh });
        out.push({ p: r, ev: 'open', pts: 0, next: nr });
        out.push({ p: steal, ev: 'steal', pts: 0, next: null });
        out.push({ p: Math.max(0, 1 - h - r - steal), ev: 'covered', pts: 0, next: nc });
        break;
      }
      if (act.t === 'giveandgo') {
        const mate = gngPartner(s);
        const pick = clamp(row.pick + 0.02 + (row.fam === 'deny' ? (m.def[mate].def - m.att[s.ball].pas) * 0.02 : 0), 0.01, 0.5);
        const open = cutChance(m, s.ball, dm, 'giveandgo') * (1 - pick);
        const no = tick(s);
        no.zones[s.ball] = act.z;
        no.adv[s.ball] = TUNE.advTtl;
        const nc = tick(s);
        nc.zones[s.ball] = act.z;
        out.push({ p: open, ev: 'open', pts: 0, next: no });
        out.push({ p: pick, ev: 'pick', pts: 0, next: null });
        out.push({ p: Math.max(0, 1 - open - pick), ev: 'covered', pts: 0, next: nc });
        break;
      }
      // Cut, backdoor and screen: while a teammate moves, the handler holds the ball (strip risk).
      const strip = row.strip;
      const open = cutChance(m, act.who, dm, act.t) * (1 - strip);
      const no = tick(s);
      no.zones[act.who] = act.z;
      no.adv[act.who] = TUNE.advTtl;
      const nc = tick(s);
      nc.zones[act.who] = act.z;
      out.push({ p: open, ev: 'open', pts: 0, next: no });
      let restP = 1 - open - strip;
      if (act.t === 'screen') {
        const sc = screenerFor(s, act.who);
        const slip = restP * row.slip;
        const ns = tick(s);
        ns.zones[act.who] = act.z;
        ns.adv[sc] = TUNE.advTtl;
        out.push({ p: slip, ev: 'slip', pts: 0, next: ns, freed: sc });
        restP -= slip;
      }
      out.push({ p: restP, ev: 'covered', pts: 0, next: nc });
      out.push({ p: strip, ev: 'steal', pts: 0, next: null });
      break;
    }
  }
  return out.filter((b) => b.p > 1e-9);
}

/** Outcome probabilities of an action against a defensive plan (exact). */
export function actOdds(m: Matchup, s: Poss, act: Act, plan: DefPlan): Partial<Record<Ev, number>> {
  const o: Partial<Record<Ev, number>> = {};
  for (const st of STANCES) {
    if (!plan.dist[st]) continue;
    for (const b of branches(m, s, act, plan.v[st])) o[b.ev] = (o[b.ev] ?? 0) + plan.dist[st] * b.p;
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

/** The human's recent defensive stances (and techniques), used by the AI attacker to guess the next one. */
export class Habits {
  stance: Record<Stance, number> = { press: 0, space: 0, deny: 0 };
  /** Last technique used for each family. */
  v: Record<Stance, TechId> = { ...BASE_V };
  private recentS: Stance[] = [];
  addStance(dm: TechId) {
    const st = famOf(dm);
    this.v[st] = dm;
    this.recentS.push(st);
    this.stance[st]++;
    if (this.recentS.length > 10) this.stance[this.recentS.shift()!]--;
  }
  stanceTotal() { return this.recentS.length; }
}

/** Expected points of the best shot right now. */
export function shotEV(m: Matchup, s: Poss, plan: DefPlan): number {
  let best = 0;
  for (const a of legalActs({ ...s, left: 1 }, m)) {
    let v = 0;
    for (const st of STANCES) {
      if (!plan.dist[st]) continue;
      for (const b of branches(m, s, a, plan.v[st])) v += plan.dist[st] * b.p * (b.pts + (b.next ? 0.5 : 0));
    }
    best = Math.max(best, v);
  }
  return best;
}

/** One-step value of an action: points now plus the best shot value of the resulting state. */
export function quickQ(m: Matchup, s: Poss, act: Act, plan: DefPlan, nextPlan: (s: Poss) => DefPlan = (x) => planOf(readDefense(m, x))): number {
  let v = 0;
  for (const st of STANCES) {
    if (!plan.dist[st]) continue;
    for (const b of branches(m, s, act, plan.v[st])) {
      v += plan.dist[st] * b.p * (b.pts + (b.next ? shotEV(m, b.next, nextPlan(b.next)) : 0));
    }
  }
  return v;
}

/** Candidate models of how an attacker decides. The adaptive defense learns which one fits best. */
type AttackModel = (m: Matchup, s: Poss, plan: DefPlan, planner: Planner) => Act;
const ONE = (st: Stance): StanceDist => ({ press: 0, space: 0, deny: 0, [st]: 1 });
const argmax = (acts: Act[], f: (a: Act) => number) => {
  let best = acts[0], bv = -Infinity;
  for (const a of acts) { const v = f(a); if (v > bv) { bv = v; best = a; } }
  return best;
};
const bestShot = (m: Matchup, s: Poss, plan: DefPlan, p: Planner) => argmax(legalActs(s, m).filter((a) => a.k === 'shoot'), (a) => p.q(s, a, plan.dist));
export const ATTACK_MODELS: Record<string, AttackModel> = {
  shootNow: (m, s, plan, p) => bestShot(m, s, plan, p),
  bestNow: (m, s, plan) => argmax(legalActs(s, m), (a) => quickQ(m, s, a, plan)),
  planner: (m, s, plan, p) => argmax(legalActs(s, m), (a) => p.q(s, a, plan.dist)),
  feedShooter: (m, s, plan, p) => {
    const star = [0, 1, 2].sort((a, b) => m.att[b].sho - m.att[a].sho)[0];
    if (s.ball !== star && s.left > 1) {
      const passes = legalActs(s, m).filter((a) => a.k === 'pass' && a.to === star);
      return argmax(passes, (a) => p.q(s, a, plan.dist));
    }
    return bestShot(m, s, plan, p);
  },
  driveIn: (m, s, plan, p) => {
    const drives = legalActs(s, m).filter((a) => a.k === 'drive');
    return drives.length ? argmax(drives, (a) => p.q(s, a, plan.dist)) : bestShot(m, s, plan, p);
  },
  cutFirst: (m, s, plan, p) => {
    const cuts = legalActs(s, m).filter((a) => a.k === 'cut');
    return cuts.length ? argmax(cuts, (a) => p.q(s, a, plan.dist)) : bestShot(m, s, plan, p);
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
  observe(m: Matchup, s: Poss, plan: DefPlan, act: Act) {
    const key = actKey(act);
    for (const [name, f] of Object.entries(ATTACK_MODELS)) {
      const hit = actKey(f(m, s, plan, this.planner)) === key ? 1 : 0;
      this.score[name] = this.score[name] * 0.75 + hit * 0.25;
    }
    this.seen++;
  }
  defend(m: Matchup, s: Poss, smart: number): StanceDist {
    const base = readDefense(m, s);
    if (this.seen < 2 || smart <= 0) return base;
    const basePlan = planOf(base, this.planner.plan(s).v);
    const preds: { a: Act; w: number }[] = [];
    let wsum = 0;
    for (const [name, f] of Object.entries(ATTACK_MODELS)) {
      const w = this.score[name] ** 3;
      if (w < 1e-4) continue;
      preds.push({ a: f(m, s, basePlan, this.planner), w });
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

/**
 * Exact expectimax over the rest of the possession against a state-only stance policy. For each
 * family the defense plays the technique that leaves the attack the smallest best option (public
 * information only: it never sees the pending choice).
 */
export class Planner {
  private memo = new Map<string, { value: number; plan: DefPlan }>();
  m: Matchup;
  policy: (s: Poss) => StanceDist;
  constructor(m: Matchup, policy: (s: Poss) => StanceDist) { this.m = m; this.policy = policy; }
  private qDm(s: Poss, act: Act, dm: TechId): number {
    let v = 0;
    for (const b of branches(this.m, s, act, dm)) v += b.p * (b.pts + (b.next ? this.value(b.next) : 0));
    return v;
  }
  private evalState(s: Poss) {
    const k = keyOf(s);
    const hit = this.memo.get(k);
    if (hit) return hit;
    const acts = legalActs(s, this.m);
    const dist = this.policy(s);
    const v: Record<Stance, TechId> = { ...BASE_V };
    const tab = new Map<TechId, number[]>();
    const col = (dm: TechId) => {
      let c = tab.get(dm);
      if (!c) { c = acts.map((a) => this.qDm(s, a, dm)); tab.set(dm, c); }
      return c;
    };
    for (const st of STANCES) {
      const opts = defMovesFor(this.m, st);
      if (opts.length > 1) {
        let best: TechId = st, bv = Infinity;
        for (const dm of opts) { const mx = Math.max(...col(dm)); if (mx < bv - 1e-12) { bv = mx; best = dm; } }
        v[st] = best;
      }
    }
    let value = -1;
    for (let i = 0; i < acts.length; i++) {
      let q = 0;
      for (const st of STANCES) if (dist[st]) q += dist[st] * col(v[st])[i];
      value = Math.max(value, q);
    }
    const res = { value, plan: { dist, v } };
    this.memo.set(k, res);
    return res;
  }
  value(s: Poss): number { return this.evalState(s).value; }
  /** The defense plan in this state (stance mix of the policy + technique per family). */
  plan(s: Poss): DefPlan { return this.evalState(s).plan; }
  /** Value of an action against a stance mix (techniques per family as in `plan(s)`). */
  q(s: Poss, act: Act, dist?: StanceDist): number {
    const p = this.plan(s);
    return this.qPlan(s, act, { dist: dist ?? p.dist, v: p.v });
  }
  qPlan(s: Poss, act: Act, plan: DefPlan): number {
    let v = 0;
    for (const st of STANCES) if (plan.dist[st]) v += plan.dist[st] * this.qDm(s, act, plan.v[st]);
    return v;
  }
}

// ---------------------------------------------------------------- AI attack (when the human defends)

export interface Weighted<T> { item: T; w: number }

/**
 * AI attacker: softmax over planner values. It assumes the human defends like a mix of a uniform
 * guess and the human's own stance habits (weight `smart`), with the technique the human last used
 * in each family, never the pending choice.
 */
export function aiAttackDist(planner: Planner, s: Poss, h: Habits, smart: number, temp: number): Weighted<Act>[] {
  const tot = h.stanceTotal();
  const k = tot >= 3 ? clamp(smart * Math.min(1, tot / 6), 0, 1) : 0;
  const belief: StanceDist = normDist({
    press: UNIFORM.press * (1 - k) + (tot ? h.stance.press / tot : 0) * k,
    space: UNIFORM.space * (1 - k) + (tot ? h.stance.space / tot : 0) * k,
    deny: UNIFORM.deny * (1 - k) + (tot ? h.stance.deny / tot : 0) * k,
  });
  const acts = legalActs(s, planner.m);
  const plan = planOf(belief, h.v);
  const qs = acts.map((a) => planner.qPlan(s, a, plan));
  const max = Math.max(...qs);
  const ws = qs.map((q) => Math.exp((q - max) / temp));
  // Keep the menu short and readable: drop actions with negligible weight.
  const sum = ws.reduce((x, y) => x + y, 0);
  let list = acts.map((a, i) => ({ item: a, w: ws[i] / sum })).filter((x) => x.w >= 0.03);
  const s2 = list.reduce((x, y) => x + y.w, 0);
  list = list.map((x) => ({ item: x.item, w: x.w / s2 }));
  return list;
}

/** Defender view: outcome probabilities of one defensive move against the AI attacker's action distribution. */
export function stanceOdds(m: Matchup, s: Poss, dm: TechId, attDist: Weighted<Act>[]) {
  const o = { score: 0, ball: 0, cont: 0 };
  for (const { item, w } of attDist) {
    for (const b of branches(m, s, item, dm)) {
      if (b.ev === 'make' || b.ev === 'and1') o.score += w * b.p;
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
const DEF_GOOD: Ev[] = ['block', 'pick', 'steal', 'stopped', 'held', 'covered', 'miss'];

/**
 * One short sentence that says what caused the result, in attacker or defender voice.
 * It names the technique, the stance and the odds, so a lucky or unlucky roll never reads as certain.
 */
export function explain(act: Act, dm: TechId, b: Branch, userAttacks: boolean): string {
  const base = explainBase(act, dm, b, userAttacks);
  const defLead = !TECHS[dm].base && DEF_GOOD.includes(b.ev);
  const lead = defLead ? TECHS[dm].name : !TECHS[act.t].base ? TECHS[act.t].name : '';
  return lead ? `${lead}. ${base}` : base;
}

function explainBase(act: Act, dm: TechId, b: Branch, you: boolean): string {
  const stance = famOf(dm);
  switch (b.ev) {
    case 'and1':
      return you ? `Fouled on a ${pc(b.shotP ?? 0)} finish: in, plus one.` : `You fouled the finish: in, plus one.`;
    case 'make':
    case 'miss':
    case 'oreb': {
      const p = b.shotP ?? 0;
      const hit = b.ev === 'make';
      const st = b.open ? (you ? 'Wide open: a' : 'They were open: a')
        : stance === 'press' ? (you ? 'Pressure made it a' : 'Your pressure made it a')
        : stance === 'space' ? (you ? 'Space gave a' : 'Your space gave them a')
          : (you ? 'Denial left a' : 'Your denial left a');
      const res = hit ? (p < 0.35 ? 'It fell anyway.' : 'In.') : (p >= 0.5 ? 'It rimmed out.' : 'Missed.');
      const reb = b.ev === 'oreb' ? ' Offensive board.' : '';
      return `${st} ${pc(p)} look. ${res}${reb}`;
    }
    case 'block':
      return stance === 'press' ? (you ? 'Tight pressure: blocked.' : 'Your pressure got the block.') : (you ? 'Help in the paint blocked it.' : 'Your help blocked it.');
    case 'catch':
      return stance === 'deny' ? (you ? 'Lane was closed, the pass still got through.' : 'They threaded the pass past your denial.') : (you ? 'Pass caught. The ball moves.' : 'They swung the ball.');
    case 'feed':
      return act.t === 'lob' ? (you ? 'Over the top: open finish next.' : 'The lob beat you: open finish.') : (you ? 'The defense lost the catcher: open.' : 'It fooled your defense: open catcher.');
    case 'pick':
      if (act.k === 'cut') return you ? 'The return pass got picked.' : 'You picked the return pass.';
      return stance === 'deny' ? (you ? 'They were denying the pass: picked off.' : 'Denial paid off: picked off.') : stance === 'space' && act.t === 'lob' ? (you ? 'Help was waiting under the lob: picked.' : 'Your help read the lob: picked.') : (you ? 'Risky pass: picked off.' : 'Lucky tip: picked off.');
    case 'beat':
      if (act.k === 'cut') return you ? 'The screen freed the handler.' : 'The screen freed their handler.';
      return stance === 'press' ? (you ? 'Your defender pressed high, so you blew past.' : 'Pressing high let them blow past.') : stance === 'deny' ? (you ? 'No help behind the denial: you got by.' : 'Denying left no help: they got by.') : (you ? 'Quick first step: you got by.' : 'Quick first step beat your space.');
    case 'room':
      return you ? 'Your defender bit: room for an open shot.' : 'Your defender bit: they made room.';
    case 'held':
      return stance === 'space' ? (you ? 'Your defender gave ground but stayed in front.' : 'You gave ground and stayed in front.') : (you ? 'You got there, still guarded.' : 'They moved, you stayed attached.');
    case 'stopped':
      return you ? 'The pressure stopped your drive.' : 'Your pressure stopped the drive.';
    case 'help':
      return you ? 'Help came to stop you: a teammate is free.' : 'Your help stopped the drive, but left a man free.';
    case 'slip':
      return you ? 'Both went with the cutter: the screener is free.' : 'Both of you chased the cutter: the screener is free.';
    case 'steal':
      return stance === 'press' ? (you ? 'Pressure on the ball: stolen.' : 'Your pressure stole it.') : (you ? 'Stripped on the move.' : 'You stripped it.');
    case 'open':
      if (act.t === 'pnr') return you ? 'The roller is open.' : 'The roller got behind you.';
      if (act.t === 'giveandgo') return you ? 'Back open near the rim.' : 'They got it back open.';
      return stance === 'deny' ? (you ? 'The defender overplayed the pass: wide open.' : 'Overplaying the lane: open man.') : (you ? 'The cut lost the defender.' : 'The cut lost your defender.');
    case 'covered':
      return stance === 'space' ? (you ? 'Sagging help saw it coming.' : 'Your help saw it coming.') : stance === 'deny' && dm === 'switch' ? (you ? 'They switched it.' : 'You switched it.') : (you ? 'The defender stayed with it.' : 'You stayed with it.');
  }
  return '';
}
