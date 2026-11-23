// Headless balance simulator: `npm run sim` (options: --seed N --poss N --matches N --quick).
// Uses the exact same rules module as the game. Every run with the same seed prints the same numbers.
import { ROLE_KITS, TEMPLATES, STARTER_IDS, type Stats } from './data.ts';
import {
  actOdds, branches, defMovesFor, OpponentModel, legalActs, Planner, pickBranch, quickQ, readDefense, rng, sampleStance,
  MATCH_RULES, setupPoss, SETUPS, shotChance, STANCES, TUNE, ZONES, ROUTES, zoneDist,
  type Act, type ActKind, type DefPlan, type Ev, type Matchup, type Poss, type Stance, type StanceDist,
} from './rules.ts';
import { TECHS, VARIANTS, isDefTech, type TechId } from './techs.ts';

declare const process: { argv: string[] };
const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const QUICK = process.argv.includes('--quick');
/** Only the technique and progression sections (for tuning). */
const TECH_ONLY = process.argv.includes('--tech');
const SEED = arg('seed', 2026);
const POSS = arg('poss', QUICK ? 400 : 1500);
const MATCHES = arg('matches', QUICK ? 60 : 200);

// Equal teams: both sides use the default starters (guard, big, shooter), mirrored.
const team: Stats[] = STARTER_IDS.map((id) => ({ ...TEMPLATES.find((t) => t.id === id)!.stats }));
const ATT_VARIANTS = VARIANTS.filter((t) => !isDefTech(t));
const DEF_VARIANTS = VARIANTS.filter((t) => isDefTech(t));

/** Kits used by the report. */
const KITS: Record<string, { att: TechId[][]; def: TechId[] }> = {
  base: { att: [[], [], []], def: [] },
  /** Starters at level 5 (first three path techniques, three slots). */
  learned: kitFromPaths(3),
  /** Starters at level 9 (all five path techniques known, four slots). */
  veteran: kitFromPaths(4),
  /** A rival of tier 5 (ROLE_KITS, capped at four). */
  rival5: { att: ROLE_KITS.map((k) => k.slice(0, 4)), def: ROLE_KITS.flatMap((k) => k.slice(0, 4)).filter(isDefTech) },
  /** Everyone knows everything: used to check that no variant dominates. */
  all: { att: [ATT_VARIANTS, ATT_VARIANTS, ATT_VARIANTS], def: DEF_VARIANTS },
};
function kitFromPaths(n: number) {
  const att = STARTER_IDS.map((id) => TEMPLATES.find((t) => t.id === id)!.path.slice(0, n));
  return { att, def: att.flat().filter(isDefTech) };
}
const mk = (attKit: string, defKit: string): Matchup => ({ att: team, def: team, kit: KITS[attKit].att, defKit: KITS[defKit].def });

const planners = new Map<string, Planner>();
function plannerFor(m: Matchup, key: string) {
  let p = planners.get(key);
  if (!p) { p = new Planner(m, (s) => readDefense(m, s)); planners.set(key, p); }
  return p;
}

// ---------------------------------------------------------------- attack strategies

interface Ctx { m: Matchup; s: Poss; plan: DefPlan; r: () => number; planner: Planner }
type AttackStrat = (c: Ctx) => Act;

const bestBy = (acts: Act[], f: (a: Act) => number) => {
  let best = acts[0], bv = -Infinity;
  for (const a of acts) { const v = f(a); if (v > bv) { bv = v; best = a; } }
  return best;
};
const bestShot = (c: Ctx) => bestBy(legalActs(c.s, c.m).filter((a) => a.k === 'shoot'), (a) => quickQ(c.m, c.s, a, c.plan));

