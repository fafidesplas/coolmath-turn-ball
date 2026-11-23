import './style.css';
import { setSound, sfx, unlockAudio } from './audio';
import {
  RIVALS, STATS, STAT_LABEL, STAT_NAME, TECHNIQUES, TECH_LEVELS, TEMPLATES, USER_TEAM, playerPower, rivalPlayers, xpForLevel, MAX_LEVEL,
  type Player, type RivalTeam,
} from './data';
import { DecisionUI } from './decisionui';
import { applyResult, loadSave, persist, rollScout, ROSTER_MAX, SCOUT_REFRESH_COST, sign, type Rewards } from './game';
import { icon } from './icons';
import { Match, type MatchResult } from './match';

const app = document.getElementById('app')!;
const save = loadSave();
setSound(save.sound);
let match: Match | null = null;
let dui: DecisionUI | null = null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const coinsHTML = () => `<div class="coins">${icon('coin', 20)}<b>${save.coins}</b></div>`;

document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

function avatarHTML(p: Player, color: string, size = 56) {
  return `<div class="avatar" style="--c:${color};--skin:${p.skin};--hair:${p.hair};width:${size}px;height:${size}px">
    <div class="av-head"><div class="av-hair"></div><div class="av-eyes"></div></div>
    <div class="av-num">${p.num}</div></div>`;
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

function techList(p: Player) {
  return `<div class="techs">${p.techs.map((id, i) => {
    const t = TECHNIQUES[id];
    const known = p.known.includes(id);
    return `<span class="tech ${known ? 'known' : 'locked'}" title="${t.desc} - ${t.cost} energy">${icon(known ? t.action : 'lock', 16)}${icon('star', 12)} +${t.bonus}${t.pierce ? ' P' : ''}${known ? ` <small>${t.cost}</small>` : ` <small>Lv${TECH_LEVELS[i]}</small>`}</span>`;
  }).join('')}</div>`;
}

// ---------------- screens ----------------
function titleScreen() {
  const next = RIVALS[Math.min(save.beaten, RIVALS.length - 1)];
  const el = mount(`
    <div class="title-wrap">
      <div class="logo"><span class="l1">TURN</span><span class="ball">${icon('ball', 64)}</span><span class="l2">BALL</span></div>
      <p class="tagline">3x3 street hoops. Every clash is a choice.</p>
      <div class="menu">
        <button class="btn big primary" data-go="league">${icon('play', 26)} PLAY</button>
        <div class="menu-row">
          <button class="btn sq" data-go="team" aria-label="My team">${icon('team', 28)}<small>Team</small></button>
          <button class="btn sq" data-go="scout" aria-label="Scout">${icon('scout', 28)}<small>Scout</small></button>
          <button class="btn sq" data-go="how" aria-label="How to play">${icon('help', 28)}<small>Help</small></button>
          <button class="btn sq" id="snd" aria-label="Sound">${icon(save.sound ? 'soundOn' : 'soundOff', 28)}<small>Sound</small></button>
        </div>
      </div>
      <div class="title-foot">
        ${coinsHTML()}
        <div class="progress">${save.beaten >= RIVALS.length ? `${icon('trophy', 18)} Champions` : `Next: <b style="color:${next.color}">${esc(next.name)}</b>`}</div>
      </div>
    </div>`, 'title');
  el.querySelector('#snd')!.addEventListener('click', () => {
    save.sound = !save.sound; setSound(save.sound); persist(save); titleScreen();
  });
}

function leagueScreen() {
  const myPow = Math.round(save.roster.slice(0, 3).reduce((a, p) => a + playerPower(p), 0) / 3 * 10) / 10;
  const el = mount(`${topBar('Sunset League')}
    <div class="league">${RIVALS.map((r, i) => {
      const locked = i > save.beaten;
      const rec = save.record[r.id];
      const beaten = i < save.beaten;
      const pw = Math.round(rivalPlayers(r).reduce((a, p) => a + playerPower(p), 0) / 3 * 10) / 10;
      return `<div class="rival ${locked ? 'locked' : ''} ${beaten ? 'beaten' : ''}" style="--c:${r.color};--a:${r.accent}">
        <div class="r-badge">${locked ? icon('lock', 22) : beaten ? icon('check', 24) : `<b>${i + 1}</b>`}</div>
        <div class="r-info"><b>${esc(r.name)}</b>
          <span class="pow"><i style="width:${pw * 10}%"></i><em>${pw}</em></span>
          ${rec ? `<small>W${rec.w} L${rec.l}</small>` : ''}</div>
        <button class="btn small ${locked ? 'ghost' : 'primary'} icon-btn" data-rival="${i}" ${locked ? 'disabled' : ''} aria-label="Play">${icon(locked ? 'lock' : 'play', 22)}</button>
      </div>`;
    }).join('')}</div>
    <div class="mypow">${save.roster.slice(0, 3).map((p) => avatarHTML(p, USER_TEAM.color, 40)).join('')}<span class="pow"><i style="width:${myPow * 10}%"></i><em>${myPow}</em></span></div>`, 'league-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-rival]').forEach((b) =>
    b.addEventListener('click', () => { sfx.tap(); matchScreen(RIVALS[+b.dataset.rival!]); }));
}

function teamScreen(msg = '') {
  const el = mount(`${topBar('My Team')}
    ${msg ? `<p class="sub"><b class="msg">${esc(msg)}</b></p>` : ''}
    <div class="roster">${save.roster.map((p, i) => `
      <div class="pcard ${i < 3 ? 'starter' : 'bench'}">
        <div class="pc-head">${avatarHTML(p, USER_TEAM.color, 52)}
          <div class="pc-name"><b>${esc(p.name)}</b><small>${i < 3 ? 'STARTER' : 'BENCH'} - Lv ${p.level}${p.level >= MAX_LEVEL ? ' MAX' : ''}</small>
            <div class="xpbar"><i style="width:${p.level >= MAX_LEVEL ? 100 : (p.xp / xpForLevel(p.level)) * 100}%"></i></div></div></div>
        ${statBars(p)}
        ${techList(p)}
        <div class="pc-actions">
          ${i > 0 ? `<button class="btn small icon-btn" data-up="${i}" aria-label="Move up">${icon('up', 20)}</button>` : ''}
          ${save.roster.length > 3 ? `<button class="btn small ghost" data-release="${i}">Release</button>` : ''}
        </div>
      </div>`).join('')}</div>`, 'team-screen');
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

function scoutScreen(msg = '') {
  const el = mount(`${topBar('Scouting')}
    ${msg ? `<p class="sub"><b class="msg">${esc(msg)}</b></p>` : ''}
    <div class="roster">${save.scout.map((id) => {
      const t = TEMPLATES.find((x) => x.id === id)!;
      const fake: Player = { uid: '', tid: t.id, name: t.name, num: t.num, tag: t.tag, hair: t.hair, skin: t.skin, stats: t.stats, growth: t.growth, techs: t.techs, level: 1, xp: 0, known: [t.techs[0]] };
      return `<div class="pcard">
        <div class="pc-head">${avatarHTML(fake, '#8d99ae', 52)}<div class="pc-name"><b>${esc(t.name)}</b><small>Power ${playerPower(fake)}</small></div></div>
        ${statBars(fake)}${techList(fake)}
        <div class="pc-actions"><button class="btn small primary" data-sign="${id}" ${save.coins < t.price || save.roster.length >= ROSTER_MAX ? 'disabled' : ''}>Sign ${icon('coin', 18)} ${t.price}</button></div>
      </div>`;
    }).join('') || '<p class="sub">Nobody left to scout.</p>'}</div>
    <div class="center"><button class="btn" id="reroll" ${save.coins < SCOUT_REFRESH_COST ? 'disabled' : ''}>${icon('scout', 20)} New ${icon('coin', 18)} ${SCOUT_REFRESH_COST}</button></div>`, 'scout-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-sign]').forEach((b) => b.addEventListener('click', () => {
    const err = sign(save, b.dataset.sign!);
    if (err) { sfx.bad(); scoutScreen(err); return; }
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
      ${card(icon('move', 34), 'Move', 'Tap or drag on the court. Keys: WASD / arrows.')}
      ${card(icon('act', 34), 'Clash', 'Touch the ball handler, or press the big button, to stop the play.')}
      ${card(`${icon('shoot', 26)}${icon('pass', 26)}`, 'Preview', 'Hover or hold an option to see the ghost path and the real odds.')}
      ${card(`<span class="mini-odds"><i class="good"></i><i class="mid"></i><i class="bad"></i></span>`, 'Read the colors', 'Green = good for you. Grey = nothing changes. Red = bad.')}
      ${card(icon('star', 30), 'Special', 'Clashes charge energy. Turn on the star to power up a move.')}
      ${card(icon('hoop', 32), 'Score', '1 point inside the arc, 2 outside. First to 11, or most points at the buzzer.')}
      <div class="center"><button class="btn big primary" data-go="league">${icon('play', 24)} Play</button></div>
    </div>`, 'how-screen');
}

function fmtClock(s: number) {
  const c = Math.ceil(s);
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
}

function matchScreen(rival: RivalTeam) {
  const el = mount(`
    <div class="stage" id="stage"></div>
    <div class="hud">
      <div class="hteam home" style="--c:${USER_TEAM.color}"><span class="hn">${USER_TEAM.short}</span><span class="hs" id="s0">0</span></div>
      <div class="hclock"><div id="clock">2:30</div><div class="shotc" id="shot"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" id="shotring"/></svg><b id="shotn">12</b></div></div>
      <div class="hteam away" style="--c:${rival.color}"><span class="hs" id="s1">0</span><span class="hn">${esc(rival.name.slice(0, 3).toUpperCase())}</span></div>
      <button class="btn small ghost pausebtn icon-btn" id="pause" aria-label="Pause">${icon('pause', 20)}</button>
    </div>
    <div class="banner" id="banner"></div>
    <div class="movehint" id="movehint" ${save.duelsSeen > 2 ? 'hidden' : ''}>${icon('move', 22)}<span>${matchMedia('(pointer: coarse)').matches ? 'Tap to move' : 'Click or WASD'}</span></div>
    <button class="actbtn" id="act" aria-label="Clash">${icon('act', 40)}<small id="actlbl"></small></button>`, 'match-screen');
  const stage = el.querySelector<HTMLElement>('#stage')!;
  const banner = el.querySelector<HTMLElement>('#banner')!;
  const act = el.querySelector<HTMLButtonElement>('#act')!;
  const ring = el.querySelector<SVGCircleElement>('#shotring')!;
  let bannerT = 0;

  dui = new DecisionUI(el, () => match, () => save.duelsSeen < 3);
  const m = new Match(stage, [
    { name: USER_TEAM.name, short: USER_TEAM.short, color: USER_TEAM.color, accent: USER_TEAM.accent, shorts: '#ffffff', players: save.roster.slice(0, 3) },
    { name: rival.name, short: rival.name.slice(0, 3).toUpperCase(), color: rival.color, accent: rival.accent, shorts: '#1d1a2b', players: rivalPlayers(rival) },
  ], rival.tier, {
    decision: (open) => {
      if (open) { save.duelsSeen++; el.querySelector('#movehint')?.setAttribute('hidden', ''); }
      el.classList.toggle('deciding', open);
      dui?.show(open);
    },
    hud: (h) => {
      el.querySelector('#s0')!.textContent = String(h.score[0]);
      el.querySelector('#s1')!.textContent = String(h.score[1]);
      el.querySelector('#clock')!.textContent = h.golden ? 'GOLD' : fmtClock(h.clock);
      el.querySelector('#shotn')!.textContent = String(Math.ceil(h.shotClock));
      ring.style.strokeDashoffset = String(94.2 * (1 - h.shotClock / 12));
      el.querySelector('.shotc')!.classList.toggle('low', h.shotClock <= 4);
      el.querySelector('.home')!.classList.toggle('poss', h.offense === 0);
      el.querySelector('.away')!.classList.toggle('poss', h.offense === 1);
    },
    mode: (mode, can) => {
      act.hidden = mode === 'idle';
      act.disabled = !can;
      act.classList.toggle('def', mode === 'defend');
      el.querySelector('#actlbl')!.textContent = mode === 'defend' ? 'CLASH' : 'PLAY';
    },
    banner: (text, color, sub) => {
      banner.innerHTML = `<div class="bn-main" style="--c:${color}">${esc(text)}</div>${sub ? `<div class="bn-sub">${esc(sub)}</div>` : ''}`;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      clearTimeout(bannerT);
      bannerT = window.setTimeout(() => banner.classList.remove('show'), 1500);
    },
    end: (r) => resultScreen(rival, r),
  });
  match = m;
  act.addEventListener('click', () => m.userAct());

  el.querySelector('#pause')!.addEventListener('click', () => {
    if (m.phase === 'over' || m.paused) return;
    m.paused = true;
    const ov = document.createElement('div');
    ov.className = 'pause-overlay';
    ov.innerHTML = `<div class="panel"><h2>Paused</h2>
      <button class="btn primary" id="resume">${icon('play', 22)} Resume</button>
      <button class="btn ghost" id="quit">${icon('cross', 20)} Quit</button></div>`;
    el.appendChild(ov);
    ov.querySelector('#resume')!.addEventListener('click', () => { m.paused = false; ov.remove(); });
    ov.querySelector('#quit')!.addEventListener('click', () => { persist(save); leagueScreen(); });
  });
}

function resultScreen(rival: RivalTeam, r: MatchResult) {
  const rewards: Rewards = applyResult(save, rival, r);
  persist(save);
  if (r.won) sfx.levelUp(); else sfx.bad();
  const el = mount(`
    <div class="result ${r.won ? 'won' : 'lost'}">
      <h1>${r.won ? 'VICTORY' : 'DEFEAT'}</h1>
      <div class="final"><span style="color:${USER_TEAM.color}">${USER_TEAM.short}</span><b>${r.score[0]} - ${r.score[1]}</b><span style="color:${rival.color}">${esc(rival.name.slice(0, 3).toUpperCase())}</span></div>
      <div class="reward">${icon('coin', 24)} +${rewards.coins}</div>
      ${rewards.unlocked ? `<div class="unlock">${icon('lock', 20)} <b>${esc(rewards.unlocked.name)}</b> unlocked</div>` : ''}
      ${r.won && RIVALS.indexOf(rival) === RIVALS.length - 1 ? `<div class="unlock">${icon('trophy', 22)} Champions</div>` : ''}
      <div class="reports">${rewards.reports.map((rep) => {
        const line = r.lines[rep.player.uid];
        return `<div class="rep ${rep.levels ? 'lvl' : ''}">${avatarHTML(rep.player, USER_TEAM.color, 40)}
          <div><b>${esc(rep.player.name)}</b> <small>Lv ${rep.player.level}</small>
          <small>${line ? `${line.pts} pts - ${line.duelsWon}/${line.duels} clashes - ` : ''}+${rep.xp} XP</small>
          ${rep.levels ? `<small class="up">${icon('up', 14)} LEVEL UP ${rep.stats.map((s) => `${STAT_LABEL[s]}+1`).join(' ')}${rep.techs.length ? ` ${icon('star', 12)} ${rep.techs.map(esc).join(', ')}` : ''}</small>` : ''}</div></div>`;
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

// Tiny hook for automated smoke tests.
(window as unknown as { __turnball: unknown }).__turnball = {
  get match() { return match; },
  save,
  play: (i: number) => matchScreen(RIVALS[i]),
};

titleScreen();
