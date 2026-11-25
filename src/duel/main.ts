// Turn Ball 1v1, classic duel (two modes, picked with ?mode=): first to 7, possessions alternate. Each beat
// the defense sets a stance (Press, Sag, or Gamble, which looks like Press), then the attacker picks Drive,
// Crossover, Step-back or Shoot seeing it. The matchup sets how wide the timing window is, and each move has a
// fixed result for MISS, GOOD and PERFECT.
//   timing  you land the press yourself (attacking: your execution; defending: your reaction)
//   dice    the press is rolled with the odds of that window, shown as percentages
// The state builds up over the beats: where the attacker is, the defender's balance and the moves left.
// Rules: rules.ts. Drawing: scene.ts. Animated beats: beats.ts. The card mode is its own page (cards.ts).
import '@fontsource/press-start-2p/400.css';
import './style.css';
import { sfx, unlockAudio } from '../audio';
import { loadAtlas } from '../pixel/sprites';
import { H, W, anim, cheer, players, say, shake, startScene, view, wait, type Ent } from './scene';
import {
  CLOCK, GUARD, MOVES, PRIOR_GAMBLE, STANCES, WIN_SCORE, aiMove, aiStance, bestMove, ease, legal, ptsOf, result, shotKind, solve,
  start, tierOdds, visOf, windowFor, type MoveId, type Out, type Side, type St, type Stance, type Tier, type Vis, type Win,
} from './rules';
import { ZONE_NAME, checkIn, guardOverlay, hud, playBeat, setStance } from './beats';

/** timing (default) or dice. */
const MODE: 'timing' | 'dice' = new URLSearchParams(location.search).get('mode') === 'dice' ? 'dice' : 'timing';

const rnd = Math.random;
/** Normal animation speed (tests raise it). */
let speedBase = 1;

