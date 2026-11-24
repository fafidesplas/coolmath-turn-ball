// Turn Ball Pixel, arcade layer: its own save, longer technique paths with the newer techniques
// (floater, skip pass, euro step, pump fake, clear-out, pick and pop, hand-off), rival kits that use
// them, and each player's signature special. The 3D game keeps its own save and data untouched.
import { RIVALS, mirrorPlayers, type Player, type RivalTeam } from '../data';
import { loadSave, persist as persistShared, type Save } from '../game';
import { SPECIALS, specialFor, type SpecialDef } from '../specials';
import { slotsFor, type TechId } from '../techs';

const PIXEL_KEY = 'turnball-pixel-save-v1';

/** Technique paths in the pixel edition (learned in order by leveling up or training). */
const PIXEL_PATHS: Record<string, TechId[]> = {
  pip: ['iso', 'cross', 'hawk', 'euro', 'spin', 'giveandgo', 'stepback'],
  mo: ['pnr', 'pop', 'switch', 'layup', 'floater', 'float', 'bank'],
  luz: ['screen', 'fade', 'skip', 'bounce', 'pumpfake', 'bank', 'recover'],
  kiki: ['nolook', 'bounce', 'handoff', 'lob', 'skip', 'giveandgo', 'hesi', 'jump'],
  benny: ['switch', 'float', 'pnr', 'recover', 'layup', 'pop', 'hawk'],
  nova: ['lob', 'bank', 'nolook', 'screen', 'skip', 'fade', 'backdoor', 'handoff', 'jump'],
  taro: ['recover', 'switch', 'floater', 'hawk', 'bank', 'pop', 'layup', 'float'],
  jax: ['hawk', 'cross', 'jump', 'euro', 'spin', 'backdoor', 'stepback'],
  ruby: ['fade', 'bank', 'pumpfake', 'stepback', 'screen', 'layup', 'floater', 'bounce'],
  zed: ['hesi', 'backdoor', 'iso', 'float', 'nolook', 'spin', 'pnr', 'handoff'],
  fern: ['layup', 'cross', 'spin', 'euro', 'pnr', 'hawk', 'floater', 'fade', 'backdoor'],
  ola: ['cross', 'hesi', 'stepback', 'iso', 'spin', 'giveandgo', 'euro', 'nolook', 'jump'],
};
/** The default starters bring one play each, so the Play menu has real choices from the first match. */
const PIXEL_START: Record<string, TechId[]> = { pip: ['iso'], mo: ['pnr'], luz: ['screen'] };

/** Bring a player (from the shared template data or an older save) to the pixel edition's paths. */
export function arcadePlayer(p: Player) {
  const path = PIXEL_PATHS[p.tid];
  if (path) p.path = [...path];
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
  ['iso', 'cross', 'hawk', 'euro', 'giveandgo'],
  ['pnr', 'switch', 'pop', 'layup', 'floater'],
  ['screen', 'fade', 'skip', 'jump', 'pumpfake'],
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
