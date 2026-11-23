// Headless balance simulator: `npm run sim` (options: --seed N --poss N --matches N).
// Uses the exact same rules module as the game. Every run with the same seed prints the same numbers.
import { TEMPLATES, STARTER_IDS, type Stats } from './data.ts';
import {
  actOdds, branches, OpponentModel, legalActs, Planner, pickBranch, quickQ, readDefense, rng, sampleStance,
  MATCH_RULES, setupPoss, SETUPS, shotChance, STANCES, TUNE, ZONES, ROUTES, zoneDist,
  type Act, type ActKind, type Ev, type Matchup, type Poss, type StanceDist,
} from './rules.ts';

declare const process: { argv: string[] };
const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const SEED = arg('seed', 2026);
const POSS = arg('poss', 4000);
const MATCHES = arg('matches', 400);

// Equal teams: both sides use the default starters (guard, big, shooter), mirrored.
const team: Stats[] = STARTER_IDS.map((id) => ({ ...TEMPLATES.find((t) => t.id === id)!.stats }));
const M: Matchup = { att: team, def: team };
/** One shared planner: the court-reading policy only depends on the state, so its memo stays valid. */
const PLANNER = new Planner(M, (s) => readDefense(M, s));

// ---------------------------------------------------------------- attack strategies

interface Ctx { m: Matchup; s: Poss; dist: StanceDist; r: () => number; planner: Planner }
type AttackStrat = (c: Ctx) => Act;

const shoot: Act = { k: 'shoot' };

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
  alwaysShoot: () => shoot,
  bestNow: ({ m, s, dist }) => {
    // Best immediate play: value of each action = points now, or the shot you get right after it.
    let best: Act = shoot, bv = -1;
    for (const a of legalActs(s)) { const v = quickQ(m, s, a, dist); if (v > bv) { bv = v; best = a; } }
    return best;
  },
  bestShooter: ({ m, s }) => {
    const star = [0, 1, 2].sort((a, b) => m.att[b].sho - m.att[a].sho)[0];
    if (s.ball !== star && s.left > 1) return { k: 'pass', to: star };
    return shoot;
  },
  reposition: ({ m, s }) => {
    // Move the ball handler toward their ideal spot (best open-floor shot), then shoot.
    if (s.left <= 1) return shoot;
    const i = s.ball;
    const taken = new Set(s.zones.filter((_, j) => j !== i));
    let ideal = s.zones[i], iv = -1;
    for (const z of Object.keys(ZONES) as Poss['zones']) {
      if (taken.has(z)) continue;
      const probe: Poss = { ...s, zones: s.zones.map((x, j) => (j === i ? z : x)), adv: [0, 0, 0] };
      const v = shotChance(m, probe, i, null).make * (ZONES[z].kind === 'three' ? 2 : 1);
      if (v > iv) { iv = v; ideal = z; }
    }
    if (s.adv[i] > 0 || ideal === s.zones[i]) return shoot;
    const hop = nextHop(s.zones[i], ideal, taken);
    return hop ? { k: 'drive', z: hop } : shoot;
  },
  attackWeakest: ({ m, s }) => {
    // Find the weakest defender and attack whoever they guard: get them the ball, then drive.
    const target = [0, 1, 2].sort((a, b) => m.def[a].def - m.def[b].def)[0];
    if (s.left <= 1 || s.adv[s.ball] > 0) return shoot;
    if (s.ball !== target) return { k: 'pass', to: target };
    const taken = new Set(s.zones);
    const inward = ROUTES[s.zones[s.ball]].filter((z) => !taken.has(z))
      .sort((a, b) => zoneDist(a, 'postL') + zoneDist(a, 'postR') - zoneDist(b, 'postL') - zoneDist(b, 'postR'))[0];
    return inward ? { k: 'drive', z: inward } : shoot;
  },
  random: ({ s, r }) => { const l = legalActs(s); return l[Math.floor(r() * l.length)]; },
  expert: ({ s, dist, planner }) => {
    let best: Act = shoot, bv = -1;
    for (const a of legalActs(s)) { const v = planner.q(s, a, dist); if (v > bv) { bv = v; best = a; } }
    return best;
  },
};
const SIMPLE = ['alwaysShoot', 'bestNow', 'bestShooter', 'reposition', 'attackWeakest'];

// ---------------------------------------------------------------- defense policies

type DefPolicy = (m: Matchup, s: Poss, h: OpponentModel) => StanceDist;
const fixed = (st: 'press' | 'space' | 'deny'): DefPolicy => () => ({ press: 0, space: 0, deny: 0, [st]: 1 });
const DEFS: Record<string, DefPolicy> = {
  alwaysPress: fixed('press'),
  alwaysSpace: fixed('space'),
  alwaysDeny: fixed('deny'),
  uniform: () => ({ press: 1 / 3, space: 1 / 3, deny: 1 / 3 }),
  read: (m, s) => readDefense(m, s),
  adaptive: (m, s, h) => h.defend(m, s, 0.6),
};