// ---------------------------------------------------------------- page
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="stage">
    <canvas width="${W}" height="${H}" aria-label="Side view of a street court: you against one rival"></canvas>
    <div class="word" aria-live="polite"></div>
    <a class="modes" href="../menu/">&#9776; MODES</a>
    <div class="score"><span class="sc you"><i class="mk home"></i>YOU <b id="s0">0</b></span><span class="to">TO ${WIN_SCORE}</span><span class="sc them"><b id="s1">0</b> RIVAL<i class="mk away"></i></span></div>
  </div>
  <div class="cmd" id="cmd">
    <div class="c-head"><span class="c-title" id="ctitle"></span><span class="c-clock" id="cclock" aria-label="Moves left"></span></div>
    <div class="c-read" id="cread"></div>
    <div class="c-rows" id="crows" role="menu"></div>
    <div class="c-line" id="cline" aria-live="polite"></div>
  </div>`;
const canvas = app.querySelector('canvas')!;
const $ = (id: string) => document.getElementById(id)!;
function fit() {
  const k = Math.max(1, Math.floor(Math.min((innerWidth - 32) / W, (innerHeight - 250) / H)));
  canvas.style.width = `${W * k}px`;
  canvas.style.height = `${H * k}px`;
  $('cmd').style.width = `${Math.max(W * k, 320)}px`;
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- match state
const score: [number, number] = [0, 0];
/** How often you gambled when you showed Press (what the AI attacker believes). */
const habit = { press: 2, gamble: 1 };

guardOverlay();

// ---------------------------------------------------------------- command window
interface Row { key: string; name: string; big: string; small?: string; line: string; tone?: 'good' | 'bad'; disabled?: boolean }
let rows: Row[] = [];
let curRow = 0;
let pending: ((key: string) => void) | null = null;

function ask(title: string, read: string, list: Row[]): Promise<string> {
  rows = list;
  $('ctitle').innerHTML = title;
  $('cread').innerHTML = read;
  $('crows').innerHTML = list.map((r, i) => `
    <button class="c-row ${r.disabled ? 'dis' : ''}" role="menuitem" data-i="${i}" ${r.disabled ? 'aria-disabled="true"' : ''}>
      <span class="c-hand" aria-hidden="true">&#9658;</span><span class="c-name">${r.name}</span>
      <span class="c-small ${r.tone ?? ''}">${r.small ?? ''}</span><span class="c-big">${r.big}</span>
    </button>`).join('');
  curRow = Math.max(0, list.findIndex((r) => !r.disabled));
  focusRow(curRow, true);
  $('cmd').classList.add('live');
  return new Promise((res) => { pending = res; });
}
function focusRow(i: number, quiet = false) {
  if (i < 0 || i >= rows.length) return;
  curRow = i;
  $('crows').querySelectorAll('.c-row').forEach((b, k) => b.classList.toggle('cur', k === i));
  $('cline').textContent = rows[i].line;
  if (!quiet) sfx.tick();
}
function choose(i: number) {
  const r = rows[i];
  if (!r || r.disabled || !pending) { if (r?.disabled) sfx.bad(); return; }
  sfx.tap();
  const p = pending;
  pending = null;
  $('cmd').classList.remove('live');
  p(r.key);
}
function idle(title: string, read = '') {
  $('ctitle').innerHTML = title;
  $('cread').innerHTML = read;
  $('crows').innerHTML = '';
  $('cline').textContent = '';
}
$('crows').addEventListener('click', (e) => {
  unlockAudio();
  const b = (e.target as HTMLElement).closest<HTMLElement>('.c-row');
  if (b) choose(+b.dataset.i!);
});
$('crows').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const b = (e.target as HTMLElement).closest<HTMLElement>('.c-row');
  if (b && +b.dataset.i! !== curRow) focusRow(+b.dataset.i!);
});
addEventListener('keydown', (e) => {
  if (!pending) return;
  const n = rows.length;
  const step = (d: number) => { let i = curRow; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!rows[i].disabled) break; } focusRow(i); };
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { e.preventDefault(); unlockAudio(); choose(curRow); }
  else { const d = parseInt(e.key, 10); if (d >= 1 && d <= n) { e.preventDefault(); if (curRow === d - 1) choose(d - 1); else focusRow(d - 1); } }
});

const clockHTML = (s: St) => Array.from({ length: CLOCK }, (_, i) => `<i class="${i < s.clock ? 'on' : ''}"></i>`).join('');
const SHOT_NAME = { three: 'Three', jumper: 'Jumper', layup: 'Layup', dunk: 'Dunk' };
const MOVE_NAME: Record<MoveId, string> = { drive: 'Drive', cross: 'Crossover', step: 'Step-back', shoot: 'Shoot' };
const STANCE_NAME: Record<Stance, string> = { press: 'Press', sag: 'Sag', gamble: 'Gamble' };
const moveLabel = (s: St, m: MoveId) => (m === 'shoot' ? SHOT_NAME[shotKind(s)] : MOVE_NAME[m]);
/** How hard the press is, as three blocks and a word (wider window = more blocks). */
/** Chance a press lands GOOD or better (dice mode shows it instead of the ease meter). */
const okPct = (w: Win) => { const o = tierOdds(w); return `${Math.round((o.good + o.perfect) * 100)}<small>%</small>`; };
function easeHTML(w: Win) {
  if (MODE === 'dice') return okPct(w);
  const e = ease(w);
  const n = e === 'EASY' ? 3 : e === 'OK' ? 2 : 1;
  return `<span class="ez ez${n}">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}<b>${e}</b></span>`;
}

/** What GOOD and PERFECT give for a move (attacking). */
function attGain(s: St, m: MoveId, vis: Vis): string {
  if (m === 'drive') return `GOOD: to the ${ZONE_NAME[s.zone + 1]}. PERFECT: and he loses balance.`;
  if (m === 'cross') return `GOOD: -1 balance. PERFECT: -2. At 0 he is broken.`;
  if (m === 'step') return `GOOD: room to shoot from the ${ZONE_NAME[Math.max(0, s.zone - 1)]}. PERFECT: and -1 balance.`;
  const k = shotKind(s);
  return `${ptsOf(s)} point${ptsOf(s) > 1 ? 's' : ''}. GOOD or PERFECT scores.${k === 'dunk' ? ' Slam it.' : s.space || s.guard === 0 ? ' Open look.' : vis === 'press' ? ' He is right on you.' : ' He gives you space.'}`;
}

async function askAttack(s: St, vis: Vis, bg: number): Promise<MoveId> {
  const st: Stance = vis;
  const list: Row[] = MOVES.map((m) => {
    const ok = legal(s, m);
    const w = windowFor('att', s, m, st);
    return {
      key: m, name: moveLabel(s, m), big: ok ? easeHTML(w) : '--',
      small: !ok ? (s.clock <= 1 ? 'LAST MOVE' : 'IN THE PAINT') : m === 'shoot' ? `+${ptsOf(s)} PTS` : m === 'cross' ? '-BALANCE' : m === 'drive' ? 'CLOSER' : 'ROOM',
      tone: m === 'shoot' ? 'good' : undefined,
      line: ok ? attGain(s, m, vis) : s.clock <= 1 ? 'Last move: you have to shoot.' : 'You are already at the rim.', disabled: !ok,
    };
  });
  const read = vis === 'sag' ? `<b class="st sag">SAG</b> He backs off: shots are easier, drives are hard.` :
    `<b class="st press">PRESS</b> He is up on you: drives are easier, shots are hard.${bg >= 0.2 ? ' <span class="gam">He might gamble.</span>' : ''}`;
  const k = await ask(`<span class="mk home"></span>YOUR BALL`, read, list);
  return k as MoveId;
}

async function askDefense(s: St): Promise<Stance> {
  const bgUser = habit.gamble / (habit.press + habit.gamble);
  const list: Row[] = STANCES.map((st) => {
    // What he would most likely answer, and how hard your reaction to it would be.
    const vis = visOf(st);
    const m = bestMove(s, vis, vis === 'press' ? bgUser : 0, 'def').m;
    const line = st === 'press' ? 'Tight on him. Easy to contest shots; his drive is hard to stop.' :
      st === 'sag' ? 'Back off. Easy to wall the drive; hard to bother his jumper.' :
      'Looks like Press. PERFECT steals or blocks; a MISS gets you burned.';
    return { key: st, name: STANCE_NAME[st], big: easeHTML(windowFor('def', s, m, st)), small: `HE'LL ${moveLabel(s, m).toUpperCase()}`, line };
  });
  const read = `He is at the <b>${ZONE_NAME[s.zone]}</b>${s.space ? ', with room' : ''}. Your balance: <b>${s.guard}/${GUARD}</b>.`;
  const k = await ask(`<span class="mk away"></span>DEFENSE`, read, list);
  return k as Stance;
}

