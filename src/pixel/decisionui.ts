// Battle command window (JRPG style). One bordered window below the stage with a hand cursor:
//   Attack:  Shoot / Dribble / Pass / Play / Combo  ->  the moves of that kind  ->  the target, when there is more than one.
//   Combo lists the combined plays (alley-oop, pick and roll, give and go...); its target is the teammate.
//   Defense: Press / Steal / Contest / Give space / More  ->  Block / Charge / Deny.
// The info box shows one big number (the chance of the move under the cursor) and one badge: whether the move
// beats the opponent's tell (the icon over their player), loses to it, or neither. Shape and color both change.
// Moving the cursor (hover, arrows, a tap) previews the move on the court and the camera frames it; activating
// it (click, a second tap, OK, Enter) goes one level down or plays it. The window never changes size: every box
// has a fixed size and only its content changes.
import { sfx } from '../audio';
import { icon } from './pxicons';
import { DEF_ORDER, KIND_ICON, KIND_LABEL, defName, type DecisionInfo, type DuelInfo, type Match, type OptionInfo, type UiKind } from './match';
import { COMBOS, COMBO_ORDER, type ComboId } from './combos';
import { TECHS, type TechId } from '../techs';
import { SPECIALS, type SpecialId } from '../specials';

const KINDS: UiKind[] = ['shoot', 'drive', 'pass', 'cut', 'combo'];
/** Combo of a menu group ("combo_alley"), if it is one. */
const comboOf = (g: string) => (g.startsWith('combo_') ? COMBOS[g.slice(6) as ComboId] : null);
/** Shots in menu order: the dunk first, then closest to farthest. */
const SHOT_ORDER = ['dunk', 'layup', 'floater', 'jumper', 'bank', 'fade'];
/** Defense: four main moves on the first page, the rest under More. */
const DEF_MAIN: TechId[] = ['press', 'hawk', 'contest', 'space'];
const grp = (o: OptionInfo) => o.group ?? o.tech;
/** Short menu names (the list is read at a glance). */
const SHORT: Partial<Record<TechId, string>> = {
  jumper: 'Jump shot', fade: 'Fadeaway', chest: 'Chest pass', bounce: 'Bounce', nolook: 'No-look', skip: 'Skip pass',
  hesi: 'Hesitate', spin: 'Spin', stepback: 'Step-back', euro: 'Euro step', pumpfake: 'Pump fake', between: 'Between',
  behind: 'Behind back', backdown: 'Back down', screen: 'Screen cut', pnr: 'Pick & roll', giveandgo: 'Give & go',
  iso: 'Clear-out', pop: 'Pick & pop', handoff: 'Hand-off', space: 'Give space', charge: 'Charge', deny: 'Deny',
};

type Level =
  | { k: 'root' }
  | { k: 'kind'; kind: UiKind }
  | { k: 'target'; kind: UiKind; group: string }
  | { k: 'more' };

interface Row {
  key: string;
  name: string;
  ic: string;
  /** Option previewed and shown in the info box. */
  opt?: OptionInfo;
  /** Big number for the info box. */
  pct?: number;
  edge?: -1 | 0 | 1;
  disabled?: boolean;
  special?: boolean;
  hint?: boolean;
  /** One short line for the info box (a locked dunk, the tutorial step). */
  line?: string;
  /** What activating it does. */
  go: () => void;
  /** What moving the cursor onto it previews. */
  show: () => void;
}

/** Pixel bitmap to a crisp SVG (X = outline, W = fill). */
function bitmap(rows: string[], cls: string) {
  const path = (ch: string) => {
    let d = '';
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === ch) { const x0 = x; while (r[x + 1] === ch) x++; d += `M${x0} ${y}h${x - x0 + 1}v1h-${x - x0 + 1}z`; } });
    return d;
  };
  const w = rows[0].length, h = rows.length;
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}" shape-rendering="crispEdges" aria-hidden="true"><path fill="#1b1029" d="${path('X')}"/><path fill="#fff7ea" d="${path('W')}"/></svg>`;
}
/** The pointing glove of the command cursor. */
const HAND = bitmap([
  '..XXXX......',
  '.XWWWWXXXXX.',
  'XWWWWWWWWWWX',
  'XWWWWWXXXXX.',
  'XWWWWWWX....',
  'XWWWWWX.....',
  '.XWWWWWX....',
  '..XXXXX.....',
], 'hand');

