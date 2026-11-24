// Turn Ball Pixel: screens and boot. Fork of src/main.ts with pixel-art avatars, team shape marks and
// the sprite renderer; saves, league, rules and techniques are the shared modules of the main game.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './style.css';
import { setSound, sfx, unlockAudio } from '../audio';
import {
  RIVALS, STATS, STAT_LABEL, STAT_NAME, TEMPLATES, USER_TEAM, playerPower, xpForLevel, MAX_LEVEL,
  type Player, type RivalTeam,
} from '../data';
import { DecisionUI } from './decisionui';
import {
  applyResult, equip, nextInPath, nextLearnLevel, rollScout, ROSTER_MAX, SCOUT_REFRESH_COST, sign, train, unequip,
  type Learned, type Rewards,
} from '../game';
import { icon, initIcons } from './pxicons';
import { Match, TUTORIAL, TUTORIAL_KITS, type MatchOptions, type MatchResult } from './match';
import { MATCH_RULES, TUNE } from '../rules';
import { TECHS, slotsFor, trainCost, type TechId } from '../techs';
import { FEET, avatarURL, drawPlayer, hairStyleFor, loadAtlas, mix, tagFrame, type Kit, type Look } from './sprites';
import { arcadePlayer, loadPixelSave, persistPixel, pixelRivals, signatureOf } from './arcade';
import { FIRE, type SpecialDef } from '../specials';

const app = document.getElementById('app')!;
const save = loadPixelSave();
const persist = persistPixel;
const mirrorPlayers = pixelRivals;
setSound(save.sound);
let match: Match | null = null;
let dui: DecisionUI | null = null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const coinsHTML = () => `<div class="coins">${icon('coin', 20)}<b>${save.coins}</b></div>`;

document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

// ---------------- pixel looks
/** Home: light kit with stripes (circle mark). Away: dark kit with headbands (diamond mark). */
const HOME_KIT: Kit = { jersey: '#f4efe6', shade: '#b9ae9f', stripe: USER_TEAM.color, stripe2: '#1b1029', band: null };
const SCOUT_KIT: Kit = { jersey: '#8d99ae', shade: '#5c667a', stripe: null, stripe2: null, band: null };
const awayKit = (r: RivalTeam): Kit => ({ jersey: mix(r.color, '#000000', 0.5), shade: mix(r.color, '#000000', 0.7), stripe: null, stripe2: null, band: r.accent });
const lookOf = (p: Player, kit: Kit): Look => ({ skin: p.skin, hair: p.hair, hairStyle: hairStyleFor(p.tid), kit });
/** Team mark: a shape, so teams never depend on color alone. */
const markHTML = (m: 'home' | 'away') => `<i class="mark ${m}" aria-label="${m === 'home' ? 'Circle team' : 'Diamond team'}"></i>`;

function avatarHTML(p: Player, kit: Kit, size = 56) {
  const s = size >= 50 ? 60 : 40;
  return `<div class="avatar px-av" style="width:${s}px;height:${s}px"><img src="${avatarURL(lookOf(p, kit))}" alt="" width="${s}" height="${s}"><b class="av-num">${p.num}</b></div>`;
}

function mount(html: string, cls: string) {
  dui?.destroy();
  dui = null;
  match?.destroy();
  match = null;
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { sfx.tap(); routes[b.dataset.go!]?.(); }));
  return app.firstElementChild as HTMLElement;
}

function topBar(title: string) {
  return `<div class="topbar"><button class="btn small ghost icon-btn" data-go="title" aria-label="Back">${icon('back', 22)}</button><h2>${title}</h2>${coinsHTML()}</div>`;
}

function statBars(p: Player) {
  return `<div class="statbars">${STATS.map((k) =>
    `<div class="sb" title="${STAT_NAME[k]}"><span>${STAT_LABEL[k]}</span><i><u style="width:${p.stats[k] * 10}%"></u></i><b>${p.stats[k]}</b></div>`).join('')}</div>`;
}

/** The player's signature special: flame icon, name and what counters it. */
const sigHTML = (p: Player, slot: number) => {
  const d = signatureOf(p, slot);
  return `<div class="sig" title="${esc(d.line)}">${icon('fire', 16)}<b>${esc(d.name)}</b><small>${esc(d.line)}</small></div>`;
};

