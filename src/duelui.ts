// Turn-based duel overlay: 3-second decision, then an animated, readable breakdown.
import { sfx } from './audio';
import {
  ACTION_INFO, ATTACK_ACTIONS, DEFEND_ACTIONS, TECHNIQUES, type Action, type AttackAction, type DefendAction, type Player,
} from './data';
import { resolveDuel, techsFor, type Choice, type DuelResult } from './duel';
import type { DuelSetup } from './match';

export const DECISION_SECONDS = 3;

export function avatarHTML(p: Player, color: string, size = 56) {
  return `<div class="avatar" style="--c:${color};--skin:${p.skin};--hair:${p.hair};width:${size}px;height:${size}px">
    <div class="av-head"><div class="av-hair"></div><div class="av-eyes"></div></div>
    <div class="av-num">${p.num}</div></div>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function showDuel(root: HTMLElement, setup: DuelSetup, showLegend: boolean): Promise<DuelResult> {
  return new Promise((resolve) => {
    const { ctx, userSide } = setup;
    const me = userSide === 'att' ? ctx.att : ctx.def;
    const them = userSide === 'att' ? ctx.def : ctx.att;
    const myColor = userSide === 'att' ? setup.attColor : setup.defColor;
    const theirColor = userSide === 'att' ? setup.defColor : setup.attColor;
    const actions: Action[] = userSide === 'att' ? ATTACK_ACTIONS : DEFEND_ACTIONS;
    const persp = userSide === 'att' ? 1 : -1;

    const el = document.createElement('div');
    el.className = 'duel-overlay';
    const techBtns = actions.flatMap((a) => techsFor(me.player, a, me.energy)).map(({ tech, ok }, i) =>
      `<button class="tech-btn" data-tech="${tech.id}" ${ok ? '' : 'disabled'}>
        <b>★ ${esc(tech.name)}</b><span>${tech.desc}</span><em>${tech.cost}⚡ ${i < 2 ? `<kbd>${i + 5}</kbd>` : ''}</em>
      </button>`).join('');
    const statLine = (p: Player, list: Action[]) => list.map((a) => {
      const st = ACTION_INFO[a].stat;
      return `<span>${st.toUpperCase()} ${p.stats[st]}</span>`;
    }).join('');
    el.innerHTML = `
      <div class="duel-box ${userSide}">
        <div class="duel-title">${userSide === 'att' ? 'DUEL! You have the ball' : 'DUEL! Stop the ball handler'}</div>
        <div class="duel-top">
          <div class="duel-card me">
            ${avatarHTML(me.player, myColor, 54)}
            <div class="dc-info"><div class="dc-tag">YOU · ${userSide === 'att' ? 'ATTACK' : 'DEFENSE'}</div>
              <div class="dc-name">${esc(me.player.name)}</div>
              <div class="dc-energy"><i style="width:${me.energy}%"></i><b>${Math.round(me.energy)}⚡</b></div></div>
          </div>
          <div class="duel-vs">VS</div>
          <div class="duel-card them">
            ${avatarHTML(them.player, theirColor, 54)}
            <div class="dc-info"><div class="dc-tag">RIVAL · Lv ${them.player.level}</div>
              <div class="dc-name">${esc(them.player.name)}</div>
              <div class="dc-stats">${statLine(them.player, userSide === 'att' ? DEFEND_ACTIONS.slice(0, 3) : ATTACK_ACTIONS.slice(0, 3))}</div></div>
          </div>
        </div>
        <div class="duel-timer"><i></i></div>
        <div class="duel-choose">
          ${showLegend ? `<div class="duel-legend">Every move <b>beats</b> one move and is <b>weak</b> to another. Your stat, ★ techniques and a little luck tilt the result.</div>` : ''}
          <div class="duel-actions">
            ${actions.map((a, i) => {
              const info = ACTION_INFO[a];
              return `<button class="act-btn" data-act="${a}" style="--ac:${info.color}">
                <span class="ab-icon">${info.icon}</span>
                <span class="ab-label">${info.label} <kbd>${i + 1}</kbd></span>
                <span class="ab-stat">${info.stat.toUpperCase()} ${me.player.stats[info.stat]}</span>
                <span class="ab-hint">Beats ${ACTION_INFO[info.beats].label} · Weak to ${ACTION_INFO[info.weak].label}</span>
              </button>`;
            }).join('')}
          </div>
          ${techBtns ? `<div class="duel-techs">${techBtns}</div>` : ''}
        </div>
        <div class="duel-reveal" hidden>
          <div class="reveal-moves">
            <div class="rm me"><span class="rm-icon"></span><span class="rm-label"></span></div>
            <div class="rm-clash">💥</div>
            <div class="rm them"><span class="rm-icon"></span><span class="rm-label"></span></div>
          </div>
          <ul class="reveal-lines"></ul>
          <div class="reveal-total"></div>
          <button class="reveal-go">Continue ▶</button>
        </div>
      </div>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const bar = el.querySelector<HTMLElement>('.duel-timer i')!;
    const start = performance.now();
    let chosen = false;
    let lastSec = DECISION_SECONDS;
    let raf = 0;

    const tick = () => {
      if (chosen) return;
      const t = (performance.now() - start) / 1000;
      const left = Math.max(0, DECISION_SECONDS - t);
      bar.style.width = `${(left / DECISION_SECONDS) * 100}%`;
      bar.classList.toggle('hurry', left < 1.2);
      if (Math.ceil(left) < lastSec) { lastSec = Math.ceil(left); sfx.tick(); }
      if (left <= 0) {
        pick({ action: userSide === 'att' ? 'protect' : 'wait', auto: true });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onKey = (e: KeyboardEvent) => {
      if (chosen) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish(); }
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) pick({ action: actions[n - 1] });
      if (n >= 5) {
        const b = el.querySelectorAll<HTMLButtonElement>('.tech-btn')[n - 5];
        if (b && !b.disabled) b.click();
      }
    };
    window.addEventListener('keydown', onKey);

    el.querySelectorAll<HTMLButtonElement>('.act-btn').forEach((b) =>
      b.addEventListener('click', () => pick({ action: b.dataset.act as Action })));
    el.querySelectorAll<HTMLButtonElement>('.tech-btn').forEach((b) =>
      b.addEventListener('click', () => {
        const tech = TECHNIQUES[b.dataset.tech!];
        pick({ action: tech.action, tech });
      }));

    let result: DuelResult;
    let done = false;
    let autoT = 0;

    function pick(c: Choice) {
      if (chosen) return;
      chosen = true;
      cancelAnimationFrame(raf);
      sfx.tap();
      const att = (userSide === 'att' ? c : setup.ai) as Choice<AttackAction>;
      const def = (userSide === 'att' ? setup.ai : c) as Choice<DefendAction>;
      result = resolveDuel(ctx, att, def);
      reveal(c, setup.ai);
    }

    function reveal(mine: Choice, theirs: Choice) {
      el.querySelector<HTMLElement>('.duel-choose')!.hidden = true;
      el.querySelector<HTMLElement>('.duel-timer')!.style.visibility = 'hidden';
      const rv = el.querySelector<HTMLElement>('.duel-reveal')!;
      rv.hidden = false;
      const setMove = (sel: string, c: Choice) => {
        const info = ACTION_INFO[c.action];
        rv.querySelector(`${sel} .rm-icon`)!.textContent = info.icon;
        rv.querySelector(`${sel} .rm-label`)!.textContent = c.tech ? `★ ${c.tech.name}` : info.label + (c.auto ? ' (auto)' : '');
        (rv.querySelector(sel) as HTMLElement).style.setProperty('--ac', info.color);
      };
      setMove('.rm.me', mine);
      setMove('.rm.them', theirs);
      sfx.clash();
      const ul = rv.querySelector('.reveal-lines')!;
      result.lines.forEach((l, i) => {
        const v = l.value * persp;
        const li = document.createElement('li');
        li.className = `rl ${l.kind} ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero'}`;
        const label = l.kind === 'luck' ? `🎲 Luck (${result.dice.map((d) => (d > 0 ? '+' + d : d)).join(', ')})` : l.label;
        li.innerHTML = `<span>${esc(label)}</span><b>${v > 0 ? '+' : ''}${v}</b>`;
        li.style.animationDelay = `${0.15 + i * 0.16}s`;
        ul.appendChild(li);
      });
      const total = result.total * persp;
      const userWin = total > 0, tie = total === 0;
      const tot = rv.querySelector<HTMLElement>('.reveal-total')!;
      tot.style.animationDelay = `${0.2 + result.lines.length * 0.16}s`;
      tot.className = `reveal-total ${userWin ? 'win' : tie ? 'tie' : 'lose'}`;
      tot.innerHTML = `<div class="rt-sum">Total ${total > 0 ? '+' : ''}${total}</div>
        <div class="rt-head">${result.headline}</div>
        <div class="rt-sub">${userWin ? 'You win the duel!' : tie ? 'Nobody wins — reset!' : 'They win the duel!'}</div>`;
      setTimeout(() => { if (!done) (userWin ? sfx.good : tie ? sfx.tick : sfx.bad)(); }, (0.2 + result.lines.length * 0.16) * 1000);
      rv.querySelector('.reveal-go')!.addEventListener('click', finish);
      autoT = window.setTimeout(finish, 1000 + result.lines.length * 160 + 1500);
    }

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(autoT);
      window.removeEventListener('keydown', onKey);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 180);
      resolve(result);
    }
  });
}