/** Next hop on the zone graph from a to b avoiding occupied zones (BFS), or null. */
function nextHop(from: Poss['zones'][number], to: Poss['zones'][number], taken: Set<string>) {
  if (from === to) return null;
  const prev = new Map<string, string>();
  const q = [from];
  const seen = new Set([from as string]);
  while (q.length) {
    const z = q.shift()!;
    for (const n of ROUTES[z]) {
      if (seen.has(n) || (taken.has(n) && n !== to)) continue;
      seen.add(n);
      prev.set(n, z);
      if (n === to) {
        let cur: string = n;
        while (prev.get(cur) !== from) cur = prev.get(cur)!;
        return cur as typeof from;
      }
      q.push(n);
    }
  }
  return null;
}

const STRATS: Record<string, AttackStrat> = {
  alwaysShoot: (c) => bestShot(c),
  bestNow: (c) => bestBy(legalActs(c.s, c.m), (a) => quickQ(c.m, c.s, a, c.plan)),
  bestShooter: (c) => {
    const { m, s } = c;
    const star = [0, 1, 2].sort((a, b) => m.att[b].sho - m.att[a].sho)[0];
    if (s.ball !== star && s.left > 1) return bestBy(legalActs(s, m).filter((a) => a.k === 'pass' && a.to === star), (a) => quickQ(m, s, a, c.plan));
    return bestShot(c);
  },
  reposition: (c) => {
    // Move the ball handler toward their ideal spot (best open-floor shot), then shoot.
    const { m, s } = c;
    if (s.left <= 1) return bestShot(c);
    const i = s.ball;
    const taken = new Set(s.zones.filter((_, j) => j !== i));
    let ideal = s.zones[i], iv = -1;
    for (const z of Object.keys(ZONES) as Poss['zones']) {
      if (taken.has(z)) continue;
      const probe: Poss = { ...s, zones: s.zones.map((x, j) => (j === i ? z : x)), adv: [0, 0, 0] };
      const v = shotChance(m, probe, i, null).make * (ZONES[z].kind === 'three' ? 2 : 1);
      if (v > iv) { iv = v; ideal = z; }
    }
    if (s.adv[i] > 0 || ideal === s.zones[i]) return bestShot(c);
    const hop = nextHop(s.zones[i], ideal, taken);
    return hop ? { k: 'drive', z: hop, t: 'drive' } : bestShot(c);
  },
  attackWeakest: (c) => {
    // Find the weakest defender and attack whoever they guard: get them the ball, then drive.
    const { m, s } = c;
    const target = [0, 1, 2].sort((a, b) => m.def[a].def - m.def[b].def)[0];
    if (s.left <= 1 || s.adv[s.ball] > 0) return bestShot(c);
    if (s.ball !== target) return { k: 'pass', to: target, t: 'chest' };
    const taken = new Set(s.zones);
    const inward = ROUTES[s.zones[s.ball]].filter((z) => !taken.has(z))
      .sort((a, b) => zoneDist(a, 'postL') + zoneDist(a, 'postR') - zoneDist(b, 'postL') - zoneDist(b, 'postR'))[0];
    return inward ? { k: 'drive', z: inward, t: 'drive' } : bestShot(c);
  },
  random: ({ s, m, r }) => { const l = legalActs(s, m); return l[Math.floor(r() * l.length)]; },
  expert: ({ s, m, plan, planner }) => bestBy(legalActs(s, m), (a) => planner.qPlan(s, a, plan)),
};
const SIMPLE = ['alwaysShoot', 'bestNow', 'bestShooter', 'reposition', 'attackWeakest'];

// ---------------------------------------------------------------- defense policies

type DefPolicy = (m: Matchup, s: Poss, h: OpponentModel) => StanceDist;
const fixed = (st: Stance): DefPolicy => () => ({ press: 0, space: 0, deny: 0, [st]: 1 });
const DEFS: Record<string, DefPolicy> = {
  alwaysPress: fixed('press'),
  alwaysSpace: fixed('space'),
  alwaysDeny: fixed('deny'),
  uniform: () => ({ press: 1 / 3, space: 1 / 3, deny: 1 / 3 }),
  read: (m, s) => readDefense(m, s),
  adaptive: (m, s, h) => h.defend(m, s, 0.6),
};

