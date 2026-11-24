// Turn Ball Pixel, arcade layer: its own save, technique paths made of passes and plays (shots,
// dribble moves and defense are a shared move set, see PIXEL_MOVES), rival kits, and each player's
// signature special. The 3D game keeps its own save and data untouched.
import { RIVALS, mirrorPlayers, type Player, type RivalTeam } from '../data';
import { loadSave, persist as persistShared, type Save } from '../game';
import { SPECIALS, specialFor, type SpecialDef } from '../specials';
import { isDefTech, slotsFor, type TechId } from '../techs';
import { PIXEL_MOVES } from '../rules';

const PIXEL_KEY = 'turnball-pixel-save-v1';

/**
 * Technique paths in the pixel edition (learned in order by leveling up or training). Shots, dribble
 * moves and defense are the same for everyone (PIXEL_MOVES / PIXEL_DEF, each tied to a pack animation);
 * what a player learns are passes and plays.
 */
const PIXEL_PATHS: Record<string, TechId[]> = {
  pip: ['iso', 'giveandgo', 'handoff', 'bounce', 'backdoor'],
  mo: ['pnr', 'pop', 'lob', 'handoff', 'bank'],
  luz: ['screen', 'skip', 'bounce', 'pop', 'bank'],
  kiki: ['nolook', 'bounce', 'handoff', 'lob', 'skip', 'giveandgo'],
  benny: ['pnr', 'pop', 'screen', 'bounce', 'lob'],
  nova: ['lob', 'nolook', 'screen', 'skip', 'backdoor', 'handoff'],
  taro: ['pop', 'pnr', 'bank', 'lob', 'screen'],
  jax: ['backdoor', 'giveandgo', 'iso', 'nolook', 'bounce'],
  ruby: ['bank', 'screen', 'pop', 'bounce', 'skip'],
  zed: ['backdoor', 'iso', 'nolook', 'pnr', 'handoff'],
  fern: ['pnr', 'backdoor', 'iso', 'lob', 'giveandgo'],
  ola: ['iso', 'giveandgo', 'nolook', 'skip', 'backdoor'],
};
/** The default starters bring one play each, so the Play menu has real choices from the first match. */
const PIXEL_START: Record<string, TechId[]> = { pip: ['iso'], mo: ['pnr'], luz: ['screen'] };

/** Bring a player (from the shared template data or an older save) to the pixel edition's paths. */
export function arcadePlayer(p: Player) {
  const path = PIXEL_PATHS[p.tid];
  if (path) p.path = [...path];
  // Moves everyone has now (shots, dribbles, defense) no longer take a slot.
  const free = (t: TechId) => !PIXEL_MOVES.includes(t) && !isDefTech(t);
  p.known = p.known.filter(free);
  p.gear = p.gear.filter(free);
  for (const t of p.known) if (!p.gear.includes(t) && p.gear.length < slotsFor(p.level)) p.gear.push(t);
  for (const t of PIXEL_START[p.tid] ?? []) {
    if (p.known.includes(t)) continue;
    p.known.push(t);
    if (p.gear.length < slotsFor(p.level)) p.gear.push(t);
  }
}

export function loadPixelSave(): Save {
  const fresh = (() => { try { return localStorage.getItem(PIXEL_KEY) === null; } catch { return true; } })();
  // First run: start from the shared save (progress made so far carries over), then keep a separate one.
  const s = fresh ? loadSave() : loadSave(PIXEL_KEY);
  s.roster.forEach(arcadePlayer);
  if (s.reduceFx === undefined) {
    try { s.reduceFx = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { s.reduceFx = false; }
  }
  persistPixel(s);
  return s;
}

export const persistPixel = (s: Save) => persistShared(s, PIXEL_KEY);

/** Rival kits in the pixel edition: by lineup slot (slasher, big, shooter); a rival of tier t knows the first t + 1 (max 4). */
const PIXEL_ROLE_KITS: TechId[][] = [
  ['iso', 'giveandgo', 'handoff', 'backdoor', 'bounce'],
  ['pnr', 'pop', 'lob', 'handoff', 'screen'],
  ['screen', 'skip', 'pop', 'nolook', 'bank'],
];
export function pixelRivals(team: RivalTeam, mine: Player[]): Player[] {
  return mirrorPlayers(team, mine).map((p, i) => {
    const kit = PIXEL_ROLE_KITS[i].slice(0, Math.min(4, team.tier + 1));
    return { ...p, known: [...kit], gear: [...kit] };
  });
}

/** Signature special of the player in a lineup slot. */
export const signatureOf = (p: Player, slot: number): SpecialDef => SPECIALS[specialFor(p.tid, slot)];

export { RIVALS };
