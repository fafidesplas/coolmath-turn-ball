# Turn Ball

3x3 street hoops in 3D, one move at a time. Every possession is a short chain of decisions: shoot, pass, drive with the ball, or cut a teammate to another marked spot. The defense picks a stance (press, give space, deny the pass) at the same time without seeing your move. Select any option to see what will happen: the route or shot drawn on the court and the exact odds the game uses. Then watch the play and read one line on why it went that way. No timers, no walls of text.

**Play it:** https://fafidesplas.github.io/coolmath-turn-ball/

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173/coolmath-turn-ball/
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build
npm run sim       # headless balance simulator (options: --seed N --poss N --matches N)
```

`npm run sim` needs Node 22.6 or newer (it runs the TypeScript rules directly).

## Controls

- **Attack:** pick Shoot, Pass, Drive or Cut. Pass, Drive and Cut show their targets as a row of buttons and as rings on the court. Selecting an option previews it; select it again or press GO to play it.
- **Defense:** pick Press, Give space or Deny pass, then GO.
- **Desktop:** hovering previews, clicking confirms. Keys: `S` `P` `D` `C` for the actions, `1-9` for targets or stances, `Enter` to confirm, `Esc` to go back.
- **Touch:** tap to preview, tap again or GO to confirm. You can also tap a ring on the court.

The first match starts with a short guided tutorial (three lessons and one free possession). It can be replayed from Help.

## Tech

TypeScript + Vite + Three.js. Everything is procedural: low-poly players and court built in code, canvas-drawn textures, SVG icons, Web Audio sound effects. No external assets. Progress is saved in `localStorage`.

The rules live in `src/rules.ts` (pure, no DOM) and are shared by the game and the simulator, so the odds on screen and the simulated ones are the same numbers.

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

See [PLANNING.md](PLANNING.md) for the design, the AI and the simulator results.