const chip = (t: TechId, cls = '', extra = '') =>
  `<span class="tech ${cls}" title="${esc(TECHS[t].name)}: ${esc(TECHS[t].line)}" ${extra}>${icon(TECHS[t].icon, 16)}${esc(TECHS[t].name)}</span>`;

/** Compact technique row for scouting cards: what they bring, and what they learn next. */
function techPreview(start: TechId[], path: TechId[]) {
  return `<div class="techs">${start.map((t) => chip(t, 'known')).join('')}${path.slice(0, 2).map((t) => chip(t, 'locked')).join('')}</div>`;
}

const HOW: Record<Learned['how'], string> = { level: 'Level up', train: 'Trained', league: 'League win' };

// ---------------- screens ----------------
function titleScreen() {
  const next = RIVALS[Math.min(save.beaten, RIVALS.length - 1)];
  const el = mount(`
    <div class="title-wrap">
      <div class="logo"><span class="l1">TURN</span><span class="l2">BALL</span></div>
      <div class="pixel-tag">PIXEL EDITION</div>
      <canvas class="title-sprites" id="tsprites" width="120" height="56"></canvas>
      <p class="tagline">3x3 street hoops, one move at a time.</p>
      <div class="menu">
        <button class="btn big primary" data-go="league">${icon('play', 26)} PLAY</button>
        <div class="menu-row">
          <button class="btn sq" data-go="team" aria-label="My team">${icon('team', 28)}<small>Team</small></button>
          <button class="btn sq" data-go="scout" aria-label="Scout">${icon('scout', 28)}<small>Scout</small></button>
          <button class="btn sq" data-go="how" aria-label="How to play">${icon('help', 28)}<small>Help</small></button>
          <button class="btn sq" id="snd" aria-label="Sound">${icon(save.sound ? 'soundOn' : 'soundOff', 28)}<small>Sound</small></button>
          <button class="btn sq" id="fx" aria-label="Effects" aria-pressed="${!save.reduceFx}">${icon(save.reduceFx ? 'even' : 'fire', 28)}<small>${save.reduceFx ? 'FX low' : 'FX full'}</small></button>
        </div>
      </div>
      <div class="title-foot">
        ${coinsHTML()}
        <div class="progress">${save.beaten >= RIVALS.length ? `${icon('trophy', 18)} Champions` : `Next: <b>${esc(next.name)}</b>`}</div>
      </div>
      <a class="classic" href="../">Classic 3D version</a>
    </div>`, 'title');
  titleSprites(el.querySelector<HTMLCanvasElement>('#tsprites')!, next);
  el.querySelector('#snd')!.addEventListener('click', () => {
    save.sound = !save.sound; setSound(save.sound); persist(save); titleScreen();
  });
  el.querySelector('#fx')!.addEventListener('click', () => {
    save.reduceFx = !save.reduceFx; persist(save); titleScreen();
  });
}

function leagueScreen() {
  const myPow = Math.round(save.roster.slice(0, 3).reduce((a, p) => a + playerPower(p), 0) / 3 * 10) / 10;
  const el = mount(`${topBar('Sunset League')}
    <div class="league">${RIVALS.map((r, i) => {
      const locked = i > save.beaten;
      const rec = save.record[r.id];
      const beaten = i < save.beaten;
      const pw = myPow;
      return `<div class="rival ${locked ? 'locked' : ''} ${beaten ? 'beaten' : ''}" style="--c:${mix(r.color, '#000000', 0.5)};--a:${r.accent}">
        <div class="r-badge">${locked ? icon('lock', 22) : beaten ? icon('check', 24) : `<b>${i + 1}</b>`}</div>
        <div class="r-info"><b>${markHTML('away')} ${esc(r.name)}</b>
          <span class="pow"><i style="width:${pw * 10}%"></i><em>${pw}</em></span>
          ${rec ? `<small>W${rec.w} L${rec.l}</small>` : ''}</div>
        <button class="btn small ${locked ? 'ghost' : 'primary'} icon-btn" data-rival="${i}" ${locked ? 'disabled' : ''} aria-label="Play">${icon(locked ? 'lock' : 'play', 22)}</button>
      </div>`;
    }).join('')}</div>
    <div class="mypow">${save.roster.slice(0, 3).map((p) => avatarHTML(p, HOME_KIT, 40)).join('')}<span class="pow"><i style="width:${myPow * 10}%"></i><em>${myPow}</em></span></div>`, 'league-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-rival]').forEach((b) =>
    b.addEventListener('click', () => { sfx.tap(); matchScreen(RIVALS[+b.dataset.rival!]); }));
}

