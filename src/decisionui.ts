// Decision bar. Attack: Shoot / Pass / Drive / Cut; Pass, Drive and Cut open a row of targets (also
// tappable as rings on the court). Defense: three stances. Selecting an option previews it in 3D and
// shows a three-line card (gain / risk / change); selecting it again or pressing GO confirms.
// Desktop: hover previews, click confirms. Keys: S P D C, digits for targets or stances, Enter, Esc.
import { sfx } from './audio';
import { icon } from './icons';
import type { ActKind } from './rules';
import { KIND_LABEL, type Match, type OptionInfo } from './match';

const KINDS: ActKind[] = ['shoot', 'pass', 'drive', 'cut'];
const KEY_KIND: Record<string, ActKind> = { s: 'shoot', p: 'pass', d: 'drive', c: 'cut' };
const STANCE_ICON: Record<string, string> = { press: 'press', space: 'space', deny: 'deny' };

export class DecisionUI {
  el: HTMLElement;
  private opts: OptionInfo[] = [];
  private cat: ActKind | null = null;
  private sel: string | null = null;
  private open = false;

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
    this.el.hidden = !on;
    const m = this.match();
    if (m) m.onPick = (id) => this.pickFromWorld(id);
    if (on) this.render();
  }

  private render() {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    this.opts = m.options();
    const bar = (o: OptionInfo) => `<span class="obar">${o.odds.filter((x) => x.pct > 0).map((x) => `<i class="${x.tone}" style="flex:${x.pct}"></i>`).join('')}</span>`;
    const pips = Array.from({ length: info.maxLeft }, (_, i) => `<i class="${i < info.left ? 'on' : ''}"></i>`).join('');
    const lean = info.lean
      ? `<span class="lean" title="What the defense tends to do here">${(['press', 'space', 'deny'] as const).map((st) =>
        `<span class="ln ${st} ${info.shown === st ? 'shown' : ''}">${icon(STANCE_ICON[st], 16)}<b>${Math.round(info.lean![st] * 100)}</b></span>`).join('')}</span>`
      : '';
    const sel = this.opts.find((o) => o.id === this.sel);
    const card = sel ? `<div class="d-card">
        <div class="lines"><span class="g"><b>+</b>${sel.card.gain}</span><span class="r"><b>!</b>${sel.card.risk}</span><span class="c"><b>&gt;</b>${sel.card.change}</span></div>
        <button class="go" data-confirm>GO</button></div>` : '';
    let main = '';
    let subs = '';
    if (info.side === 'att') {
      main = KINDS.map((k) => {
        const list = this.opts.filter((o) => o.kind === k);
        const live = list.filter((o) => !o.disabled);
        const best = live.reduce((a, o) => Math.max(a, o.main), 0);
        const shoot = k === 'shoot' ? list[0] : undefined;
        const isSel = k === 'shoot' ? this.sel === 'shoot' : this.cat === k;
        const hint = list.some((o) => o.hint);
        return `<button class="opt ${k} ${isSel ? 'sel' : ''} ${hint ? 'hint' : ''}" data-kind="${k}" ${live.length ? '' : 'disabled'}>
          <span class="oi">${icon(k === 'drive' ? 'dribble' : k, 28)}</span>
          <b class="pct">${live.length ? `${best}%` : '-'}</b>
          ${shoot ? bar(shoot) : `<span class="cnt">${live.length || ''}</span>`}
          <small>${KIND_LABEL[k]}</small><kbd>${k[0].toUpperCase()}</kbd>
        </button>`;
      }).join('');
      if (this.cat && this.cat !== 'shoot') {
        const list = this.opts.filter((o) => o.kind === this.cat);
        subs = `<div class="d-subs">${list.map((o, i) => `
          <button class="sub ${o.id === this.sel ? 'sel' : ''} ${o.hint ? 'hint' : ''}" data-opt="${o.id}" ${o.disabled ? 'disabled' : ''}>
            <span class="st">${o.tag ?? ''}</span><b>${o.main}%</b>${bar(o)}<kbd>${i + 1}</kbd></button>`).join('')}</div>`;
      }
    } else {
      main = this.opts.map((o, i) => `
        <button class="opt stance ${o.id} ${o.id === this.sel ? 'sel' : ''}" data-opt="${o.id}">
          <span class="oi">${icon(STANCE_ICON[o.id], 28)}</span>
          <b class="pct">${o.main}%</b>${bar(o)}<small>${o.label}</small><kbd>${i + 1}</kbd>
        </button>`).join('');
    }
    this.el.innerHTML = `
      <div class="d-top">
        <span class="pips ${info.side}" title="Moves left this possession">${pips}</span>
        ${lean}
        ${info.attLean ? `<span class="lean" title="What the attack tends to do here">${KINDS.map((k) =>
          `<span class="ln ${k}">${icon(k === 'drive' ? 'dribble' : k, 16)}<b>${Math.round(info.attLean![k] * 100)}</b></span>`).join('')}</span>` : ''}
      </div>
      ${info.hint ? `<div class="d-hint">${info.hint}</div>` : ''}
      ${card}
      ${subs}
      <div class="d-opts n${info.side === 'att' ? 4 : 3}">${main}</div>`;
  }

  private select(id: string | null) {
    if (this.sel === id) return;
    this.sel = id;
    this.match()?.preview(id);
    this.render();
    if (id) sfx.tick();
  }

  private openCat(k: ActKind) {
    if (k === 'shoot') {
      this.cat = 'shoot';
      if (this.sel === 'shoot') { this.confirm('shoot'); return; }
      this.select('shoot');
      return;
    }
    if (this.cat === k && !this.sel) return;
    this.cat = k;
    this.sel = null;
    const m = this.match();
    m?.preview(null);
    m?.showCategory(k);
    const live = this.opts.filter((o) => o.kind === k && !o.disabled);
    if (live.length === 1) { this.select(live[0].id); return; }
    this.render();
    sfx.tick();
  }

  private pickFromWorld(id: string) {
    if (!this.open) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    if (this.sel === id) { this.confirm(id); return; }
    this.cat = o.kind as ActKind;
    this.select(id);
  }

  private confirm(id: string) {
    if (!this.open) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    sfx.tap();
    this.match()?.confirm(id);
  }

  private onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-confirm]')) { if (this.sel) this.confirm(this.sel); return; }
    const kind = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as ActKind | undefined;
    if (kind) { this.openCat(kind); return; }
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (!id) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    if (this.sel === id) this.confirm(id); else this.select(id);
  };

  private onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (id) {
      const o = this.opts.find((x) => x.id === id);
      if (o && !o.disabled) this.select(id);
      return;
    }
    if (t.closest('[data-kind="shoot"]') && !this.opts.find((o) => o.id === 'shoot')?.disabled) { this.cat = 'shoot'; this.select('shoot'); }
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
    if (k === 'escape') { this.cat = null; this.select(null); return; }
    if (info.side === 'att' && KEY_KIND[k]) {
      const kind = KEY_KIND[k];
      if (this.opts.some((o) => o.kind === kind && !o.disabled)) this.openCat(kind);
      return;
    }
    if (n >= 1) {
      const list = info.side === 'att' ? this.opts.filter((o) => o.kind === this.cat && this.cat !== 'shoot') : this.opts;
      const o = list[n - 1];
      if (!o || o.disabled) return;
      if (this.sel === o.id) this.confirm(o.id); else this.select(o.id);
      e.preventDefault();
    }
  };
}