export class DecisionUI {
  el: HTMLElement;
  private opts: OptionInfo[] = [];
  private info: DecisionInfo | null = null;
  private level: Level = { k: 'root' };
  private rows: Row[] = [];
  private cur = 0;
  private open = false;
  private listEl: HTMLElement;
  private titleEl: HTMLElement;
  private infoEl: HTMLElement;
  private lastPointer = 'mouse';

  constructor(root: HTMLElement, private match: () => Match | null) {
    this.el = root;
    root.innerHTML = `
      <div class="w-list"><div class="w-title"></div><div class="w-rows" role="menu"></div></div>
      <div class="w-info"></div>`;
    this.listEl = root.querySelector('.w-rows')!;
    this.titleEl = root.querySelector('.w-title')!;
    this.infoEl = root.querySelector('.w-info')!;
    window.addEventListener('keydown', this.onKey);
    root.addEventListener('pointerdown', (e) => { this.lastPointer = e.pointerType; }, { capture: true });
    root.addEventListener('click', this.onClick);
    root.addEventListener('pointerover', this.onOver);
    this.listEl.addEventListener('scroll', () => this.moreMark(), { passive: true });
    this.idle('');
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }

  show(on: boolean) {
    this.open = on;
    const m = this.match();
    if (m) m.onPick = (x, y) => this.pickFromWorld(x, y);
    this.el.classList.toggle('live', on);
    if (!on) return;
    this.info = m?.decisionInfo() ?? null;
    this.opts = m?.options() ?? [];
    this.level = { k: 'root' };
    this.build(true);
  }

  /** Between duels: the window says whose turn it is. */
  idle(side: 'att' | 'def' | '') {
    if (this.open) return;
    this.titleEl.innerHTML = side ? `${icon(side === 'att' ? 'ball' : 'protect', 16)}<span>${side === 'att' ? 'ATTACK' : 'DEFENSE'}</span>` : '';
    this.listEl.innerHTML = '';
    this.moreMark();
    this.infoEl.innerHTML = this.infoHTML(null);
  }

  /** After a duel: both moves and who won, then the result word (shown big over the stage too). */
  duel(d: DuelInfo) {
    if (this.open) return;
    const mark = d.res === 'win' ? 'check' : d.res === 'lose' ? 'cross' : 'even';
    this.titleEl.innerHTML = `${icon(mark, 16)}<span>${d.word}</span>`;
    this.listEl.innerHTML = `
      <div class="w-vs you ${d.res === 'win' ? 'won' : ''}"><i class="mark home"></i>${icon(d.you.icon, 32)}<b>${d.you.name}</b></div>
      <div class="w-vs them ${d.res === 'lose' ? 'won' : ''}"><i class="mark away"></i>${icon(d.them.icon, 32)}<b>${d.them.name}</b></div>`;
    this.infoEl.innerHTML = `<div class="wi-res r-${d.res}">${icon(mark, 32)}</div>${this.buttonsHTML(false, false)}`;
    this.moreMark();
  }

