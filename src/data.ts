// Static game data: stats, players (with their technique paths) and rival teams.
import type { TechId } from './techs.ts';
// Everything here is original to Turn Ball.

export type Stat = 'spd' | 'pas' | 'sho' | 'str' | 'def' | 'blk';
export const STATS: Stat[] = ['spd', 'pas', 'sho', 'str', 'def', 'blk'];
export const STAT_LABEL: Record<Stat, string> = {
  spd: 'SPD', pas: 'PAS', sho: 'SHO', str: 'STR', def: 'DEF', blk: 'BLK',
};
export const STAT_NAME: Record<Stat, string> = {
  spd: 'Speed', pas: 'Passing', sho: 'Shooting', str: 'Strength', def: 'Defense', blk: 'Blocking',
};

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
  /** Archetype shown on the card. */
  role: string;
  /** Techniques known when signed. */
  start: TechId[];
  /** Techniques learned in order at LEARN_LEVELS (or earlier by training). */
  path: TechId[];
  price: number;
}

const s = (spd: number, pas: number, sho: number, str: number, def: number, blk: number): Stats =>
  ({ spd, pas, sho, str, def, blk });

export const TEMPLATES: PlayerTemplate[] = [
  { id: 'pip', name: 'Pip Rocket', num: 7, tag: 'Faster than the school bell.', hair: '#2b2d42', skin: '#8d5524', stats: s(8, 5, 4, 3, 6, 3), growth: ['spd', 'def'], role: 'Slasher', start: [], path: ['cross', 'hawk', 'spin', 'giveandgo', 'stepback'], price: 0 },
  { id: 'mo', name: 'Mo Tower', num: 34, tag: 'Has not seen their own shoes since 5th grade.', hair: '#e09f3e', skin: '#f1c27d', stats: s(3, 4, 4, 7, 5, 8), growth: ['blk', 'str'], role: 'Big', start: [], path: ['pnr', 'switch', 'layup', 'float', 'bank'], price: 0 },
  { id: 'luz', name: 'Luz Swish', num: 11, tag: 'Practices free throws in their sleep.', hair: '#6a040f', skin: '#c68642', stats: s(5, 6, 8, 3, 4, 3), growth: ['sho', 'pas'], role: 'Shooter', start: [], path: ['fade', 'screen', 'bounce', 'bank', 'recover'], price: 0 },
  { id: 'kiki', name: 'Kiki Zoom', num: 2, tag: 'Passes before you blink. Blinks before you pass.', hair: '#ff006e', skin: '#ffdbac', stats: s(7, 7, 5, 3, 5, 3), growth: ['pas', 'spd'], role: 'Playmaker', start: ['nolook'], path: ['bounce', 'lob', 'giveandgo', 'hesi', 'jump'], price: 220 },
  { id: 'benny', name: 'Benny Bricks', num: 50, tag: 'Cannot shoot. Cannot be moved.', hair: '#3a5a40', skin: '#e0ac69', stats: s(3, 3, 3, 9, 6, 7), growth: ['str', 'def'], role: 'Defender', start: ['switch'], path: ['float', 'recover', 'layup', 'pnr', 'hawk'], price: 200 },
  { id: 'nova', name: 'Nova Lane', num: 9, tag: 'Sees the court like a math grid.', hair: '#7209b7', skin: '#8d5524', stats: s(6, 8, 6, 4, 4, 4), growth: ['pas', 'sho'], role: 'Playmaker', start: ['lob', 'bank'], path: ['nolook', 'screen', 'fade', 'backdoor', 'jump'], price: 300 },
  { id: 'taro', name: 'Taro Wall', num: 44, tag: 'Their high-five is a blocked shot.', hair: '#14213d', skin: '#f1c27d', stats: s(4, 4, 5, 7, 7, 7), growth: ['blk', 'def'], role: 'Defender', start: ['recover'], path: ['switch', 'hawk', 'bank', 'layup', 'float'], price: 320 },
  { id: 'jax', name: 'Jax Pepper', num: 23, tag: 'Spicy hands. Steals your lunch money (and the ball).', hair: '#d00000', skin: '#ffdbac', stats: s(8, 5, 6, 4, 7, 3), growth: ['def', 'spd'], role: 'Defender', start: ['hawk'], path: ['cross', 'jump', 'spin', 'backdoor', 'stepback'], price: 350 },
  { id: 'ruby', name: 'Ruby Hook', num: 31, tag: 'One move. Nobody stops it.', hair: '#9d0208', skin: '#c68642', stats: s(5, 5, 8, 6, 4, 6), growth: ['sho', 'str'], role: 'Shooter', start: ['fade'], path: ['bank', 'stepback', 'screen', 'layup', 'bounce'], price: 380 },
  { id: 'zed', name: 'Zed Noodle', num: 0, tag: 'Bendy. Unpredictable. Good at everything.', hair: '#06d6a0', skin: '#e0ac69', stats: s(6, 6, 6, 5, 6, 6), growth: ['spd', 'blk'], role: 'All-round', start: ['hesi'], path: ['backdoor', 'float', 'nolook', 'spin', 'pnr'], price: 420 },
  { id: 'fern', name: 'Fern Dunkworth', num: 12, tag: 'Jumps first, asks questions later.', hair: '#606c38', skin: '#8d5524', stats: s(7, 4, 7, 7, 5, 7), growth: ['str', 'sho'], role: 'Slasher', start: ['layup', 'cross'], path: ['spin', 'pnr', 'hawk', 'fade', 'backdoor'], price: 520 },
  { id: 'ola', name: 'Ola Breeze', num: 8, tag: 'Leaves defenders in a light wind.', hair: '#ffbe0b', skin: '#f1c27d', stats: s(9, 7, 7, 3, 6, 3), growth: ['spd', 'pas'], role: 'Slasher', start: ['cross', 'hesi'], path: ['stepback', 'spin', 'giveandgo', 'nolook', 'jump'], price: 560 },
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
  /** Technique your best scorer learns the first time you beat this team. */
  lesson: TechId;
}

