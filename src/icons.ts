// Hand-drawn SVG icon set (24x24 grid). No emoji, no icon fonts.
const P: Record<string, string> = {
  shoot: '<circle cx="7" cy="17" r="3.2"/><path d="M9.5 14.5C12 8 16 5.5 19.5 6"/><path d="M16 4.5l3.6 1.6-1.8 3.4"/><path d="M15.5 12.5h6l-.8 2.5h-4.4z" fill="currentColor" stroke="none" opacity=".55"/>',
  pass: '<circle cx="4.5" cy="12" r="2.4"/><circle cx="19.5" cy="12" r="2.4"/><path d="M7.5 12h8" stroke-dasharray="2 2.2"/><path d="M13.5 8.8 17 12l-3.5 3.2"/>',
  dribble: '<path d="M4 19l4-5 4 3 4-6 4 2"/><path d="M17.2 6.6 20.3 13l-6.6-.4"/><circle cx="6" cy="6" r="2.4"/>',
  protect: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 7.8-7.5 9.5-4.3-1.7-7.5-4.9-7.5-9.5V6z"/><circle cx="12" cy="11.5" r="2.6"/>',
  steal: '<path d="M7 20v-7.5a1.6 1.6 0 0 1 3.2 0V11a1.6 1.6 0 0 1 3.2 0v.6a1.6 1.6 0 0 1 3.2 0V13a1.6 1.6 0 0 1 3.2 0v2.5c0 3-2 4.5-4.6 4.5H10z"/><circle cx="6" cy="5.5" r="2.6"/><path d="M8.6 7l2.4 2"/>',
  block: '<path d="M6 21V10a1.6 1.6 0 0 1 3.2 0V6a1.6 1.6 0 0 1 3.2 0v-1a1.6 1.6 0 0 1 3.2 0V7a1.6 1.6 0 0 1 3.2 0v8c0 3.5-2.4 6-5.8 6z"/><path d="M2 3l3 3M2 8h2.5"/>',
  press: '<circle cx="12" cy="12" r="2.8"/><path d="M2.5 12h4.5M21.5 12H17M12 2.5V7M12 21.5V17"/><path d="M5 9.8 7.2 12 5 14.2M19 9.8 16.8 12 19 14.2"/>',
  wait: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/>',
  act: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="#ffd166" stroke="#b8860b"/><path d="M12 7.5v9M9.5 10h5M9.5 14h5" stroke="#b8860b"/>',
  team: '<path d="M8 3.5 4 6l-2 5 3.2 1.3L7 10v10.5h10V10l1.8 2.3L22 11l-2-5-4-2.5c-.6 1.6-2.1 2.5-4 2.5S8.6 5.1 8 3.5z"/>',
  scout: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/><path d="M10.5 7.5v6M7.5 10.5h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.5a2.8 2.8 0 1 1 3.8 2.6c-.8.4-1.1 1-1.1 1.9v.5"/><circle cx="12" cy="17.4" r=".6" fill="currentColor"/>',
  soundOn: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 21h8M9.5 18h5"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3.5 3 3.5 9.8 0 12.8M18.4 5.6c-3.5 3-3.5 9.8 0 12.8"/>',
  hoop: '<rect x="5" y="2.5" width="14" height="8" rx="1"/><path d="M9 6h6v4.5"/><path d="M7.5 10.5h9l-1.5 9h-6z"/><path d="M8.3 14h7.4M9 17h6"/>',
  energy: '<path d="M13.5 2 5 13.5h6L10 22l9-12h-6.2z" fill="currentColor"/>',
  move: '<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><path d="M9.5 4.5 12 2l2.5 2.5M9.5 19.5 12 22l2.5-2.5M4.5 9.5 2 12l2.5 2.5M19.5 9.5 22 12l-2.5 2.5"/>',
  even: '<path d="M5 9.5h14M5 14.5h14"/>',
  beaten: '<path d="M4 18 18 6"/><path d="M11 5.5h7.5V13"/>',
};

export function icon(name: string, size = 24, cls = ''): string {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}
