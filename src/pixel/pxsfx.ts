// Extra sound effects of the pixel edition (sneaker squeaks, dribble, crowd, slam), synthesized with Web Audio
// like the shared ones in ../audio.ts, which stays untouched. Follows the shared Sound switch.
import { soundOn } from '../audio';

let ctx: AudioContext | null = null;
const unlock = () => {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
};
document.addEventListener('pointerdown', unlock, { capture: true });
document.addEventListener('keydown', unlock, { capture: true });

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (!soundOn() || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Filtered noise with an attack (crowd swells) or a sharp hit. */
function noise(dur: number, vol: number, freq: number, attack = 0.01, delay = 0, q = 0.8) {
  if (!soundOn() || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

let lastSqueak = 0;
export const pxsfx = {
  /** Sneaker squeak on a hard cut (rate-limited). */
  squeak: () => {
    const now = performance.now();
    if (now - lastSqueak < 250) return;
    lastSqueak = now;
    tone(2200 + Math.random() * 500, 0.06, 'sine', 0.025, 3100);
  },
  /** One dribble on the floor. */
  dribble: () => tone(120, 0.06, 'sine', 0.05, 70),
  /** The crowd roars (k: 0.5 small, 1 big). */
  crowd: (k = 1) => { noise(0.9 + k * 0.5, 0.05 + k * 0.05, 900, 0.15); noise(0.7 + k * 0.4, 0.03 + k * 0.03, 2200, 0.1, 0.05); },
  /** The crowd goes "ooh" (blocks, steals). */
  ooh: () => { noise(0.7, 0.06, 420, 0.12, 0, 4); tone(220, 0.5, 'triangle', 0.02, 180, 0.05); },
  /** Dunk: a low thump on the rim. */
  slam: () => { tone(90, 0.25, 'square', 0.07, 45); noise(0.18, 0.1, 300, 0.005); },
};