// ---------------------------------------------------------------- calibration

const MAIN_EV: Record<ActKind, Ev[]> = { shoot: ['make', 'and1', 'block'], pass: ['catch', 'feed', 'pick'], drive: ['beat', 'room', 'steal'], cut: ['open', 'slip', 'beat'] };
type Cal = { n: number; p: number; hit: number };
const calib = { bins: Array.from({ length: 10 }, (): Cal => ({ n: 0, p: 0, hit: 0 })), byEv: new Map<string, Cal>() };
function recordCalib(m: Matchup, s: Poss, a: Act, plan: DefPlan, happened: Ev) {
  const odds = actOdds(m, s, a, plan);
  for (const ev of MAIN_EV[a.k]) {
    if (odds[ev] === undefined) continue;
    const p = odds[ev] ?? 0;
    const hit = happened === ev ? 1 : 0;
    const b = calib.bins[Math.min(9, Math.floor(p * 10))];
    b.n++; b.p += p; b.hit += hit;
    const key = `${a.t}:${ev}`;
    const e = calib.byEv.get(key) ?? { n: 0, p: 0, hit: 0 };
    e.n++; e.p += p; e.hit += hit;
    calib.byEv.set(key, e);
  }
}

// ---------------------------------------------------------------- possession & match

interface PossOut { pts: number; decisions: number; acts: Act[]; dms: TechId[] }

function playPoss(m: Matchup, s0: Poss, att: AttackStrat, def: DefPolicy, h: OpponentModel, r: () => number, planner: Planner, calibOn: boolean): PossOut {
  let s: Poss | null = s0;
  let pts = 0, decisions = 0;
  const acts: Act[] = [];
  const dms: TechId[] = [];
  while (s) {
    const plan: DefPlan = { dist: def(m, s, h), v: planner.plan(s).v };
    const a = att({ m, s, plan, r, planner });
    const st = sampleStance(plan.dist, r());
    const dm = plan.v[st];
    const b = pickBranch(branches(m, s, a, dm), r());
    if (calibOn) recordCalib(m, s, a, plan, b.ev);
    h.observe(m, s, plan, a);
    acts.push(a);
    dms.push(dm);
    decisions++;
    pts += b.pts;
    s = b.next;
  }
  return { pts, decisions, acts, dms };
}

const randomStart = (r: () => number) => setupPoss(SETUPS[Math.floor(r() * SETUPS.length)], Math.floor(r() * 3));

function possTable(r: () => number, kit: string, strats: string[], calibOn: boolean) {
  const m = mk(kit, kit);
  const planner = plannerFor(m, `${kit}/${kit}`);
  const rows: string[] = [];
  const header = ['attack \\ defense', ...Object.keys(DEFS)];
  rows.push(`| ${header.join(' | ')} | avg |`, `|${header.map(() => '---').join('|')}|---|`);
  const decisionsBy: Record<string, number> = {};
  const usage: Record<string, Record<ActKind, number>> = {};
  for (const name of strats) {
    const strat = STRATS[name];
    const cells: string[] = [];
    let sumPpp = 0, dec = 0, n = 0;
    usage[name] = { shoot: 0, pass: 0, drive: 0, cut: 0 };
    for (const [dname, def] of Object.entries(DEFS)) {
      const h = new OpponentModel(planner);
      let pts = 0;
      for (let i = 0; i < POSS; i++) {
        const o = playPoss(m, randomStart(r), strat, def, h, r, planner, calibOn && (dname === 'read' || dname === 'adaptive'));
        pts += o.pts; dec += o.decisions; n++;
        for (const a of o.acts) usage[name][a.k]++;
      }
      cells.push((pts / POSS).toFixed(2));
      sumPpp += pts / POSS;
    }
    decisionsBy[name] = dec / n;
    rows.push(`| ${name} | ${cells.join(' | ')} | ${(sumPpp / Object.keys(DEFS).length).toFixed(2)} |`);
  }
  return { table: rows.join('\n'), decisionsBy, usage };
}

