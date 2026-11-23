// Static game data: stats, duel actions, techniques, players and rival teams.
// Everything here is original to Turn Ball.

export type Stat = 'spd' | 'pas' | 'sho' | 'str' | 'def' | 'blk';
export const STATS: Stat[] = ['spd', 'pas', 'sho', 'str', 'def', 'blk'];
export const STAT_LABEL: Record<Stat, string> = {
  spd: 'SPD', pas: 'PAS', sho: 'SHO', str: 'STR', def: 'DEF', blk: 'BLK',
};
export const STAT_NAME: Record<Stat, string> = {
  spd: 'Speed', pas: 'Passing', sho: 'Shooting', str: 'Strength', def: 'Defense', blk: 'Blocking',
};

export type AttackAction = 'dribble' | 'pass' | 'shoot' | 'protect';
export type DefendAction = 'steal' | 'block' | 'press' | 'wait';
export type Action = AttackAction | DefendAction;
export const ATTACK_ACTIONS: AttackAction[] = ['dribble', 'pass', 'shoot', 'protect'];
export const DEFEND_ACTIONS: DefendAction[] = ['steal', 'block', 'press', 'wait'];

export interface ActionInfo {
  label: string;
  icon: string;
  stat: Stat;
  beats: Action;
  weak: Action;
  color: string;
}

export const ACTION_INFO: Record<Action, ActionInfo> = {
  dribble: { label: 'Dribble', icon: '⚡', stat: 'spd', beats: 'block', weak: 'steal', color: '#ffb703' },
  pass: { label: 'Pass', icon: '🎯', stat: 'pas', beats: 'press', weak: 'wait', color: '#3ddc97' },
  shoot: { label: 'Shoot', icon: '🏀', stat: 'sho', beats: 'wait', weak: 'block', color: '#ff6b35' },
  protect: { label: 'Protect', icon: '🛡️', stat: 'str', beats: 'steal', weak: 'press', color: '#4cc9f0' },
  steal: { label: 'Steal', icon: '🖐️', stat: 'def', beats: 'dribble', weak: 'protect', color: '#ffb703' },
  block: { label: 'Block', icon: '🧱', stat: 'blk', beats: 'shoot', weak: 'dribble', color: '#ff6b35' },
  press: { label: 'Press', icon: '🔥', stat: 'str', beats: 'protect', weak: 'pass', color: '#f72585' },
  wait: { label: 'Wait', icon: '👀', stat: 'def', beats: 'pass', weak: 'shoot', color: '#4cc9f0' },
};

/** Matchup bonus from the ATTACKER's point of view. +3 = hard counter, ±1 = slight edge. */
export const MATRIX: Record<AttackAction, Record<DefendAction, number>> = {
  dribble: { steal: -3, block: 3, press: 1, wait: -1 },
  pass: { steal: 1, block: -1, press: 3, wait: -3 },
  shoot: { steal: 1, block: -3, press: -1, wait: 3 },
  protect: { steal: 3, block: 1, press: -3, wait: -1 },
};

export const MATCHUP_TEXT: Record<string, string> = {
  'dribble-block': 'Ankle breaker!',
  'dribble-steal': 'Picked clean!',
  'pass-press': 'Pass over the pressure!',
  'pass-wait': 'Read like a book!',
  'shoot-wait': 'Too much space!',
  'shoot-block': 'Swatted!',
  'protect-steal': 'Shielded!',
  'protect-press': 'Trapped!',
};

export interface Technique {
  id: string;
  name: string;
  action: Action;
  bonus: number;
  cost: number;
  /** Pierce: a bad matchup counts as 0 instead of negative. */
  pierce?: boolean;
  desc: string;
}

export const TECHNIQUES: Record<string, Technique> = {
  blink: { id: 'blink', name: 'Blink Crossover', action: 'dribble', bonus: 4, cost: 40, desc: 'Dribble +4' },
  spin: { id: 'spin', name: 'Tornado Spin', action: 'dribble', bonus: 3, cost: 55, pierce: true, desc: 'Dribble +3, ignores counters' },
  needle: { id: 'needle', name: 'Needle Pass', action: 'pass', bonus: 4, cost: 40, desc: 'Pass +4' },
  nolook: { id: 'nolook', name: 'No-Look Magic', action: 'pass', bonus: 3, cost: 55, pierce: true, desc: 'Pass +3, ignores counters' },
  floater: { id: 'floater', name: 'Feather Floater', action: 'shoot', bonus: 3, cost: 40, desc: 'Shoot +3' },
  rainbow: { id: 'rainbow', name: 'Rainbow Bomb', action: 'shoot', bonus: 3, cost: 60, pierce: true, desc: 'Shoot +3, ignores counters' },
  bulldoze: { id: 'bulldoze', name: 'Bulldozer', action: 'protect', bonus: 4, cost: 30, desc: 'Protect +4' },
  vacuum: { id: 'vacuum', name: 'Vacuum Hands', action: 'steal', bonus: 4, cost: 40, desc: 'Steal +4' },
  sky: { id: 'sky', name: 'Skyscraper', action: 'block', bonus: 4, cost: 40, desc: 'Block +4' },
  wall: { id: 'wall', name: 'Brick Wall', action: 'block', bonus: 3, cost: 55, pierce: true, desc: 'Block +3, ignores counters' },
  swarm: { id: 'swarm', name: 'Hornet Swarm', action: 'press', bonus: 4, cost: 40, desc: 'Press +4' },
  mind: { id: 'mind', name: 'Mind Reader', action: 'wait', bonus: 3, cost: 50, pierce: true, desc: 'Wait +3, ignores counters' },
};

