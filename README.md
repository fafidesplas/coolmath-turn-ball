# Turn Ball

3x3 street hoops in 3D, one move at a time. Every possession is a short chain of decisions: shoot, pass, drive with the ball, or run a play. Each move comes in techniques your players learn as they level up (jump shot, bank shot, fadeaway, layup; bounce pass, lob, no-look; crossover, hesitation, spin, step-back; cut, backdoor, screen, pick and roll, give and go). The defense picks a stance (press, give space, deny the pass) and a defensive technique at the same time without seeing your move. Select any option to see what will happen: the route or shot drawn on the court and the exact odds the game uses. Then watch the play and read one line on why it went that way. No timers, no walls of text.

**Play it:** https://fafidesplas.github.io/coolmath-turn-ball/

**Pixel edition:** https://fafidesplas.github.io/coolmath-turn-ball/pixel/ (same rules, odds and techniques, drawn in pixel art; see below)

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

## Pixel edition

`/pixel/` is the same game drawn in pixel art with sprites from *Basketball Asset Pack - Hoops in Pixel* by Josee (n3cloud on itch.io): top-down court, side-view players animated from the pack (idle, dribble, run, slide, jump shot, fadeaway, floater, layup, several dunks, double clutch, crossover, hesitation, behind the back, between the legs, side step, back down, pass, lob, steal, block, rebound), hoop, net and spinning ball. The canvas is drawn at its native size and scaled by a whole number of device pixels (`image-rendering: pixelated`); see Layout below.

Teams never depend on color alone: home plays in a light striped kit over a hollow ring, away in a dark kit with headbands over a solid diamond, and the HUD shows the same shapes. Odds use light solid, dotted grey and dark striped fills plus their icons and words; danger rings are dashed with a cross. Two-point spots are light squares, one-point spots dark dots.

**Layout.** The court and the decision panel form one block: the court takes the biggest whole-number scale that leaves the panel a readable width (landscape: panel beside the court with the score on top, full height; portrait: score on top, court, panel below). Panel buttons are at least 44 px.

**Arcade layer (pixel edition only).**