interface TeamPlan { att: AttackStrat; def: DefPolicy; kit: string }

function playMatch(a: TeamPlan, b: TeamPlan, r: () => number) {
  const teams = [a, b];
  // ms[off]: team `off` attacking against the other team's defense.
  const ms = [mk(a.kit, b.kit), mk(b.kit, a.kit)];
  const pls = [plannerFor(ms[0], `${a.kit}/${b.kit}`), plannerFor(ms[1], `${b.kit}/${a.kit}`)];
  const habits = [new OpponentModel(pls[0]), new OpponentModel(pls[1])];
  const score = [0, 0];
  const possN = [0, 0];
  let off = r() < 0.5 ? 0 : 1;
  let decisions = 0;
  for (let guard = 0; guard < 200; guard++) {
    const o = playPoss(ms[off], randomStart(r), teams[off].att, teams[1 - off].def, habits[off], r, pls[off], false);
    score[off] += o.pts;
    possN[off]++;
    decisions += o.decisions;
    if (score[off] >= MATCH_RULES.winScore) break;
    if (possN[0] === possN[1] && possN[0] >= MATCH_RULES.maxPoss && score[0] !== score[1]) break;
    off = 1 - off;
  }
  return { winner: score[0] > score[1] ? 0 : 1, decisions, score, poss: possN[0] + possN[1] };
}

function matchTable(r: () => number, defName: string) {
  const names = [...SIMPLE, 'random', 'expert'];
  const def = DEFS[defName];
  const win: Record<string, Record<string, number>> = {};
  const lens: number[] = [];
  for (const x of names) win[x] = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      let w = 0;
      for (let k = 0; k < MATCHES; k++) {
        const res = playMatch({ att: STRATS[names[i]], def, kit: 'base' }, { att: STRATS[names[j]], def, kit: 'base' }, r);
        if (res.winner === 0) w++;
        lens.push(res.decisions);
      }
      win[names[i]][names[j]] = w / MATCHES;
      win[names[j]][names[i]] = 1 - w / MATCHES;
    }
  }
  const rows = [`| vs | ${names.join(' | ')} | avg vs simple |`, `|---|${names.map(() => '---').join('|')}|---|`];
  for (const x of names) {
    const vsSimple = SIMPLE.filter((y) => y !== x).map((y) => win[x][y]);
    const avg = vsSimple.reduce((p, q) => p + q, 0) / vsSimple.length;
    rows.push(`| ${x} | ${names.map((y) => (x === y ? '-' : `${Math.round(win[x][y] * 100)}%`)).join(' | ')} | ${Math.round(avg * 100)}% |`);
  }
  const dominant = SIMPLE.filter((x) => SIMPLE.every((y) => y === x || win[x][y] > 0.55));
  lens.sort((p, q) => p - q);
  return { table: rows.join('\n'), dominant, lens };
}

// ---------------------------------------------------------------- technique balance

/**
 * Walk possessions with the expert planner against the court-reading defense (everyone knows every
 * technique). For each decision with a choice we record: the overall best action, and inside each
 * action kind which technique is the best one (only when two or more techniques of that kind are
 * legal). Defensive techniques: which one the defense plays for each family.
 */
