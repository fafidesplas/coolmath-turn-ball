// Turn Ball 1v1, card mode (page /cards/). Same court, players and animations as the classic duel; the
// decision is different: both hands are face up, both sides play one card at a time, and the cards are compared
// (power against stop, no dice). Rules: cardrules.ts. Hovering one of your cards marks, on each of the rival's
// cards, what would happen if he played it.
import '@fontsource/press-start-2p/400.css';
import './style.css';
import { sfx, unlockAudio } from '../audio';
import { loadAtlas } from '../pixel/sprites';
import { H, W, cheer, players, say, startScene, view, wait } from './scene';
import { checkIn, guardOverlay, hud, playBeat, setStance } from './beats';
import {
  ACARDS, ATT_DECK, BEATS, DCARDS, DEF_DECK, Deck, ENERGY, HAND, KIND_SHORT, WIN_SCORE, aiDef, aiPlay, clash, kindOf, legalPlays,
  powerOf, shotName, startCS, type CS, type DCardId, type Kind, type Play, type Res,
} from './cardrules';
import type { Ev } from './rules';

const rnd = Math.random;
let speedBase = 1;

// ---------------------------------------------------------------- page
const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="stage">
    <canvas width="${W}" height="${H}" aria-label="Side view of a street court: you against one rival"></canvas>
    <div class="word" aria-live="polite"></div>
    <div class="score"><span class="sc you"><i class="mk home"></i>YOU <b id="s0">0</b></span><span class="to">TO ${WIN_SCORE}</span><span class="sc them"><b id="s1">0</b> RIVAL<i class="mk away"></i></span></div>
    <a class="modes" href="../menu/">&#9776; MODES</a>
    <div class="clash" id="clash" aria-live="polite"></div>
  </div>
  <div class="cmd cardcmd" id="cmd">
    <div class="c-head"><span class="c-title" id="ctitle"></span><span class="c-meta"><span class="c-energy" id="cenergy" aria-label="Energy"></span><span class="c-clock" id="cclock" aria-label="Beats left"></span></span></div>
    <div class="hand-lbl" id="olbl">RIVAL</div>
    <div class="hand opp" id="opp"></div>
    <div class="hand-lbl" id="mlbl">YOU</div>
    <div class="hand mine" id="mine" role="menu"></div>
    <div class="c-line" id="cline" aria-live="polite"></div>
  </div>`;
const canvas = app.querySelector('canvas')!;
const $ = (id: string) => document.getElementById(id)!;
function fit() {
  const k = Math.max(1, Math.floor(Math.min((innerWidth - 32) / W, (innerHeight - 300) / H)));
  canvas.style.width = `${W * k}px`;
  canvas.style.height = `${H * k}px`;
  $('cmd').style.width = `${Math.max(W * k, 320)}px`;
}
addEventListener('resize', fit);
fit();
guardOverlay();

// ---------------------------------------------------------------- cards as HTML
const EV_WORD: Record<Ev, string> = {
  score: 'SCORES', miss: 'MISSES', block: 'BLOCK', steal: 'STEAL', beat: 'GETS BY', burn: 'BURNS', stopped: 'STOPPED',
  shook: 'SHAKES', broke: 'ANKLES', read: 'READ', room: 'ROOM', noroom: 'NO ROOM',
};
/** Good for the attack? */
const ATT_GOOD = new Set<Ev>(['score', 'beat', 'burn', 'shook', 'broke', 'room']);
const pips = (n: number, max: number, cls: string) => Array.from({ length: max }, (_, i) => `<i class="${cls} ${i < n ? 'on' : ''}"></i>`).join('');

function attCardHTML(cs: CS, p: Play, i: number, live: boolean, mine: boolean) {
  const shot = p === 'shoot';
  const c = shot ? null : ACARDS[p];
  const name = shot ? shotName(cs) : c!.name;
  const k: Kind = kindOf(p);
  const pw = powerOf(cs, p);
  const cost = shot ? '' : '&#9679;'.repeat(c!.cost) || '0';
  return `<button class="card att k-${k} ${live ? '' : 'dis'}" data-i="${i}" ${mine ? 'role="menuitem"' : 'tabindex="-1"'} ${live ? '' : 'aria-disabled="true"'}>
    <span class="cd-cost">${cost}</span><b class="cd-pw">${pw}</b><span class="cd-nm">${name}</span><span class="cd-kd">${KIND_SHORT[k]}</span><span class="cd-res"></span></button>`;
}
function defCardHTML(d: DCardId, i: number, mine: boolean, focus: Kind | null) {
  const c = DCARDS[d];
  const stops = (Object.keys(c.stop) as Kind[]).map((k) => `<span class="${focus === k ? 'hot' : ''}">${KIND_SHORT[k]}<b>${c.stop[k] < 0 ? '-' : c.stop[k]}</b></span>`).join('');
  return `<button class="card def d-${d}" data-i="${i}" ${mine ? 'role="menuitem"' : 'tabindex="-1"'}><span class="cd-nm">${c.name}</span><span class="cd-stops">${stops}</span><span class="cd-res"></span></button>`;
}

// ---------------------------------------------------------------- one decision
interface Choice { mine: (Play | DCardId)[]; disabled: boolean[]; resolve: (i: number) => void }
let choice: Choice | null = null;
let focusI = 0;
/** What the rival can play right now (unique plays for the attack, his hand for the defense). */
let oppList: (Play | DCardId)[] = [];
let state: CS | null = null;
let userAttacks = true;

function render(cs: CS, title: string) {
  state = cs;
  $('ctitle').innerHTML = title;
  $('cenergy').innerHTML = `${pips(cs.energy, ENERGY, 'en')}${cs.combo ? '<em class="combo">+1 NEXT</em>' : ''}`;
  $('cclock').innerHTML = pips(cs.clock, BEATS, 'cl');
  const attPlays = legalPlays(cs);
  const attHand: Play[] = [...cs.hand, 'shoot'];
  const live = (p: Play) => attPlays.includes(p);
  if (userAttacks) {
    $('olbl').textContent = 'RIVAL DEFENSE';
    $('mlbl').textContent = 'YOUR MOVES';
    oppList = [...cs.dhand];
    $('opp').innerHTML = cs.dhand.map((d, i) => defCardHTML(d, i, false, null)).join('');
    $('mine').innerHTML = attHand.map((p, i) => attCardHTML(cs, p, i, live(p), true)).join('');
  } else {
    $('olbl').textContent = 'RIVAL MOVES';
    $('mlbl').textContent = 'YOUR DEFENSE';
    oppList = attHand;
    $('opp').innerHTML = attHand.map((p, i) => attCardHTML(cs, p, i, live(p), false)).join('');
    $('mine').innerHTML = cs.dhand.map((d, i) => defCardHTML(d, i, true, null)).join('');
  }
}

/** Mark on each rival card what my focused card would do against it. */
function preview(i: number) {
  const cs = state;
  const c = choice;
  if (!c) return;
  focusI = i;
  $('mine').querySelectorAll('.card').forEach((b, k) => b.classList.toggle('cur', k === i));
  if (!cs) return;
  const opp = $('opp').querySelectorAll<HTMLElement>('.card');
  const mine = c.mine[i];
  const plays = legalPlays(cs);
  oppList.forEach((o, k) => {
    const el = opp[k].querySelector<HTMLElement>('.cd-res')!;
    let r: Res | null = null;
    if (userAttacks) r = clash(cs, mine as Play, o as DCardId);
    else if (plays.includes(o as Play)) r = clash(cs, o as Play, mine as DCardId);
    opp[k].classList.remove('r-good', 'r-bad', 'r-mid');
    if (!r) { el.textContent = ''; return; }
    const attGood = ATT_GOOD.has(r.ev);
    const forMe = userAttacks ? attGood : !attGood;
    const mid = r.ev === 'read' || r.ev === 'stopped' || r.ev === 'noroom' || r.ev === 'miss';
    opp[k].classList.add(mid ? 'r-mid' : forMe ? 'r-good' : 'r-bad');
    el.textContent = EV_WORD[r.ev];
  });
  if (userAttacks) {
    const p = mine as Play;
    $('cline').textContent = p === 'shoot' ? `${shotName(cs)}: power ${powerOf(cs, p)} against his SHT stop. Ends the possession.` : `${ACARDS[p].name}: ${ACARDS[p].text}`;
  } else $('cline').textContent = `${DCARDS[mine as DCardId].name}: ${DCARDS[mine as DCardId].text}`;
}

function choose(i: number) {
  const c = choice;
  if (!c) return;
  if (c.disabled[i]) { sfx.bad(); return; }
  sfx.tap();
  choice = null;
  $('cmd').classList.remove('live');
  c.resolve(i);
}
function pickCard(mine: (Play | DCardId)[], disabled: boolean[]): Promise<number> {
  return new Promise((res) => {
    choice = { mine, disabled, resolve: res };
    $('cmd').classList.add('live');
    const first = disabled.findIndex((d) => !d);
    preview(first < 0 ? 0 : first);
  });
}
$('mine').addEventListener('click', (e) => {
  unlockAudio();
  const b = (e.target as HTMLElement).closest<HTMLElement>('.card');
  if (!b || !choice) return;
  const i = +b.dataset.i!;
  // Touch: first tap previews, second plays. Mouse: hover already previewed.
  if (i !== focusI && (e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== 'mouse') { preview(i); sfx.tick(); return; }
  choose(i);
});
$('mine').addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !choice) return;
  const b = (e.target as HTMLElement).closest<HTMLElement>('.card');
  if (b && +b.dataset.i! !== focusI) { preview(+b.dataset.i!); sfx.tick(); }
});
addEventListener('keydown', (e) => {
  const c = choice;
  if (!c) return;
  const n = c.mine.length;
  const step = (d: number) => { let i = focusI; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!c.disabled[i]) break; } preview(i); sfx.tick(); };
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { e.preventDefault(); unlockAudio(); choose(focusI); }
  else { const d = parseInt(e.key, 10); if (d >= 1 && d <= n) { e.preventDefault(); if (focusI === d - 1) choose(d - 1); else { preview(d - 1); sfx.tick(); } } }
});

/** The two cards meet over the court: names and numbers, then the result. */
async function showClash(cs: CS, p: Play, d: DCardId, r: Res, off: 0 | 1) {
  const att = p === 'shoot' ? shotName(cs) : ACARDS[p].name;
  const good = ATT_GOOD.has(r.ev) === (off === 0);
  $('clash').innerHTML = `
    <div class="cl-card ${off === 0 ? 'me' : 'them'}"><span>${att}</span><b>${r.power}</b></div>
    <div class="cl-vs">VS</div>
    <div class="cl-card ${off === 1 ? 'me' : 'them'}"><span>${DCARDS[d].name}</span><b>${r.stop < 0 ? '-' : r.stop}</b></div>
    <div class="cl-res ${good ? 'good' : 'bad'}">${r.grade === 'great' ? 'GREAT!' : r.grade === 'ok' ? 'IT WORKS' : 'STOPPED'}</div>`;
  $('clash').classList.add('show');
  sfx.duel();
  await wait(1.0);
  $('clash').classList.remove('show');
}

// ---------------------------------------------------------------- the match
const score: [number, number] = [0, 0];
const decks = {
  att: [new Deck(ATT_DECK, rnd), new Deck(ATT_DECK, rnd)],
  def: [new Deck(DEF_DECK, rnd), new Deck(DEF_DECK, rnd)],
};

async function possession(off: 0 | 1) {
  userAttacks = off === 0;
  const a = players[off], d = players[1 - off];
  let cs: CS | undefined = startCS(decks.att[off].draw(HAND), decks.def[1 - off].draw(HAND));
  const title = () => (off === 0 ? '<span class="mk home"></span>YOUR BALL' : '<span class="mk away"></span>DEFENSE');
  render(cs, title());
  $('cline').textContent = off === 0 ? 'Both hands are face up. Pick a move: the rival picks his card at the same time.' : 'He will play one of his moves. Pick your answer at the same time.';
  await checkIn(a, d);
  const cur = { s: cs, att: a, def: d };
  hud.cur = cur;
  while (cs) {
    cur.s = cs;
    render(cs, title());
    let p: Play, dc: DCardId;
    if (off === 0) {
      const mine: Play[] = [...cs.hand, 'shoot'];
      const plays = legalPlays(cs);
      dc = aiDef(cs, rnd());
      const i = await pickCard(mine, mine.map((x) => !plays.includes(x)));
      p = mine[i];
    } else {
      p = aiPlay(cs, rnd());
      const i = await pickCard([...cs.dhand], cs.dhand.map(() => false));
      dc = cs.dhand[i];
    }
    const r = clash(cs, p, dc);
    // Reveal: the rival's card lights up in his hand, then the two meet over the court.
    const oi = off === 0 ? cs.dhand.indexOf(dc) : [...cs.hand, 'shoot'].indexOf(p);
    $('opp').querySelectorAll('.card')[oi]?.classList.add('played');
    $('ctitle').innerHTML = `<span class="mk ${off === 0 ? 'home' : 'away'}"></span>${(p === 'shoot' ? shotName(cs) : ACARDS[p].name).toUpperCase()} vs ${DCARDS[dc].name.toUpperCase()}`;
    await showClash(cs, p, dc, r, off);
    await setStance(d, a, r.stance);
    await playBeat(cs, r.move, r.stance, { ev: r.ev, next: r.next, pts: r.pts }, a, d);
    if (r.pts) { score[off] += r.pts; $(`s${off}`).textContent = String(score[off]); }
    cs = r.next;
  }
  hud.cur = null;
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
    $('ctitle').innerHTML = won ? 'VICTORY' : 'DEFEAT';
    $('opp').innerHTML = ''; $('cenergy').innerHTML = ''; $('cclock').innerHTML = '';
    $('olbl').textContent = `${score[0]} - ${score[1]}`;
    $('mlbl').textContent = '';
    $('mine').innerHTML = `<button class="card again" data-i="0" role="menuitem"><span class="cd-nm">Play again</span></button>`;
    $('cline').textContent = `First to ${WIN_SCORE} again.`;
    state = null;
    oppList = [];
    await pickCard(['shoot'], [false]);
  }
}

// Tiny hook for automated checks.
(window as unknown as { __cards: unknown }).__cards = {
  get pending() { return !!choice; },
  get mine() { return choice ? choice.mine.map((m, i) => `${m}${choice!.disabled[i] ? '(x)' : ''}`) : []; },
  choose: (i: number) => choose(i),
  setSpeed: (k: number) => { speedBase = k; view.speed = k; },
  score,
};
void speedBase;

loadAtlas().then(() => {
  startScene(canvas, app.querySelector<HTMLElement>('.word')!);
  matchLoop();
}).catch(() => { app.innerHTML = '<p style="padding:24px">Could not load the game art. Reload to try again.</p>'; });
