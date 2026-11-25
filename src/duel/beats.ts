// Turn Ball 1v1: the animated beats shared by every 1v1 mode (dice, timing, cards). Given the state before a
// move, the move, the defense's stance and the result (rules.ts), it plays the scene: drives, crossovers,
// step-backs, shots, dunks, blocks, steals and rebounds, with the result word over the stage.
import { sfx } from '../audio';
import { pxsfx } from '../pixel/pxsfx';
import { releaseIndex } from '../pixel/sprites';
import { HOOP, anim, ball, cheer, dribble, face, jump, move, moveThen, players, proj, say, shake, swishNet, throwBall, view, wait, type Ent } from './scene';
import { GUARD, shotKind, type MoveId, type Out, type St, type Stance } from './rules';

/** Court x of each zone: the three, the mid-range (elbow), the paint. */
export const ZX = [5.0, 8.6, 10.9];
export const ZONE_NAME = ['three', 'mid-range', 'paint'];
export const AZ = 7.9, DZ = 7.3;

/** The duel the guard pips are drawn for (null between possessions). */
export const hud: { cur: { s: St; att: Ent; def: Ent } | null } = { cur: null };
export function guardOverlay() {
  view.overlay = (g) => {
    const cur = hud.cur;
  if (!cur) return;
    // Guard pips over the defender: filled = balance left, hollow = lost.
    const d = cur.def, p = proj(d.x, d.z, d.h + 2.55);
    const n = GUARD, w = 5;
    const x0 = Math.round(p.x - (n * w + (n - 1)) / 2), y = Math.round(p.y);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w + 1);
      g.fillStyle = '#1b1029';
      g.fillRect(x - 1, y - 1, w + 2, w + 2);
      g.fillStyle = i < cur.s.guard ? '#7ee0ff' : '#3a2a55';
      g.fillRect(x, y, w, w);
      if (i < cur.s.guard) { g.fillStyle = '#e6f8ff'; g.fillRect(x, y, w, 1); }
    }
    if (cur.s.guard === 0) {
      // Broken: a little spinning star.
      const t = performance.now() / 120;
      g.fillStyle = '#ffd166';
      g.fillRect(Math.round(p.x + Math.cos(t) * 6), y - 4 + Math.round(Math.sin(t) * 2), 2, 2);
    }
  };
}

/** Check the ball at the top: the attacker takes it to the three, the defender picks him up. */
export async function checkIn(a: Ent, d: Ent) {
  give(a);
  faceHoop(a, d);
  anim(a, 'Run_Ball', 85, true); anim(d, 'Run', 85, true);
  move(a, ZX[0], AZ, 0.9); move(d, ZX[0] + 1.2, DZ, 0.9);
  view.goal = 7.8;
  await wait(0.95);
  dribble(a); anim(d, 'Idle_2', 110, true);
  sfx.whistle();
}

// ---------------------------------------------------------------- animation helpers
export const faceHoop = (a: Ent, d: Ent) => { face(a, true); face(d, false); };
export function defSpot(a: Ent, st: Stance) { return { x: a.x + (st === 'sag' ? 2.1 : 0.95), z: DZ }; }
export async function setStance(d: Ent, a: Ent, st: Stance) {
  const p = defSpot(a, st);
  face(d, false);
  if (Math.abs(d.x - p.x) > 0.1 || Math.abs(d.z - p.z) > 0.1) {
    anim(d, 'Slide', 90, true);
    move(d, p.x, p.z, 0.45);
    pxsfx.squeak();
    await wait(0.45);
  }
  anim(d, st === 'sag' ? 'Idle' : 'Idle_2', 110, true);
  dribble(a);
}

/** Ball from a shooter to the rim; then the make, the miss or nothing (blocked). */
export function shotFlight(a: Ent, apex: number, dur: number, made: boolean, def: Ent): Promise<void> {
  return new Promise((res) => {
    throwBall(a, HOOP.x, HOOP.z, HOOP.h + 0.15, apex, dur, () => {
      if (made) {
        sfx.swish(); swishNet();
        ball.flight = { fx: HOOP.x, fz: HOOP.z, fh: HOOP.h + 0.15, tx: HOOP.x - 0.2, tz: HOOP.z, th: 0.15, apex: 0, t: 0, dur: 0.4, done: () => { ball.bounce = { vx: -0.8, vz: 0.3, vh: 2 }; } };
      } else {
        sfx.rim();
        ball.flight = { fx: HOOP.x, fz: HOOP.z, fh: HOOP.h + 0.15, tx: def.x, tz: def.z, th: 2.3, apex: 0.8, t: 0, dur: 0.6, done: () => {} };
      }
      res();
    });
  });
}

