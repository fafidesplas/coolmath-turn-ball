// Decision bar. Attack: Shoot / Pass / Drive / Play. A base action opens the techniques the player
// knows for it (one line each: icon, name, when it is good, best odds), then its targets (also
// tappable as rings on the court). Defense: three stance families, each opening the team's
// defensive techniques. Selecting an option previews it in 3D and shows a three-line card
// (gain / risk / change); selecting it again or pressing GO confirms.
// Desktop: hover previews, click confirms. Keys: S P D C actions, Q W E R techniques, digits for
// targets (or stances), Enter, Esc.
import { sfx } from './audio';
import { icon } from './icons';
import type { ActKind, Stance } from './rules';
import { KIND_LABEL, STANCE_LABEL, type Match, type OptionInfo } from './match';
import { TECHS, type TechId } from './techs';

const KINDS: ActKind[] = ['shoot', 'pass', 'drive', 'cut'];
const FAMS: Stance[] = ['press', 'space', 'deny'];
const KEY_KIND: Record<string, ActKind> = { s: 'shoot', p: 'pass', d: 'drive', c: 'cut' };
const VAR_KEYS = ['q', 'w', 'e', 'r'];
const KIND_ICON: Record<ActKind, string> = { shoot: 'shoot', pass: 'pass', drive: 'dribble', cut: 'cut' };

