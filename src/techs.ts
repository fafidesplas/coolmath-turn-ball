// Technique repertoire (RPG-style variants of every base action). Pure data, no DOM, shared by the
// game and the headless simulator. The numbers that make each variant behave differently live in
// rules.ts (TUNE / DEF_MOVES); this file holds identity: name, icon, one-line "when it is good".

export type TechKind = 'shoot' | 'pass' | 'drive' | 'cut' | 'press' | 'space' | 'deny';
export type TechId =
  | 'jumper' | 'bank' | 'fade' | 'layup' | 'floater'
  | 'chest' | 'bounce' | 'lob' | 'nolook' | 'skip'
  | 'drive' | 'cross' | 'hesi' | 'spin' | 'stepback' | 'euro' | 'pumpfake'
  | 'cut' | 'backdoor' | 'screen' | 'pnr' | 'giveandgo' | 'iso' | 'pop' | 'handoff'
  | 'press' | 'hawk'
  | 'space' | 'float' | 'recover'
  | 'deny' | 'jump' | 'switch';

export interface TechInfo {
  id: TechId;
  kind: TechKind;
  name: string;
  /** Icon name in icons.ts. */
  icon: string;
  /** Known by everyone, never takes a slot. */
  base?: boolean;
  /** One short line: when it is good and what punishes it. */
  line: string;
  /** Where it can be used (shown on the team screen). */
  where?: string;
}

const T = (id: TechId, kind: TechKind, name: string, icon: string, line: string, extra: Partial<TechInfo> = {}): TechInfo =>
  ({ id, kind, name, icon, line, ...extra });

export const TECHS: Record<TechId, TechInfo> = {
  // Shots (the shooter's repertoire)
  jumper: T('jumper', 'shoot', 'Jump shot', 'shoot', 'Any spot. Press hurts it.', { base: true }),
  bank: T('bank', 'shoot', 'Bank shot', 't_bank', 'Steady vs Press and Deny. Needs an angle.', { where: 'Wing, elbow, post' }),
  fade: T('fade', 'shoot', 'Fadeaway', 't_fade', 'Ignores Press and blocks. Lower base.'),
  layup: T('layup', 'shoot', 'Layup', 't_layup', 'Post only. Can draw a foul: +1. Help blocks it.', { where: 'Post' }),
  floater: T('floater', 'shoot', 'Floater', 't_floater', 'Soft and high: few blocks, beats help. Press still hurts.', { where: 'Elbow, post' }),
  // Passes (the passer's repertoire)
  chest: T('chest', 'pass', 'Chest pass', 'pass', 'Plain pass. Deny picks it.', { base: true }),
  bounce: T('bounce', 'pass', 'Bounce pass', 't_bounce', 'Slips under Deny. Press tips it. Short only.', { where: 'Short passes' }),
  lob: T('lob', 'pass', 'Lob', 't_lob', 'Over Deny. To the post: open finish. Help picks it.', { where: 'To elbow or post' }),
  nolook: T('nolook', 'pass', 'No-look pass', 't_nolook', 'May leave the catcher open. Riskier.'),
  skip: T('skip', 'pass', 'Skip pass', 't_skip', 'Cross-court over a sagging D: open catch. Deny jumps it.', { where: 'Long passes' }),
  // Drives (the handler's repertoire)
  drive: T('drive', 'drive', 'Drive', 'dribble', 'Beats Press. Space walls it.', { base: true }),
  cross: T('cross', 'drive', 'Crossover', 't_cross', 'Best vs Press. Reaching D steals it.'),
  hesi: T('hesi', 'drive', 'Hesitation', 't_hesi', 'Freezes Give space. Bad vs Press.'),
  spin: T('spin', 'drive', 'Spin move', 't_spin', 'Hard to steal. A bit slower.'),
  stepback: T('stepback', 'drive', 'Step-back', 't_stepback', 'Stay and make room: open shot next. Kills Press.', { where: 'Outside the post' }),
  euro: T('euro', 'drive', 'Euro step', 't_euro', 'Two steps around help: best vs Give space. Press reaches.', { where: 'Into elbow or post' }),
  pumpfake: T('pumpfake', 'drive', 'Pump fake', 't_pump', 'Fake the shot, the defender flies: room. Deny does not bite.', { where: 'Elbow, post' }),
  // Plays (the player who moves knows them: cutter, screener who rolls, handler on a give and go)
  cut: T('cut', 'cut', 'Cut', 'cut', 'A mate moves. Deny opens it.', { base: true }),
  backdoor: T('backdoor', 'cut', 'Backdoor', 't_backdoor', 'Behind Deny: wide open. Help sees it.', { where: 'Cuts toward the rim' }),
  screen: T('screen', 'cut', 'Screen cut', 't_screen', 'Cuts off a mate\'s screen. Beats Press. Switch stops it.'),
  pnr: T('pnr', 'cut', 'Pick and roll', 't_pnr', 'This player screens and rolls: handler or roller gets free. Switch kills it.', { where: 'Roll to the post' }),
  giveandgo: T('giveandgo', 'cut', 'Give and go', 't_giveandgo', 'Pass, run, get it back. Beats Press. Deny picks it.', { where: 'Toward the rim' }),
  iso: T('iso', 'cut', 'Clear-out', 't_iso', 'Mates clear to the corners: 1 on 1, no help. Best vs Deny.'),
  pop: T('pop', 'cut', 'Pick and pop', 't_pop', 'This player screens and pops out for an open shot. Deny and Switch stay home.', { where: 'Pop to the arc' }),
  handoff: T('handoff', 'cut', 'Hand-off', 't_handoff', 'Hand the ball to the nearest mate on the run. Beats Press and Deny. Space waits.'),
  // Team defense (the starters' combined repertoire)
  press: T('press', 'press', 'Press', 'press', 'Tight on the ball.', { base: true }),
  hawk: T('hawk', 'press', 'Ball hawk', 't_hawk', 'More steals and picks. Easier to beat.'),
  space: T('space', 'space', 'Give space', 'space', 'Sag and help.', { base: true }),
  float: T('float', 'space', 'Float', 't_float', 'Packs the paint. Outside is wide open.'),
  recover: T('recover', 'space', 'Help and recover', 't_recover', 'Helps without leaving a man free.'),
  deny: T('deny', 'deny', 'Deny pass', 'deny', 'Close the lanes.', { base: true }),
  jump: T('jump', 'deny', 'Jump lanes', 't_jump', 'Picks more passes. Backdoors open up.'),
  switch: T('switch', 'deny', 'Switch', 't_switch', 'Stops screens and cuts. Mismatch inside.'),
};

export const TECH_IDS = Object.keys(TECHS) as TechId[];
export const BASE_TECH: Record<TechKind, TechId> = { shoot: 'jumper', pass: 'chest', drive: 'drive', cut: 'cut', press: 'press', space: 'space', deny: 'deny' };
export const BASE_TECHS = TECH_IDS.filter((t) => TECHS[t].base);
export const VARIANTS = TECH_IDS.filter((t) => !TECHS[t].base);
export const isDefTech = (t: TechId) => TECHS[t].kind === 'press' || TECHS[t].kind === 'space' || TECHS[t].kind === 'deny';

/** Technique slots by level: equipped (non-base) techniques a player can bring to a match. */
export const slotsFor = (level: number) => (level >= 8 ? 4 : level >= 4 ? 3 : 2);
/** Levels at which a player learns the next technique of their path. */
export const LEARN_LEVELS = [2, 3, 5, 7, 9];
/** Coins to train the next technique of the path early (by how many the player already learned). */
export const trainCost = (learned: number) => 80 + learned * 40;
