// Signature specials: one per player. Pure data shared by rules.ts (odds), the simulator and the pixel
// edition (cinematics). A special is a stronger, riskier version of one action that costs a full Fire
// meter (earned by winning duels). Every special has a counter stance against which it is no better,
// or worse, than the plain technique it builds on: it is a read, not a win button.
import type { ActKind, Stance, ZoneKind } from './rules.ts';
import type { TechId } from './techs.ts';

export type SpecialId =
  | 'rocket' | 'tower' | 'splash' | 'zoom' | 'dozer' | 'blueprint' | 'wallhook' | 'dash' | 'rubyfade' | 'noodle'
  | 'skywalk' | 'breeze' | 'blaze' | 'quake' | 'comet';

/** Particle style of the cinematic (each also has its own shape, never only a color). */
export type FxStyle = 'fire' | 'bolt' | 'frost' | 'wind' | 'spark' | 'quake';

type PerStance = Record<Stance, number>;
const S = (press: number, space: number, deny: number): PerStance => ({ press, space, deny });

export interface SpecialDef {
  id: SpecialId;
  name: string;
  kind: ActKind;
  /** Technique the special builds on (odds base, legality and fallback animation). */
  tech: TechId;
  /** Zone kinds where it can be used: the shooter's spot (shots) or the destination (drives, cuts, pass targets). */
  zones?: ZoneKind[];
  /** The stance that answers it. */
  counter: Stance;
  /** One line: what it does and what stops it. */
  line: string;
  /** Sprite animation from the asset pack (pixel edition). */
  anim: string;
  fx: FxStyle;
  // Shots
  make?: PerStance;
  /** Multiplier on the negative defensive effect (contest). */
  contest?: number;
  block?: PerStance;
  and1?: number;
  /** Long rebound: no offensive board on a miss. */
  noOreb?: boolean;
  /** Make bonus when the shooter is already open. */
  openMake?: number;
  // Drives
  beat?: PerStance;
  steal?: PerStance;
  noHelp?: boolean;
  // Passes
  pick?: PerStance;
  /** Share of catches that leave the catcher open. */
  feed?: number;
  // Cuts
  open?: PerStance;
  /** Decisions the advantage survives (drives, cuts, passes). */
  ttl?: number;
}

const D = (d: SpecialDef) => d;

