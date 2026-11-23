# Turn Ball 🏀

3-on-3 street hoops where every collision becomes a **turn-based duel**. Move freely on a half court; when a defender touches the ball handler, time freezes and both sides pick a move (Dribble / Pass / Shoot / Protect vs Steal / Block / Press / Wait) against a 3-second timer. Stats, ★ techniques and a little dice decide who wins, and the game shows you why.

**Play it:** https://fafidesplas.github.io/coolmath-turn-ball/

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173/coolmath-turn-ball/
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build
```

## Controls

- **Touch / mouse:** tap or drag on the court to move · tap a teammate to pass · on-screen buttons to shoot, pass and switch defender · big buttons in duels.
- **Keyboard:** `WASD`/arrows move · `Space` shoot · `Q`/`E` pass · `Shift` switch defender · `1-4` duel moves · `5-6` techniques.

## Tech

TypeScript + Vite, Canvas 2D for the court, DOM for menus and duels, and Web Audio for synthesized sound effects. No engine and no external assets. Progress is saved in `localStorage`.

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

See [PLANNING.md](PLANNING.md) for the game design and roadmap.
