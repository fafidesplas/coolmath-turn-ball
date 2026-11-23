# Turn Ball — Planning

> A Coolmath-style team-sport game: real-time movement on an open court, with turn-based RPG duels whenever players collide. Inspired by the *structure* of classic underwater-sport minigames in RPGs, but built on a real sport. All names, characters, art and audio are original.

## 1. Pitch

**"3-on-3 street hoops where every collision is a turn-based showdown."**
You run a scrappy neighborhood crew, the Sunnyside Hoopers, through the Sunset League. On the court you move freely. When a defender touches your ball handler, time freezes: you have **3 seconds** to choose a move, and your stats, techniques and a little luck decide what happens. A match lasts **3–5 minutes**. Between matches you level up players, unlock techniques and scout new signings.

## 2. Sport choice: 3x3 basketball (not futsal)

| Criterion | 3x3 basketball | Futsal |
|---|---|---|
| Court | **One hoop, half court.** All action happens in one area that fits a phone screen. | Two goals, full pitch. Needs scrolling or tiny sprites. |
| Players | 3 v 3 = 6 tokens, readable on mobile. | 5 v 5 + keepers = 10, crowded. |
| Possession | **12-second shot clock** creates constant decisions, close to the 2–3 s duel rhythm. | Long possessions, less frequent clashes. |
| Duel fit | Dribble/pass/shoot/protect vs steal/block/press/wait map 1:1 onto real basketball moves. | Shoot and block map less cleanly (keeper adds a third party). |
| Scoring | Many small scores (1 and 2 points) keep the scoreboard moving in short matches. | Low scoring; a 3-minute match often ends 0–0. |
| Real sport | FIBA 3x3 is an official Olympic sport with simple rules. | Also real, but adds rules overhead. |

**Decision:** 3x3 basketball. Rules are simplified from FIBA 3x3: 1 point inside the arc, 2 outside, a 12 s shot clock, first to 11 or the leader at the end of the clock, and a golden basket if tied. Possession restarts with a "check" at the top after every score or turnover.

## 3. Core loop

1. **Field phase (real time).** Tap or drag to move the controlled player; tap a teammate to pass. Pass lanes show green (safe) or red (an interception is possible). The Shoot button shows the live % and the point value.
2. **Contact → duel (turn-based).** Contact between the ball handler and a defender pauses the game.
3. **Duel phase.** A 3-second timer. The attacker picks Dribble / Pass / Shoot / Protect; the defender picks Steal / Block / Press / Wait. ★ technique buttons appear when the player has enough energy. If time runs out, the game picks Protect or Wait for you with a −1 penalty.
4. **Reveal (~2 s).** Both moves are shown, then a line-by-line breakdown: stat edge, matchup, technique, modifiers, dice, and the total. A headline (BLOWN BY!, REJECTED!, STOLEN!…) explains the outcome.
5. **Consequence.** Play resumes with the result applied, so the next field decision builds on the duel.

## 4. Duel system

**Total = stat edge (clamped ±4) + matchup + technique bonus + context modifiers + luck (two dice of −1/0/+1).**
Above 0 the attacker wins, 0 is a stand-off, and below 0 the defender wins.