function techBalance(r: () => number, defName: string) {
  const m = mk('all', 'all');
  const planner = plannerFor(m, 'all/all');
  const def = DEFS[defName];
  const used: Record<string, number> = {};
  const kindN: Record<string, number> = { shoot: 0, pass: 0, drive: 0, cut: 0 };
  const bestOfKind: Record<string, number> = {};
  const contested: Record<string, number> = {};
  const legal: Record<string, number> = {};
  const edge: Record<string, number> = {};
  const defUse: Record<string, number> = {};
  const famN: Record<string, number> = { press: 0, space: 0, deny: 0 };
  let n = 0;
  for (let i = 0; i < POSS; i++) {
    let s: Poss | null = randomStart(r);
    const h = new OpponentModel(planner);
    while (s) {
      const plan: DefPlan = { dist: def(m, s, h), v: planner.plan(s).v };
      const acts = legalActs(s, m);
      const qs = acts.map((a) => planner.qPlan(s!, a, plan));
      const bi = qs.indexOf(Math.max(...qs));
      const best = acts[bi];
      if (s.left > 1) {
        n++;
        used[best.t] = (used[best.t] ?? 0) + 1;
        kindN[best.k]++;
      }
      {
        for (const k of ['shoot', 'pass', 'drive', 'cut'] as ActKind[]) {
          const idx = acts.map((a, j) => (a.k === k ? j : -1)).filter((j) => j >= 0);
          const techs = new Set(idx.map((j) => acts[j].t));
          for (const t of techs) legal[t] = (legal[t] ?? 0) + 1;
          if (techs.size < 2) continue;
          // Best technique of this kind, and its edge over the best other technique of the same kind.
          let bj = idx[0];
          for (const j of idx) if (qs[j] > qs[bj]) bj = j;
          const bt = acts[bj].t;
          const alt = Math.max(...idx.filter((j) => acts[j].t !== bt).map((j) => qs[j]));
          for (const t of techs) contested[t] = (contested[t] ?? 0) + 1;
          bestOfKind[bt] = (bestOfKind[bt] ?? 0) + 1;
          edge[bt] = (edge[bt] ?? 0) + (qs[bj] - alt);
        }
        for (const st of STANCES) {
          if (defMovesFor(m, st).length < 2) continue;
          famN[st]++;
          defUse[plan.v[st]] = (defUse[plan.v[st]] ?? 0) + 1;
        }
      }
      h.observe(m, s, plan, best);
      const st = sampleStance(plan.dist, r());
      s = pickBranch(branches(m, s, best, plan.v[st]), r()).next;
    }
  }
  return { used, kindN, bestOfKind, contested, legal, edge, defUse, famN, n };
}

// ---------------------------------------------------------------- report

const t0 = Date.now();
const r = rng(SEED);
const out: string[] = [];
const pct = (x: number) => `${Math.round(x * 100)}%`;
out.push(`# Turn Ball simulation (seed ${SEED}, ${POSS} possessions per cell, ${MATCHES} matches per pairing)`);
out.push('');
out.push(`Rules: ${TUNE.actions} decisions per possession, first to ${MATCH_RULES.winScore} or most points after ${MATCH_RULES.maxPoss} possessions each. Equal stats (mirrored starters).`);
out.push('');

// 1. Technique balance (everyone knows everything).
for (const dn of ['read', 'adaptive']) {
  const tb = techBalance(r, dn);
  out.push(`## Technique balance: expert planner vs "${dn}" defense, every technique known (${tb.n} decisions with a choice)`);
  out.push('');
  out.push('"share of kind" = how often the planner picks this technique when it picks that action kind. "best of its kind" = in decisions where two or more techniques of that kind are legal, how often this one is the best of them; "edge" = average points over the next best technique of the same kind when it is.');
  out.push('');
  out.push('| technique | kind | legal in | share of kind | best of its kind | edge (pts) |');
  out.push('|---|---|---|---|---|---|');
  let maxShare = 0, maxT = '';
  const never: string[] = [];
  for (const k of ['shoot', 'pass', 'drive', 'cut'] as ActKind[]) {
    for (const t of Object.keys(TECHS) as TechId[]) {
      if (TECHS[t].kind !== k) continue;
      const share = (tb.used[t] ?? 0) / (tb.kindN[k] || 1);
      const bok = (tb.bestOfKind[t] ?? 0) / (tb.contested[t] || 1);
      if (bok > maxShare) { maxShare = bok; maxT = t; }
      if (!tb.bestOfKind[t]) never.push(t);
      out.push(`| ${TECHS[t].name} | ${k} | ${tb.legal[t] ?? 0} | ${pct(share)} | ${pct(bok)} | ${tb.bestOfKind[t] ? ((tb.edge[t] ?? 0) / tb.bestOfKind[t]).toFixed(3) : '-'} |`);
    }
  }
  out.push('');
  out.push('Defensive technique chosen per family (states where the family has a choice):');
  out.push('');
  out.push('| family | ' + 'technique share |'.repeat(1));
  out.push('|---|---|');
  for (const st of STANCES) {
    const opts = (Object.keys(TECHS) as TechId[]).filter((t) => TECHS[t].kind === st);
    out.push(`| ${st} | ${opts.map((t) => `${TECHS[t].name} ${pct((tb.defUse[t] ?? 0) / (tb.famN[st] || 1))}`).join(', ')} |`);
  }
  out.push('');
  out.push(`Highest "best of its kind" share: ${TECHS[maxT as TechId]?.name ?? '-'} ${pct(maxShare)}. Techniques that are never the best of their kind: ${never.length ? never.map((t) => TECHS[t as TechId].name).join(', ') : 'none'}.`);
  out.push('');
}

