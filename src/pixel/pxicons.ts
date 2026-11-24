// Pixel icons: the game's 24-unit SVG icons rasterized once at boot onto a 16x16 grid, then emitted as
// crisp SVG rectangles (shape-rendering: crispEdges) in currentColor, drawn at 1x, 2x or 4x.
import { icon as vectorIcon } from '../icons';
import { TECHS } from '../techs';

const NAMES = [
  'shoot', 'pass', 'dribble', 'protect', 'steal', 'block', 'press', 'wait', 'star', 'act', 'pause', 'play', 'back', 'coin',
  'team', 'scout', 'help', 'soundOn', 'soundOff', 'lock', 'check', 'cross', 'trophy', 'up', 'ball', 'hoop', 'energy',
  'move', 'space', 'deny', 'cut', 'even', 'beaten', 'slot', 'train', 'next', 'fire',
  ...Object.values(TECHS).map((t) => t.icon),
];
const G = 16;
const mono = new Map<string, string>();
const color = new Map<string, string>();

function rowsToPath(mask: (x: number, y: number) => boolean) {
  let d = '';
  for (let y = 0; y < G; y++) {
    let x = 0;
    while (x < G) {
      if (!mask(x, y)) { x++; continue; }
      const x0 = x;
      while (x < G && mask(x, y)) x++;
      d += `M${x0} ${y}h${x - x0}v1h${x0 - x}z`;
    }
  }
  return d;
}

function raster(name: string): Promise<void> {
  const svg = vectorIcon(name, G).replace('stroke-width="2.1"', 'stroke-width="2.5"').replace(/currentColor/g, '#000');
  const multi = name === 'coin';
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = G;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, G, G);
      const d = g.getImageData(0, 0, G, G).data;
      const on = (x: number, y: number) => d[(y * G + x) * 4 + 3] >= 110;
      if (!multi) mono.set(name, rowsToPath(on));
      else {
        // Keep the icon's own two colors (coin): light fill, dark rim and marks.
        const dark = (x: number, y: number) => on(x, y) && d[(y * G + x) * 4] < 200;
        const light = (x: number, y: number) => on(x, y) && !dark(x, y);
        color.set(name, `<path fill="#ffd166" d="${rowsToPath(light)}"/><path fill="#9a6a00" d="${rowsToPath(dark)}"/>`);
      }
      res();
    };
    img.onerror = () => res();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
  });
}

export async function initIcons() {
  await Promise.all([...new Set(NAMES)].map(raster));
}

export function icon(name: string, size = 24, cls = ''): string {
  const S = Math.max(1, Math.floor(size / G + 0.35)) * G;
  const inner = color.get(name) ?? `<path fill="currentColor" d="${mono.get(name) ?? ''}"/>`;
  return `<svg class="ico px ${cls}" width="${S}" height="${S}" viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;
}