Matchup matrix (attacker's view). Each move hard-counters exactly one move and is hard-countered by exactly one:

| Attack \ Defense | Steal | Block | Press | Wait |
|---|---|---|---|---|
| Dribble (SPD) | **−3** | **+3** | +1 | −1 |
| Pass (PAS) | +1 | −1 | **+3** | **−3** |
| Shoot (SHO) | +1 | **−3** | −1 | **+3** |
| Protect (STR) | **+3** | +1 | **−3** | −1 |

Defender stats: Steal → DEF, Block → BLK, Press → STR, Wait → DEF.

Outcomes:
- **Dribble win:** the defender is dazed for 2.5 s and the attacker gets a speed boost and a better shot chance.
- **Pass win:** a guaranteed pass to the most open teammate.
- **Shoot win:** the basket is good.
- **Protect win:** keep the ball, +25 energy, and the defender is pushed back.
- **Stand-off:** the players separate and the shot clock loses 2 s.
- **Defender win:** turnover (steal, block or interception).

Shooting modifiers: right under the rim +1, deep two −1. Every duel costs 2 s of game clock.

**Readability rules:** each button shows "Beats X · Weak to Y" plus the relevant stat. The rival's stats are visible. Values in the reveal are always shown from *your* perspective, with green for good and red for bad. The first duels show a one-line legend.

**AI:** rival choices are weighted by their stats and the context (shot clock, distance), plus a habit memory. With probability `0.1 + 0.09 × tier` the AI counters your most frequent recent move, so predictable players get punished on harder teams.

## 5. Energy & techniques

- Players start a match with 40 energy and gain +10 per duel. Protect (attack) and Wait (defense) give +15 more, so playing it safe charges your specials.
- The yellow ring around each token shows energy.
- There are 12 original techniques, such as Blink Crossover (Dribble +4), Skyscraper (Block +4), Rainbow Bomb (Shoot +3, pierces counters) and Mind Reader (Wait +3, pierces counters). Costs range from 30 to 60 energy.
- **Pierce** turns a negative matchup into 0, which counters the counter.

## 6. Progression

- **XP:** 25 + 8/point + 5/duel won + 30 for a win; bench players get 15. Each level costs `60 + 40 × level` XP, up to a maximum of level 10.
- **Level up:** +1 to the player's two growth stats. New techniques unlock at levels 1, 3 and 5.
- **Coins:** a win pays 100 + 25 × tier + 5 × margin; a loss pays 30 + 5 × tier.
- **Scouting:** 3 free agents at a time (200–560 coins), a 25-coin refresh, and a roster of up to 5. The first 3 players in the roster start; you reorder them in My Team.
- **League:** 6 rivals with rising tiers. Beating one unlocks the next: Puddle Jumpers → Rooftop Ravens → Crunchtime Crabs → Neon Narwhals → Thunder Toasters → Midnight Meteors.
- The game saves to `localStorage`.

## 7. Pacing targets

| Target | Value | Status |
|---|---|---|
| Duel decision | 3 s timer | ✅ |
| Duel total (decide + reveal) | ~4–5 s | ✅ |
| Match length | 2:30 game clock → ~3.5–4.5 min real time | ✅ measured 3:22–4:25 in automated playtests |
| Duels per match | ~30–45 | measured 34–42 |

## 8. Art & audio direction

- Bright, chunky, readable look: wooden court, top-down "chibi" tokens (jersey color, skin, hair, eyes, number), an energy ring and a controlled-player arrow.
- Juice: floating callouts, screen shake on blocks and buckets, daze stars, speed lines, confetti on wins, and a bobbing crowd.
- On tall phone screens the court is drawn transposed, with the hoop on the left, so it fills the screen. On wide screens it is drawn with the hoop at the top.
- Sound effects are synthesized with Web Audio (whistle, swish, rim, clash, ticks, buzzer, level-up). There are no audio files.

## 9. Tech

- TypeScript + Vite. Canvas 2D for the court and DOM for menus and duel UI. No engine.
- Modules: `data.ts` (content), `duel.ts` (pure resolution + AI), `match.ts` (simulation, input, rendering), `duelui.ts`, `game.ts` (save/progression), `main.ts` (screens), `audio.ts`.
- Deployed to GitHub Pages via Actions, with `base: /coolmath-turn-ball/`.

## 10. Roadmap

**Prototype (done):** field + duels, AI, 6 rivals, leveling, techniques, scouting, mobile and desktop input, Pages deploy.

**Next:**
1. Onboarding: a guided first possession with arrows ("tap here", "pass to Luz").
2. Balance pass with real players: AI shot selection, duel frequency, how often players reach 11 points.
3. Positional off-ball plays (screens / give-and-go) as a field-side counterpart to duels.
4. Player portraits and a richer token art pass; an announcer text ticker.
5. Settings: duel timer length (accessibility), reduced motion, left-handed layout.
6. More content: tournament mode, rival rematches with traits, cosmetic jerseys.
7. Analytics hooks for Coolmath (match length, duel choices, drop-off).

## 11. Known risks

- Duel frequency can feel high for some players. Tunables: `DUEL_RANGE`, the AI chase speed, and the post-duel cooldown.
- Steal is the riskiest defensive pick (+2 net for the attacker across the matrix) and Wait is the safest. This is intentional, but needs validating with players.
- The emoji icons used on buttons render slightly differently across platforms.
