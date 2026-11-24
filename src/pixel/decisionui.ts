// Pixel decision panel, built so every turn reads in plain words.
// Top line: what is going on (who has the ball, where, who is open; on defense, what they like to do).
// Attack: four move types (Shoot / Dribble / Pass / Play). A type opens one row per move: icon, name,
// what it does, reward and risk as icon pips (arrows and warning triangles, never color alone) and the
// main chance. Dribbles, passes and plays then pick a target (also tappable on the court). The dunk is
// always listed on Shoot: when it is out of reach the row says why.
// Defense: the seven defensive moves are the buttons themselves; the selected one explains what it
// stops, what beats it and how it does against the attack's most likely move.
// Selecting an option previews it on the court and shows a card; selecting it again or GO confirms.
// The first attack and the first defense possession have a step-by-step coach.
// Keys: S P D C move types, Q W E R T Y rows, digits for targets (defense: 1-7), Enter, Esc.
import { sfx } from '../audio';
import { icon } from './pxicons';
import type { ActKind } from '../rules';
import { KIND_LABEL, type DecisionInfo, type Match, type OptionInfo } from './match';
import { TECHS } from '../techs';
import { SPECIALS, type SpecialId } from '../specials';

const KINDS: ActKind[] = ['shoot', 'drive', 'pass', 'cut'];
const KEY_KIND: Record<string, ActKind> = { s: 'shoot', p: 'pass', d: 'drive', c: 'cut' };
const VAR_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'];
const KIND_ICON: Record<ActKind, string> = { shoot: 'shoot', pass: 'pass', drive: 'dribble', cut: 'cut' };
const KIND_KEY: Record<ActKind, string> = { shoot: 'S', pass: 'P', drive: 'D', cut: 'C' };
/** Shots in menu order: the dunk first, then closest to farthest. */
const SHOT_ORDER = ['dunk', 'layup', 'floater', 'jumper', 'bank', 'fade'];
const grp = (o: OptionInfo) => o.group ?? o.tech;

/** Reward (arrows) and risk (warning triangles) as three icon slots each, with a word. */
function pips(o: OptionInfo) {
  if (!o.reward) return '';
  const row = (n: number, ic: string, cls: string, word: string) =>
    `<span class="pp ${cls}" title="${word}"><small>${word}</small>${[1, 2, 3].map((k) => `<i class="${k <= n ? 'on' : ''}">${icon(ic, 16)}</i>`).join('')}</span>`;
  return `<span class="pps">${row(o.reward, 'up', 'rw', 'GAIN')}${row(o.risk ?? 1, 'warn', 'rk', 'RISK')}</span>`;
}

export class DecisionUI {
  el: HTMLElement;
  private opts: OptionInfo[] = [];
  private cat: string | null = null;
  /** Selected group inside the category (a technique id or a special id). */
  private tech: string | null = null;
  private sel: string | null = null;
  private open = false;
  /** Coach step (first attack / first defense possession). */
  private coachStep = 0;

