# Turn Ball

3x3 street hoops in 3D where every clash is a choice. Move freely on a half court; when the ball handler meets a defender, play stops, the camera drops behind your player, and you pick a move. Hover or hold any option to see what will happen: a ghost trajectory or route in the court and floating odds (make, miss, blocked, stolen...) that are the exact probabilities the game uses. No timer, no walls of text.

**Play it:** https://fafidesplas.github.io/coolmath-turn-ball/

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173/coolmath-turn-ball/
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build
```

## Controls

- **Desktop:** click the court or use `WASD`/arrows to move. `Space` or the big button calls a play (attack) or a clash (defense, when close). In a decision: hover an option to preview, click to confirm. Keys `1-5` preview (press again to confirm), `Enter` confirms, `S` toggles the special move.
- **Touch:** tap or drag on the court to move. In a decision: press and hold an option to preview (slide across options to compare), release on it or tap it again to confirm.

## Tech

TypeScript + Vite + Three.js. Everything is procedural: low-poly players and court built in code, canvas-drawn textures, SVG icons, Web Audio sound effects. No external assets. Progress is saved in `localStorage`.

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

See [PLANNING.md](PLANNING.md) for the design: camera, previews, clash math and roadmap.
