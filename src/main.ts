import './style.css';
import { setSound, sfx, unlockAudio } from './audio';
import {
  ACTION_INFO, ATTACK_ACTIONS, DEFEND_ACTIONS, MATRIX, RIVALS, STATS, STAT_LABEL, STAT_NAME, TECHNIQUES, TECH_LEVELS,
  TEMPLATES, USER_TEAM, playerPower, rivalPlayers, xpForLevel, MAX_LEVEL,
  type Player, type RivalTeam,
} from './data';
import { avatarHTML, showDuel } from './duelui';
import { applyResult, loadSave, persist, rollScout, ROSTER_MAX, SCOUT_REFRESH_COST, sign, type Rewards } from './game';
import { Match, MATCH_SECONDS, WIN_SCORE, type MatchResult } from './match';

const app = document.getElementById('app')!;
const save = loadSave();
setSound(save.sound);
let match: Match | null = null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const coinsHTML = () => `<div class="coins">🪙 <b>${save.coins}</b></div>`;

document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

function mount(html: string, cls: string) {
  match?.destroy();
  match = null;
  app.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { sfx.tap(); routes[b.dataset.go!]?.(); }));
  return app.firstElementChild as HTMLElement;
}

function topBar(title: string) {
  return `<div class="topbar"><button class="btn small ghost" data-go="title">◀ Back</button><h2>${title}</h2>${coinsHTML()}</div>`;
}

function statBars(p: Player) {
  return `<div class="statbars">${STATS.map((k) =>
    `<div class="sb" title="${STAT_NAME[k]}"><span>${STAT_LABEL[k]}</span><i><u style="width:${p.stats[k] * 10}%"></u></i><b>${p.stats[k]}</b></div>`).join('')}</div>`;
}

function techList(p: Player) {
  return `<div class="techs">${p.techs.map((id, i) => {
    const t = TECHNIQUES[id];
    const known = p.known.includes(id);
    return `<span class="tech ${known ? 'known' : 'locked'}" title="${t.desc} · ${t.cost} energy">${known ? '★' : '🔒'} ${t.name}${known ? '' : ` <small>Lv${TECH_LEVELS[i]}</small>`}</span>`;
  }).join('')}</div>`;
}

// ---------------- screens ----------------
function titleScreen() {
  const next = RIVALS[Math.min(save.beaten, RIVALS.length - 1)];
  const el = mount(`
    <div class="title-wrap">
      <div class="logo"><span class="l1">TURN</span><span class="ball">🏀</span><span class="l2">BALL</span></div>
      <p class="tagline">3-on-3 street hoops where every collision is a <b>turn-based showdown</b>.</p>
      <div class="menu">
        <button class="btn big primary" data-go="league">▶ PLAY</button>
        <button class="btn" data-go="team">👕 My Team</button>
        <button class="btn" data-go="scout">🔎 Scout Players</button>
        <button class="btn" data-go="how">❓ How to Play</button>
      </div>
      <div class="title-foot">
        ${coinsHTML()}
        <div class="progress">${save.beaten >= RIVALS.length ? '🏆 Champions of the Sunset League!' : `Next rival: <b>${esc(next.name)}</b>`}</div>
        <button class="btn small ghost" id="snd">${save.sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
      </div>
    </div>`, 'title');
  el.querySelector('#snd')!.addEventListener('click', () => {
    save.sound = !save.sound; setSound(save.sound); persist(save); titleScreen();
  });
}