/** Levels at which a player's 1st, 2nd and 3rd technique are learned. */
export const TECH_LEVELS = [1, 3, 5];
export const MAX_LEVEL = 10;
export const xpForLevel = (level: number) => 60 + level * 40;

export type Stats = Record<Stat, number>;

export interface PlayerTemplate {
  id: string;
  name: string;
  num: number;
  tag: string;
  hair: string;
  skin: string;
  stats: Stats;
  growth: [Stat, Stat];
  techs: [string, string, string];
  price: number;
}

const s = (spd: number, pas: number, sho: number, str: number, def: number, blk: number): Stats =>
  ({ spd, pas, sho, str, def, blk });

export const TEMPLATES: PlayerTemplate[] = [
  { id: 'pip', name: 'Pip Rocket', num: 7, tag: 'Faster than the school bell.', hair: '#2b2d42', skin: '#8d5524', stats: s(8, 5, 4, 3, 6, 3), growth: ['spd', 'def'], techs: ['blink', 'vacuum', 'spin'], price: 0 },
  { id: 'mo', name: 'Mo Tower', num: 34, tag: 'Has not seen their own shoes since 5th grade.', hair: '#e09f3e', skin: '#f1c27d', stats: s(3, 4, 4, 7, 5, 8), growth: ['blk', 'str'], techs: ['sky', 'bulldoze', 'wall'], price: 0 },
  { id: 'luz', name: 'Luz Swish', num: 11, tag: 'Practices free throws in their sleep.', hair: '#6a040f', skin: '#c68642', stats: s(5, 6, 8, 3, 4, 3), growth: ['sho', 'pas'], techs: ['floater', 'needle', 'rainbow'], price: 0 },
  { id: 'kiki', name: 'Kiki Zoom', num: 2, tag: 'Passes before you blink. Blinks before you pass.', hair: '#ff006e', skin: '#ffdbac', stats: s(7, 7, 5, 3, 5, 3), growth: ['pas', 'spd'], techs: ['needle', 'blink', 'nolook'], price: 220 },
  { id: 'benny', name: 'Benny Bricks', num: 50, tag: 'Cannot shoot. Cannot be moved.', hair: '#3a5a40', skin: '#e0ac69', stats: s(3, 3, 3, 9, 6, 7), growth: ['str', 'def'], techs: ['bulldoze', 'swarm', 'wall'], price: 200 },
  { id: 'nova', name: 'Nova Lane', num: 9, tag: 'Sees the court like a math grid.', hair: '#7209b7', skin: '#8d5524', stats: s(6, 8, 6, 4, 4, 4), growth: ['pas', 'sho'], techs: ['nolook', 'floater', 'needle'], price: 300 },
  { id: 'taro', name: 'Taro Wall', num: 44, tag: 'Their high-five is a blocked shot.', hair: '#14213d', skin: '#f1c27d', stats: s(4, 4, 5, 7, 7, 7), growth: ['blk', 'def'], techs: ['sky', 'mind', 'swarm'], price: 320 },
  { id: 'jax', name: 'Jax Pepper', num: 23, tag: 'Spicy hands. Steals your lunch money (and the ball).', hair: '#d00000', skin: '#ffdbac', stats: s(8, 5, 6, 4, 7, 3), growth: ['def', 'spd'], techs: ['vacuum', 'blink', 'swarm'], price: 350 },
  { id: 'ruby', name: 'Ruby Hook', num: 31, tag: 'One move. Nobody stops it.', hair: '#9d0208', skin: '#c68642', stats: s(5, 5, 8, 6, 4, 6), growth: ['sho', 'str'], techs: ['floater', 'rainbow', 'bulldoze'], price: 380 },
  { id: 'zed', name: 'Zed Noodle', num: 0, tag: 'Bendy. Unpredictable. Good at everything.', hair: '#06d6a0', skin: '#e0ac69', stats: s(6, 6, 6, 5, 6, 6), growth: ['spd', 'blk'], techs: ['mind', 'spin', 'sky'], price: 420 },
  { id: 'fern', name: 'Fern Dunkworth', num: 12, tag: 'Jumps first, asks questions later.', hair: '#606c38', skin: '#8d5524', stats: s(7, 4, 7, 7, 5, 7), growth: ['str', 'sho'], techs: ['rainbow', 'wall', 'spin'], price: 520 },
  { id: 'ola', name: 'Ola Breeze', num: 8, tag: 'Leaves defenders in a light wind.', hair: '#ffbe0b', skin: '#f1c27d', stats: s(9, 7, 7, 3, 6, 3), growth: ['spd', 'pas'], techs: ['spin', 'nolook', 'vacuum'], price: 560 },
];

