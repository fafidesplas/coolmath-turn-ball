// Combined plays (pixel edition): two or three players chain several actions in one decision (alley-oop,
// give and go, pick and roll with its roll, kick-out, backdoor, drive and dish, swing passes).
// A combo is a script of plain actions from rules.ts, each resolved with branches() like any single move, so
// its odds are exact and the balance is the same as playing those moves one by one. Pure logic: no DOM.
//
// The defense reads the play: the first step meets the move it picked; on every later step it reacts within
// the same family (deny jumps the lane or switches the cut, give space sends help to the rim, press contests).
// That is what turns a combo into a 2 on 2 or 3 on 3 duel.
import {
  ROUTES, ZONES, branches, canDunk, famOf, gngPartner, helperFor, rimDist, rollZone, zoneDist, STANCES,
  type Act, type Branch, type DefPlan, type Ev, type Matchup, type Poss, type Stance, type Zone,
} from '../rules.ts';
import type { TechId } from '../techs.ts';

export type ComboId = 'alley' | 'gng' | 'pnr' | 'kick' | 'backdoor' | 'dish' | 'swing';

export interface ComboDef {
  id: ComboId;
  name: string;
  /** Short menu name. */
  short: string;
  icon: string;
  /** Representative technique (icons, stats). */
  tech: TechId;
  line: string;
}

export const COMBOS: Record<ComboId, ComboDef> = {
  alley: { id: 'alley', name: 'Alley-oop', short: 'Alley-oop', icon: 't_lob', tech: 'lob', line: 'A mate runs to the rim, you throw it up, he dunks it in the air.' },
  gng: { id: 'gng', name: 'Give and go', short: 'Give & go', icon: 't_giveandgo', tech: 'giveandgo', line: 'Pass, run past your man, get it back and finish.' },
  pnr: { id: 'pnr', name: 'Pick and roll', short: 'Pick & roll', icon: 't_pnr', tech: 'pnr', line: 'A mate screens and rolls to the rim: feed the roller, or shoot if you come off free.' },
  kick: { id: 'kick', name: 'Kick-out', short: 'Kick-out', icon: 't_skip', tech: 'drive', line: 'Drive, pull the defense in, kick it out to the shooter.' },
  backdoor: { id: 'backdoor', name: 'Backdoor', short: 'Backdoor', icon: 't_backdoor', tech: 'backdoor', line: 'A mate cuts behind his man: bounce pass or lob, then the finish.' },
  dish: { id: 'dish', name: 'Drive and dish', short: 'Drive & dish', icon: 't_bounce', tech: 'bounce', line: 'Drive, and when help comes, drop it to the big inside.' },
  swing: { id: 'swing', name: 'Swing', short: 'Swing', icon: 'pass', tech: 'chest', line: 'Quick passes around the arc, then the shot.' },
};
export const COMBO_ORDER: ComboId[] = ['alley', 'pnr', 'gng', 'kick', 'backdoor', 'dish', 'swing'];

/** How a step's outcome reads for the chain: go on, stop (the ball is still yours) or end the possession. */
const CONTINUE = new Set<Ev>(['open', 'catch', 'feed', 'beat', 'help', 'room']);

/** One combo instance the player can pick. */
export interface ComboPlan {
  id: ComboId;
  /** Unique key (menu id). */
  key: string;
  /** Short target label in the menu ("#7", "#7 glass"). */
  tag: string;
  /** Attackers involved (slots), handler first. */
  who: number[];
  /** The main teammate (target of the play). */
  mate: number;
  /** Destination spot (give and go). */
  zone?: Zone;
  /** Look of the delivery (alley-oop off the glass, backdoor lob or bounce). */
  look?: 'lob' | 'glass' | 'bounce';
  /** Number of steps when everything goes right. */
  steps: number;
  /** The action of step `i` from state `s` (after the previous steps), or null when the chain is over. */
  next: (i: number, s: Poss, prev: Branch | null) => Act | null;
}