- *Fire meter:* each team fills up to 4 flames by winning duels (+1 per duel won on attack, +2 per steal, pick, block or charge, +1 per forced miss, -1 per turnover). A full meter unlocks one signature special for that possession. Flames are solid when lit and dotted when empty, with the word READY when full.
- *Signature specials:* every player has one (`src/specials.ts`): Rocket Cross (Pip), Tower Slam (Mo), Sunset Splash (Luz), Zoom Thread (Kiki), Bulldozer (Benny), Blueprint Cut (Nova), Wall Hook (Taro), Pepper Dash (Jax), Ruby Fade (Ruby), Noodle Spin (Zed), Skywalk (Fern), Breeze Step (Ola); rivals have Street Blaze, Rim Quake and Comet Three. Each is a stronger, riskier version of a move with exact odds and one counter stance (the simulator checks that the counter is its weakest matchup). On defense the panel lists the specials the attack can throw and which stance stops each.
- *Cinematics:* cut-in card with the pixel portrait, speed lines, letterbox bars, a smooth close-up (Full camera only), slow motion, fire aura and afterimages, burning ball trail, bursts, flash and screen shake, reusing pack animations (Dunk_3, Dunk_5, Dunk_7, Floater, Jumpshot_3, Fake_Fadeaway_Right, Back_Down, Between, Switch_Dribble_1...). "FX low" on the title screen or the pause menu (default when the system asks for reduced motion) removes slow motion, zoom, shake, flashes and most particles.
- *Move set (every animation is a choice):* every player has the same shots (Dunk, Layup, Floater, Jump shot, Three, Fadeaway) and dribble moves (Crossover, Between the legs, Behind the back, Spin, Euro step, Back down, Hesitation, Step-back, Pump fake), each played with its own pack animation. The dunk is always listed under Shoot: live at the post, or from the elbow once the handler beat their man (a flying dunk); when out of reach the row says why. Each player has their own dunks (Dunk_1 to Dunk_7). Technique paths now teach passes and team plays (lob, no-look, skip, bounce, cut, backdoor, screen, pick and roll, pick and pop, clear-out, hand-off, give and go).
- *Defense:* seven moves, each with its own animation or court shape: Press, Steal, Contest (Block_2), Give space, Block (waits at the rim, Block_1 / Block_3), Take the charge (a drive or finish into it can be an offensive foul) and Deny pass. Each button shows gain and risk pips; the card says what it stops, what beats it and how it does against the attack's most likely move. The AI defense picks among the moves that are close to its best one, so all seven show up.
- *Clarity:* a top line says who has the ball, where, how much a make is worth and who is open (on defense, what the attack likes to do). Options show reward as arrows and risk as warning triangles (shape and a word, not color). After every duel a card says whose move won ("Their Block beats your Dunk"), with a check, cross or equals mark and the reason. A step-by-step coach walks through the first attack and the first defense possession (once per save).
- *Dunk and dribble cinematics:* dunks get slow motion, rim zoom, fire aura and ball trail, rim shake and a burst; winning dribble moves get an ankle-breaker trail and dust; blocks a swat burst. FX low removes them like the specials' effects.
- *Camera:* every move is a smooth eased transition (about 0.55 to 0.65 s, ease in and out, zoom on a log scale), never a cut. At rest the zoom is a whole number of device pixels per scene pixel and the view starts on a whole scene pixel, so the art stays sharp (the canvas is drawn at device resolution). Three modes in the pause menu: *Soft* (default: one gentle 1.5x zoom on the duel, previews only open to the whole court when needed), *Full* (frames every preview and play up to 2x, rim close-ups on dunks) and *Off* (whole court). No shake while the camera moves. FX low or reduced motion: the camera never moves (no zoom, no slow motion). The duel stays on the court with light corner brackets around the two players.
- *Combos (Combo menu):* plays between two or three players in one decision, all on the court with pack animations: Alley-oop (lob or off the glass; the finisher catches it in the air and dunks with his own Dunk animation), Pick and roll (the screen, then the roll: bounce pass to the roller and his finish, or the handler's pull-up), Give and go, Kick-out, Backdoor (bounce pass or lob), Drive and dish, Swing. The preview draws every step's route with a numbered badge. Each step is a plain action resolved with `rules.ts`, so the odds are exact; the defense meets the first step with the move it picked and reacts to later ones within the same family (help at the rim, a switch, a defender jumping the lane). Code: `src/pixel/combos.ts`.
- *Legibility:* nobody moves faster than a sprint (8.5 m/s at the peak) and every trip is a run with its pack animation; between possessions everyone runs to a spot of their side and the ball reaches the new handler in plain sight; a dotted line ties each defender to his man. On defense a light shield marks your defender and the attack's most likely move is drawn as an orange dashed threat. Each defensive option previews its covered area (hatch pattern per family), who helps and the risk it leaves open (crosses). Duels play in three beats: anticipation (everyone in place, the attacker's route shown), action, and a short hold on the decisive moment with a big icon. Combo previews use the same geometry as the play. Nothing reads by color alone. Audit and numbers: [docs/auditoria-movimientos.md](docs/auditoria-movimientos.md).
- *Feel:* teammates make V-cuts while you decide and their defenders follow; rebounds are a scramble (long or short caroms, sometimes a floor bounce, box-outs, two players jump for it); teammates run to the scorer and jump; spectators (pack characters) cheer big plays; hit-stop on dunks and blocks; dribble, sneaker squeak, crowd and slam sounds (`src/pixel/pxsfx.ts`); whoever wins the ball clears it out to start the next possession. Open items: [docs/diagnostico-feel.md](docs/diagnostico-feel.md).
- Pack audit: [docs/animaciones-pack.md](docs/animaciones-pack.md) lists every animation of the pack and where it is used.

Code: `src/pixel/` (renderer `world.ts`, sprites `sprites.ts`, a presentation fork of the match and screens, `arcade.ts` for the save, paths and rival kits). Odds come from the shared `rules.ts`; the pixel move set (`PIXEL_MOVES`, `PIXEL_DEF`), the new techniques and the specials there only appear when a kit or a full Fire meter enables them, so the 3D game plays exactly as before. The pixel edition keeps its own save (`turnball-pixel-save-v1`), seeded once from the 3D save.

The art is licensed and may not be redistributed, so the repo only holds it encrypted; the Pages build unseals it with a repository secret. Details and commands: [tools/pixel-art/README.md](tools/pixel-art/README.md).

## Tech

TypeScript + Vite + Three.js. Everything is procedural: low-poly players and court built in code, canvas-drawn textures, SVG icons, Web Audio sound effects. No external assets. Progress is saved in `localStorage`.

The rules live in `src/rules.ts` and the technique list in `src/techs.ts` (pure, no DOM) and are shared by the game and the simulator, so the odds on screen and the simulated ones are the same numbers.

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

See [PLANNING.md](PLANNING.md) for the design, the AI and the simulator results.