  constructor(root: HTMLElement, private match: () => Match | null) {
    this.el = document.createElement('div');
    this.el.className = 'decision';
    this.el.hidden = true;
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('pointerover', this.onOver);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  show(on: boolean) {
    this.open = on;
    this.sel = null;
    this.cat = null;
    this.tech = null;
    this.coachStep = 0;
    this.el.hidden = !on;
    const m = this.match();
    if (m) m.onPick = (x, y) => this.pickFromWorld(x, y);
    if (on) this.render();
  }

  /** Groups available in a category, in a stable order. */
  private groupsIn(cat: string): string[] {
    const out: string[] = [];
    for (const o of this.opts) if (o.kind === cat && !out.includes(grp(o))) out.push(grp(o));
    const rank = (g: string) => {
      if (g in SPECIALS) return 100;
      if (cat === 'shoot') { const i = SHOT_ORDER.indexOf(g); return i < 0 ? 50 : i; }
      return TECHS[g as keyof typeof TECHS]?.base ? 0 : 1;
    };
    return out.sort((a, b) => rank(a) - rank(b));
  }

  private coachHTML(info: DecisionInfo): string {
    if (!info.coach) return '';
    const att = info.side === 'att';
    const steps = att
      ? [
        ['1/3', 'Your turn on attack. The player in the yellow ring has the ball. Pick a move type below: SHOOT, DRIBBLE, PASS or PLAY.', 'opts'],
        ['2/3', 'Each row says what the move does. Arrows = how much you gain, triangles = how risky it is. Tap a row to see it on the court.', 'mid'],
        ['3/3', 'Like it? Tap GO (or the same row again). The defense picks its move at the same time, without seeing yours.', 'go'],
      ]
      : [
        ['1/3', 'Now you defend. The top line says who has the ball and what they like to do.', 'sit'],
        ['2/3', 'Pick one of the 7 defensive moves below. Each one stops some moves and loses to others.', 'opts'],
        ['3/3', 'The card says what it stops, what beats it, and how it does against their likely move. Tap GO.', 'go'],
      ];
    const [n, text, where] = steps[Math.min(this.coachStep, steps.length - 1)];
    this.el.dataset.coach = where;
    const next = !att && this.coachStep === 0 ? `<button class="btn small" data-coach-next>${icon('check', 16)} Got it</button>` : '';
    return `<div class="d-coach"><b>${icon('help', 16)} COACH ${n}</b><span>${text}</span>${next}</div>`;
  }

  private render() {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    this.opts = m.options();
    delete this.el.dataset.coach;
    const leftPips = Array.from({ length: info.maxLeft }, (_, i) => `<i class="${i < info.left ? 'on' : ''}"></i>`).join('');
    const sel = this.opts.find((o) => o.id === this.sel);
    const live = (l: OptionInfo[]) => l.filter((o) => !o.disabled);
    let card = '';
    if (sel) {
      const lines = info.side === 'def'
        ? `<span class="w">${icon(TECHS[sel.tech].icon, 16)}<b>${sel.label}:</b> ${sel.what ?? ''}</span>
           <span class="g">${icon('check', 16)}${sel.card.gain}</span>
           <span class="r">${icon('cross', 16)}${sel.card.risk}</span>
           ${sel.vsTop ? `<span class="c">${icon('scout', 16)}${sel.vsTop}</span>` : ''}`
        : `<span class="w">${icon(sel.sp ? 'fire' : TECHS[sel.tech].icon, 16)}<b>${sel.label}${sel.tag ? ` - ${sel.tag}` : ''}</b></span>
           <span class="g">${icon('up', 16)}${sel.card.gain}</span>
           <span class="r">${icon('warn', 16)}${sel.card.risk}</span>
           <span class="c">${icon('next', 16)}${sel.card.change}</span>`;
      card = `<div class="d-card ${sel.sp ? 'special' : ''}"><div class="lines">${lines}</div>
        <button class="go" data-confirm>${sel.sp ? `${icon('fire', 16)} GO` : 'GO'}</button></div>`;
    }
    let vars = '';
    let subs = '';
    if (info.side === 'att' && this.cat) {
      const groups = this.groupsIn(this.cat);
      const direct = this.cat === 'shoot';
      vars = `<div class="d-vars">${groups.map((g, i) => {
        const list = this.opts.filter((o) => o.kind === this.cat && grp(o) === g);
        const l = live(list);
        const lock = list.find((o) => o.locked);
        const best = l.reduce((a, o) => Math.max(a, o.main), 0);
        const top = l.slice().sort((a, b) => b.main - a.main)[0] ?? list[0];
        const opt = direct ? list[0] : undefined;
        const isSel = direct ? this.sel === opt?.id : this.tech === g;
        const sp = g in SPECIALS ? SPECIALS[g as SpecialId] : null;
        const T = sp ? null : TECHS[g as keyof typeof TECHS];
        const name = sp ? sp.name : direct && opt ? opt.label : T!.name;
        const line = lock ? lock.locked! : sp ? sp.line : top?.what ?? T!.line;
        const ic = lock ? icon('lock', 20) : sp ? icon('fire', 20) : icon(g === 'jumper' && opt?.label === 'Three' ? 't_three' : T!.icon, 20);
        const dunk = g === 'dunk' && !lock;
        return `<button class="var ${sp ? 'special' : ''} ${dunk ? 'dunk' : ''} ${lock ? 'locked' : ''} ${isSel ? 'sel' : ''} ${list.some((o) => o.hint) ? 'hint' : ''}" ${direct ? `data-opt="${opt?.id}"` : `data-tech="${g}"`} ${l.length ? '' : 'disabled'}>
          <span class="vi">${ic}</span><b class="vn">${name}${sp ? '<em class="firetag">FIRE</em>' : ''}${dunk ? '<em class="firetag">SLAM</em>' : ''}</b><span class="vl">${line}</span>
          ${l.length ? `${pips(top)}<b class="vp">${direct ? `${best}%` : `${best}%`}</b>` : ''}<kbd>${VAR_KEYS[i]?.toUpperCase() ?? ''}</kbd></button>`;
      }).join('')}</div>`;
      if (!direct && this.tech) {
        const list = this.opts.filter((o) => o.kind === this.cat && grp(o) === this.tech);
        subs = `<div class="d-subs"><small class="d-pick">${icon('next', 16)} Where? Tap a target (or the ring on the court):</small>${list.map((o, i) => `
          <button class="sub ${o.sp ? 'special' : ''} ${o.id === this.sel ? 'sel' : ''} ${o.hint ? 'hint' : ''}" data-opt="${o.id}" ${o.disabled ? 'disabled' : ''}>
            <span class="st">${o.tag ?? ''}</span><b>${o.main}%</b><kbd>${i + 1}</kbd></button>`).join('')}</div>`;
      }
    }
    let main: string;
    if (info.side === 'att') {
      main = KINDS.map((k) => {
        const list = this.opts.filter((o) => o.kind === k);
        const l = live(list);
        const hasSp = l.some((o) => o.sp);
        const dunk = k === 'shoot' && l.some((o) => o.tech === 'dunk');
        const what = k === 'shoot' ? 'End it: score' : k === 'drive' ? 'Beat your man' : k === 'pass' ? 'Move the ball' : 'Run a play';
        return `<button class="opt ${k} ${this.cat === k ? 'sel' : ''} ${list.some((o) => o.hint) ? 'hint' : ''} ${hasSp ? 'has-sp' : ''} ${dunk ? 'has-dunk' : ''}" data-kind="${k}" ${l.length ? '' : 'disabled'}>
          ${hasSp ? `<span class="spb" title="Special available">${icon('fire', 16)}</span>` : ''}
          ${dunk ? '<span class="dkb">DUNK</span>' : ''}
          <span class="oi">${icon(KIND_ICON[k], 32)}</span>
          <b class="kn">${KIND_LABEL[k]}</b><small>${what}</small><kbd>${KIND_KEY[k]}</kbd>
        </button>`;
      }).join('');
    } else {
      main = this.opts.map((o, i) => {
        const counters = (info.threats ?? []).filter((t) => t.counter === o.kind && o.tech === t.counter).length;
        return `<button class="opt defm ${o.kind} ${this.sel === o.id ? 'sel' : ''} ${counters ? 'counter' : ''}" data-opt="${o.id}">
          <span class="oi">${icon(TECHS[o.tech].icon, 32)}</span>
          <b class="kn">${o.label}</b>${pips(o)}<kbd>${i + 1}</kbd>
        </button>`;
      }).join('');
    }
    const threats = info.threats?.length
      ? `<div class="d-threat">${icon('fire', 16)}<b>Their Fire is full.</b>${info.threats.map((t) =>
        `<span>#${t.num} ${t.name} ${t.pct}%</span>`).join('')}</div>`
      : '';
    this.el.innerHTML = `
      <div class="d-sit ${info.side}">
        <span class="pips ${info.side}" title="Moves left this possession">${leftPips}</span>
        ${info.fire ? `<span class="fire-on">${icon('fire', 16)} FIRE</span>` : ''}
        <span class="sit">${info.situation}</span>
        ${info.threat ? `<span class="thr">${icon('scout', 16)}<b>They like:</b> ${info.threat}</span>` : ''}
      </div>
      ${this.coachHTML(info)}
      ${info.hint ? `<div class="d-hint">${info.hint}</div>` : ''}
      ${threats}
      <div class="d-mid">${vars}${subs}</div>
      ${card}
      <div class="d-opts ${info.side === 'att' ? 'n4' : 'n7'}">${main}</div>`;
    // Keep the GO card in view on small screens (the panel can scroll).
    // With a choice made, show the GO card and the buttons (bottom); otherwise the situation and coach (top).
    this.el.scrollTop = sel ? this.el.scrollHeight : 0;
  }

  private select(id: string | null) {
    if (this.sel === id) return;
    this.sel = id;
    this.match()?.preview(id);
    if (id) this.advanceCoach(this.match()?.decisionInfo()?.side === 'def' ? 2 : 2);
    this.render();
    if (id) sfx.tick();
  }

  private advanceCoach(to: number) { if (this.coachStep < to) this.coachStep = to; }

  /** Default group when a category opens: the hinted one, else the dunk or base technique, else the first live one. */
  private defaultGroup(cat: string): string | null {
    const list = this.opts.filter((o) => o.kind === cat && !o.disabled);
    if (cat !== 'shoot' && list.some((o) => o.hint) && this.groupsIn(cat).length > 1) return null;
    if (cat === 'shoot') return null;
    const o = list.find((x) => TECHS[x.tech].base && !x.sp) ?? list.find((x) => !x.sp) ?? list[0];
    return o ? grp(o) : null;
  }

  private openCat(k: ActKind) {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    this.advanceCoach(1);
    this.cat = k;
    this.sel = null;
    m.preview(null);
    if (k === 'shoot') {
      // Shots: the list itself is the choice (nothing preselected, so the dunk row is read first).
      this.tech = null;
      this.render();
      sfx.tick();
      return;
    }
    this.pickGroup(this.defaultGroup(k));
  }

  private pickGroup(g: string | null) {
    if (!this.cat) return;
    const m = this.match();
    if (this.cat === 'shoot') {
      const o = this.opts.find((x) => x.kind === this.cat && grp(x) === g && !x.disabled);
      if (o) { if (this.sel === o.id) this.confirm(o.id); else this.select(o.id); }
      return;
    }
    this.tech = g;
    this.sel = null;
    m?.preview(null);
    m?.showCategory(this.cat as ActKind, g ?? undefined);
    const live = this.opts.filter((o) => o.kind === this.cat && grp(o) === g && !o.disabled);
    if (live.length === 1) { this.select(live[0].id); return; }
    this.render();
    sfx.tick();
  }

  private pickFromWorld(x: number, y: number) {
    if (!this.open) return;
    const m = this.match();
    if (!m) return;
    const kind = this.cat && KINDS.includes(this.cat as ActKind) && this.cat !== 'shoot' ? (this.cat as ActKind) : null;
    const id = m.optionAt(x, y, kind, kind ? this.tech ?? undefined : undefined) ?? m.optionAt(x, y, null);
    if (!id) return;
    const o = this.opts.find((q) => q.id === id);
    if (!o || o.disabled) return;
    if (this.sel === id) { this.confirm(id); return; }
    this.cat = o.kind;
    this.tech = grp(o);
    this.select(id);
  }

  private confirm(id: string) {
    if (!this.open) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    sfx.tap();
    const m = this.match();
    const info = m?.decisionInfo();
    if (info?.coach) m?.coachDone(info.side);
    m?.confirm(id);
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-coach-next]')) { this.advanceCoach(1); this.render(); return; }
    if (t.closest('[data-confirm]')) { if (this.sel) this.confirm(this.sel); return; }
    const kind = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as ActKind | undefined;
    if (kind) { if (this.cat === kind && this.sel && kind === 'shoot') { this.confirm(this.sel); return; } this.openCat(kind); return; }
    const tech = t.closest<HTMLButtonElement>('[data-tech]');
    if (tech && !tech.disabled) { this.pickGroup(tech.dataset.tech!); return; }
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (!id) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    if (this.sel === id) this.confirm(id); else { this.tech = grp(o); this.select(id); }
  };

