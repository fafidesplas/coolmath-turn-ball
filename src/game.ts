// Persistent career state: roster, coins, league progress, scouting and leveling.
import {
  MAX_LEVEL, RIVALS, STARTER_IDS, TECH_LEVELS, TECHNIQUES, TEMPLATES, playerFromTemplate, xpForLevel,
  type Player, type RivalTeam, type Stat,
} from './data';
import type { MatchResult } from './match';

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
}

export function newSave(): Save {
  const roster = STARTER_IDS.map((id) => playerFromTemplate(TEMPLATES.find((t) => t.id === id)!));
  const s: Save = { v: 1, coins: 150, roster, beaten: 0, record: {}, scout: [], sound: true, duelsSeen: 0 };
  rollScout(s);
  return s;
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Save;
      if (s.v === 1 && Array.isArray(s.roster) && s.roster.length >= 3) return s;
    }
  } catch { /* corrupted save: start fresh */ }
  return newSave();
}

export function persist(s: Save) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
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

export interface LevelReport {
  player: Player;
  xp: number;
  levels: number;
  stats: Stat[];
  techs: string[];
}

export interface Rewards { coins: number; reports: LevelReport[]; unlocked: RivalTeam | null }

export function applyResult(s: Save, rival: RivalTeam, r: MatchResult): Rewards {
  const rec = (s.record[rival.id] ??= { w: 0, l: 0 });
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
  const reports = s.roster.map((p, i) => {
    const line = r.lines[p.uid];
    const xp = i < 3 && line ? 25 + line.pts * 8 + line.duelsWon * 5 + (r.won ? 30 : 0) : 15;
    return gainXp(p, xp);
  });
  return { coins, reports, unlocked };
}

export function gainXp(p: Player, xp: number): LevelReport {
  const rep: LevelReport = { player: p, xp, levels: 0, stats: [], techs: [] };
  p.xp += xp;
  while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    rep.levels++;
    for (const st of p.growth) {
      if (p.stats[st] < 10) { p.stats[st]++; rep.stats.push(st); }
    }
    const ti = TECH_LEVELS.indexOf(p.level);
    if (ti >= 0 && p.techs[ti] && !p.known.includes(p.techs[ti])) {
      p.known.push(p.techs[ti]);
      rep.techs.push(TECHNIQUES[p.techs[ti]].name);
    }
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  return rep;
}