// ---------------------------------------------------------------- the timing press
/** Test hook: land every press on this tier. */
let autoTier: Tier | null = null;
const PROMPT_ATT: Record<MoveId, string> = { drive: 'GO!', cross: 'CROSS HIM!', step: 'STEP BACK!', shoot: 'RELEASE!' };
const PROMPT_DEF: Record<MoveId, string> = { drive: 'CUT HIM OFF!', cross: 'STAY IN FRONT!', step: 'CLOSE OUT!', shoot: 'CONTEST!' };
/**
 * The press: a marker sweeps the bar once; stop it in the GOOD window (PERFECT in the middle). Space, Enter, Z,
 * a click or a tap. Not pressing is a MISS. Runs on real time while the court plays in slow motion.
 */
function timing(title: string, prompt: string, w: Win): Promise<Tier> {
  $('ctitle').innerHTML = title;
  $('cread').innerHTML = '';
  const c = 0.55 + Math.random() * 0.25;
  const pctL = (x: number) => `${(x * 100).toFixed(2)}%`;
  $('crows').innerHTML = `
    <div class="tbar" aria-hidden="true">
      <div class="t-good" style="left:${pctL(c - w.good / 2)};width:${pctL(w.good)}"></div>
      <div class="t-perf" style="left:${pctL(c - w.perfect / 2)};width:${pctL(w.perfect)}"></div>
      <div class="t-mark"></div>
    </div>
    <div class="t-prompt">${prompt}<small>SPACE / CLICK / TAP</small></div>`;
  $('crows').classList.add('timing');
  $('cline').textContent = '';
  const mark = $('crows').querySelector<HTMLElement>('.t-mark')!;
  const DELAY = 0.35, DUR = 1.05;
  return new Promise((res) => {
    const t0 = performance.now();
    let done = false;
    const finish = (t: Tier) => {
      if (done) return;
      done = true;
      removeEventListener('keydown', onKey, true);
      removeEventListener('pointerdown', onPtr, true);
      $('crows').classList.add(`hit-${t}`);
      $('cline').innerHTML = `<b class="tier ${t}">${t === 'perfect' ? 'PERFECT!' : t === 'good' ? 'GOOD' : 'MISS'}</b>`;
      if (t === 'perfect') sfx.good(); else if (t === 'good') sfx.tap(); else sfx.bad();
      setTimeout(() => { $('crows').classList.remove('timing', 'hit-perfect', 'hit-good', 'hit-miss'); res(t); }, 420);
    };
    const judge = () => {
      const x = ((performance.now() - t0) / 1000 - DELAY) / DUR;
      if (x < 0) return;
      const d = Math.abs(x - c);
      finish(d <= w.perfect / 2 ? 'perfect' : d <= w.good / 2 ? 'good' : 'miss');
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); e.stopPropagation(); judge(); } };
    const onPtr = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.stage, .cmd')) { e.preventDefault(); unlockAudio(); judge(); } };
    addEventListener('keydown', onKey, true);
    addEventListener('pointerdown', onPtr, true);
    const step = () => {
      if (done) return;
      const x = ((performance.now() - t0) / 1000 - DELAY) / DUR;
      mark.style.left = pctL(Math.max(0, Math.min(1, x)));
      if (autoTier && x >= 0) {
        const t = autoTier;
        if (t === 'miss') finish('miss');
        else if (Math.abs(x - c) <= (t === 'perfect' ? w.perfect : w.good) / 2 - 0.005) finish(t);
      }
      if (x >= 1) { finish('miss'); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** The wind-up while the bar runs: the court in slow motion, the attacker starting his move. */
function windUp(a: Ent, d: Ent, m: MoveId) {
  view.speed = view.reduce ? 1 : 0.3;
  anim(a, m === 'drive' ? 'Hesi' : m === 'cross' ? 'Dribble_2' : m === 'step' ? 'Pocket_Dribble' : 'Idle_Ball_2', 100, true);
  anim(d, 'Idle_2', 90, true);
}

// ---------------------------------------------------------------- possessions
async function possession(off: 0 | 1) {
  const a = players[off], d = players[1 - off];
  idle(off === 0 ? '<span class="mk home"></span>YOUR BALL' : '<span class="mk away"></span>THEIR BALL');
  await checkIn(a, d);
  let s: St | undefined = start();
  const cur = { s, att: a, def: d };
  hud.cur = cur;
  while (s) {
    cur.s = s;
    $('cclock').innerHTML = clockHTML(s);
    // 1. The defense sets its stance first.
    let st: Stance;
    if (off === 0) {
      st = aiStance(s, rnd());
    } else {
      st = await askDefense(s);
      if (st === 'gamble') habit.gamble++; else if (st === 'press') habit.press++;
    }
    idle(off === 0 ? '<span class="mk home"></span>YOUR BALL' : '<span class="mk away"></span>DEFENSE');
    await setStance(d, a, st);
    // 2. The attacker answers what he sees.
    const vis = visOf(st);
    let m: MoveId;
    if (off === 0) {
      const pi = solve(s, 'att').pi;
      const bg = vis === 'press' ? pi.gamble / (pi.press + pi.gamble) : 0;
      m = await askAttack(s, vis, bg);
    } else {
      const bg = vis === 'press' ? Math.max(PRIOR_GAMBLE * 0.5, habit.gamble / (habit.press + habit.gamble)) : 0;
      m = aiMove(s, vis, bg, rnd());
      await wait(0.35);
    }
    // 3. The press: you pull it off (attacking) or answer it (defending).
    const side: Side = off === 0 ? 'att' : 'def';
    let tier: Tier;
    if (MODE === 'timing') {
      windUp(a, d, m);
      const title = off === 0 ? `<span class="mk home"></span>${moveLabel(s, m).toUpperCase()}` : `<span class="mk away"></span>HE GOES ${moveLabel(s, m).toUpperCase()}!`;
      tier = await timing(title, off === 0 ? PROMPT_ATT[m] : st === 'gamble' ? (m === 'shoot' ? 'BLOCK IT!' : 'STEAL IT!') : PROMPT_DEF[m], windowFor(side, s, m, st));
      view.speed = speedBase;
    } else {
      // Dice: the same window, rolled with the odds a player would land it.
      const od = tierOdds(windowFor(side, s, m, st));
      const r = rnd();
      tier = r < od.perfect ? 'perfect' : r < od.perfect + od.good ? 'good' : 'miss';
      if (off === 1) await wait(0.3);
    }
    // Both moves are shown once they meet (a Gamble is revealed here).
    idle(`<span class="mk ${off === 0 ? 'home' : 'away'}"></span>${moveLabel(s, m).toUpperCase()} vs ${STANCE_NAME[st].toUpperCase()}`);
    const o: Out = result(s, m, st, side, tier);
    if (tier === 'perfect') { shake(0.1); }
    await playBeat(s, m, st, o, a, d);
    if (o.pts) { score[off] += o.pts; $(`s${off}`).textContent = String(score[off]); }
    s = o.next;
    if (s) cur.s = s;
  }
  hud.cur = null;
  $('cclock').innerHTML = '';
}

async function matchLoop() {
  for (;;) {
    score[0] = score[1] = 0;
    $('s0').textContent = '0'; $('s1').textContent = '0';
    let off: 0 | 1 = 0;
    while (score[0] < WIN_SCORE && score[1] < WIN_SCORE) {
      await possession(off);
      off = (1 - off) as 0 | 1;
      await wait(0.3);
    }
    const won = score[0] > score[1];
    say(won ? 'YOU WIN!' : 'YOU LOSE');
    if (won) { sfx.levelUp(); cheer(); } else sfx.buzzer();
    await ask(won ? 'VICTORY' : 'DEFEAT', `${score[0]} - ${score[1]}`, [{ key: 'again', name: 'Play again', big: '', line: 'First to 7 again.' }]);
  }
}

// Tiny hook for automated checks.
(window as unknown as { __duel: unknown }).__duel = {
  get pending() { return !!pending; },
  get rows() { return rows.map((r) => `${r.key}:${r.big.replace(/<[^>]+>/g, '')}`); },
  choose: (i: number) => choose(i),
  setSpeed: (k: number) => { speedBase = k; view.speed = k; },
  set auto(t: Tier | null) { autoTier = t; },
  score,
};

loadAtlas().then(() => {
  startScene(canvas, app.querySelector<HTMLElement>('.word')!);
  matchLoop();
}).catch(() => { app.innerHTML = '<p style="padding:24px">Could not load the game art. Reload to try again.</p>'; });
