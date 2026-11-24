// Persistent career state: roster, coins, league progress, scouting, leveling and techniques.
import {
  MAX_LEVEL, RIVALS, STARTER_IDS, TEMPLATES, playerFromTemplate, xpForLevel,
  type Player, type RivalTeam, type Stat,
} from './data';
import type { MatchResult } from './match';
import { LEARN_LEVELS, TECHS, slotsFor, trainCost, type TechId } from './techs';

export const ROSTER_MAX = 5;
export const SCOUT_REFRESH_COST = 25;
const KEY = 'turnball-save-v1';

export interface Save {
  v: 1;
  coins: number;
  roster: Player[];
  beaten: number;
  record: Record<string, { w: number; l: number }>;
  scout: string[];
  sound: boolean;
  duelsSeen: number;
  /** Guided tutorial finished (or skipped). */
  tutorialDone?: boolean;
  /** Techniques learned since the team screen was last opened (uid:tech), shown as NEW. */
  fresh?: string[];
  /** Pixel edition: reduced motion (no slow motion, zoom, shake or particle bursts). */
  reduceFx?: boolean;
  /** Pixel edition: the in-match coach already walked through an attack / a defense possession. */
  coachedAtt?: boolean;
  coachedDef?: boolean;
}

export function newSave(): Save {
  const roster = STARTER_IDS.map((id) => playerFromTemplate(TEMPLATES.find((t) => t.id === id)!));
  const s: Save = { v: 1, coins: 150, roster, beaten: 0, record: {}, scout: [], sound: true, duelsSeen: 0, fresh: [] };
  rollScout(s);
  return s;
}

/** Saves from v3 (old specials) get their technique fields rebuilt from the template and level. */
function migratePlayer(p: Player) {
  if (Array.isArray(p.gear) && Array.isArray(p.path) && p.role) return;
  const t = TEMPLATES.find((x) => x.id === p.tid);
  if (!t) { p.role = p.role ?? 'All-round'; p.path = []; p.known = []; p.gear = []; return; }
  p.role = t.role;
  p.path = [...t.path];
  p.known = [...t.start, ...t.path.slice(0, LEARN_LEVELS.filter((l) => l <= p.level).length)];
  p.gear = p.known.slice(0, slotsFor(p.level));
}

/** `key`: the pixel edition keeps its own save (its techniques and signatures do not exist in the 3D game). */
export function loadSave(key = KEY): Save {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw) as Save;
      if (s.v === 1 && Array.isArray(s.roster) && s.roster.length >= 3) {
        s.roster.forEach(migratePlayer);
        s.fresh ??= [];
        return s;
      }
    }
  } catch { /* corrupted save: start fresh */ }
  return newSave();
}

export function persist(s: Save, key = KEY) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* private mode */ }
}