function leagueScreen() {
  const el = mount(`${topBar('Sunset League')}
    <p class="sub">Beat each crew to unlock the next. Wins pay more coins and XP.</p>
    <div class="league">${RIVALS.map((r, i) => {
      const locked = i > save.beaten;
      const rec = save.record[r.id];
      const beaten = i < save.beaten;
      const pw = Math.round(rivalPlayers(r).reduce((a, p) => a + playerPower(p), 0) / 3 * 10) / 10;
      return `<div class="rival ${locked ? 'locked' : ''} ${beaten ? 'beaten' : ''}" style="--c:${r.color};--a:${r.accent}">
        <div class="r-badge">${locked ? '🔒' : beaten ? '✔' : '★'.repeat(1 + Math.floor(r.tier / 2))}</div>
        <div class="r-info"><b>${esc(r.name)}</b><small>${esc(r.motto)}</small>
          <small>Power ${pw}${rec ? ` · W${rec.w} L${rec.l}` : ''}</small></div>
        <button class="btn small ${locked ? 'ghost' : 'primary'}" data-rival="${i}" ${locked ? 'disabled' : ''}>${locked ? 'Locked' : 'Play'}</button>
      </div>`;
    }).join('')}</div>
    <p class="sub">Your power: <b>${Math.round(save.roster.slice(0, 3).reduce((a, p) => a + playerPower(p), 0) / 3 * 10) / 10}</b> · Starters: ${save.roster.slice(0, 3).map((p) => esc(p.name.split(' ')[0])).join(', ')}</p>`, 'league-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-rival]').forEach((b) =>
    b.addEventListener('click', () => { sfx.tap(); matchScreen(RIVALS[+b.dataset.rival!]); }));
}

function teamScreen(msg = '') {
  const el = mount(`${topBar('My Team')}
    <p class="sub">The first three are your starters. Bench players earn a little XP too. ${msg ? `<b class="msg">${esc(msg)}</b>` : ''}</p>
    <div class="roster">${save.roster.map((p, i) => `
      <div class="pcard ${i < 3 ? 'starter' : 'bench'}">
        <div class="pc-head">${avatarHTML(p, USER_TEAM.color, 52)}
          <div class="pc-name"><b>${esc(p.name)}</b><small>${i < 3 ? 'STARTER' : 'BENCH'} · Lv ${p.level}${p.level >= MAX_LEVEL ? ' MAX' : ''}</small>
            <div class="xpbar"><i style="width:${p.level >= MAX_LEVEL ? 100 : (p.xp / xpForLevel(p.level)) * 100}%"></i></div>
            <small class="quote">“${esc(p.tag)}”</small></div></div>
        ${statBars(p)}
        ${techList(p)}
        <div class="pc-actions">
          ${i > 0 ? `<button class="btn small" data-up="${i}">▲ Move up</button>` : ''}
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
    if (!confirm(`Release ${p.name}? They will leave the team.`)) return;
    save.roster.splice(+b.dataset.release!, 1);
    persist(save); teamScreen(`${p.name} waved goodbye.`);
  }));
}

function scoutScreen(msg = '') {
  const el = mount(`${topBar('Scouting')}
    <p class="sub">Sign free agents with coins (roster max ${ROSTER_MAX}). New signings start at Lv 1. ${msg ? `<b class="msg">${esc(msg)}</b>` : ''}</p>
    <div class="roster">${save.scout.map((id) => {
      const t = TEMPLATES.find((x) => x.id === id)!;
      const fake: Player = { uid: '', tid: t.id, name: t.name, num: t.num, tag: t.tag, hair: t.hair, skin: t.skin, stats: t.stats, growth: t.growth, techs: t.techs, level: 1, xp: 0, known: [t.techs[0]] };
      return `<div class="pcard">
        <div class="pc-head">${avatarHTML(fake, '#8d99ae', 52)}<div class="pc-name"><b>${esc(t.name)}</b><small>Power ${playerPower(fake)}</small><small class="quote">“${esc(t.tag)}”</small></div></div>
        ${statBars(fake)}${techList(fake)}
        <div class="pc-actions"><button class="btn small primary" data-sign="${id}" ${save.coins < t.price || save.roster.length >= ROSTER_MAX ? 'disabled' : ''}>Sign · 🪙 ${t.price}</button></div>
      </div>`;
    }).join('') || '<p class="sub">Nobody left to scout. You signed them all!</p>'}</div>
    <div class="center"><button class="btn" id="reroll" ${save.coins < SCOUT_REFRESH_COST ? 'disabled' : ''}>🔄 New prospects · 🪙 ${SCOUT_REFRESH_COST}</button></div>`, 'scout-screen');
  el.querySelectorAll<HTMLButtonElement>('[data-sign]').forEach((b) => b.addEventListener('click', () => {
    const err = sign(save, b.dataset.sign!);
    if (err) { sfx.bad(); scoutScreen(err); return; }
    persist(save); sfx.coin(); scoutScreen('Welcome to the Hoopers! Check My Team to make them a starter.');
  }));
  el.querySelector('#reroll')!.addEventListener('click', () => {
    if (save.coins < SCOUT_REFRESH_COST) return;
    save.coins -= SCOUT_REFRESH_COST; rollScout(save); persist(save); sfx.coin(); scoutScreen();
  });
}