function teamScreen(msg = '') {
  const fresh = new Set(save.fresh ?? []);
  const el = mount(`${topBar('My Team')}
    ${msg ? `<p class="sub"><b class="msg">${esc(msg)}</b></p>` : ''}
    <div class="roster">${save.roster.map((p, i) => {
      const slots = slotsFor(p.level);
      const bench = p.known.filter((t) => !p.gear.includes(t));
      const nt = nextInPath(p);
      const nl = nextLearnLevel(p);
      const cost = trainCost(p.known.length);
      const isNew = (t: TechId) => fresh.has(`${p.uid}:${t}`);
      return `
      <div class="pcard ${i < 3 ? 'starter' : 'bench'}">
        <div class="pc-head">${avatarHTML(p, HOME_KIT, 52)}
          <div class="pc-name"><b>${esc(p.name)}</b><small>${i < 3 ? 'STARTER' : 'BENCH'} - ${esc(p.role)} - Lv ${p.level}${p.level >= MAX_LEVEL ? ' MAX' : ''}</small>
            <div class="xpbar"><i style="width:${p.level >= MAX_LEVEL ? 100 : (p.xp / xpForLevel(p.level)) * 100}%"></i></div></div></div>
        ${statBars(p)}
        ${sigHTML(p, i)}
        <div class="kit">
          <div class="kit-h"><span>Techniques</span><span class="slots">${Array.from({ length: slots }, (_, k) => `<i class="${k < p.gear.length ? 'on' : ''}"></i>`).join('')}<b>${p.gear.length}/${slots}</b></span></div>
          <div class="techs">${p.gear.map((t) => chip(t, `known eq ${isNew(t) ? 'new' : ''}`, `data-unequip="${i}:${t}" role="button"`)).join('')}${
            Array.from({ length: Math.max(0, slots - p.gear.length) }, () => `<span class="tech empty">${icon('slot', 16)}Empty</span>`).join('')}</div>
          ${bench.length ? `<div class="techs off">${bench.map((t) => chip(t, `known ${isNew(t) ? 'new' : ''}`, `data-equip="${i}:${t}" role="button"`)).join('')}</div>` : ''}
          ${nt ? `<div class="kit-next">${icon('lock', 16)}<span>${chip(nt, 'locked')}</span><small>${nl ? `Lv ${nl}` : ''}</small>
            <button class="btn small" data-train="${i}" ${save.coins < cost ? 'disabled' : ''}>${icon('train', 18)} ${icon('coin', 16)} ${cost}</button></div>` : '<div class="kit-next"><small>Path complete</small></div>'}
        </div>
        <div class="pc-actions">
          ${i > 0 ? `<button class="btn small icon-btn" data-up="${i}" aria-label="Move up">${icon('up', 20)}</button>` : ''}
          ${save.roster.length > 3 ? `<button class="btn small ghost" data-release="${i}">Release</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>
    <p class="sub center">Tap a technique to equip or unequip it. Only equipped ones are used in matches.</p>
    <p class="sub center">Everyone already has every shot (dunk, layup, floater, jump shot, three, fadeaway), every dribble move and the seven defenses. Techniques here add passes and team plays.</p>`, 'team-screen');
  if (save.fresh?.length) { save.fresh = []; persist(save); }
  el.querySelectorAll<HTMLElement>('[data-equip]').forEach((b) => b.addEventListener('click', () => {
    const [i, t] = b.dataset.equip!.split(':');
    const p = save.roster[+i];
    const err = equip(p, t as TechId);
    if (err) { sfx.bad(); teamScreen(err); return; }
    persist(save); sfx.tap(); teamScreen();
  }));
  el.querySelectorAll<HTMLElement>('[data-unequip]').forEach((b) => b.addEventListener('click', () => {
    const [i, t] = b.dataset.unequip!.split(':');
    unequip(save.roster[+i], t as TechId);
    persist(save); sfx.tap(); teamScreen();
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((b) => b.addEventListener('click', () => {
    const p = save.roster[+b.dataset.train!];
    const r = train(save, p);
    if (typeof r === 'string') { sfx.bad(); teamScreen(r); return; }
    persist(save); sfx.levelUp();
    learnedOverlay([r], () => teamScreen());
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.up!;
    [save.roster[i - 1], save.roster[i]] = [save.roster[i], save.roster[i - 1]];
    persist(save); sfx.tap(); teamScreen();
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-release]').forEach((b) => b.addEventListener('click', () => {
    const p = save.roster[+b.dataset.release!];
    if (!confirm(`Release ${p.name}?`)) return;
    save.roster.splice(+b.dataset.release!, 1);
    persist(save); teamScreen(`${p.name} left the team.`);
  }));
}

/** Full-screen notice for newly learned techniques. */
function learnedHTML(list: Learned[]) {
  return list.map((l) => `<div class="learned">
      <span class="li">${icon(TECHS[l.tech].icon, 34)}</span>
      <div><small>NEW TECHNIQUE - ${HOW[l.how]}</small><b>${esc(TECHS[l.tech].name)}</b><span>${esc(l.player.name)}</span><em>${esc(TECHS[l.tech].line)}</em>
      <small class="${l.equipped ? 'ok' : 'warn'}">${l.equipped ? 'Equipped' : 'Slots full: equip it in Team'}</small></div></div>`).join('');
}

function learnedOverlay(list: Learned[], done: () => void) {
  const ov = document.createElement('div');
  ov.className = 'pause-overlay learn-ov';
  ov.innerHTML = `<div class="panel">${learnedHTML(list)}<button class="btn primary" id="lok">${icon('check', 20)} OK</button></div>`;
  app.firstElementChild!.appendChild(ov);
  ov.querySelector('#lok')!.addEventListener('click', () => { sfx.tap(); done(); });
}

function scoutScreen(msg = '') {
  const el = mount(`${topBar('Scouting')}
    ${msg ? `<p class="sub"><b class="msg">${esc(msg)}</b></p>` : ''}
    <div class="roster">${save.scout.map((id) => {
      const t = TEMPLATES.find((x) => x.id === id)!;
      const fake: Player = { uid: '', tid: t.id, name: t.name, num: t.num, tag: t.tag, hair: t.hair, skin: t.skin, stats: t.stats, growth: t.growth, role: t.role, path: t.path, level: 1, xp: 0, known: [...t.start], gear: [...t.start] };
      arcadePlayer(fake);
      return `<div class="pcard">
        <div class="pc-head">${avatarHTML(fake, SCOUT_KIT, 52)}<div class="pc-name"><b>${esc(t.name)}</b><small>${esc(t.role)} - Power ${playerPower(fake)}</small></div></div>
        ${statBars(fake)}${sigHTML(fake, 0)}${techPreview(fake.known, fake.path.filter((x) => !fake.known.includes(x)))}
        <div class="pc-actions"><button class="btn small primary" data-sign="${id}" ${save.coins < t.price || save.roster.length >= ROSTER_MAX ? 'disabled' : ''}>Sign ${icon('coin', 18)} ${t.price}</button></div>
      </div>`;
    }).join('') || '<p class="sub">Nobody left to scout.</p>'}</div>
    <div class="center"><button class="btn" id="reroll" ${save.coins < SCOUT_REFRESH_COST ? 'disabled' : ''}>${icon('scout', 20)} New ${icon('coin', 18)} ${SCOUT_REFRESH_COST}</button></div>`, 'scout-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-sign]').forEach((b) => b.addEventListener('click', () => {
    const err = sign(save, b.dataset.sign!);
    if (err) { sfx.bad(); scoutScreen(err); return; }
    arcadePlayer(save.roster[save.roster.length - 1]);
    persist(save); sfx.coin(); scoutScreen('Signed. Set starters in My Team.');
  }));
  el.querySelector('#reroll')!.addEventListener('click', () => {
    if (save.coins < SCOUT_REFRESH_COST) return;
    save.coins -= SCOUT_REFRESH_COST; rollScout(save); persist(save); sfx.coin(); scoutScreen();
  });
}

function howScreen() {
  const card = (ic: string, title: string, body: string) => `<section class="hcard"><div class="hi">${ic}</div><div><h3>${title}</h3><p>${body}</p></div></section>`;
  mount(`${topBar('How to Play')}
    <div class="how">
      ${card(`${icon('t_dunk', 26)}${icon('shoot', 26)}`, 'Your turn: shoot', 'Dunk, layup, floater, jump shot, three or fadeaway. The dunk is the best finish: at the post, or from the elbow once you beat your man. A shot blocker can stuff it.')}
      ${card(`${icon('t_cross', 24)}${icon('t_between', 24)}${icon('t_backdown', 24)}`, 'Your turn: dribble', 'Crossover, between the legs, behind the back, spin, euro step, back down, hesitation, step-back, pump fake. Beat your man and you are open: then dunk or shoot.')}
      ${card(`${icon('t_rim', 24)}${icon('t_contest', 24)}${icon('t_charge', 24)}`, 'Their turn: defend', 'Press, Steal, Contest, Give space, Block, Take the charge or Deny pass. Each one says what it stops and what beats it. You both pick at the same time.')}
      ${card(`<span class="pps"><span class="pp rw">${icon('up', 16)}${icon('up', 16)}</span><span class="pp rk">${icon('warn', 16)}</span></span>`, 'Gain and risk', 'Arrows show how much an option can win you, warning triangles how risky it is. After every play a card says whose move won and why.')}
      ${card(`${icon('fire', 30)}`, 'Fire and specials', `Win duels to fill your Fire meter (${FIRE.max} flames: +1 per duel won, +2 per steal, pick, block or charge, +1 per forced miss, -1 per turnover). Full Fire unlocks each player's signature special for one move. Every special has a defense that stops it.`)}
      ${card(`${icon('t_pnr', 24)}${icon('t_iso', 24)}${icon('t_pop', 24)}`, 'Plays and passes', 'Players learn passes and team plays (pick and roll, clear-out, hand-off...) by leveling up and training. Shots, dribble moves and defense are the same for everyone.')}
      ${card(`<span class="pips att"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span>`, 'Moves', `${TUNE.actions} moves per possession. The last one is a shot.`)}
      ${card(icon('hoop', 32), 'Score', `1 inside the arc, 2 outside. First to ${MATCH_RULES.winScore}, or most after ${MATCH_RULES.maxPoss} possessions each.`)}
      <div class="center menu row"><button class="btn primary" id="tut">${icon('play', 22)} Tutorial</button><button class="btn" data-go="league">${icon('play', 22)} Play</button></div>
    </div>`, 'how-screen');
  app.querySelector('#tut')!.addEventListener('click', () => { sfx.tap(); tutorialScreen(); });
}

/** Fire meter: flame pips (filled solid, empty dotted), plus the word READY when full. */
const fireHTML = (t: 0 | 1, short: string) => `<div class="fire t${t}" id="fire${t}">${markHTML(t === 0 ? 'home' : 'away')}<span class="fn">${esc(short)}</span>
  <span class="fpips">${Array.from({ length: FIRE.max }, () => `<i>${icon('fire', 16)}</i>`).join('')}</span><b class="fready">READY</b></div>`;

function matchHud(rivalName: string, rivalColor: string) {
  return `
    <div class="stage" id="stage"></div>
    <div class="mpanel" id="mpanel">
      <div class="fires">${fireHTML(0, USER_TEAM.short)}${fireHTML(1, rivalName)}</div>
      <div class="log" id="log"></div>
    </div>
    <div class="hud">
      <div class="hteam home">${markHTML('home')}<span class="hn">${USER_TEAM.short}</span><span class="hs" id="s0">0</span></div>
      <div class="hclock"><span id="possn"></span></div>
      <div class="hteam away" style="--c:${mix(rivalColor, '#000000', 0.5)}"><span class="hs" id="s1">0</span><span class="hn">${esc(rivalName)}</span>${markHTML('away')}</div>
      <button class="btn small ghost pausebtn icon-btn" id="pause" aria-label="Pause">${icon('pause', 20)}</button>
    </div>
    <div class="banner" id="banner"></div>
    <div class="duel" id="duel" aria-live="polite"></div>
    <div class="cutin" id="cutin"></div>`;
}

function bindMatch(el: HTMLElement, rival: RivalTeam | null, opts: MatchOptions) {
  const stage = el.querySelector<HTMLElement>('#stage')!;
  const banner = el.querySelector<HTMLElement>('#banner')!;
  const log = el.querySelector<HTMLElement>('#log')!;
  const cutin = el.querySelector<HTMLElement>('#cutin')!;
  const duel = el.querySelector<HTMLElement>('#duel')!;
  const panel = el.querySelector<HTMLElement>('#mpanel')!;
  let bannerT = 0, cutT = 0, duelT = 0;
  dui = new DecisionUI(panel, () => match);
  const team = save.roster.slice(0, 3);
  const foe = rival ? rival : RIVALS[0];
  const m = new Match(stage, [
    { name: USER_TEAM.name, short: USER_TEAM.short, color: USER_TEAM.color, accent: USER_TEAM.accent, shorts: '#ffffff', kit: HOME_KIT, marker: 'home', players: team },
    { name: foe.name, short: foe.name.slice(0, 3).toUpperCase(), color: foe.color, accent: foe.accent, shorts: '#1d1a2b', kit: awayKit(foe), marker: 'away', players: mirrorPlayers(foe, team) },
  ], opts, {
    decision: (open) => {
      el.classList.toggle('deciding', open);
      if (open) { save.duelsSeen++; duel.classList.remove('show'); }
      dui?.show(open);
    },
    hud: (h) => {
      el.querySelector('#s0')!.textContent = String(h.score[0]);
      el.querySelector('#s1')!.textContent = String(h.score[1]);
      const n = Math.min(h.maxPoss, Math.max(h.poss[0], h.poss[1]) + (h.poss[0] === h.poss[1] ? 1 : 0));
      el.querySelector('#possn')!.innerHTML = opts.tutorial ? `${icon('help', 16)}` : h.golden ? 'GOLDEN' : `${icon('ball', 16)} ${n}/${h.maxPoss}`;
      el.querySelector('.hteam.home')!.classList.toggle('poss', h.offense === 0);
      el.querySelector('.hteam.away')!.classList.toggle('poss', h.offense === 1);
      for (const t of [0, 1] as const) {
        const f = el.querySelector<HTMLElement>(`#fire${t}`)!;
        f.querySelectorAll('.fpips i').forEach((p, k) => p.classList.toggle('on', k < h.heat[t]));
        f.classList.toggle('full', h.heat[t] >= FIRE.cost);
      }
    },
    banner: (text, color, sub) => {
      banner.innerHTML = `<div class="bn-main" style="--c:${color}">${esc(text)}</div>${sub ? `<div class="bn-sub">${esc(sub)}</div>` : ''}`;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      clearTimeout(bannerT);
      bannerT = window.setTimeout(() => banner.classList.remove('show'), 1500);
    },
    explain: (text, tone) => {
      const line = document.createElement('p');
      line.className = `explain ${tone}`;
      line.textContent = text;
      log.prepend(line);
      while (log.children.length > 4) log.lastElementChild!.remove();
    },
    duel: (d) => {
      // Result card: both moves with their icons, who won (check / cross / equals mark plus a word), and why.
      const mark = d.res === 'win' ? icon('check', 24) : d.res === 'lose' ? icon('cross', 24) : icon('even', 24);
      const word = d.res === 'win' ? 'YOU WIN' : d.res === 'lose' ? 'THEY WIN' : 'EVEN';
      duel.className = `duel r-${d.res}`;
      duel.innerHTML = `<div class="du-row">
          <span class="du-side"><small>YOU</small>${icon(d.you.icon, 32)}<b>${esc(d.you.name)}</b></span>
          <span class="du-res">${mark}<small>${word}</small></span>
          <span class="du-side"><small>THEM</small>${icon(d.them.icon, 32)}<b>${esc(d.them.name)}</b></span></div>
        <div class="du-head">${esc(d.head)}</div><div class="du-why">${esc(d.why)}</div>`;
      void duel.offsetWidth;
      duel.classList.add('show');
      clearTimeout(duelT);
      duelT = window.setTimeout(() => duel.classList.remove('show'), 2600);
    },
    coached: (side) => {
      if (side === 'att') save.coachedAtt = true; else save.coachedDef = true;
      persist(save);
    },
    special: (sp: SpecialDef, pl: Player, team: 0 | 1) => {
      const kit = team === 0 ? HOME_KIT : awayKit(foe);
      cutin.className = `cutin fx-${sp.fx} t${team} ${save.reduceFx ? 'calm' : ''}`;
      cutin.innerHTML = `<div class="ci-band"><img src="${avatarURL(lookOf(pl, kit))}" alt="" width="80" height="80">
        <div><small>${team === 0 ? markHTML('home') : markHTML('away')} #${pl.num} ${esc(pl.name.toUpperCase())}</small><b>${icon('fire', 24)} ${esc(sp.name.toUpperCase())}</b><em>${esc(sp.line)}</em></div></div>`;
      void cutin.offsetWidth;
      cutin.classList.add('show');
      clearTimeout(cutT);
      cutT = window.setTimeout(() => cutin.classList.remove('show'), save.reduceFx ? 1400 : 1500);
    },
    end: (r) => {
      if (r.tutorial) { save.tutorialDone = true; persist(save); leagueScreen(); return; }
      resultScreen(rival!, r);
    },
  });
  match = m;
  el.querySelector('#pause')!.addEventListener('click', () => {
    if (m.phase === 'over' || m.paused) return;
    m.paused = true;
    const ov = document.createElement('div');
    ov.className = 'pause-overlay';
    ov.innerHTML = `<div class="panel"><h2>Paused</h2>
      <button class="btn primary" id="resume">${icon('play', 22)} Resume</button>
      <button class="btn" id="pfx">${icon(save.reduceFx ? 'even' : 'fire', 20)} Effects: ${save.reduceFx ? 'reduced' : 'full'}</button>
      <button class="btn ghost" id="quit">${icon('cross', 20)} Quit</button></div>`;
    el.appendChild(ov);
    ov.querySelector('#resume')!.addEventListener('click', () => { m.paused = false; ov.remove(); });
    ov.querySelector('#pfx')!.addEventListener('click', (e) => {
      save.reduceFx = !save.reduceFx; persist(save);
      m.setReduceFx(!!save.reduceFx);
      (e.currentTarget as HTMLElement).innerHTML = `${icon(save.reduceFx ? 'even' : 'fire', 20)} Effects: ${save.reduceFx ? 'reduced' : 'full'}`;
    });
    ov.querySelector('#quit')!.addEventListener('click', () => {
      if (opts.tutorial) { save.tutorialDone = true; }
      persist(save);
      leagueScreen();
    });
  });
}