export const SPECIALS: Record<SpecialId, SpecialDef> = {
  rocket: D({ id: 'rocket', name: 'Rocket Cross', kind: 'drive', tech: 'cross', counter: 'space', anim: 'Crossover', fx: 'fire',
    line: 'Ankle-breaker: the defender falls, open for 3 moves. Space waits for it.',
    beat: S(1.6, 0.9, 1.35), steal: S(0.02, 0.05, 0.03), ttl: 3 }),
  tower: D({ id: 'tower', name: 'Tower Slam', kind: 'shoot', tech: 'layup', zones: ['close'], counter: 'space', anim: 'Dunk_3', fx: 'bolt',
    line: 'Post slam, big and-one chance. Packed help blocks it.',
    make: S(0.2, 0.08, 0.24), block: S(1, 2.2, 0.6), and1: 0.3, openMake: 0.12 }),
  splash: D({ id: 'splash', name: 'Sunset Splash', kind: 'shoot', tech: 'jumper', zones: ['three'], counter: 'press', anim: 'Jumpshot_3', fx: 'fire',
    line: 'Deep high three over the contest. Press still bothers it, no offensive board.',
    make: S(-0.06, 0.12, 0.09), contest: 0.5, block: S(0.8, 0.5, 0.5), noOreb: true, openMake: 0.06 }),
  zoom: D({ id: 'zoom', name: 'Zoom Thread', kind: 'pass', tech: 'nolook', counter: 'deny', anim: 'Jab', fx: 'wind',
    line: 'Laser pass: every catch is open. Deny reads the lane.',
    pick: S(0.8, 0.6, 1.7), feed: 1, ttl: 2 }),
  dozer: D({ id: 'dozer', name: 'Bulldozer', kind: 'drive', tech: 'drive', zones: ['close', 'mid'], counter: 'press', anim: 'Back_Down', fx: 'quake',
    line: 'Backs down through anyone. Press strips it in the post.',
    beat: S(0.8, 2.6, 1.4), steal: S(0.07, 0.06, 0.02) }),
  blueprint: D({ id: 'blueprint', name: 'Blueprint Cut', kind: 'cut', tech: 'cut', counter: 'deny', anim: 'Sprint', fx: 'spark',
    line: 'A drawn-up cut: open for 3 moves. Deny was waiting for it.',
    open: S(1.5, 1.9, 0.75), ttl: 3 }),
  wallhook: D({ id: 'wallhook', name: 'Wall Hook', kind: 'shoot', tech: 'floater', zones: ['close', 'mid'], counter: 'press', anim: 'Floater', fx: 'frost',
    line: 'Hook over the top: almost unblockable. Press on the body still hurts.',
    make: S(-0.04, 0.1, 0.08), contest: 0.7, block: S(0.2, 0.1, 0.1), openMake: 0.05 }),
  dash: D({ id: 'dash', name: 'Pepper Dash', kind: 'drive', tech: 'hesi', counter: 'press', anim: 'Between', fx: 'bolt',
    line: 'Between-the-legs burst that eats space. Press pokes it away.',
    beat: S(0.8, 2.2, 1.3), steal: S(0.06, 0, 0.02) }),
  rubyfade: D({ id: 'rubyfade', name: 'Ruby Fade', kind: 'shoot', tech: 'fade', zones: ['mid', 'three'], counter: 'space', anim: 'Fake_Fadeaway_Right', fx: 'spark',
    line: 'Fake, then a fade nobody blocks. Space leaves no one to fool.',
    make: S(0.14, 0.02, 0.1), block: S(0.5, 0.5, 0.5), openMake: 0.04 }),
  noodle: D({ id: 'noodle', name: 'Noodle Spin', kind: 'drive', tech: 'spin', counter: 'press', anim: 'Behind_Back', fx: 'wind',
    line: 'Behind the back into a spin, open for 3 moves. Press stays attached.',
    beat: S(1.4, 3.0, 1.9), steal: S(0.03, 0, 0), ttl: 3 }),
  skywalk: D({ id: 'skywalk', name: 'Skywalk', kind: 'shoot', tech: 'layup', zones: ['close', 'mid'], counter: 'press', anim: 'Dunk_5', fx: 'fire',
    line: 'Takes off from the elbow and flies to the rim. Press meets it in the air.',
    make: S(-0.02, 0.16, 0.18), block: S(1.6, 1, 0.7), and1: 0.2, openMake: 0.1 }),
  breeze: D({ id: 'breeze', name: 'Breeze Step', kind: 'drive', tech: 'euro', zones: ['close', 'mid'], counter: 'deny', anim: 'Side_Step', fx: 'wind',
    line: 'Floating euro step: open for 3 moves. Deny clogs the lane.',
    beat: S(2.0, 1.8, 0.85), steal: S(0.02, 0, 0.05), ttl: 3 }),
  blaze: D({ id: 'blaze', name: 'Street Blaze', kind: 'drive', tech: 'cross', counter: 'space', anim: 'Switch_Dribble_1', fx: 'fire',
    line: 'Street handles: the defender is left behind. Space waits for it.',
    beat: S(1.5, 0.9, 1.3), steal: S(0.03, 0.05, 0.03), ttl: 3 }),
  quake: D({ id: 'quake', name: 'Rim Quake', kind: 'shoot', tech: 'layup', zones: ['close'], counter: 'space', anim: 'Dunk_7', fx: 'quake',
    line: 'Tomahawk slam that shakes the rim. Help in the paint blocks it.',
    make: S(0.18, 0.06, 0.22), block: S(1, 2.1, 0.7), and1: 0.25, openMake: 0.1 }),
  comet: D({ id: 'comet', name: 'Comet Three', kind: 'shoot', tech: 'jumper', zones: ['three'], counter: 'press', anim: 'Jumpshot_3', fx: 'spark',
    line: 'Rainbow three over the hand. Press bothers it, no offensive board.',
    make: S(-0.05, 0.11, 0.08), contest: 0.5, block: S(0.8, 0.5, 0.5), noOreb: true, openMake: 0.05 }),
};

/** Each signing has their own signature. */
export const SIGNATURE: Record<string, SpecialId> = {
  pip: 'rocket', mo: 'tower', luz: 'splash', kiki: 'zoom', benny: 'dozer', nova: 'blueprint', taro: 'wallhook',
  jax: 'dash', ruby: 'rubyfade', zed: 'noodle', fern: 'skywalk', ola: 'breeze',
};
/** Rival players: one signature per lineup slot (slasher, big, shooter). */
export const ROLE_SIGNATURE: SpecialId[] = ['blaze', 'quake', 'comet'];

export const specialFor = (tid: string, slot: number): SpecialId => SIGNATURE[tid] ?? ROLE_SIGNATURE[slot % 3];

/** Fire meter: duels won fill it, a full meter pays for one special. */
export const FIRE = {
  max: 4,
  cost: 4,
  /** Attack: advantage won (beaten defender, open man, room, open catch) or a score. */
  attWin: 1,
  /** Defense: a stop that keeps the possession alive (held drive, covered cut) is 0; a takeaway or a block is 2; a miss is 1. */
  takeaway: 2,
  miss: 1,
  /** Losing the ball costs heat. */
  turnover: -1,
};

const ATT_WIN = new Set(['beat', 'room', 'open', 'slip', 'feed', 'help', 'make', 'and1']);
const TAKEAWAY = new Set(['steal', 'pick', 'block']);
/** Fire change for the attacking and the defending team after one outcome. */
export function fireDelta(ev: string): { att: number; def: number } {
  if (ATT_WIN.has(ev)) return { att: FIRE.attWin, def: 0 };
  if (TAKEAWAY.has(ev)) return { att: FIRE.turnover, def: FIRE.takeaway };
  if (ev === 'miss') return { att: 0, def: FIRE.miss };
  return { att: 0, def: 0 };
}
