// Turn Ball: animation viewer (/anims/). Every animation tag in the game's atlas (built from the licensed pack),
// listed; picking one plays it on a player, big, with its own frame timings. Controls: play/pause, step frame
// by frame, speed, loop, mirror, with or without the ball, and the kit.
import '@fontsource/press-start-2p/400.css';
import './style.css';
import { A, FEET, drawPlayer, loadAtlas, type Kit, type Look } from '../pixel/sprites';

const KITS: Record<string, Kit> = {
  Home: { jersey: '#f4efe6', shade: '#b9ae9f', stripe: '#f72585', stripe2: '#1b1029', band: null },
  Away: { jersey: '#1f6f63', shade: '#134a42', stripe: null, stripe2: null, band: '#ffd166' },
  Street: { jersey: '#8d99ae', shade: '#5c667a', stripe: null, stripe2: null, band: null },
};
const LOOKS: Omit<Look, 'kit'>[] = [
  { skin: '#c98a5a', hair: '#2e222f', hairStyle: 1 },
  { skin: '#7a4a32', hair: '#1b1029', hairStyle: 3 },
  { skin: '#f0c6a0', hair: '#d9a441', hairStyle: 2 },
];
const CW = 96, CH = 72;

const app = document.getElementById('app')!;
app.innerHTML = `
  <main class="viewer">
    <header><a class="back" href="../menu/">&#9776; MODES</a><h1>ANIMATIONS</h1><span id="count"></span></header>
    <div class="body">
      <nav class="list" id="list" role="listbox" aria-label="Animations"></nav>
      <section class="stagebox">
        <canvas id="cv" width="${CW}" height="${CH}" aria-label="The selected animation, played on a player"></canvas>
        <div class="info" id="info"></div>
        <div class="ctrls">
          <button id="prev" aria-label="Previous frame">&#9664;</button>
          <button id="play" aria-label="Play or pause">PAUSE</button>
          <button id="next" aria-label="Next frame">&#9654;</button>
          <button id="speed">1x</button>
          <button id="loop" class="on">LOOP</button>
          <button id="flip">MIRROR</button>
          <button id="ball" class="on">BALL</button>
          <button id="kit">HOME</button>
          <button id="look">LOOK 1</button>
        </div>
        <p class="keys">Up/Down: pick · Space: play/pause · Left/Right: frame by frame</p>
      </section>
    </div>
  </main>`;
const $ = (id: string) => document.getElementById(id)!;
const cv = $('cv') as HTMLCanvasElement;
const g = cv.getContext('2d')!;
g.imageSmoothingEnabled = false;

const st = { tag: '', t: 0, frame: 0, playing: true, speed: 1, loop: true, flip: false, ball: true, kit: 'Home', look: 0 };
let tags: [string, [number, number]][] = [];

function fit() {
  const box = cv.parentElement!.clientWidth;
  const k = Math.max(2, Math.min(8, Math.floor(Math.min(box, innerHeight * 0.6) / CW)));
  cv.style.width = `${CW * k}px`;
  cv.style.height = `${CH * k}px`;
}
addEventListener('resize', fit);

function select(tag: string) {
  st.tag = tag; st.t = 0; st.frame = 0; st.playing = true;
  $('play').textContent = 'PAUSE';
  $('list').querySelectorAll<HTMLElement>('.item').forEach((b) => {
    const on = b.dataset.tag === tag;
    b.classList.toggle('cur', on);
    b.setAttribute('aria-selected', String(on));
    if (on) {
      // Scroll the list only (scrollIntoView would also scroll the page around it).
      const l = $('list'), top = b.offsetTop - l.offsetTop, bot = top + b.offsetHeight;
      if (top < l.scrollTop) l.scrollTop = top;
      else if (bot > l.scrollTop + l.clientHeight) l.scrollTop = bot - l.clientHeight;
    }
  });
}
const range = () => A.tags[st.tag];
const len = () => { const [a, b] = range(); return b - a + 1; };
const durOf = (i: number) => (A.durs[range()[0] + i] ?? 100) / 1000;