function tutorialScreen() {
  const el = mount(matchHud('TUT', RIVALS[0].color), 'match-screen');
  bindMatch(el, null, { tier: 0, tutorial: TUTORIAL, kits: TUTORIAL_KITS, hints: true, reduceFx: save.reduceFx });
}

function matchScreen(rival: RivalTeam) {
  if (!save.tutorialDone) { tutorialScreen(); return; }
  const el = mount(matchHud(rival.name.slice(0, 3).toUpperCase(), rival.color), 'match-screen');
  bindMatch(el, rival, { tier: rival.tier, hints: save.duelsSeen < 6, reduceFx: save.reduceFx, coach: { att: !save.coachedAtt, def: !save.coachedDef } });
}

function resultScreen(rival: RivalTeam, r: MatchResult) {
  const rewards: Rewards = applyResult(save, rival, r);
  persist(save);
  if (r.won) sfx.levelUp(); else sfx.bad();
  const el = mount(`
    <div class="result ${r.won ? 'won' : 'lost'}">
      <h1>${r.won ? 'VICTORY' : 'DEFEAT'}</h1>
      <div class="final"><span>${markHTML('home')} ${USER_TEAM.short}</span><b>${r.score[0]} - ${r.score[1]}</b><span>${esc(rival.name.slice(0, 3).toUpperCase())} ${markHTML('away')}</span></div>
      <div class="reward">${icon('coin', 24)} +${rewards.coins}</div>
      ${rewards.learned.length ? `<div class="learned-list">${learnedHTML(rewards.learned)}</div>` : ''}
      ${rewards.unlocked ? `<div class="unlock">${icon('lock', 20)} <b>${esc(rewards.unlocked.name)}</b> unlocked</div>` : ''}
      ${r.won && RIVALS.indexOf(rival) === RIVALS.length - 1 ? `<div class="unlock">${icon('trophy', 22)} Champions</div>` : ''}
      <div class="reports">${rewards.reports.map((rep) => {
        const line = r.lines[rep.player.uid];
        return `<div class="rep ${rep.levels ? 'lvl' : ''}">${avatarHTML(rep.player, HOME_KIT, 40)}
          <div><b>${esc(rep.player.name)}</b> <small>Lv ${rep.player.level}</small>
          <small>${line ? `${line.pts} pts - ` : ''}+${rep.xp} XP</small>
          ${rep.levels ? `<small class="up">${icon('up', 14)} LEVEL UP ${rep.stats.map((s) => `${STAT_LABEL[s]}+1`).join(' ')}</small>` : ''}</div></div>`;
      }).join('')}</div>
      <div class="menu row">
        <button class="btn primary" data-go="league">${icon('play', 20)} Next</button>
        <button class="btn sq" data-go="team" aria-label="Team">${icon('team', 24)}</button>
        <button class="btn sq" data-go="scout" aria-label="Scout">${icon('scout', 24)}</button>
      </div>
    </div>`, 'result-screen');
  if (r.won) confetti(el);
}