  // ---------------------------------------------------------------- levels
  private build(fresh = false) {
    const m = this.match();
    const info = this.info;
    if (!m || !info) return;
    const live = (l: OptionInfo[]) => l.filter((o) => !o.disabled);
    const best = (l: OptionInfo[]) => live(l).slice().sort((a, b) => b.main - a.main)[0];
    const rows: Row[] = [];
    const L = this.level;
    let title = '';
    if (info.side === 'att') {
      if (L.k === 'root') {
        title = `${icon('ball', 16)}<span>ATTACK</span>`;
        for (const k of KINDS) {
          const list = this.opts.filter((o) => o.kind === k);
          const b = best(list);
          rows.push({
            key: k, name: KIND_LABEL[k], ic: KIND_ICON[k], pct: b?.main, edge: b?.edge, disabled: !b,
            special: live(list).some((o) => o.sp), hint: list.some((o) => o.hint),
            go: () => this.enter({ k: 'kind', kind: k }),
            show: () => { m.preview(null); if (k === 'pass' || k === 'cut' || k === 'combo') m.showCategory(k); },
          });
        }
      } else if (L.k === 'kind') {
        title = `${icon(KIND_ICON[L.kind], 16)}<span>${KIND_LABEL[L.kind].toUpperCase()}</span>`;
        for (const g of this.groupsIn(L.kind)) {
          const list = this.opts.filter((o) => o.kind === L.kind && grp(o) === g);
          const lock = list.find((o) => o.locked);
          const b = best(list);
          const sp = g in SPECIALS ? SPECIALS[g as SpecialId] : null;
          const cb = comboOf(g);
          const first = list[0];
          const three = first?.label === 'Three';
          const name = cb ? cb.short : sp ? sp.name : three ? 'Three' : g === 'dunk' && first?.label ? first.label : SHORT[g as TechId] ?? TECHS[g as TechId].name;
          const many = live(list).length > 1;
          rows.push({
            key: g, name, ic: lock ? 'lock' : cb ? cb.icon : sp ? 'fire' : three ? 't_three' : TECHS[g as TechId].icon,
            opt: b, pct: b?.main, edge: b?.edge, disabled: !b, special: !!sp, hint: list.some((o) => o.hint),
            line: lock ? lock.locked : undefined,
            go: () => { if (!b) return; if (many) this.enter({ k: 'target', kind: L.kind, group: g }); else this.confirm(b); },
            show: () => { if (b) m.preview(b.id); else { m.preview(null); } },
          });
        }
      } else if (L.k === 'target') {
        const list = this.opts.filter((o) => o.kind === L.kind && grp(o) === L.group);
        const sp = L.group in SPECIALS ? SPECIALS[L.group as SpecialId] : null;
        const cb = comboOf(L.group);
        title = `${icon(cb ? cb.icon : sp ? 'fire' : TECHS[L.group as TechId]?.icon ?? 'next', 16)}<span>${(cb ? cb.short : sp ? sp.name : SHORT[L.group as TechId] ?? TECHS[L.group as TechId].name).toUpperCase()}</span>`;
        for (const o of list) {
          rows.push({
            key: o.id, name: o.short ?? o.tag ?? o.label, ic: L.kind === 'pass' ? 'pass' : L.kind === 'drive' ? 'next' : L.kind === 'combo' ? 'team' : 'cut',
            opt: o, pct: o.main, edge: o.edge, disabled: o.disabled, special: !!o.sp, hint: o.hint,
            go: () => this.confirm(o),
            show: () => m.preview(o.id),
          });
        }
      }
    } else {
      const defRow = (o: OptionInfo): Row => ({
        key: o.id, name: SHORT[o.tech] ?? defName(o.tech), ic: TECHS[o.tech].icon, opt: o, pct: o.main, edge: o.edge,
        go: () => this.confirm(o), show: () => m.preview(o.id),
      });
      const byId = (id: TechId) => this.opts.find((o) => o.id === id);
      if (L.k === 'more') {
        title = `${icon('protect', 16)}<span>MORE</span>`;
        for (const id of DEF_ORDER.filter((d) => !DEF_MAIN.includes(d))) { const o = byId(id); if (o) rows.push(defRow(o)); }
      } else {
        title = `${icon('protect', 16)}<span>DEFENSE</span>`;
        for (const id of DEF_MAIN) { const o = byId(id); if (o) rows.push(defRow(o)); }
        const rest = DEF_ORDER.filter((d) => !DEF_MAIN.includes(d)).map(byId).filter((o): o is OptionInfo => !!o);
        const top = rest.slice().sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))[0];
        rows.push({
          key: 'more', name: 'More', ic: 'next', edge: rest.some((o) => o.edge === 1) ? 1 : undefined, pct: undefined,
          go: () => this.enter({ k: 'more' }), show: () => { m.preview(null); },
        });
        void top;
      }
    }
    this.rows = rows;
    this.titleEl.innerHTML = title;
    this.listEl.innerHTML = rows.map((r, i) => `
      <button class="row ${r.disabled ? 'dis' : ''} ${r.special ? 'sp' : ''} ${r.hint ? 'hint' : ''}" data-i="${i}" role="menuitem" ${r.disabled && !r.line ? 'aria-disabled="true"' : ''}>
        ${HAND}<span class="ri">${icon(r.ic, 32)}</span><span class="rn">${r.name}</span>${this.edgeHTML(r.edge, true)}
      </button>`).join('');
    // Cursor: the hinted row, else the first live one (keeps the slot when coming back up).
    if (fresh || this.cur >= rows.length || rows[this.cur]?.disabled) {
      const h = rows.findIndex((r) => r.hint && !r.disabled);
      this.cur = h >= 0 ? h : Math.max(0, rows.findIndex((r) => !r.disabled));
    }
    this.moveTo(this.cur, true);
    this.moreMark();
  }

  /** A down arrow over the bottom of the list when more rows are below (an overlay: nothing moves). */
  private moreMark() {
    const l = this.listEl;
    l.parentElement!.classList.toggle('more', l.scrollTop + l.clientHeight < l.scrollHeight - 2);
  }

  private groupsIn(kind: UiKind): string[] {
    const out: string[] = [];
    for (const o of this.opts) if (o.kind === kind && !out.includes(grp(o))) out.push(grp(o));
    const rank = (g: string) => {
      const cb = comboOf(g);
      if (cb) return COMBO_ORDER.indexOf(cb.id);
      if (g in SPECIALS) return -1;
      if (kind === 'shoot') { const i = SHOT_ORDER.indexOf(g); return i < 0 ? 50 : i; }
      return TECHS[g as TechId]?.base ? 0 : 1;
    };
    return out.sort((a, b) => rank(a) - rank(b));
  }

  private stack: { level: Level; cur: number }[] = [];
  private enter(l: Level) {
    sfx.tap();
    this.stack.push({ level: this.level, cur: this.cur });
    this.level = l;
    this.cur = 0;
    this.build(true);
  }
  private back() {
    const prev = this.stack.pop();
    if (!prev) return;
    sfx.tick();
    this.level = prev.level;
    this.cur = prev.cur;
    this.match()?.preview(null);
    this.build(false);
  }

  private moveTo(i: number, force = false) {
    if (i < 0 || i >= this.rows.length) return;
    if (i === this.cur && !force) return;
    this.cur = i;
    this.listEl.querySelectorAll('.row').forEach((b, k) => b.classList.toggle('cur', k === i));
    const el = this.listEl.querySelector<HTMLElement>(`.row[data-i="${i}"]`);
    if (el) {
      // Keep the cursor row in view without moving anything else.
      const top = el.offsetTop - this.listEl.offsetTop, bot = top + el.offsetHeight;
      if (top < this.listEl.scrollTop) this.listEl.scrollTop = top;
      else if (bot > this.listEl.scrollTop + this.listEl.clientHeight) this.listEl.scrollTop = bot - this.listEl.clientHeight;
    }
    const r = this.rows[i];
    this.infoEl.innerHTML = this.infoHTML(r);
    r.show();
    if (!force) sfx.tick();
  }

  private activate(i = this.cur) {
    const r = this.rows[i];
    if (!r || r.disabled) { if (r) sfx.bad(); return; }
    r.go();
  }

  private confirm(o: OptionInfo) {
    if (!this.open || o.disabled) return;
    sfx.tap();
    this.stack = [];
    const m = this.match();
    const info = m?.decisionInfo();
    if (info?.coach) m?.coachDone(info.side);
    m?.confirm(o.id);
  }

  // ---------------------------------------------------------------- info box
  private edgeHTML(e: -1 | 0 | 1 | undefined, small = false) {
    if (e === undefined || (small && e === 0)) return `<span class="edge none"></span>`;
    const cls = e === 1 ? 'good' : e === -1 ? 'bad' : 'even';
    const ic = e === 1 ? 'up' : e === -1 ? 'cross' : 'even';
    return `<span class="edge ${cls}" title="${e === 1 ? 'Beats their move' : e === -1 ? 'Loses to their move' : 'Even'}">${icon(ic, small ? 16 : 32)}</span>`;
  }

  private buttonsHTML(back: boolean, ok: boolean) {
    return `<div class="wi-btns">
      <button class="wbtn back" data-back ${back ? '' : 'disabled'} aria-label="Back">${icon('back', 16)}</button>
      <button class="wbtn ok" data-ok ${ok ? '' : 'disabled'} aria-label="OK">OK</button></div>`;
  }

  private infoHTML(r: Row | null) {
    const info = this.info;
    const tell = info?.tell;
    const back = !!r && this.stack.length > 0;
    if (!r) return `<div class="wi-num"></div><div class="wi-edge"></div><div class="wi-line"></div>${this.buttonsHTML(false, false)}`;
    const kindIc = info?.side === 'def' ? 'protect' : r.opt ? KIND_ICON[r.opt.kind as UiKind] ?? 'ball' : r.ic;
    const num = r.pct !== undefined && !r.disabled ? `<span class="wi-ic">${icon(r.special ? 'fire' : kindIc, 32)}</span><b class="${r.pct >= 100 ? 'w3' : ''}">${r.pct}<small>%</small></b>` : r.line ? `<span class="wi-ic">${icon('lock', 32)}</span>` : '';
    const vs = tell && r.edge !== undefined && !r.disabled ? `${this.edgeHTML(r.edge)}<span class="wi-vs">vs</span><span class="wi-tell">${icon(tell.icon, 32)}</span>` : '';
    const line = r.line ?? (r.hint ? info?.hint ?? '' : r.special ? 'FIRE' : r.opt?.combo ? `${r.opt.combo.steps} STEPS` : '');
    return `<div class="wi-num">${num}</div><div class="wi-edge">${vs}</div><div class="wi-line ${r.special ? 'fire' : ''}">${line}</div>${this.buttonsHTML(back, !r.disabled)}`;
  }

  // ---------------------------------------------------------------- input
  private pickFromWorld(x: number, y: number) {
    if (!this.open || this.info?.side !== 'att') return;
    const m = this.match();
    if (!m) return;
    const L = this.level;
    const kind = L.k === 'kind' || L.k === 'target' ? L.kind : null;
    const group = L.k === 'target' ? L.group : undefined;
    const id = m.optionAt(x, y, kind === 'shoot' ? null : kind, group) ?? m.optionAt(x, y, null);
    if (!id) return;
    const o = this.opts.find((q) => q.id === id);
    if (!o || o.disabled) return;
    const g = grp(o);
    const live = this.opts.filter((q) => q.kind === o.kind && grp(q) === g && !q.disabled);
    if (!(L.k === 'target' && L.group === g)) {
      this.stack = [{ level: { k: 'root' }, cur: KINDS.indexOf(o.kind as UiKind) }];
      if (live.length > 1) {
        this.stack.push({ level: { k: 'kind', kind: o.kind as UiKind }, cur: this.groupsIn(o.kind as UiKind).indexOf(g) });
        this.level = { k: 'target', kind: o.kind as UiKind, group: g };
      } else this.level = { k: 'kind', kind: o.kind as UiKind };
      this.build(true);
    }
    const i = this.rows.findIndex((r) => r.opt?.id === id || r.key === g);
    if (i < 0) return;
    if (i === this.cur && this.rows[i].opt?.id === id) { this.activate(i); return; }
    this.moveTo(i, true);
    sfx.tick();
  }

  private onClick = (e: MouseEvent) => {
    if (!this.open) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-back]')) { this.back(); return; }
    if (t.closest('[data-ok]')) { this.activate(); return; }
    const row = t.closest<HTMLElement>('.row');
    if (!row) return;
    const i = +row.dataset.i!;
    // Touch: the first tap moves the hand (and previews), the second plays it. Mouse: hovering already moved it.
    if (i !== this.cur) { this.moveTo(i); if (this.lastPointer === 'mouse') this.activate(i); return; }
    this.activate(i);
  };

  private onOver = (e: PointerEvent) => {
    if (!this.open || e.pointerType !== 'mouse') return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (row) this.moveTo(+row.dataset.i!);
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.open) return;
    const k = e.key;
    const n = this.rows.length;
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); let i = this.cur; for (let s = 0; s < n; s++) { i = (i + 1) % n; if (!this.rows[i].disabled) break; } this.moveTo(i); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); let i = this.cur; for (let s = 0; s < n; s++) { i = (i - 1 + n) % n; if (!this.rows[i].disabled) break; } this.moveTo(i); return; }
    if (k === 'Enter' || k === ' ' || k === 'z' || k === 'Z') { e.preventDefault(); this.activate(); return; }
    if (k === 'Escape' || k === 'Backspace' || k === 'x' || k === 'X') { e.preventDefault(); this.back(); return; }
    const d = parseInt(k, 10);
    if (d >= 1 && d <= n) { e.preventDefault(); if (this.cur === d - 1) this.activate(); else this.moveTo(d - 1); }
  };
}