/** Hand the ball to a player (catch in place). */
export function give(e: Ent) { ball.free = false; ball.flight = null; ball.bounce = null; for (const p of players) p.ball = p === e; }

// ---------------------------------------------------------------- one beat, animated
export async function playBeat(s: St, m: MoveId, st: Stance, o: Out, a: Ent, d: Ent) {
  view.goal = Math.min(10.5, Math.max(7.6, a.x + 1.6));
  if (m === 'drive') {
    const nx = ZX[s.zone + 1];
    if (o.ev === 'steal') return stealIt(a, d, 'Steal');
    if (o.ev === 'stopped') {
      anim(a, 'Sprint_Ball', 70, true); move(a, a.x + 0.7, AZ, 0.3);
      anim(d, 'Slide', 70, true); move(d, d.x - 0.1, AZ - 0.35, 0.3);
      await wait(0.3);
      sfx.clash(); shake(0.12);
      say('WALLED!');
      anim(a, 'Back_Dribble', 90, true); move(a, a.x - 0.7, AZ, 0.45);
      anim(d, 'Idle_2', 110, true);
      await wait(0.6);
      return;
    }
    // Beat or burned: past him, to the next spot.
    if (o.ev === 'burn') { anim(d, 'Steal', 60); move(d, d.x - 0.5, DZ, 0.2); }
    anim(a, 'Sprint_Ball', 65, true); move(a, nx, AZ, 0.6);
    pxsfx.squeak();
    view.goal = Math.min(10.5, nx + 0.8);
    await wait(o.ev === 'burn' ? 0.25 : 0.1);
    face(d, true); anim(d, 'Run', 80, true); move(d, nx + (o.ev === 'burn' ? -0.7 : 0.4), DZ - 0.3, o.ev === 'burn' ? 0.9 : 0.6);
    if (o.ev === 'burn') say('BURNED!');
    await wait(0.6);
    dribble(a);
    await wait(o.ev === 'burn' ? 0.4 : 0.15);
    return;
  }
  if (m === 'cross') {
    // The crossover family: the move changes the dribbling hand.
    const CROSS = ['Crossover', 'Between', 'Behind_Back'];
    const T = moveThen(a, CROSS[Math.floor(Math.random() * CROSS.length)], 72, true);
    if (o.ev === 'steal') { await wait(T * 0.4); return stealIt(a, d, 'Steal'); }
    pxsfx.squeak();
    if (o.ev === 'read') {
      anim(d, 'Slide', 80, true); move(d, d.x, DZ + 0.35, T * 0.5);
      await wait(T);
      anim(d, 'Idle_2', 110, true);
      say('READ IT!');
      await wait(0.4);
      return;
    }
    // He bites the wrong way.
    const broke = o.ev === 'broke';
    anim(d, 'Slide', 70, true); move(d, d.x + 0.3, DZ - (broke ? 1.6 : 0.9), T * 0.7);
    await wait(T * 0.75);
    if (broke) {
      // Ankles: he spins around, lost.
      for (let k = 0; k < 3; k++) { face(d, k % 2 === 0); await wait(0.09); }
      face(d, false);
      anim(d, 'Idle', 140, true);
      say('ANKLES!');
      shake(0.18); pxsfx.ooh();
    } else say('SHOOK HIM!');
    await wait(0.6);
    return;
  }
  if (m === 'step') {
    const nx = ZX[o.next!.zone] - (o.next!.zone === s.zone ? 0.6 : 0);
    const T = anim(a, 'Side_Step', 70);
    move(a, nx, AZ, T);
    pxsfx.squeak();
    if (o.ev === 'room') {
      await wait(T * 0.3);
      anim(d, st === 'gamble' ? 'Steal' : 'Slide', 80, st !== 'gamble'); move(d, d.x - 0.4, DZ, 0.3);
      await wait(T * 0.7);
      say('SPACE!');
    } else {
      anim(d, 'Slide', 80, true); move(d, nx + 1.0, DZ, T);
      await wait(T);
      say('STUCK');
    }
    dribble(a); anim(d, 'Idle_2', 110, true);
    await wait(0.4);
    return;
  }
  return shoot(s, st, o, a, d);
}

