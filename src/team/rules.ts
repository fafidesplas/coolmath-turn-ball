// Turn Ball 5v5, playbook mode: the rules. Pure functions (run by the page and by the balance check).
//
// A possession is a called play, not a string of small moves:
//   1. The defense shows its scheme (Man, Zone, Switch, Trap). The offense calls a play from its playbook.
//   2. The play runs. At its key moment the defense reacts (hedge, drop, double...): that reaction is visible.
//   3. The offense picks the read that punishes it (the roller, the open corner, the mismatch...).
//   4. The read is played out: a pass can be picked off, a shot goes in or not, a miss may be an offensive board.
// Odds depend on the read (open, contested, tough), the players (each has shooting, finishing, passing and
// defense from 1 to 5) and the scheme. The page never shows percentages: it shows OPEN / CONTESTED / TOUGH,
// the stars of the player who takes it, and whether the pass is risky.

export type Pos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POS: Pos[] = ['PG', 'SG', 'SF', 'PF', 'C'];
export interface TP {
  name: string; num: number; pos: Pos; skin: string; hair: string; hairStyle: number;
  /** Outside shooting, finishing at the rim, passing, defense, size (1 to 5). */
  sh: number; fi: number; pa: number; de: number; sz: number;
}
export type Scheme = 'man' | 'zone' | 'switch' | 'trap';
export const SCHEMES: Scheme[] = ['man', 'zone', 'switch', 'trap'];
export type PlayId = 'pnr' | 'iso' | 'post' | 'motion';
export const PLAYS: PlayId[] = ['pnr', 'iso', 'post', 'motion'];
export type ShotKind = 'three' | 'mid' | 'layup' | 'dunk' | 'hook';
export type Quality = 'open' | 'contested' | 'tough';

export const SCHEME_INFO: Record<Scheme, { name: string; line: string }> = {
  man: { name: 'Man', line: 'Everyone guards his man. No weak spot, no help either.' },
  zone: { name: 'Zone', line: 'They pack the paint: inside shots get harder, shooters get looks.' },
  switch: { name: 'Switch', line: 'They switch every screen: no one gets free, but mismatches appear.' },
  trap: { name: 'Trap', line: 'They jump the ball: passes get risky, but someone is always open.' },
};
export const PLAY_INFO: Record<PlayId, { name: string; line: string }> = {
  pnr: { name: 'Pick and roll', line: 'Your center screens for the point guard and rolls to the rim.' },
  iso: { name: 'Isolation', line: 'Clear the side for your best scorer, one against one.' },
  post: { name: 'Post-up', line: 'Feed your center on the block and play off him.' },
  motion: { name: 'Motion', line: 'Swing the ball, screen away and cut until someone is free.' },
};

export interface Reaction { id: string; name: string; line: string }
/** The defense's answers at each play's key moment. */
export const REACTIONS: Record<PlayId, Reaction[]> = {
  pnr: [
    { id: 'hedge', name: 'Hedge', line: 'The big jumps out at the ball. The roller and the weak side are left.' },
    { id: 'drop', name: 'Drop', line: 'The big stays back in the paint. The pull-up jumper is left.' },
    { id: 'switch', name: 'Switch', line: 'They swap men: a big on the guard, a guard on the big.' },
  ],
  iso: [
    { id: 'stay', name: 'Stay home', line: 'One on one, nobody helps. The scorer against his man.' },
    { id: 'double', name: 'Double', line: 'A second man comes: someone else is open.' },
    { id: 'help', name: 'Help inside', line: 'Help waits in the paint for the drive. The corner is left.' },
  ],
  post: [
    { id: 'front', name: 'Front', line: 'His man gets in front: the lob over the top is there.' },
    { id: 'behind', name: 'Play behind', line: 'His man stays behind: the center works one on one.' },
    { id: 'double', name: 'Double', line: 'A guard digs in: the guard he left is open.' },
  ],
  motion: [
    { id: 'deny', name: 'Deny', line: 'They overplay every pass: the backdoor cut opens.' },
    { id: 'pack', name: 'Pack paint', line: 'They sag into the paint: the threes are open.' },
    { id: 'switch', name: 'Switch all', line: 'They switch every off-ball screen: mismatches.' },
  ],
};