function howScreen() {
  const cell = (v: number) => `<td class="${v >= 3 ? 'w3' : v > 0 ? 'w1' : v <= -3 ? 'l3' : 'l1'}">${v > 0 ? '+' : ''}${v}</td>`;
  mount(`${topBar('How to Play')}
    <div class="how">
      <section><h3>🏀 The game</h3>
        <p>3-on-3 half-court hoops. Inside the arc = <b>1 point</b>, outside = <b>2 points</b>. First to <b>${WIN_SCORE}</b> or most points after <b>${Math.floor(MATCH_SECONDS / 60)}:${String(MATCH_SECONDS % 60).padStart(2, '0')}</b> wins. Tie? <b>Golden basket</b>! You have <b>12 seconds</b> per possession.</p></section>
      <section><h3>🕹️ Controls</h3>
        <p><b>Tap / drag</b> the court to move. <b>Tap a teammate</b> to pass (green lane = safe, red = risky). Buttons below the court to shoot or pass.<br>
        Keyboard: <kbd>WASD</kbd>/<kbd>Arrows</kbd> move · <kbd>Space</kbd> shoot · <kbd>Q</kbd>/<kbd>E</kbd> pass · <kbd>Shift</kbd> switch defender · <kbd>1-4</kbd> duel moves · <kbd>5-6</kbd> techniques.</p></section>
      <section><h3>⚔️ Duels</h3>
        <p>When a defender touches the ball handler, time freezes. You get <b>3 seconds</b> to pick a move. Total = <b>stat edge</b> + <b>matchup</b> + <b>★ technique</b> + <b>luck (-2…+2)</b>. Above 0, the attacker wins; below 0, the defender steals the ball.</p>
        <table class="matrix"><tr><th>Attack ↓ / Defense →</th>${DEFEND_ACTIONS.map((d) => `<th>${ACTION_INFO[d].icon} ${ACTION_INFO[d].label}</th>`).join('')}</tr>
        ${ATTACK_ACTIONS.map((a) => `<tr><th>${ACTION_INFO[a].icon} ${ACTION_INFO[a].label}</th>${DEFEND_ACTIONS.map((d) => cell(MATRIX[a][d])).join('')}</tr>`).join('')}</table>
        <p class="small">Winning a duel: <b>Dribble</b> blows past (defender dazed), <b>Pass</b> finds the open teammate, <b>Shoot</b> scores, <b>Protect</b> keeps the ball and charges energy. <b>Wait</b> also charges energy on defense.</p></section>
      <section><h3>⚡ Energy & ★ Techniques</h3>
        <p>Every duel charges energy (the yellow ring). Spend it on special techniques that add a big bonus — some even <b>pierce</b> counters.</p></section>
      <section><h3>📈 Progress</h3>
        <p>Win matches for coins and XP. Players level up, gain stats and learn new techniques at Lv ${TECH_LEVELS.join(', ')}. Spend coins to <b>scout</b> new players.</p></section>
      <div class="center"><button class="btn big primary" data-go="league">Let's play!</button></div>
    </div>`, 'how-screen');
}