// 2. Progression: exact expected points per possession (expectimax, no sampling noise).
out.push('## Learned techniques: exact expected points per possession');
out.push('');
out.push('Expectimax value of a possession averaged over every starting formation and handler: the attack plays its best line knowing the defense mix, the defense reads the court and plays the technique per family that leaves the attack the smallest best option. Rows: attack kit; columns: defense kit.');
out.push('');
{
  const names = ['base', 'learned', 'veteran', 'rival5', 'all'];
  out.push(`| attack \\ defense | ${names.join(' | ')} |`);
  out.push(`|---|${names.map(() => '---').join('|')}|`);
  for (const a of names) {
    const cells = names.map((d) => {
      const m = mk(a, d);
      const pl = plannerFor(m, `${a}/${d}`);
      let v = 0, n = 0;
      for (const su of SETUPS) for (let h = 0; h < 3; h++) { v += pl.value(setupPoss(su, h)); n++; }
      return (v / n).toFixed(3);
    });
    out.push(`| ${a} | ${cells.join(' | ')} |`);
  }
  out.push('');
}

// 3. Progression: learned techniques vs base, full matches.
out.push('## Learned techniques vs base kit (full matches, equal stats, row win % vs column)');
out.push('');
out.push('Both teams: expert planner on attack, court-reading or adaptive defense (each team defends with its own defensive techniques). Kits: base = basics only; learned = starters at level 5 (3 path techniques each); veteran = all 5 path techniques, 4 slots; rival5 = a tier-5 rival.');
out.push('');
const kitNames = ['base', 'learned', 'veteran', 'rival5'];
for (const dn of ['read', 'adaptive']) {
  out.push(`Defense "${dn}":`);
  out.push('');
  out.push(`| vs | ${kitNames.join(' | ')} |`);
  out.push(`|---|${kitNames.map(() => '---').join('|')}|`);
  const res: Record<string, Record<string, number>> = {};
  for (const a of kitNames) res[a] = {};
  for (let i = 0; i < kitNames.length; i++) {
    for (let j = i + 1; j < kitNames.length; j++) {
      let w = 0;
      const nM = MATCHES * 2;
      for (let k = 0; k < nM; k++) {
        const o = playMatch({ att: STRATS.expert, def: DEFS[dn], kit: kitNames[i] }, { att: STRATS.expert, def: DEFS[dn], kit: kitNames[j] }, r);
        if (o.winner === 0) w++;
      }
      res[kitNames[i]][kitNames[j]] = w / nM;
      res[kitNames[j]][kitNames[i]] = 1 - w / nM;
    }
  }
  for (const a of kitNames) out.push(`| ${a} | ${kitNames.map((b) => (a === b ? '-' : pct(res[a][b]))).join(' | ')} |`);
  out.push('');
}
out.push('Points per possession, expert attack vs court-reading defense, by attack kit / defense kit:');
out.push('');
out.push(`| attack \\ defense | ${kitNames.join(' | ')} |`);
out.push(`|---|${kitNames.map(() => '---').join('|')}|`);
for (const a of kitNames) {
  const cells: string[] = [];
  for (const d of kitNames) {
    const m = mk(a, d);
    const pl = plannerFor(m, `${a}/${d}`);
    let pts = 0;
    for (let i = 0; i < POSS; i++) pts += playPoss(m, randomStart(r), STRATS.expert, DEFS.read, new OpponentModel(pl), r, pl, a !== 'base').pts;
    cells.push((pts / POSS).toFixed(2));
  }
  out.push(`| ${a} | ${cells.join(' | ')} |`);
}
out.push('');