/** Best finish for `who` from state s: dunk if they can, layup at the post, floater at the elbow, else a jump shot. */
export function finishAct(m: Matchup, s: Poss, who: number): Act {
  const z = s.zones[who];
  if (canDunk(m.att[who], z, s.adv[who] > 0)) return { k: 'shoot', t: 'dunk' };
  const k = ZONES[z].kind;
  return { k: 'shoot', t: k === 'close' ? 'layup' : k === 'mid' ? 'floater' : 'jumper' };
}

/** A free close-to-the-rim spot for a cutter (nearest post first). */
function freePost(s: Poss, from: Zone): Zone | null {
  const taken = new Set(s.zones);
  const posts = (['postL', 'postR', 'elbowL', 'elbowR'] as Zone[]).filter((z) => !taken.has(z));
  posts.sort((a, b) => (ZONES[a].kind === 'close' ? 0 : 1) - (ZONES[b].kind === 'close' ? 0 : 1) || zoneDist(a, from) - zoneDist(b, from));
  return posts[0] ?? null;
}

/** The handler's drive toward the rim for kick-outs and dishes: a free neighbor inside the arc, nearest the rim. */
function driveSpot(s: Poss): Zone | null {
  const hz = s.zones[s.ball];
  const taken = new Set(s.zones);
  const out = ROUTES[hz].filter((z) => !taken.has(z) && ZONES[z].kind !== 'three' && rimDist(z) < rimDist(hz));
  return out.sort((a, b) => rimDist(a) - rimDist(b))[0] ?? null;
}