/** One read: who takes the shot, how good it is, and how risky the pass to him is. */
export interface Read {
  id: string;
  name: string;
  /** Index (0 PG .. 4 C) of the player who shoots. */
  who: number;
  /** Index of the player who passes him the ball (null: he already has it). */
  from: number | null;
  kind: ShotKind;
  q: Quality;
  /** Base chance the pass is picked off. */
  risk: number;
  line: string;
}
const R = (id: string, name: string, who: number, from: number | null, kind: ShotKind, q: Quality, risk: number, line: string): Read => ({ id, name, who, from, kind, q, risk, line });

/** The reads each reaction leaves (the ball handler of each play is the first player that holds it). */
export const READS: Record<PlayId, Record<string, Read[]>> = {
  pnr: {
    hedge: [
      R('roll', 'Pocket pass to the roller', 4, 0, 'dunk', 'contested', 0.1, 'Bounce it to the center rolling to the rim; the help may tag him.'),
      R('skip', 'Skip to the weak side', 2, 0, 'three', 'open', 0.08, 'The help left the small forward: a long pass for an open three.'),
      R('pull', 'Pull-up three', 0, null, 'three', 'tough', 0, 'Shoot over the big right away.'),
    ],
    drop: [
      R('pull', 'Pull-up jumper', 0, null, 'mid', 'open', 0, 'The big is back: an open mid-range jumper.'),
      R('lob', 'Lob to the roller', 4, 0, 'dunk', 'contested', 0.14, 'Throw it up over the big who dropped.'),
      R('kick', 'Kick to the wing', 1, 0, 'three', 'contested', 0.04, 'A three for the shooting guard, his man close.'),
    ],
    switch: [
      R('attack', 'Attack the big', 0, null, 'layup', 'open', 0, 'Your guard against a slow big: drive past him.'),
      R('feed', 'Feed the mismatch', 4, 0, 'hook', 'open', 0.08, 'Your center against a guard: post him and hook it.'),
      R('step', 'Step-back three', 0, null, 'three', 'contested', 0, 'Make room on the big and shoot.'),
    ],
  },
  iso: {
    stay: [
      R('drive', 'Drive', 1, null, 'layup', 'contested', 0, 'Beat him off the dribble to the rim.'),
      R('jab', 'Jab and jumper', 1, null, 'mid', 'contested', 0, 'Jab, rise, shoot over him.'),
      R('step', 'Step-back three', 1, null, 'three', 'tough', 0, 'Step back behind the line.'),
    ],
    double: [
      R('swing', 'Swing to the corner', 3, 1, 'three', 'open', 0.06, 'The man who doubled left the corner open.'),
      R('short', 'Hit the short roll', 4, 1, 'mid', 'open', 0.1, 'Your center flashes to the middle, open.'),
      R('split', 'Split the double', 1, null, 'layup', 'tough', 0.16, 'Dribble through both of them.'),
    ],
    help: [
      R('kick', 'Drive and kick', 3, 1, 'three', 'open', 0.06, 'Draw the help, kick it to the corner.'),
      R('pull', 'Pull-up jumper', 1, null, 'mid', 'open', 0, 'Stop short of the help and shoot.'),
      R('finish', 'Finish through it', 1, null, 'layup', 'tough', 0, 'Go at the help and finish.'),
    ],
  },
  post: {
    front: [
      R('lob', 'Lob over the top', 4, 1, 'layup', 'open', 0.14, 'He is fronted: throw it over him.'),
      R('reset', 'Reset to the top', 0, 1, 'three', 'contested', 0.03, 'Swing it back out for a three.'),
      R('drive', 'Drive the wing', 1, null, 'layup', 'contested', 0, 'Go yourself while they front.'),
    ],
    behind: [
      R('hook', 'Hook shot', 4, 1, 'hook', 'contested', 0.04, 'Back him down and hook it.'),
      R('drop', 'Drop step', 4, 1, 'layup', 'contested', 0.04, 'Spin baseline and finish.'),
      R('kickout', 'Kick out', 2, 4, 'three', 'contested', 0.08, 'The center finds the small forward.'),
    ],
    double: [
      R('out', 'Out to the open guard', 0, 4, 'three', 'open', 0.08, 'The guard who dug in left the point guard.'),
      R('cut', 'Hit the cutter', 2, 4, 'layup', 'open', 0.12, 'The small forward cuts behind the double.'),
      R('force', 'Shoot over two', 4, null, 'hook', 'tough', 0, 'Force it up through the double.'),
    ],
  },
  motion: {
    deny: [
      R('backdoor', 'Backdoor cut', 2, 0, 'layup', 'open', 0.12, 'His man overplays: cut behind him.'),
      R('curl', 'Curl jumper', 1, 0, 'mid', 'contested', 0.04, 'Curl off the screen and shoot.'),
      R('top', 'Three from the top', 0, null, 'three', 'contested', 0, 'Keep it and shoot.'),
    ],
    pack: [
      R('swing', 'Swing three', 1, 0, 'three', 'open', 0.04, 'The ball moves faster than they do.'),
      R('extra', 'Extra pass to the corner', 3, 1, 'three', 'open', 0.07, 'One more pass, a wide-open corner.'),
      R('drive', 'Drive the gap', 0, null, 'layup', 'tough', 0, 'Attack the packed paint.'),
    ],
    switch: [
      R('mismatch', 'Post the small man', 3, 0, 'hook', 'open', 0.06, 'Your power forward against a guard.'),
      R('slip', 'Slip the screen', 4, 0, 'layup', 'contested', 0.1, 'The center slips before they switch.'),
      R('three', 'Contested three', 1, 0, 'three', 'contested', 0.03, 'Take what is there.'),
    ],
  },
};