export class DecisionUI {
  el: HTMLElement;
  private opts: OptionInfo[] = [];
  private cat: ActKind | Stance | null = null;
  private tech: TechId | null = null;
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
    this.tech = null;
    this.el.hidden = !on;
    const m = this.match();
    if (m) m.onPick = (x, y) => this.pickFromWorld(x, y);
    if (on) this.render();
  }

  /** Techniques available in a category, in a stable order (base first). */
  private techsIn(cat: ActKind | Stance): TechId[] {
    const out: TechId[] = [];
    for (const o of this.opts) if (o.kind === cat && !out.includes(o.tech)) out.push(o.tech);
    return out.sort((a, b) => Number(!TECHS[a].base) - Number(!TECHS[b].base));
  }

  private render() {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    this.opts = m.options();
    const bar = (o: OptionInfo) => `<span class="obar">${o.odds.filter((x) => x.pct > 0).map((x) => `<i class="${x.tone}" style="flex:${x.pct}"></i>`).join('')}</span>`;
    const pips = Array.from({ length: info.maxLeft }, (_, i) => `<i class="${i < info.left ? 'on' : ''}"></i>`).join('');
    const lean = info.lean
      ? `<span class="lean" title="What the defense tends to do here">${FAMS.map((st) => {
        const v = info.lean!.v[st];
        return `<span class="ln ${st} ${info.shown === st ? 'shown' : ''}" title="${TECHS[v].name}">${icon(TECHS[v].icon, 16)}<b>${Math.round(info.lean!.dist[st] * 100)}</b></span>`;
      }).join('')}</span>`
      : '';
    const sel = this.opts.find((o) => o.id === this.sel);
    const card = sel ? `<div class="d-card">
        <div class="lines"><span class="g"><b>+</b>${sel.card.gain}</span><span class="r"><b>!</b>${sel.card.risk}</span><span class="c"><b>&gt;</b>${sel.card.change}</span></div>
        <button class="go" data-confirm>GO</button></div>` : '';
    let main = '';
    let vars = '';
    let subs = '';
    const live = (l: OptionInfo[]) => l.filter((o) => !o.disabled);
    if (this.cat) {
      const techs = this.techsIn(this.cat);
      // One line per technique. Shots and defensive techniques are options themselves; the rest
      // pick the technique and then a target below.
      const direct = this.cat === 'shoot' || info.side === 'def';
      if (techs.length > 1 || direct) {
        vars = `<div class="d-vars">${techs.map((t, i) => {
          const list = this.opts.filter((o) => o.kind === this.cat && o.tech === t);
          const l = live(list);
          const best = l.reduce((a, o) => Math.max(a, o.main), 0);
          const opt = direct ? list[0] : undefined;
          const isSel = direct ? this.sel === opt?.id : this.tech === t;
          const T = TECHS[t];
          return `<button class="var ${isSel ? 'sel' : ''} ${list.some((o) => o.hint) ? 'hint' : ''}" ${direct ? `data-opt="${opt?.id}"` : `data-tech="${t}"`} ${l.length ? '' : 'disabled'}>
            <span class="vi">${icon(T.icon, 20)}</span><b class="vn">${T.name}</b><span class="vl">${T.line}</span>
            <b class="vp">${l.length ? `${best}%` : '-'}</b>${opt ? bar(opt) : ''}<kbd>${VAR_KEYS[i]?.toUpperCase() ?? ''}</kbd></button>`;
        }).join('')}</div>`;
      }
      if (!direct && this.tech) {
        const list = this.opts.filter((o) => o.kind === this.cat && o.tech === this.tech);
        subs = `<div class="d-subs">${list.map((o, i) => `
          <button class="sub ${o.id === this.sel ? 'sel' : ''} ${o.hint ? 'hint' : ''}" data-opt="${o.id}" ${o.disabled ? 'disabled' : ''}>
            <span class="st">${o.tag ?? ''}</span><b>${o.main}%</b>${bar(o)}<kbd>${i + 1}</kbd></button>`).join('')}</div>`;
      }
    }
    if (info.side === 'att') {
      main = KINDS.map((k) => {
        const list = this.opts.filter((o) => o.kind === k);
        const l = live(list);
        const best = l.reduce((a, o) => Math.max(a, o.main), 0);
        const n = this.techsIn(k).length;
        return `<button class="opt ${k} ${this.cat === k ? 'sel' : ''} ${list.some((o) => o.hint) ? 'hint' : ''}" data-kind="${k}" ${l.length ? '' : 'disabled'}>
          <span class="oi">${icon(KIND_ICON[k], 28)}</span>
          <b class="pct">${l.length ? `${best}%` : '-'}</b>
          <span class="vdots">${n > 1 ? Array.from({ length: n }, () => '<i></i>').join('') : ''}</span>
          <small>${KIND_LABEL[k]}</small><kbd>${k[0].toUpperCase()}</kbd>
        </button>`;
      }).join('');
    } else {
      main = FAMS.map((st, i) => {
        const list = this.opts.filter((o) => o.kind === st);
        const base = list.find((o) => o.tech === st) ?? list[0];
        const n = list.length;
        return `<button class="opt stance ${st} ${this.cat === st ? 'sel' : ''}" data-fam="${st}">
          <span class="oi">${icon(st, 28)}</span>
          <b class="pct">${base.main}%</b>${bar(base)}
          <span class="vdots">${n > 1 ? Array.from({ length: n }, () => '<i></i>').join('') : ''}</span>
          <small>${STANCE_LABEL[st]}</small><kbd>${i + 1}</kbd>
        </button>`;
      }).join('');
    }
    this.el.innerHTML = `
      <div class="d-top">
        <span class="pips ${info.side}" title="Moves left this possession">${pips}</span>
        ${lean}
        ${info.attLean ? `<span class="lean" title="What the attack tends to do here">${KINDS.map((k) =>
          `<span class="ln ${k}">${icon(KIND_ICON[k], 16)}<b>${Math.round(info.attLean![k] * 100)}</b></span>`).join('')}</span>` : ''}
      </div>
      ${info.hint ? `<div class="d-hint">${info.hint}</div>` : ''}
      ${card}
      ${subs}
      ${vars}
      <div class="d-opts n${info.side === 'att' ? 4 : 3}">${main}</div>`;
  }

  private select(id: string | null) {
    if (this.sel === id) return;
    this.sel = id;
    this.match()?.preview(id);
    this.render();
    if (id) sfx.tick();
  }

  /** Default technique when a category opens: the hinted one, else the base one, else the first live one. */
  private defaultTech(cat: ActKind | Stance): TechId | null {
    const list = this.opts.filter((o) => o.kind === cat && !o.disabled);
    // Tutorial: when the lesson is about picking a technique, let the player tap it.
    if (cat !== 'shoot' && list.some((o) => o.hint) && this.techsIn(cat).length > 1) return null;
    return (list.find((o) => TECHS[o.tech].base) ?? list[0])?.tech ?? null;
  }

  private openCat(k: ActKind | Stance) {
    const m = this.match();
    const info = m?.decisionInfo();
    if (!m || !info) return;
    if (this.cat === k && this.sel) {
      // Second tap on the same action confirms the selected option.
      const o = this.opts.find((x) => x.id === this.sel);
      if (o && (o.kind === 'shoot' || info.side === 'def')) { this.confirm(this.sel); return; }
    }
    this.cat = k;
    const t = this.defaultTech(k);
    if (k === 'shoot' || info.side === 'def') {
      const o = this.opts.find((x) => x.kind === k && x.tech === t);
      this.tech = t;
      this.sel = null;
      this.select(o?.id ?? null);
      if (!o) this.render();
      return;
    }
    this.pickTech(t);
  }

  private pickTech(t: TechId | null) {
    if (!this.cat) return;
    const m = this.match();
    if (this.cat === 'shoot' || FAMS.includes(this.cat as Stance)) {
      const o = this.opts.find((x) => x.kind === this.cat && x.tech === t && !x.disabled);
      if (o) { if (this.sel === o.id) this.confirm(o.id); else this.select(o.id); }
      return;
    }
    this.tech = t;
    this.sel = null;
    m?.preview(null);
    m?.showCategory(this.cat as ActKind, t ?? undefined);
    const live = this.opts.filter((o) => o.kind === this.cat && o.tech === t && !o.disabled);
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
    this.tech = o.tech;
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
    const fam = t.closest<HTMLElement>('[data-fam]')?.dataset.fam as Stance | undefined;
    if (fam) { this.openCat(fam); return; }
    const tech = t.closest<HTMLButtonElement>('[data-tech]');
    if (tech && !tech.disabled) { this.pickTech(tech.dataset.tech as TechId); return; }
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (!id) return;
    const o = this.opts.find((x) => x.id === id);
    if (!o || o.disabled) return;
    if (this.sel === id) this.confirm(id); else { this.tech = o.tech; this.select(id); }
  };

  private onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('[data-opt]')?.dataset.opt;
    if (id) {
      const o = this.opts.find((x) => x.id === id);
      if (o && !o.disabled) { this.tech = o.tech; this.select(id); }
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
    if (vi >= 0 && this.cat) {
      const t = this.techsIn(this.cat)[vi];
      if (t && this.opts.some((o) => o.kind === this.cat && o.tech === t && !o.disabled)) this.pickTech(t);
      return;
    }
    if (n >= 1) {
      if (info.side === 'def') {
        const fam = FAMS[n - 1];
        if (fam) { this.openCat(fam); e.preventDefault(); }
        return;
      }
      const list = this.opts.filter((o) => o.kind === this.cat && this.cat !== 'shoot' && o.tech === this.tech);
      const o = list[n - 1];
      if (!o || o.disabled) return;
      if (this.sel === o.id) this.confirm(o.id); else this.select(o.id);
      e.preventDefault();
    }
  };
}