/** Every combo available from state s. */
export function combosFor(m: Matchup, s: Poss): ComboPlan[] {
  const out: ComboPlan[] = [];
  const h = s.ball;
  const hz = s.zones[h];
  const mates = [0, 1, 2].filter((j) => j !== h);
  const left = s.left;
  const gate = (n: number) => left >= n;
  // A step only goes on when the previous one worked; the chain stops on anything else.
  const ok = (prev: Branch | null) => !prev || (CONTINUE.has(prev.ev) && !!prev.next);

  // Alley-oop: the mate cuts to the rim (if not there yet), the lob, the finish in the air.
  for (const j of mates) {
    const at = s.zones[j];
    const inside = ZONES[at].kind === 'close';
    const post = inside ? at : freePost(s, at);
    if (!post) continue;
    const n = inside ? 2 : 3;
    if (!gate(n)) continue;
    const glass = TUNE_GLASS.includes(hz);
    for (const look of (glass ? ['lob', 'glass'] : ['lob']) as ('lob' | 'glass')[]) {
      out.push({
        id: 'alley', key: `alley-${j}-${look}`, tag: `#${j}${look === 'glass' ? ' glass' : ''}`, who: [h, j], mate: j, look, steps: n,
        next: (i, st, prev) => {
          if (!ok(prev)) return null;
          const k = inside ? i + 1 : i;
          if (k === 0) return { k: 'cut', who: j, z: post, t: 'cut' };
          if (k === 1) return { k: 'pass', to: j, t: 'lob' };
          if (k === 2) return finishAct(m, st, j);
          return null;
        },
      });
    }
  }

  // Give and go: pass to the nearest mate, run to a spot closer to the rim, get it back, finish.
  if (gate(2)) {
    const p = gngPartner(s);
    const taken = new Set(s.zones);
    for (const z of ROUTES[hz]) {
      if (taken.has(z) || !(rimDist(z) < rimDist(hz) - 0.5)) continue;
      out.push({
        id: 'gng', key: `gng-${z}`, tag: ZONES[z].name, who: [h, p], mate: p, zone: z, steps: 2,
        next: (i, st, prev) => {
          if (!ok(prev)) return null;
          if (i === 0) return { k: 'cut', who: h, z, t: 'giveandgo' };
          if (i === 1) return finishAct(m, st, h);
          return null;
        },
      });
    }
  }

  // Pick and roll: the screen, then the roll (pass to the roller and his finish) or the handler's pull-up.
  const roll = rollZone(s);
  if (roll && gate(3)) {
    for (const j of mates) {
      out.push({
        id: 'pnr', key: `pnr-${j}`, tag: `#${j}`, who: [h, j], mate: j, steps: 3,
        next: (i, st, prev) => {
          if (!ok(prev)) return null;
          if (i === 0) return { k: 'cut', who: j, z: roll, t: 'pnr' };
          // Step 2: the roller is open (pass to him) or the handler came off free (he shoots).
          if (i === 1) return prev!.ev === 'open' ? { k: 'pass', to: j, t: 'bounce' } : finishAct(m, st, h);
          if (i === 2) return prev!.next && prev!.next.ball === j ? finishAct(m, st, j) : null;
          return null;
        },
      });
    }
  }

  // Kick-out: drive in, the pass out to a mate on the arc, his jump shot.
  const dz = driveSpot(s);
  if (dz && gate(3)) {
    for (const j of mates) {
      if (ZONES[s.zones[j]].kind !== 'three') continue;
      out.push({
        id: 'kick', key: `kick-${j}`, tag: `#${j}`, who: [h, j], mate: j, steps: 3,
        next: (i, _st, prev) => {
          if (!ok(prev)) return null;
          if (i === 0) return { k: 'drive', z: dz, t: 'drive' };
          if (i === 1) return { k: 'pass', to: j, t: 'chest' };
          if (i === 2) return { k: 'shoot', t: 'jumper' };
          return null;
        },
      });
    }
  }

  // Backdoor: the mate cuts behind his man toward the rim; bounce pass (short) or lob; the finish.
  if (gate(3)) {
    const taken = new Set(s.zones);
    for (const j of mates) {
      const zj = s.zones[j];
      const z = ROUTES[zj].filter((q) => !taken.has(q) && rimDist(q) < rimDist(zj) - 0.5).sort((a, b) => rimDist(a) - rimDist(b))[0];
      if (!z) continue;
      const looks: ('bounce' | 'lob')[] = zoneDist(hz, z) <= 9 ? ['bounce', 'lob'] : ['lob'];
      for (const look of looks) {
        out.push({
          id: 'backdoor', key: `backdoor-${j}-${look}`, tag: `#${j} ${look}`, who: [h, j], mate: j, look, steps: 3,
          next: (i, st, prev) => {
            if (!ok(prev)) return null;
            if (i === 0) return { k: 'cut', who: j, z, t: 'backdoor' };
            if (i === 1) return { k: 'pass', to: j, t: look };
            if (i === 2) return finishAct(m, st, j);
            return null;
          },
        });
      }
    }
  }

  // Drive and dish: drive in, the drop-off to a mate inside the arc (the post), his finish.
  if (dz && gate(3)) {
    for (const j of mates) {
      if (ZONES[s.zones[j]].kind === 'three') continue;
      out.push({
        id: 'dish', key: `dish-${j}`, tag: `#${j}`, who: [h, j], mate: j, steps: 3,
        next: (i, st, prev) => {
          if (!ok(prev)) return null;
          if (i === 0) return { k: 'drive', z: dz, t: 'drive' };
          if (i === 1) return { k: 'pass', to: j, t: zoneDist(dz, s.zones[j]) <= 9 ? 'bounce' : 'chest' };
          if (i === 2) return finishAct(m, st, j);
          return null;
        },
      });
    }
  }

  // Swing: two quick passes (to the near mate, then to the far one), the far one shoots.
  if (gate(3)) {
    for (const j of mates) {
      const k = mates.find((x) => x !== j)!;
      out.push({
        id: 'swing', key: `swing-${j}-${k}`, tag: `#${j} > #${k}`, who: [h, j, k], mate: k, steps: 3,
        next: (i, st, prev) => {
          if (!ok(prev)) return null;
          if (i === 0) return { k: 'pass', to: j, t: 'chest' };
          if (i === 1) return { k: 'pass', to: k, t: zoneDist(st.zones[j], st.zones[k]) > 9 ? 'skip' : 'chest' };
          if (i === 2) return finishAct(m, st, k);
          return null;
        },
      });
    }
  }
  return out;
}