export async function stealIt(a: Ent, d: Ent, tag: string) {
  anim(d, tag, 65); move(d, a.x + 0.4, DZ + 0.3, 0.25);
  await wait(0.22);
  give(d);
  sfx.steal(); pxsfx.ooh(); shake(0.12);
  say('STEAL!');
  await wait(0.3);
  face(d, false); anim(d, 'Sprint_Ball', 70, true); move(d, d.x - 2.2, DZ, 0.8);
  anim(a, 'Idle', 120, true);
  await wait(0.9);
}

export async function shoot(s: St, st: Stance, o: Out, a: Ent, d: Ent) {
  const k = shotKind(s);
  const contest = st !== 'sag' && !s.space && s.guard > 0;
  if (k === 'dunk' || k === 'layup') {
    // Take off toward the rim.
    // Flying dunks vary (Dunk_5 and Dunk_6 finish with the back to the rim).
    const DUNKS = ['Dunk_3', 'Dunk_5', 'Dunk_6'];
    const tag = k === 'dunk' ? DUNKS[Math.floor(Math.random() * DUNKS.length)] : 'Layup', ms = k === 'dunk' ? 70 : 75;
    anim(a, tag, ms);
    const rel = Math.max(1, releaseIndex(tag)) * ms / 1000;
    move(a, HOOP.x - (k === 'dunk' ? 0.55 : 0.8), AZ - 0.2, rel);
    jump(a, k === 'dunk' ? 1.15 : 0.75, rel + 0.35);
    view.goal = 10.5;
    if (contest || o.ev === 'block') { anim(d, 'Block_1', 65); jump(d, o.ev === 'block' ? 0.95 : 0.6, 0.65); move(d, HOOP.x - 0.4, DZ, 0.4); }
    await wait(rel);
    if (o.ev === 'block') {
      a.ball = false; ball.free = true; ball.x = a.x + 0.4; ball.z = a.z; ball.h = 2.9; ball.bounce = { vx: -6, vz: 1, vh: 1.5 };
      sfx.clash(); pxsfx.ooh(); shake(0.25); say('BLOCKED!');
      await wait(1.1);
      give(d);
      return;
    }
    if (k === 'dunk' && o.ev === 'score') {
      a.ball = false; ball.free = true;
      ball.flight = { fx: HOOP.x, fz: HOOP.z, fh: HOOP.h + 0.25, tx: HOOP.x, tz: HOOP.z, th: 0.15, apex: 0, t: 0, dur: 0.4, done: () => { ball.bounce = { vx: -1.2, vz: 0.3, vh: 2.5 }; sfx.bounce(); } };
      pxsfx.slam(); sfx.swish(); shake(0.3); swishNet();
      say('SLAM!'); cheer();
      await wait(1.2);
      return;
    }
    await shotFlight(a, 0.5, 0.35, o.ev === 'score', d);
  } else {
    const tag = k === 'three' ? 'Jumpshot_3' : 'Jumpshot', ms = 70;
    anim(a, tag, ms);
    const rel = Math.max(1, releaseIndex(tag)) * ms / 1000;
    jump(a, 0.45, 0.65);
    await wait(rel * 0.6);
    if (contest || o.ev === 'block') { anim(d, o.ev === 'block' ? 'Block_1' : 'Block_2', 70); jump(d, 0.6, 0.6); move(d, a.x + 0.7, DZ, 0.3); }
    await wait(rel * 0.4);
    if (o.ev === 'block') {
      a.ball = false; ball.free = true; ball.x = a.x + 0.5; ball.z = a.z; ball.h = 2.6; ball.bounce = { vx: -5, vz: 1.2, vh: 2 };
      sfx.clash(); pxsfx.ooh(); shake(0.25); say('BLOCKED!');
      await wait(1.1);
      give(d);
      return;
    }
    view.goal = 9.6;
    await shotFlight(a, k === 'three' ? 2.3 : 1.7, k === 'three' ? 1.05 : 0.85, o.ev === 'score', d);
  }
  if (o.ev === 'score') {
    say(k === 'three' ? 'SPLASH!' : 'BUCKET!');
    cheer();
    await wait(1.0);
  } else {
    // Rebound: the defender goes up and gets it.
    face(d, true); anim(d, 'Rebound_1', 70); jump(d, 0.5, 0.5);
    await wait(0.55);
    give(d);
    say('NO GOOD');
    await wait(0.6);
  }
  anim(a, 'Idle', 120, true);
}