function confetti(el: HTMLElement) {
  const cols = ['#ff7a1a', '#ffd166', '#3ddc97', '#4cc9f0', '#f72585'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = cols[i % cols.length];
    c.style.animationDelay = `${Math.random() * 0.8}s`;
    c.style.animationDuration = `${1.8 + Math.random() * 1.5}s`;
    c.style.animationTimingFunction = `steps(${24 + Math.floor(Math.random() * 12)})`;
    el.appendChild(c);
  }
}

const routes: Record<string, () => void> = {
  title: titleScreen,
  league: leagueScreen,
  team: () => teamScreen(),
  scout: () => scoutScreen(),
  how: howScreen,
};

/** Title animation: a home player dribbling, an away player in a defensive stance. */
let titleRaf = 0;
function titleSprites(c: HTMLCanvasElement, rival: RivalTeam) {
  cancelAnimationFrame(titleRaf);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const me = lookOf(save.roster[0], HOME_KIT);
  const them = lookOf(mirrorPlayers(rival, save.roster)[0], awayKit(rival));
  const t0 = performance.now();
  const frame = (now: number) => {
    if (!c.isConnected) return;
    const t = (now - t0) / 1000;
    g.clearRect(0, 0, c.width, c.height);
    drawPlayer(g, me, tagFrame('Dribble_1', t, true), 30 - FEET.x, 54 - FEET.y, false, true);
    drawPlayer(g, them, tagFrame('Idle_2', t, true), 90 - FEET.x, 54 - FEET.y, true, false);
    titleRaf = requestAnimationFrame(frame);
  };
  titleRaf = requestAnimationFrame(frame);
}

// Tiny hook for automated smoke tests.
(window as unknown as { __turnball: unknown }).__turnball = {
  get match() { return match; },
  save,
  play: (i: number) => matchScreen(RIVALS[i]),
  tutorial: () => tutorialScreen(),
};

app.innerHTML = '<div class="screen boot"><p>LOADING...</p></div>';
Promise.all([loadAtlas(), initIcons(), document.fonts?.load('700 16px "Pixelify Sans"').catch(() => null)])
  .then(() => titleScreen())
  .catch((err) => {
    app.innerHTML = '<div class="screen boot"><p>Could not load the game art. Reload to try again.</p></div>';
    console.error(err);
  });