export function rollScout(s: Save) {
  const owned = new Set(s.roster.map((p) => p.tid));
  const pool = TEMPLATES.filter((t) => t.price > 0 && !owned.has(t.id)).map((t) => t.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  s.scout = pool.slice(0, 3);
}

export function sign(s: Save, tid: string): string | null {
  const t = TEMPLATES.find((x) => x.id === tid);
  if (!t) return 'Unknown player';
  if (s.roster.length >= ROSTER_MAX) return `Roster full (${ROSTER_MAX}). Release someone first.`;
  if (s.coins < t.price) return 'Not enough coins!';
  s.coins -= t.price;
  s.roster.push(playerFromTemplate(t));
  s.scout = s.scout.filter((x) => x !== tid);
  return null;
}

// ---------------------------------------------------------------- techniques

export interface Learned { player: Player; tech: TechId; equipped: boolean; how: 'level' | 'train' | 'league' }

/** Next technique of the player's path not learned yet. */
export const nextInPath = (p: Player): TechId | null => p.path.find((t) => !p.known.includes(t)) ?? null;
/** Level at which the next path technique is learned (null if the path is done or levels ran out). */
export function nextLearnLevel(p: Player): number | null {
  if (!nextInPath(p)) return null;
  return LEARN_LEVELS.find((l) => l > p.level) ?? null;
}

export function learn(s: Save, p: Player, tech: TechId, how: Learned['how']): Learned | null {
  if (TECHS[tech].base || p.known.includes(tech)) return null;
  p.known.push(tech);
  const equipped = p.gear.length < slotsFor(p.level);
  if (equipped) p.gear.push(tech);
  (s.fresh ??= []).push(`${p.uid}:${tech}`);
  return { player: p, tech, equipped, how };
}

export function equip(p: Player, tech: TechId): string | null {
  if (!p.known.includes(tech)) return 'Not learned yet';
  if (p.gear.includes(tech)) return null;
  if (p.gear.length >= slotsFor(p.level)) return 'All slots used. Unequip one first.';
  p.gear.push(tech);
  return null;
}

export function unequip(p: Player, tech: TechId) { p.gear = p.gear.filter((t) => t !== tech); }

/** Pay coins to learn the next path technique now. */
export function train(s: Save, p: Player): Learned | string {
  const t = nextInPath(p);
  if (!t) return 'Nothing left to learn';
  const cost = trainCost(p.known.length);
  if (s.coins < cost) return 'Not enough coins!';
  s.coins -= cost;
  return learn(s, p, t, 'train') ?? 'Already known';
}

// ---------------------------------------------------------------- match rewards

export interface LevelReport {
  player: Player;
  xp: number;
  levels: number;
  stats: Stat[];
}

export interface Rewards { coins: number; reports: LevelReport[]; unlocked: RivalTeam | null; learned: Learned[] }

export function applyResult(s: Save, rival: RivalTeam, r: MatchResult): Rewards {
  const rec = (s.record[rival.id] ??= { w: 0, l: 0 });
  const firstWin = r.won && rec.w === 0;
  if (r.won) rec.w++; else rec.l++;
  const margin = Math.abs(r.score[0] - r.score[1]);
  const coins = r.won ? 100 + rival.tier * 25 + margin * 5 : 30 + rival.tier * 5;
  s.coins += coins;
  let unlocked: RivalTeam | null = null;
  const idx = RIVALS.indexOf(rival);
  if (r.won && idx === s.beaten && s.beaten < RIVALS.length) {
    s.beaten++;
    unlocked = RIVALS[s.beaten] ?? null;
  }
  const learned: Learned[] = [];
  const reports = s.roster.map((p, i) => {
    const line = r.lines[p.uid];
    const xp = i < 3 && line ? 25 + line.pts * 8 + line.duelsWon * 5 + (r.won ? 30 : 0) : 15;
    return gainXp(s, p, xp, learned);
  });
  // League lesson: the first win against a team teaches its signature technique to your top scorer
  // among the starters who do not know it yet.
  if (firstWin) {
    const cands = s.roster.slice(0, 3).filter((p) => !p.known.includes(rival.lesson))
      .sort((a, b) => (r.lines[b.uid]?.pts ?? 0) - (r.lines[a.uid]?.pts ?? 0));
    if (cands[0]) { const l = learn(s, cands[0], rival.lesson, 'league'); if (l) learned.push(l); }
  }
  return { coins, reports, unlocked, learned };
}

export function gainXp(s: Save, p: Player, xp: number, learned: Learned[] = []): LevelReport {
  const rep: LevelReport = { player: p, xp, levels: 0, stats: [] };
  p.xp += xp;
  while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    rep.levels++;
    for (const st of p.growth) {
      if (p.stats[st] < 10) { p.stats[st]++; rep.stats.push(st); }
    }
    if (LEARN_LEVELS.includes(p.level)) {
      const t = nextInPath(p);
      if (t) { const l = learn(s, p, t, 'level'); if (l) learned.push(l); }
    }
    // A new slot equips waiting techniques automatically.
    for (const t of p.known) if (!p.gear.includes(t) && p.gear.length < slotsFor(p.level)) p.gear.push(t);
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return rep;
}
