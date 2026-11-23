// Decision bar: one big button per option. Desktop: hover previews, click confirms.
// Touch: press and hold previews (slide across options), release on it or tap it again to confirm.
// Keys: 1-5 preview (same key again confirms), Enter/Space confirm, S toggles the special move.
import { sfx } from './audio';
import { icon } from './icons';
import type { Match, OptionInfo } from './match';

const HOLD_MS = 280;

export class DecisionUI {
  el: HTMLElement;
  private opts: OptionInfo[] = [];
  private sel: string | null = null;
  private down: { id: string; t: number; wasSel: boolean } | null = null;
  private open = false;

  constructor(root: HTMLElement, private match: () => Match | null, private firstTime: () => boolean) {
    this.el = document.createElement('div');
    this.el.className = 'decision';
    this.el.hidden = true;
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    this.el.addEventListener('pointerdown', this.onDown);
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', () => { this.down = null; });
    this.el.addEventListener('pointerover', this.onOver);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  show(on: boolean) {
    this.open = on;
    this.sel = null;
    this.down = null;
    this.el.hidden = !on;
    if (on) this.render();
  }

  private render() {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    this.opts = m.options();
    const touch = matchMedia('(pointer: coarse)').matches;
    const bar = (o: OptionInfo) => `<span class="obar">${o.odds.filter((x) => x.pct > 0).map((x) => `<i class="${x.tone}" style="flex:${x.pct}"></i>`).join('')}</span>`;
    const energyPct = Math.round(info.me.energy);
    this.el.innerHTML = `
      <div class="d-top">
        <div class="d-chip ${info.side}">
          <span class="num" style="--c:${info.me.color}">${info.me.num}</span>
          <span class="en" title="Energy"><i style="width:${energyPct}%"></i></span>
          <span class="vs">${icon(info.side === 'att' ? 'ball' : 'protect', 18)}</span>
          <span class="num them" style="--c:${info.them.color}">${info.them.num}</span>
        </div>
        ${info.specialAvailable ? `<button class="sp ${info.special ? 'on' : ''}" data-special>${icon('star', 20)}<span>${info.special ? 'ON' : 'OFF'}</span></button>` : ''}
      </div>
      ${this.firstTime() ? `<div class="d-hint">${touch ? 'Hold to preview - release to play' : 'Hover to preview - click to play'}</div>` : ''}
      <div class="d-opts n${this.opts.length}">
        ${this.opts.map((o, i) => `
          <button class="opt ${o.action} ${o.id === this.sel ? 'sel' : ''} ${o.tech ? 'tech' : ''}" data-opt="${o.id}">
            <span class="oi">${icon(o.action, 30)}${o.targetNum !== undefined ? `<em class="tgt">${o.targetNum}</em>` : ''}${o.tech ? `<em class="st">${icon('star', 14)}</em>` : ''}</span>
            <b class="pct">${o.main}%</b>
            ${bar(o)}
            <small>${o.label}</small>
            <kbd>${i + 1}</kbd>
          </button>`).join('')}
      </div>`;
  }

  private select(id: string | null) {
    if (this.sel === id) return;
    this.sel = id;
    this.match()?.preview(id);
    this.el.querySelectorAll<HTMLElement>('[data-opt]').forEach((b) => b.classList.toggle('sel', b.dataset.opt === id));
    if (id) sfx.tick();
  }

  private confirm(id: string) {
    if (!this.open) return;
    sfx.tap();
    this.match()?.confirm(id);
  }

  private optAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('[data-opt]')?.dataset.opt ?? null;
  }

  private onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (id) this.select(id);
  };

  private onDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-special]')) {
      this.match()?.toggleSpecial();
      const keep = this.sel;
      this.sel = null;
      this.render();
      if (keep) { this.sel = null; this.select(keep); }
      return;
    }
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (!id) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.confirm(id);
      return;
    }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    this.down = { id, t: performance.now(), wasSel: this.sel === id };
    this.select(id);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.down || e.pointerType === 'mouse') return;
    const id = this.optAt(e.clientX, e.clientY);
    if (id && id !== this.sel) {
      this.down = { id, t: performance.now(), wasSel: false };
      this.select(id);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.down || e.pointerType === 'mouse') return;
    const id = this.optAt(e.clientX, e.clientY);
    const d = this.down;
    this.down = null;
    if (!id || id !== this.sel) return;
    const held = performance.now() - d.t >= HOLD_MS;
    if ((id === d.id && (held || d.wasSel))) this.confirm(id);
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.open) return;
    const k = e.key.toLowerCase();
    const n = parseInt(k, 10);
    if (n >= 1 && n <= this.opts.length) {
      const id = this.opts[n - 1].id;
      if (this.sel === id) this.confirm(id); else this.select(id);
      e.preventDefault();
    } else if ((k === 'enter' || k === ' ') && this.sel) {
      e.preventDefault();
      this.confirm(this.sel);
    } else if (k === 's') {
      const keep = this.sel;
      this.match()?.toggleSpecial();
      this.sel = null;
      this.render();
      if (keep) this.select(keep);
    }
  };
}