// ---------------------------------------------------------------- calibration

const MAIN_EV: Record<ActKind, Ev[]> = { shoot: ['make', 'block'], pass: ['catch', 'pick'], drive: ['beat', 'steal'], cut: ['open'] };
const calib = { bins: Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 })), byEv: new Map<string, { n: number; p: number; hit: number }>() };
function recordCalib(m: Matchup, s: Poss, a: Act, dist: StanceDist, happened: Ev) {
  const odds = actOdds(m, s, a, dist);
  for (const ev of MAIN_EV[a.k]) {
    const p = odds[ev] ?? 0;
    const hit = happened === ev ? 1 : 0;
    const b = calib.bins[Math.min(9, Math.floor(p * 10))];
    b.n++; b.p += p; b.hit += hit;
    const key = `${a.k}:${ev}`;
    const e = calib.byEv.get(key) ?? { n: 0, p: 0, hit: 0 };
    e.n++; e.p += p; e.hit += hit;
    calib.byEv.set(key, e);
  }
}

// ---------------------------------------------------------------- possession & match

interface PossOut { pts: number; decisions: number; kinds: ActKind[] }

function playPoss(m: Matchup, s0: Poss, att: AttackStrat, def: DefPolicy, h: OpponentModel, r: () => number, planner: Planner, calibOn: boolean): PossOut {
  let s: Poss | null = s0;
  let pts = 0, decisions = 0;
  const kinds: ActKind[] = [];
  while (s) {
    const dist = def(m, s, h);
    const a = att({ m, s, dist, r, planner });
    const st = sampleStance(dist, r());
    const b = pickBranch(branches(m, s, a, st), r());
    if (calibOn) recordCalib(m, s, a, dist, b.ev);
    h.observe(m, s, dist, a);
    kinds.push(a.k);
    decisions++;
    pts += b.pts;
    s = b.next;
  }
  return { pts, decisions, kinds };
}

const randomStart = (r: () => number) => setupPoss(SETUPS[Math.floor(r() * SETUPS.length)], Math.floor(r() * 3));

function possTable(r: () => number) {
  const rows: string[] = [];
  const header = ['attack \\ defense', ...Object.keys(DEFS)];
  rows.push(`| ${header.join(' | ')} | avg |`, `|${header.map(() => '---').join('|')}|---|`);
  const decisionsBy: Record<string, number> = {};
  const usage: Record<string, Record<ActKind, number>> = {};
  for (const [name, strat] of Object.entries(STRATS)) {
    const cells: string[] = [];
    let sumPpp = 0, dec = 0, n = 0;
    usage[name] = { shoot: 0, pass: 0, drive: 0, cut: 0 };
    for (const [dname, def] of Object.entries(DEFS)) {
      const planner = PLANNER;
      const h = new OpponentModel(PLANNER);
      let pts = 0;
      for (let i = 0; i < POSS; i++) {
        const o = playPoss(M, randomStart(r), strat, def, h, r, planner, dname === 'read' || dname === 'adaptive');
        pts += o.pts; dec += o.decisions; n++;
        for (const k of o.kinds) usage[name][k]++;
      }
      cells.push((pts / POSS).toFixed(2));
      sumPpp += pts / POSS;
      void dname;
    }
    decisionsBy[name] = dec / n;
    rows.push(`| ${name} | ${cells.join(' | ')} | ${(sumPpp / Object.keys(DEFS).length).toFixed(2)} |`);
  }
  return { table: rows.join('\n'), decisionsBy, usage };
}

interface TeamPlan { att: AttackStrat; def: DefPolicy }

function playMatch(a: TeamPlan, b: TeamPlan, r: () => number) {
  const teams = [a, b];
  const habits = [new OpponentModel(PLANNER), new OpponentModel(PLANNER)];
  const planners = [PLANNER, PLANNER];
  const score = [0, 0];
  const possN = [0, 0];
  let off = r() < 0.5 ? 0 : 1;
  let decisions = 0;
  for (let guard = 0; guard < 200; guard++) {
    const o = playPoss(M, randomStart(r), teams[off].att, teams[1 - off].def, habits[off], r, planners[off], false);
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
        const res = playMatch({ att: STRATS[names[i]], def }, { att: STRATS[names[j]], def }, r);
        if (res.winner === 0) w++;
        lens.push(res.decisions);
      }
      win[names[i]][names[j]] = w / MATCHES;
      win[names[j]][names[i]] = 1 - w / MATCHES;
    }
  }
  const rows = [`| vs | ${names.join(' | ')} | avg vs simple |`, `|---|${names.map(() => '---').join('|')}|---|`];
  const avgSimple: Record<string, number> = {};
  for (const x of names) {
    const vsSimple = SIMPLE.filter((y) => y !== x).map((y) => win[x][y]);
    avgSimple[x] = vsSimple.reduce((p, q) => p + q, 0) / vsSimple.length;
    rows.push(`| ${x} | ${names.map((y) => (x === y ? '-' : `${Math.round(win[x][y] * 100)}%`)).join(' | ')} | ${Math.round(avgSimple[x] * 100)}% |`);
  }
  const dominant = SIMPLE.filter((x) => SIMPLE.every((y) => y === x || win[x][y] > 0.55));
  lens.sort((p, q) => p - q);
  return { table: rows.join('\n'), dominant, lens, avgSimple };
}