/** Alley-oops off the glass need an angle to the backboard (wings and elbows). */
const TUNE_GLASS: Zone[] = ['wingL', 'wingR', 'elbowL', 'elbowR'];

/**
 * The defense's answer to a later step of a combo, within the family it picked: deny jumps passing lanes and
 * switches cuts; give space sends help to the rim (Block) and sags on jump shots; press contests shots.
 */
export function reaction(dm0: TechId, act: Act): TechId {
  const fam: Stance = famOf(dm0);
  if (act.k === 'pass') return fam === 'deny' ? 'jump' : fam === 'press' ? 'press' : 'space';
  if (act.k === 'cut') return fam === 'deny' ? 'switch' : fam === 'space' ? 'space' : 'press';
  if (act.k === 'drive') return fam === 'press' ? 'press' : fam === 'space' ? 'space' : 'deny';
  const rimShot = act.t === 'dunk' || act.t === 'layup';
  if (fam === 'space') return rimShot ? 'rim' : 'space';
  if (fam === 'press') return 'contest';
  return 'deny';
}

/** What a reaction looks like on the court (callout word). */
export const REACT_WORD: Partial<Record<TechId, string>> = {
  jump: 'READS IT', switch: 'SWITCH', rim: 'HELP', contest: 'CONTEST', space: 'SAG', press: 'PRESS', deny: 'DENY',
};

/** Outcome of a whole combo, in the categories shown in the menu. */
export interface ComboOdds { score: number; pts: number; miss: number; block: number; stop: number; lost: number }

/** Exact odds of a combo against a defensive plan (every branch of every step, every stance of the mix). */
export function comboOdds(m: Matchup, s: Poss, c: ComboPlan, plan: DefPlan): ComboOdds {
  const o: ComboOdds = { score: 0, pts: 0, miss: 0, block: 0, stop: 0, lost: 0 };
  const walk = (st: Poss, i: number, prev: Branch | null, dm0: TechId, w: number) => {
    const act = c.next(i, st, prev);
    if (!act) {
      // The chain stopped: prev decides where the possession stands.
      if (prev) leaf(prev, w);
      return;
    }
    const dm = i === 0 ? dm0 : reaction(dm0, act);
    for (const b of branches(m, st, act, dm)) {
      const p = w * b.p;
      if (p < 1e-9) continue;
      if (b.next && CONTINUE.has(b.ev) && i + 1 < 4) walk(b.next, i + 1, b, dm0, p);
      else leaf(b, p);
    }
  };
  const leaf = (b: Branch, p: number) => {
    if (b.ev === 'make' || b.ev === 'and1') { o.score += p; o.pts += p * b.pts; }
    else if (b.ev === 'block') o.block += p;
    else if (b.ev === 'miss' || b.ev === 'oreb') o.miss += p;
    else if (!b.next) o.lost += p;
    else o.stop += p;
  };
  for (const st of STANCES) if (plan.dist[st] > 0) walk(s, 0, null, plan.v[st], plan.dist[st]);
  return o;
}

/** Odds of a combo against one stance only (edge against the opponent's tell). */
export function comboScoreVs(m: Matchup, s: Poss, c: ComboPlan, dm: TechId): number {
  const one: DefPlan = { dist: { press: 0, space: 0, deny: 0, [famOf(dm)]: 1 } as Record<Stance, number>, v: { press: 'press', space: 'space', deny: 'deny', [famOf(dm)]: dm } as Record<Stance, TechId> };
  const o = comboOdds(m, s, c, one);
  return o.score + o.stop * 0.3;
}

/** Plain helpers for the scene: who helps on a drive to z (re-exported for the animation). */
export { helperFor };