  private onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('.d-subs [data-opt]')?.dataset.opt;
    if (id) {
      const o = this.opts.find((x) => x.id === id);
      if (o && !o.disabled) { this.tech = grp(o); this.select(id); }
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.open) return;
    const k = e.key.toLowerCase();
    const info = this.match()?.decisionInfo();
    if (!info) return;
    const n = parseInt(k, 10);
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      if (this.sel) this.confirm(this.sel);
      return;
    }
    if (k === 'escape') { this.cat = null; this.tech = null; this.select(null); this.match()?.preview(null); this.render(); return; }
    if (info.side === 'att' && KEY_KIND[k]) {
      const kind = KEY_KIND[k];
      if (this.opts.some((o) => o.kind === kind && !o.disabled)) this.openCat(kind);
      return;
    }
    const vi = VAR_KEYS.indexOf(k);
    if (vi >= 0 && this.cat && info.side === 'att') {
      const g = this.groupsIn(this.cat)[vi];
      if (g && this.opts.some((o) => o.kind === this.cat && grp(o) === g && !o.disabled)) this.pickGroup(g);
      return;
    }
    if (n >= 1) {
      if (info.side === 'def') {
        const o = this.opts[n - 1];
        if (o) { if (this.sel === o.id) this.confirm(o.id); else this.select(o.id); e.preventDefault(); }
        return;
      }
      const list = this.opts.filter((o) => o.kind === this.cat && this.cat !== 'shoot' && grp(o) === this.tech);
      const o = list[n - 1];
      if (!o || o.disabled) return;
      if (this.sel === o.id) this.confirm(o.id); else this.select(o.id);
      e.preventDefault();
    }
  };
}