/** In which situations is each action kind the best one? (expert planner vs the court-reading defense). */
function bestKindShare(r: () => number) {
  const planner = PLANNER;
  const count: Record<ActKind, number> = { shoot: 0, pass: 0, drive: 0, cut: 0 };
  const gain: Record<ActKind, number> = { shoot: 0, pass: 0, drive: 0, cut: 0 };
  let n = 0;
  for (let i = 0; i < POSS; i++) {
    let s: Poss | null = randomStart(r);
    while (s) {
      const dist = readDefense(M, s);
      const acts = legalActs(s);
      const qs = acts.map((a) => planner.q(s!, a, dist));
      const bi = qs.indexOf(Math.max(...qs));
      const best = acts[bi];
      if (s.left > 1) {
        count[best.k]++;
        n++;
        // How much better than the best alternative of a different kind.
        const alt = Math.max(...acts.map((a, k) => (a.k === best.k ? -1 : qs[k])));
        gain[best.k] += qs[bi] - alt;
      }
      const st = sampleStance(dist, r());
      s = pickBranch(branches(M, s, best, st), r()).next;
    }
  }
  return { count, gain, n };
}

// ---------------------------------------------------------------- report

const t0 = Date.now();
const r = rng(SEED);
const out: string[] = [];
out.push(`# Turn Ball simulation (seed ${SEED}, ${POSS} possessions per cell, ${MATCHES} matches per pairing)`);
out.push('');
out.push(`Rules: ${TUNE.actions} decisions per possession, first to ${MATCH_RULES.winScore} or most points after ${MATCH_RULES.maxPoss} possessions each. Equal teams (mirrored starters).`);
out.push('');
out.push('## Points per possession (attack strategy vs defense policy)');
out.push('');
const pt = possTable(r);
out.push(pt.table);
out.push('');
out.push('Decisions per possession and action mix:');
out.push('');
out.push('| strategy | decisions/poss | shoot | pass | drive | cut |');
out.push('|---|---|---|---|---|---|');
for (const [k, u] of Object.entries(pt.usage)) {
  const tot = u.shoot + u.pass + u.drive + u.cut;
  const f = (x: number) => `${Math.round((x / tot) * 100)}%`;
  out.push(`| ${k} | ${pt.decisionsBy[k].toFixed(2)} | ${f(u.shoot)} | ${f(u.pass)} | ${f(u.drive)} | ${f(u.cut)} |`);
}
out.push('');
for (const dn of ['read', 'adaptive']) {
  const mt = matchTable(r, dn);
  out.push(`## Full matches, both teams defend with "${dn}" (row win % vs column)`);
  out.push('');
  out.push(mt.table);
  out.push('');
  const q = (f: number) => mt.lens[Math.floor(f * (mt.lens.length - 1))];
  out.push(`Match length in decisions (both teams): median ${q(0.5)}, p10 ${q(0.1)}, p90 ${q(0.9)}.`);
  out.push(`Dominant simple strategy (beats every other simple one >55%): ${mt.dominant.length ? mt.dominant.join(', ') : 'none'}.`);
  out.push('');
}
const bk = bestKindShare(r);
out.push('## When is each action the best one? (expert planner, court-reading defense, decisions with a choice)');
out.push('');
out.push('| action | best in | avg edge over best other kind (pts) |');
out.push('|---|---|---|');
for (const k of ['shoot', 'pass', 'drive', 'cut'] as ActKind[]) {
  out.push(`| ${k} | ${Math.round((bk.count[k] / bk.n) * 100)}% | ${bk.count[k] ? (bk.gain[k] / bk.count[k]).toFixed(3) : '-'} |`);
}
out.push('');
out.push('## Calibration (announced probability vs observed frequency)');
out.push('');
out.push('| announced bin | samples | mean announced | observed |');
out.push('|---|---|---|---|');
calib.bins.forEach((b, i) => {
  if (!b.n) return;
  out.push(`| ${i * 10}-${i * 10 + 10}% | ${b.n} | ${((b.p / b.n) * 100).toFixed(1)}% | ${((b.hit / b.n) * 100).toFixed(1)}% |`);
});
out.push('');
out.push('| event | samples | mean announced | observed |');
out.push('|---|---|---|---|');
for (const [k, e] of [...calib.byEv.entries()].sort()) {
  out.push(`| ${k} | ${e.n} | ${((e.p / e.n) * 100).toFixed(1)}% | ${((e.hit / e.n) * 100).toFixed(1)}% |`);
}
out.push('');
out.push(`Stances: ${STANCES.join(', ')}. Run time ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
console.log(out.join('\n'));