export const USER_TEAM = { name: 'Sunnyside Hoopers', short: 'SUN', color: '#ff7a1a', accent: '#ffd166' };

export const RIVALS: RivalTeam[] = [
  { id: 'puddle', name: 'Puddle Jumpers', color: '#2ec4b6', accent: '#cbf3f0', tier: 0, motto: 'They jump. Mostly into puddles.', players: ['Drip Malone', 'Galosh Gary', 'Splatty Jo'], lesson: 'bounce' },
  { id: 'ravens', name: 'Rooftop Ravens', color: '#7b2cbf', accent: '#e0aaff', tier: 1, motto: 'Caw. Caw. Buckets.', players: ['Beaky Ray', 'Talon Sue', 'Perch Petrov'], lesson: 'backdoor' },
  { id: 'crabs', name: 'Crunchtime Crabs', color: '#c1121f', accent: '#ffccd5', tier: 2, motto: 'Sideways defense, straight-up rude.', players: ['Pinch Ortiz', 'Shelly Snap', 'Claw Danvers'], lesson: 'hesi' },
  { id: 'narwhals', name: 'Neon Narwhals', color: '#f72585', accent: '#4cc9f0', tier: 3, motto: 'Glow in the dark. Score in the light.', players: ['Glimmer Ko', 'Tusk Bright', 'Neona Vale'], lesson: 'lob' },
  { id: 'toasters', name: 'Thunder Toasters', color: '#3d5a80', accent: '#f4a261', tier: 4, motto: 'Pop-up shots, crispy defense.', players: ['Crumbs McKay', 'Sizzle Ade', 'Bagel Brick'], lesson: 'jump' },
  { id: 'meteors', name: 'Midnight Meteors', color: '#3a0ca3', accent: '#ffd60a', tier: 5, motto: 'Undefeated since sundown.', players: ['Comet Kade', 'Orbit Ines', 'Big Crater'], lesson: 'nolook' },
];

/** Technique paths of rival players by role; a rival of tier t knows the first t of them. */
export const ROLE_KITS: TechId[][] = [
  ['cross', 'hawk', 'giveandgo', 'spin', 'stepback'],
  ['pnr', 'switch', 'layup', 'float', 'bank'],
  ['fade', 'screen', 'bounce', 'jump', 'recover'],
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
  role: string;
  path: TechId[];
  level: number;
  xp: number;
  /** Learned (non-base) techniques. */
  known: TechId[];
  /** Equipped techniques (limited by slots); only these are used in matches. */
  gear: TechId[];
}

let uidCounter = 0;
export const newUid = () => `p${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function playerFromTemplate(t: PlayerTemplate): Player {
  return {
    uid: newUid(), tid: t.id, name: t.name, num: t.num, tag: t.tag, hair: t.hair, skin: t.skin,
    stats: { ...t.stats }, growth: [...t.growth] as [Stat, Stat], role: t.role, path: [...t.path], level: 1, xp: 0,
    known: [...t.start], gear: [...t.start],
  };
}

/**
 * Equal stats: the rival plays with exact copies of your starters' stats (same slot = same role),
 * wearing its own names and colors. Its techniques come from its tier (ROLE_KITS), so learning
 * techniques makes you stronger than early rivals and keeps up with later ones.
 */
export function mirrorPlayers(team: RivalTeam, mine: Player[]): Player[] {
  return mine.slice(0, 3).map((p, i) => {
    const kit = ROLE_KITS[i].slice(0, Math.min(4, team.tier));
    return {
      ...p, uid: `${team.id}-${i}`, tid: `${team.id}-${i}`, name: team.players[i], num: [3, 21, 55][i] + team.tier,
      tag: team.motto, hair: ROLE_LOOK[i].hair, skin: ROLE_LOOK[i].skin, stats: { ...p.stats }, known: [...kit], gear: [...kit],
    };
  });
}

export const playerPower = (p: Player) =>
  Math.round((Object.values(p.stats).reduce((a, b) => a + b, 0) / 6) * 10) / 10;