function info() {
  const [a, b] = range();
  const total = Array.from({ length: len() }, (_, i) => durOf(i)).reduce((x, y) => x + y, 0);
  $('info').innerHTML = `<b>${st.tag}</b><span>frame ${st.frame + 1}/${len()} · atlas #${a + st.frame} (${a}-${b}) · ${Math.round(durOf(st.frame) * 1000)} ms · total ${total.toFixed(2)} s</span>`;
}

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (st.playing && st.tag) {
    st.t += dt * st.speed;
    while (st.t >= durOf(st.frame)) {
      st.t -= durOf(st.frame);
      if (st.frame + 1 < len()) st.frame++;
      else if (st.loop) st.frame = 0;
      else { st.t = 0; st.playing = false; $('play').textContent = 'PLAY'; break; }
    }
  }
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  g.fillStyle = '#2b1d45';
  g.fillRect(0, 0, CW, CH);
  // A strip of court floor with a line, and the player's shadow.
  g.fillStyle = '#e2ab77';
  g.fillRect(0, 52, CW, CH - 52);
  g.fillStyle = '#cf9563';
  for (let y = 55; y < CH; y += 4) g.fillRect(0, y, CW, 1);
  g.fillStyle = '#fff7ea';
  g.fillRect(0, 60, CW, 1);
  if (!st.tag) return;
  const fx = CW / 2, fy = 58;
  g.fillStyle = 'rgba(27,16,41,0.35)';
  g.fillRect(fx - 9, fy - 1, 18, 3);
  const look: Look = { ...LOOKS[st.look], kit: KITS[st.kit] };
  drawPlayer(g, look, range()[0] + st.frame, fx - FEET.x, fy - FEET.y, st.flip, st.ball);
  info();
}

function step(d: number) {
  st.playing = false;
  $('play').textContent = 'PLAY';
  st.t = 0;
  st.frame = (st.frame + d + len()) % len();
}
function move(d: number) {
  const i = tags.findIndex(([t]) => t === st.tag);
  select(tags[(i + d + tags.length) % tags.length][0]);
}
const toggle = (id: string, on: boolean) => $(id).classList.toggle('on', on);

$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('play').addEventListener('click', () => { st.playing = !st.playing; if (st.playing && !st.loop && st.frame === len() - 1) st.frame = 0; $('play').textContent = st.playing ? 'PAUSE' : 'PLAY'; });
$('speed').addEventListener('click', () => { const s = [0.25, 0.5, 1, 2]; st.speed = s[(s.indexOf(st.speed) + 1) % s.length]; $('speed').textContent = `${st.speed}x`; });
$('loop').addEventListener('click', () => { st.loop = !st.loop; toggle('loop', st.loop); });
$('flip').addEventListener('click', () => { st.flip = !st.flip; toggle('flip', st.flip); });
$('ball').addEventListener('click', () => { st.ball = !st.ball; toggle('ball', st.ball); });
$('kit').addEventListener('click', () => { const k = Object.keys(KITS); st.kit = k[(k.indexOf(st.kit) + 1) % k.length]; $('kit').textContent = st.kit.toUpperCase(); });
$('look').addEventListener('click', () => { st.look = (st.look + 1) % LOOKS.length; $('look').textContent = `LOOK ${st.look + 1}`; });
$('list').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.item'); if (b) select(b.dataset.tag!); });
addEventListener('keydown', (e) => {
  if (!st.tag) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === ' ') { e.preventDefault(); $('play').click(); }
});

loadAtlas().then(() => {
  // In the pack's order (by first frame).
  tags = Object.entries(A.tags).sort((a, b) => a[1][0] - b[1][0]);
  $('count').textContent = `${tags.length} tags · ${A.frames} frames`;
  $('list').innerHTML = tags.map(([t, [a, b]]) => `<button class="item" role="option" data-tag="${t}"><span>${t}</span><small>${b - a + 1}</small></button>`).join('');
  fit();
  select(tags[0][0]);
  requestAnimationFrame(loop);
}).catch(() => { app.innerHTML = '<p style="padding:24px">Could not load the game art. Reload to try again.</p>'; });