if (!TECH_ONLY) {
// 4. Base-kit tables (v3 parity: simple strategies with basic techniques only).
out.push('## Basic techniques only: points per possession (attack strategy vs defense policy)');
out.push('');
const pt = possTable(r, 'base', Object.keys(STRATS), true);
out.push(pt.table);
out.push('');
out.push('| strategy | decisions/poss | shoot | pass | drive | cut |');
out.push('|---|---|---|---|---|---|');
for (const [k, u] of Object.entries(pt.usage)) {
  const tot = u.shoot + u.pass + u.drive + u.cut;
  const f = (x: number) => pct(x / tot);
  out.push(`| ${k} | ${pt.decisionsBy[k].toFixed(2)} | ${f(u.shoot)} | ${f(u.pass)} | ${f(u.drive)} | ${f(u.cut)} |`);
}
out.push('');
out.push('Same table, every technique known by both sides:');
out.push('');
out.push(possTable(r, 'all', ['alwaysShoot', 'bestNow', 'random', 'expert'], true).table);
out.push('');
if (!QUICK) {
  const mt = matchTable(r, 'read');
  out.push('## Full matches, basic techniques, both teams defend with "read" (row win % vs column)');
  out.push('');
  out.push(mt.table);
  out.push('');
  const q = (f: number) => mt.lens[Math.floor(f * (mt.lens.length - 1))];
  out.push(`Match length in decisions (both teams): median ${q(0.5)}, p10 ${q(0.1)}, p90 ${q(0.9)}.`);
  out.push(`Dominant simple strategy (beats every other simple one >55%): ${mt.dominant.length ? mt.dominant.join(', ') : 'none'}.`);
  out.push('');
}

}

// 5. Calibration (all kits used above, every technique).
out.push('## Calibration (announced probability vs observed frequency, every technique)');
out.push('');
out.push('| announced bin | samples | mean announced | observed | gap (pts) | std. error (pts) |');
out.push('|---|---|---|---|---|---|');
let maxGap = 0;
calib.bins.forEach((b, i) => {
  if (!b.n) return;
  const gap = Math.abs(b.p / b.n - b.hit / b.n) * 100;
  maxGap = Math.max(maxGap, gap);
  const se = Math.sqrt((b.p / b.n) * (1 - b.p / b.n) / b.n) * 100;
  out.push(`| ${i * 10}-${i * 10 + 10}% | ${b.n} | ${((b.p / b.n) * 100).toFixed(1)}% | ${((b.hit / b.n) * 100).toFixed(1)}% | ${gap.toFixed(1)} | ${se.toFixed(1)} |`);
});
out.push('');
out.push(`Largest bin gap: ${maxGap.toFixed(2)} points.`);
out.push('');
out.push('| technique:event | samples | mean announced | observed |');
out.push('|---|---|---|---|');
for (const [k, e] of [...calib.byEv.entries()].sort()) {
  if (e.n < 200) continue;
  out.push(`| ${k} | ${e.n} | ${((e.p / e.n) * 100).toFixed(1)}% | ${((e.hit / e.n) * 100).toFixed(1)}% |`);
}
out.push('');
out.push(`Run time ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
console.log(out.join('\n'));