export const STARTER_IDS = ['pip', 'mo', 'luz'];

export interface RivalTeam {
  id: string;
  name: string;
  color: string;
  accent: string;
  tier: number;
  motto: string;
  players: [string, string, string];
}

export const USER_TEAM = { name: 'Sunnyside Hoopers', short: 'SUN', color: '#ff7a1a', accent: '#ffd166' };

export const RIVALS: RivalTeam[] = [
  { id: 'puddle', name: 'Puddle Jumpers', color: '#2ec4b6', accent: '#cbf3f0', tier: 0, motto: 'They jump. Mostly into puddles.', players: ['Drip Malone', 'Galosh Gary', 'Splatty Jo'] },
  { id: 'ravens', name: 'Rooftop Ravens', color: '#7b2cbf', accent: '#e0aaff', tier: 1, motto: 'Caw. Caw. Buckets.', players: ['Beaky Ray', 'Talon Sue', 'Perch Petrov'] },
  { id: 'crabs', name: 'Crunchtime Crabs', color: '#e63946', accent: '#ffccd5', tier: 2, motto: 'Sideways defense, straight-up rude.', players: ['Pinch Ortiz', 'Shelly Snap', 'Claw Danvers'] },
  { id: 'narwhals', name: 'Neon Narwhals', color: '#f72585', accent: '#4cc9f0', tier: 3, motto: 'Glow in the dark. Score in the light.', players: ['Glimmer Ko', 'Tusk Bright', 'Neona Vale'] },
  { id: 'toasters', name: 'Thunder Toasters', color: '#f4a261', accent: '#264653', tier: 4, motto: 'Pop-up shots, crispy defense.', players: ['Crumbs McKay', 'Sizzle Ade', 'Bagel Brick'] },
  { id: 'meteors', name: 'Midnight Meteors', color: '#3a0ca3', accent: '#ffd60a', tier: 5, motto: 'Undefeated since sundown.', players: ['Comet Kade', 'Orbit Ines', 'Big Crater'] },
];

const ROLE_OFFSETS: Stats[] = [
  s(2, 1, 0, -2, 1, -2), // guard
  s(0, 0, 2, 0, 0, -1), // wing
  s(-2, -1, -1, 2, 0, 3), // big
];
const ROLE_TECHS: string[][] = [
  ['blink', 'vacuum', 'nolook'],
  ['floater', 'needle', 'rainbow'],
  ['sky', 'bulldoze', 'wall'],
];
const ROLE_LOOK = [
  { hair: '#111', skin: '#8d5524' },
  { hair: '#5e3023', skin: '#f1c27d' },
  { hair: '#333', skin: '#c68642' },
];

export interface Player {
  uid: string;
  tid: string;
  name: string;
  num: number;
  tag: string;
  hair: string;
  skin: string;
  stats: Stats;
  growth: [Stat, Stat];
  techs: string[];
  level: number;
  xp: number;
  known: string[];
}

let uidCounter = 0;
export const newUid = () => `p${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function playerFromTemplate(t: PlayerTemplate): Player {
  return {
    uid: newUid(), tid: t.id, name: t.name, num: t.num, tag: t.tag, hair: t.hair, skin: t.skin,
    stats: { ...t.stats }, growth: [...t.growth] as [Stat, Stat], techs: [...t.techs], level: 1, xp: 0,
    known: [t.techs[0]],
  };
}

export function rivalPlayers(team: RivalTeam): Player[] {
  const base = 4 + team.tier * 0.8;
  return team.players.map((name, i) => {
    const off = ROLE_OFFSETS[i];
    const stats = {} as Stats;
    for (const k of Object.keys(off) as Stat[]) {
      stats[k] = Math.max(1, Math.min(10, Math.round(base + off[k])));
    }
    const techCount = team.tier === 0 ? 0 : team.tier < 3 ? 1 : team.tier < 5 ? 2 : 3;
    return {
      uid: `${team.id}-${i}`, tid: `${team.id}-${i}`, name, num: [3, 21, 55][i] + team.tier,
      tag: team.motto, hair: ROLE_LOOK[i].hair, skin: ROLE_LOOK[i].skin, stats,
      growth: ['spd', 'def'], techs: ROLE_TECHS[i], level: 1 + team.tier * 2, xp: 0,
      known: ROLE_TECHS[i].slice(0, techCount),
    };
  });
}

export const playerPower = (p: Player) =>
  Math.round((Object.values(p.stats).reduce((a, b) => a + b, 0) / 6) * 10) / 10;