const BASE: Record<ShotKind, Record<Quality, number>> = {
  three: { open: 0.38, contested: 0.31, tough: 0.25 },
  mid: { open: 0.47, contested: 0.4, tough: 0.33 },
  layup: { open: 0.62, contested: 0.5, tough: 0.4 },
  dunk: { open: 0.8, contested: 0.62, tough: 0.48 },
  hook: { open: 0.52, contested: 0.46, tough: 0.38 },
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ptsOf = (k: ShotKind) => (k === 'three' ? 3 : 2);
const inside = (k: ShotKind) => k === 'layup' || k === 'dunk' || k === 'hook';

/** The odds of a read for these two teams under this scheme: pass picked off, shot made (if the pass gets there). */
export function odds(rd: Read, sc: Scheme, off: TP[], def: TP[]): { to: number; make: number } {
  const s = off[rd.who];
  const stat = inside(rd.kind) ? s.fi : s.sh;
  let make = BASE[rd.kind][rd.q] - 0.04 + (stat - 3) * 0.045;
  // The defender who closes out: his man's defender, a little less if the shot is open.
  const d = def[rd.who];
  make -= (d.de - 3) * (rd.q === 'open' ? 0.01 : 0.03);
  if (inside(rd.kind)) make -= (d.sz - s.sz) * 0.02;
  if (sc === 'zone') make += inside(rd.kind) ? -0.07 : 0.03;
  if (sc === 'trap') make += rd.q === 'open' ? 0.04 : 0;
  if (sc === 'switch') make += rd.q === 'open' ? -0.03 : 0.02;
  let to = rd.risk;
  if (rd.from !== null) to += (3 - off[rd.from].pa) * 0.025;
  if (sc === 'trap' && rd.from !== null) to += 0.05;
  to = clamp(to, 0, 0.5);
  return { to, make: clamp(make, 0.05, 0.95) };
}
/** Chance of an offensive rebound on a miss. */
export const orebChance = (off: TP[], def: TP[]) => clamp(0.15 + ((off[3].sz + off[4].sz) - (def[3].sz + def[4].sz)) * 0.03, 0.08, 0.35);
/** Expected points of a read (with a little credit for the offensive board). */
export function readEV(rd: Read, sc: Scheme, off: TP[], def: TP[]) {
  const o = odds(rd, sc, off, def);
  return (1 - o.to) * (o.make * ptsOf(rd.kind) + (1 - o.make) * orebChance(off, def) * 1.0);
}
export const readsFor = (p: PlayId, reaction: string) => READS[p][reaction];
/** The best read against a reaction (what a perfect offense takes). */
export const bestRead = (p: PlayId, re: string, sc: Scheme, off: TP[], def: TP[]) =>
  readsFor(p, re).map((r) => ({ r, v: readEV(r, sc, off, def) })).sort((a, b) => b.v - a.v)[0];

/** Softmax pick (higher value more likely; temp 0 = always the best). */
export function soft<T>(items: { x: T; v: number }[], temp: number, r: number): T {
  if (temp <= 0) return items.slice().sort((a, b) => b.v - a.v)[0].x;
  const hi = Math.max(...items.map((i) => i.v));
  const ws = items.map((i) => Math.exp((i.v - hi) / temp));
  let t = r * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { t -= ws[i]; if (t <= 0) return items[i].x; }
  return items[items.length - 1].x;
}
/** The defense's reaction: the one that leaves the offense the least, with some noise. */
export const aiReaction = (p: PlayId, sc: Scheme, off: TP[], def: TP[], r: number, temp = 0.08) =>
  soft(REACTIONS[p].map((re) => ({ x: re.id, v: -bestRead(p, re.id, sc, off, def).v })), temp, r);
/** Value of a play: the defense answers it well, the offense reads it well. */
export function playEV(p: PlayId, sc: Scheme, off: TP[], def: TP[]) {
  return Math.min(...REACTIONS[p].map((re) => bestRead(p, re.id, sc, off, def).v)) * 0.6 +
    REACTIONS[p].reduce((a, re) => a + bestRead(p, re.id, sc, off, def).v, 0) / 3 * 0.4;
}
export const aiPlay = (sc: Scheme, off: TP[], def: TP[], r: number, temp = 0.06) => soft(PLAYS.map((p) => ({ x: p, v: playEV(p, sc, off, def) })), temp, r);
/** The AI's read, a bit noisy (it does not always see the best one). */
export const aiRead = (p: PlayId, re: string, sc: Scheme, off: TP[], def: TP[], r: number, temp = 0.12) =>
  soft(readsFor(p, re).map((rd) => ({ x: rd, v: readEV(rd, sc, off, def) })), temp, r);
/** The AI's scheme for a possession: what holds the opponent's best play to the least. */
export const aiScheme = (off: TP[], def: TP[], r: number, temp = 0.06) =>
  soft(SCHEMES.map((sc) => ({ x: sc, v: -Math.max(...PLAYS.map((p) => playEV(p, sc, off, def))) })), temp, r);

/** A grade for a value (expected points): what the menus show instead of numbers. */
export const grade = (v: number) => (v >= 1.1 ? 'A' : v >= 0.95 ? 'B' : v >= 0.8 ? 'C' : 'D');

export const POSSESSIONS = 8;

// ---------------------------------------------------------------- rosters (original players)
const P = (name: string, num: number, pos: Pos, skin: string, hair: string, hairStyle: number, sh: number, fi: number, pa: number, de: number, sz: number): TP =>
  ({ name, num, pos, skin, hair, hairStyle, sh, fi, pa, de, sz });
export const HOME_TEAM: TP[] = [
  P('Pip', 3, 'PG', '#c98a5a', '#2e222f', 1, 4, 3, 5, 3, 1),
  P('Luz', 11, 'SG', '#e0b090', '#6b3a2a', 4, 5, 3, 3, 3, 2),
  P('Kiki', 7, 'SF', '#8d5a3b', '#1b1029', 0, 3, 4, 3, 4, 3),
  P('Benny', 21, 'PF', '#f0c6a0', '#d9a441', 2, 3, 3, 2, 3, 4),
  P('Mo', 55, 'C', '#5a3825', '#1b1029', -1, 1, 5, 2, 4, 5),
];
export const AWAY_TEAM: TP[] = [
  P('Jax', 1, 'PG', '#7a4a32', '#1b1029', 3, 3, 4, 4, 4, 1),
  P('Ruby', 8, 'SG', '#f0c6a0', '#b23a48', 2, 4, 3, 3, 3, 2),
  P('Zed', 13, 'SF', '#a86b4a', '#2e222f', 1, 4, 3, 3, 3, 3),
  P('Taro', 32, 'PF', '#e0b090', '#1b1029', 4, 2, 4, 3, 4, 4),
  P('Fern', 50, 'C', '#6b4430', '#3a2a55', 0, 2, 4, 3, 3, 5),
];
