# Turn Ball

3x3 street hoops in 3D, one move at a time. Every possession is a short chain of decisions: shoot, pass, drive with the ball, or run a play. Each move comes in techniques your players learn as they level up (jump shot, bank shot, fadeaway, layup; bounce pass, lob, no-look; crossover, hesitation, spin, step-back; cut, backdoor, screen, pick and roll, give and go). The defense picks a stance (press, give space, deny the pass) and a defensive technique at the same time without seeing your move. Select any option to see what will happen: the route or shot drawn on the court and the exact odds the game uses. Then watch the play and read one line on why it went that way. No timers, no walls of text.

**Play it:** https://fafidesplas.github.io/coolmath-turn-ball/

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173/coolmath-turn-ball/
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build
npm run sim       # headless balance simulator (options: --seed N --poss N --matches N --quick --tech)
```

`npm run sim` needs Node 22.6 or newer (it runs the TypeScript rules directly).

## Controls

- **Attack:** pick Shoot, Pass, Drive or Play, then one of the techniques the ball handler knows (one line each: when it is good, best odds). Pass, Drive and Play then show their targets as a row of buttons and as rings on the court. Selecting an option previews it; select it again or press GO to play it.
- **Defense:** pick Press, Give space or Deny pass, then one of your team's defensive techniques, then GO.
- **Desktop:** hovering previews, clicking confirms. Keys: `S` `P` `D` `C` for the actions, `Q` `W` `E` `R` for techniques, `1-9` for targets (stances on defense), `Enter` to confirm, `Esc` to go back.
- **Touch:** tap to preview, tap again or GO to confirm. You can also tap a ring on the court.

The first match starts with a short guided tutorial (three lessons and one free possession; the second one teaches picking a technique). It can be replayed from Help.

**Team:** each player has a technique path (learned at levels 2, 3, 5, 7 and 9, or earlier by training for coins) and a few slots (2, 3 from level 4, 4 from level 8). Tap a technique to equip or unequip it. The first win against each league team teaches its signature technique to your top scorer.

## Tech

TypeScript + Vite + Three.js. Everything is procedural: low-poly players and court built in code, canvas-drawn textures, SVG icons, Web Audio sound effects. No external assets. Progress is saved in `localStorage`.

The rules live in `src/rules.ts` and the technique list in `src/techs.ts` (pure, no DOM) and are shared by the game and the simulator, so the odds on screen and the simulated ones are the same numbers.

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

See [PLANNING.md](PLANNING.md) for the design, the AI and the simulator results.
