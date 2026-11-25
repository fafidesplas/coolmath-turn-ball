// Turn Ball: the mode menu (/menu/). One page that links every prototype of the game, so they can be played
// side by side: the 3D and pixel 3x3 games, the 5v5 playbook, the three 1v1 duels (dice, timing, cards), and
// the animation viewer.
import '@fontsource/press-start-2p/400.css';
import './style.css';

interface Mode { href: string; name: string; tag: string; text: string }
const GROUPS: { title: string; modes: Mode[] }[] = [
  {
    title: '1 VS 1 · SIDE VIEW',
    modes: [
      { href: '../cards/', name: 'Cards', tag: 'CARDS', text: 'Both hands face up. Play a move card against his stance card: power against stop, no dice. Make him spend his best answer before you shoot.' },
      { href: '../1v1/?mode=timing', name: 'Timing', tag: 'SKILL', text: 'Pick a move, then pull it off with a well-timed press. The matchup sets how wide the window is. On defense you time the answer.' },
      { href: '../1v1/?mode=dice', name: 'Dice', tag: 'ODDS', text: 'Same duel as Timing, but every move is rolled with its odds, shown as percentages.' },
    ],
  },
  {
    title: 'TEAM GAMES',
    modes: [
      { href: '../5v5/', name: 'Playbook 5v5', tag: 'NEW', text: 'Coach a five: call a play seeing their scheme, watch it run, and pick the read at its key moment. On defense, set the scheme and choose how to react.' },
      { href: '../pixel/', name: 'Pixel 3x3', tag: 'LEAGUE', text: 'The pixel edition: top-down court, techniques, combos, specials and a league.' },
      { href: '../', name: '3D 3x3', tag: 'ORIGINAL', text: 'The first version, in 3D: turn-based possessions with exact odds.' },
    ],
  },
  {
    title: 'TOOLS',
    modes: [
      { href: '../anims/', name: 'Animation viewer', tag: 'ART', text: 'Every animation of the sprite pack, listed. Pick one to watch a player do it, frame by frame if you like.' },
    ],
  },
];

document.getElementById('app')!.innerHTML = `
  <main class="menu">
    <h1>TURN BALL</h1>
    <p class="sub">Pick a mode to try</p>
    ${GROUPS.map((g) => `
      <section>
        <h2>${g.title}</h2>
        <div class="grid">
          ${g.modes.map((m) => `<a class="mode" href="${m.href}"><span class="tag">${m.tag}</span><b>${m.name}</b><span class="txt">${m.text}</span></a>`).join('')}
        </div>
      </section>`).join('')}
  </main>`;
