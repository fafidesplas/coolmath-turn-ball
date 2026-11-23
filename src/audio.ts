// Tiny Web Audio synth for retro sound effects. No audio files needed.
let ctx: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean) { enabled = on; }
export function soundOn() { return enabled; }

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slideTo?: number, delay = 0) {
  if (!enabled || !ctx) return;
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

function noise(dur: number, vol = 0.08, freq = 1200, delay = 0) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  tap: () => tone(660, 0.05, 'square', 0.04),
  bounce: () => tone(140, 0.08, 'sine', 0.12, 70),
  pass: () => tone(500, 0.1, 'triangle', 0.06, 900),
  swish: () => { noise(0.25, 0.12, 3000); tone(880, 0.12, 'triangle', 0.05, 1320, 0.05); },
  rim: () => { tone(320, 0.18, 'square', 0.05, 180); },
  whistle: () => { tone(2100, 0.12, 'sine', 0.06); tone(2300, 0.18, 'sine', 0.06, undefined, 0.12); },
  duel: () => { tone(220, 0.12, 'sawtooth', 0.06, 440); tone(440, 0.15, 'sawtooth', 0.05, 880, 0.1); },
  tick: () => tone(1200, 0.03, 'square', 0.025),
  clash: () => { noise(0.2, 0.15, 800); tone(150, 0.2, 'square', 0.06, 60); },
  good: () => { tone(523, 0.1, 'square', 0.05); tone(659, 0.1, 'square', 0.05, undefined, 0.08); tone(784, 0.18, 'square', 0.05, undefined, 0.16); },
  bad: () => { tone(392, 0.15, 'square', 0.05); tone(262, 0.25, 'square', 0.05, undefined, 0.12); },
  steal: () => tone(900, 0.12, 'square', 0.05, 300),
  buzzer: () => tone(110, 0.7, 'sawtooth', 0.07),
  coin: () => { tone(988, 0.07, 'square', 0.04); tone(1319, 0.15, 'square', 0.04, undefined, 0.07); },
  levelUp: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', 0.06, undefined, i * 0.09)),
  cheer: () => { noise(0.8, 0.06, 1500); noise(0.6, 0.05, 2500, 0.1); },
};