function fmtClock(s: number) {
  const c = Math.ceil(s);
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
}

function matchScreen(rival: RivalTeam) {
  const el = mount(`
    <div class="hud">
      <div class="hteam home" style="--c:${USER_TEAM.color}"><span class="hn">${USER_TEAM.short}</span><span class="hs" id="s0">0</span></div>
      <div class="hclock"><div id="clock">${fmtClock(MATCH_SECONDS)}</div><div class="shotc" id="shot">12</div></div>
      <div class="hteam away" style="--c:${rival.color}"><span class="hs" id="s1">0</span><span class="hn">${esc(rival.name.split(' ')[1] ?? rival.name).slice(0, 8).toUpperCase()}</span></div>
      <button class="btn small ghost pausebtn" id="pause" aria-label="Pause">⏸</button>
    </div>
    <div class="court-wrap"><canvas id="court"></canvas><div class="banner" id="banner"></div></div>
    <div class="controls" id="controls"></div>`, 'match-screen');
  const canvas = el.querySelector<HTMLCanvasElement>('#court')!;
  const banner = el.querySelector<HTMLElement>('#banner')!;
  const controls = el.querySelector<HTMLElement>('#controls')!;
  const wrap = el.querySelector<HTMLElement>('.court-wrap')!;
  let bannerT = 0;
  let ctrlSig = '';

  const m = new Match(canvas, [
    { name: USER_TEAM.name, short: USER_TEAM.short, color: USER_TEAM.color, accent: USER_TEAM.accent, players: save.roster.slice(0, 3) },
    { name: rival.name, short: rival.name.slice(0, 3).toUpperCase(), color: rival.color, accent: rival.accent, players: rivalPlayers(rival) },
  ], rival.tier, {
    duel: (setup) => {
      const legend = save.duelsSeen < 4;
      save.duelsSeen++;
      return showDuel(wrap, setup, legend);
    },
    hud: (h) => {
      el.querySelector('#s0')!.textContent = String(h.score[0]);
      el.querySelector('#s1')!.textContent = String(h.score[1]);
      el.querySelector('#clock')!.textContent = h.golden ? 'GOLDEN' : fmtClock(h.clock);
      const sc = el.querySelector<HTMLElement>('#shot')!;
      sc.textContent = String(Math.ceil(h.shotClock));
      sc.classList.toggle('low', h.shotClock <= 4);
      el.querySelector('.home')!.classList.toggle('poss', h.offense === 0);
      el.querySelector('.away')!.classList.toggle('poss', h.offense === 1);
    },
    controls: (c) => {
      const sig = `${c.mode}|${c.passes.length}`;
      if (sig !== ctrlSig) {
        ctrlSig = sig;
        if (c.mode === 'attack') {
          controls.innerHTML = `
            <button class="btn ctrl shoot" id="cshoot"><span>🏀 SHOOT <kbd>Space</kbd></span><b></b><small></small></button>
            ${c.passes.map((_, i) => `<button class="btn ctrl pass" data-pass="${i}"><span>🎯 PASS <kbd>${i ? 'E' : 'Q'}</kbd></span><b></b><small></small></button>`).join('')}`;
          controls.querySelector('#cshoot')!.addEventListener('click', () => m.userShoot());
          controls.querySelectorAll<HTMLElement>('[data-pass]').forEach((b) => b.addEventListener('click', () => m.userPass(+b.dataset.pass!)));
        } else if (c.mode === 'defend') {
          controls.innerHTML = `<div class="ctrl-hint">🛡️ Defending with <b></b><br><small>Run into the ball handler to start a DUEL</small></div>
            <button class="btn ctrl switch" id="cswitch"><span>🔄 SWITCH <kbd>Shift</kbd></span><small>closest to ball</small></button>`;
          controls.querySelector('#cswitch')!.addEventListener('click', () => m.userSwitch());
        } else {
          controls.innerHTML = `<div class="ctrl-hint dim">…</div>`;
        }
      }
      if (c.mode === 'attack') {
        const sh = controls.querySelector('#cshoot')!;
        sh.querySelector('b')!.textContent = `${c.shootPct}%`;
        sh.querySelector('small')!.textContent = c.isTwo ? '2 PTS' : '1 PT';
        sh.classList.toggle('hot', c.shootPct >= 50);
        controls.querySelectorAll<HTMLElement>('[data-pass]').forEach((b, i) => {
          const p = c.passes[i];
          b.querySelector('b')!.textContent = p.name;
          b.querySelector('small')!.textContent = p.risky ? 'RISKY' : 'OPEN';
          b.classList.toggle('risky', p.risky);
        });
      } else if (c.mode === 'defend') {
        controls.querySelector('.ctrl-hint b')!.textContent = c.controlledName;
      }
    },
    banner: (text, sub, color) => {
      banner.innerHTML = `<div class="bn-main" style="--c:${color ?? '#fff'}">${esc(text)}</div>${sub ? `<div class="bn-sub">${esc(sub)}</div>` : ''}`;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      clearTimeout(bannerT);
      bannerT = window.setTimeout(() => banner.classList.remove('show'), 1600);
    },
    end: (r) => resultScreen(rival, r),
  });
  match = m;

  el.querySelector('#pause')!.addEventListener('click', () => {
    if (m.phase === 'duel' || m.phase === 'over') return;
    m.paused = true;
    const ov = document.createElement('div');
    ov.className = 'pause-overlay';
    ov.innerHTML = `<div class="panel"><h2>Paused</h2>
      <button class="btn primary" id="resume">▶ Resume</button>
      <button class="btn ghost" id="quit">Quit match (no rewards)</button></div>`;
    wrap.appendChild(ov);
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
      <h1>${r.won ? 'VICTORY!' : 'NICE TRY!'}</h1>
      <div class="final"><span>${USER_TEAM.name}</span><b>${r.score[0]} – ${r.score[1]}</b><span>${esc(rival.name)}</span></div>
      <div class="reward">🪙 +${rewards.coins} coins</div>
      ${rewards.unlocked ? `<div class="unlock">🔓 New rival unlocked: <b>${esc(rewards.unlocked.name)}</b></div>` : ''}
      ${r.won && RIVALS.indexOf(rival) === RIVALS.length - 1 ? '<div class="unlock">🏆 You beat the Midnight Meteors! Champions!</div>' : ''}
      <div class="reports">${rewards.reports.map((rep) => {
        const line = r.lines[rep.player.uid];
        return `<div class="rep ${rep.levels ? 'lvl' : ''}">${avatarHTML(rep.player, USER_TEAM.color, 40)}
          <div><b>${esc(rep.player.name)}</b> <small>Lv ${rep.player.level}</small>
          <small>${line ? `${line.pts} pts · ${line.duelsWon}/${line.duels} duels won · ` : 'Bench · '}+${rep.xp} XP</small>
          ${rep.levels ? `<small class="up">⬆ LEVEL UP! ${rep.stats.map((s) => `${STAT_LABEL[s]}+1`).join(' ')}${rep.techs.length ? ` · New technique: ★ ${rep.techs.map(esc).join(', ')}` : ''}</small>` : ''}</div></div>`;
      }).join('')}</div>
      <div class="menu row">
        <button class="btn primary" data-go="league">Continue</button>
        <button class="btn" data-go="team">My Team</button>
        <button class="btn" data-go="scout">Scout</button>
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

// Expose a tiny hook for automated smoke tests.
(window as unknown as { __turnball: unknown }).__turnball = { get match() { return match; }, save };

titleScreen();
