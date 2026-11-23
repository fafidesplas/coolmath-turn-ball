# Turn Ball - Planning (v2, 3D)

> A Coolmath-style team-sport game: real-time movement on a 3D half court, with turn-based clashes whenever the ball handler meets a defender. All names, characters, art and audio are original and generated in code.

## 0. Why v2

Player feedback on the 2D prototype: it was hard to understand. Too much text, a 3-second timer, and a duel panel full of numbers that covered the court. The requests were:

- Make it 3D.
- When there is a decision, drop the camera to a third-person view.
- Hovering an option should show what will happen: a ghost line from the ball to the hoop, a line to the teammate, floating odds for each result (make, miss, blocked...).
- Do the same for every option, attack and defense.
- Remove the decision timer.
- Less text, no emoji, everything readable at a glance.

v2 keeps the good parts of the system (stat-tilted rock-paper-scissors, energy, special techniques, league progression with signings and levels) and rebuilds the presentation around **show, don't tell**.

## 1. Pitch

**"3x3 street hoops in 3D. Every clash is a choice, and you see the odds before you make it."**
You run the Sunnyside Hoopers through the Sunset League. You move freely on the court. When the ball handler meets a defender, play stops, the camera swoops behind your player and you pick a move. Every option previews its outcome in the world, with the exact odds. A match lasts 3-5 minutes.

## 2. Sport: 3x3 basketball

One hoop, half court, 3 v 3: six readable players, constant possession changes, and moves that map 1:1 to real basketball (shoot, pass, drive, shield vs steal, block, press, read). Rules simplified from FIBA 3x3: 1 point inside the arc, 2 outside, 12 s shot clock, first to 11 or the leader at the buzzer (2:30 game clock), golden basket if tied. After every score or turnover, possession restarts with a check at the top.

## 3. Core loop

1. **Free play (real time).** Elevated 3/4 camera that follows the ball. Tap/click the court (or WASD) to move your player. A white ring marks the move target.
2. **Clash.** Play stops when:
   - a defender touches your ball handler, or you press the big **PLAY** button (open look: more space = bonus);
   - on defense, your defender touches the rival handler, you press **CLASH** within 3.2 m, or the rival tries to shoot with your defender close enough to contest.
3. **Decide (no timer).** The camera drops to third person behind your player. One big button per option. Hover (desktop) or press and hold (touch) to preview; click, release on it, or tap it again to confirm.
4. **Resolve.** Both chosen moves pop above the players, then a short 3D animation shows the result: the shot drops or rattles out, the block, the steal, the drive past a dazed defender, the pass caught or picked off.
5. **Back to free play.** The camera rises back to the overview.

## 4. Camera

| Moment | Camera |
|---|---|
| Free play | Perspective camera, 46-50 deg pitch, behind the baseline-facing view. Frames the ball, your player and the rim; portrait phones aim slightly ahead so the court fills the screen. |
| Attack decision | Behind and slightly to the side of your ball handler, facing the hoop (22 deg pitch). Frames handler, defender and rim; when previewing a pass, it widens to include the receiver. |
| Defense decision | Over your defender's shoulder, facing the ball handler (27 deg pitch), offset sideways so the attacker is never hidden. Widens to show passing lanes for Read. |
| Transitions | Exponential smoothing (no cuts). Small screen shake on blocks, steals and scores. |

The camera rig is a generic "frame these points from this direction" function, so every situation (corners, pass targets, portrait vs landscape) is framed automatically.

## 5. Previews (the heart of v2)

Every option draws its consequence in the world and pins its odds as labels anchored to 3D points (players, rim, trajectory).

| Option | Preview | Odds labels (green / grey / red) |
|---|---|---|
| Shoot | Flowing dotted arc from the ball to the rim, ghost ball in the rim, red block wall over the defender, point value (+1/+2) on the arc | IN at the rim, MISS beside the rim, BLOCK over the defender |
| Pass (one per teammate) | Dotted pass line to that teammate, green ring under the receiver, red rings under the defender and any second defender lurking in the lane | CATCH at the receiver, TIPPED mid-lane, PICKED over the defender |
| Drive | Dotted route around the defender toward the hoop, green ring at the end | PAST at the end of the route, HELD over you, STOLEN over the defender |
| Shield | Translucent dome around you, push path for the defender, +25 energy badge | SPACE where the defender lands, HELD, TRAPPED |
| Steal | Reach arc from your hand to the ball, ghost ball | BALL, EVEN, BEAT, SCORE (all four for every defensive option) |
| Block | Contest wall between the shooter and the hoop, faint shot arc | |
| Press | Two pulsing pink rings closing on the handler | |
| Read | Vision cone plus the passing lanes you are covering, +25 energy badge | |

Each option button also shows its main success % and a stacked green/grey/red bar, so the options can be compared without reading anything.

**The odds are real.** The resolution samples the rival's move from an explicit probability distribution (stat-based weights, the habit counter of smarter rivals, and technique use). The preview computes the exact probability of each outcome by summing over that distribution, the two luck dice, and the shot-make roll. The numbers are rounded with a largest-remainder method so they always add up to 100.

## 6. Clash system

**Total = stat edge (clamped +-4) + matchup + technique bonus + context + luck (two dice of -1/0/+1).**
Above 0 the attacker wins, 0 is a stand-off, below 0 the defender wins.

Matchup matrix (attacker's view):

| Attack \ Defense | Steal | Block | Press | Read |
|---|---|---|---|---|
| Drive (SPD) | -3 | +3 | +1 | -1 |
| Pass (PAS) | +1 | -1 | +3 | -3 |
| Shoot (SHO) | +1 | -3 | -1 | +3 |
| Shield (STR) | +3 | +1 | -3 | -1 |

Context: shooting right under the rim +1, deep two -1; open space (called plays) +1/+2; a second defender in the pass lane -1; very long pass -1.

Outcomes:

| Attack | Attacker wins | Stand-off | Defender wins |
|---|---|---|---|
| Shoot | Clean shot (open make %) | Contested shot (contested make %) | Blocked, turnover |
| Pass | Caught, receiver gets a boost | Tipped, ball stays, shot clock -3 | Intercepted |
| Drive | Past the defender (dazed 2.5 s), speed boost | Held, shot clock -2 | Stolen |
| Shield | Defender shoved back, +energy | Held | Trapped, turnover |

Missed shots go to a rebound battle (strength + blocking).

**AI:** the rival's move distribution is weighted by its stats and context (distance, shot clock, energy, shot intent). Smarter rivals (`0.1 + 0.09 x tier`) blend in the counter to your most frequent recent move, so the odds you see shift if you get predictable.

## 7. Energy and specials

- Each player starts with 40 energy, +10 per clash, +15 more for Shield (attack) or Read (defense).
- The **star toggle** in the decision bar turns on the special version of every option that has an affordable technique. Buttons and odds update instantly; a star label shows the bonus.
- 12 original techniques (for example Blink Crossover: Drive +4; Skyscraper: Block +4; Rainbow Bomb: Shoot +3 and ignores counters). Costs 30-60 energy.

## 8. Progression (unchanged)

- XP per match (points, clashes won, win bonus); levels up to 10 raise the two growth stats; techniques unlock at levels 1, 3 and 5.
- Coins from matches; scouting with 3 free agents, roster of 5, first 3 start.
- League of 6 rivals with rising tiers. Progress saved in `localStorage` (same save as v1).

## 9. Simplifications vs v1

| v1 | v2 |
|---|---|
| 3-second decision timer with auto-pick penalty | No timer. Think as long as you want. |
| Duel panel with stat lines, matrix hints ("Beats X / Weak to Y") and a line-by-line breakdown | Options show their outcome in the world with exact odds; the matrix is never needed. |
| Separate shoot and pass buttons in free play, plus pass lanes colored on the court | One PLAY button that opens the same decision view (all shots and passes go through previews). |
| Switch-defender button | Your defender is chosen automatically (the one guarding the ball). |
| Emoji icons | Hand-drawn SVG icon set; no emoji anywhere. |
| Text banners and long callouts | Icon callouts above the players, short banners only for possession changes. |

## 10. Art, audio, performance

- Low-poly procedural look: chunky players (big heads, flat-shaded), team jersey colors with white shorts for the Hoopers and dark shorts for rivals, colored rings under every player, numbers on back and chest. The ball handler gets a pulsing gold ring and a floating gem; your controlled defender gets a white chevron.
- Sunset street court: wood floor and lines drawn into a canvas texture, glass backboard, wireframe net that reacts to swishes, low-poly city blocks, trees and fence.
- Lighting: hemisphere + warm key + cool rim light, fog. No shadow maps; soft blob shadows instead (cheap on phones).
- Pixel ratio capped at 1.5 on touch devices, 2 on desktop. Instanced meshes for preview dots. One draw call per mesh, no post-processing.
- Sound: synthesized with Web Audio. No audio files.

## 11. Tech

- TypeScript + Vite + Three.js. DOM for menus, HUD and decision bar; CSS2D labels for world-anchored odds and callouts.
- Modules: `data.ts` (content), `duel.ts` (resolution, exact odds, AI distributions), `world.ts` (3D scene, camera rig, previews, labels), `match.ts` (simulation, decisions, resolution animations), `decisionui.ts` (option bar and input), `icons.ts` (SVG icons), `game.ts` (save/progression), `main.ts` (screens), `audio.ts`.
- Deployed to GitHub Pages via Actions with `base: /coolmath-turn-ball/`.

## 12. Pacing targets

| Target | Value |
|---|---|
| Match length | 2:30 game clock, paused during decisions; ~3-5 min real time |
| Clashes per match | ~15-30 |
| Decision | No timer; camera transition ~0.6 s, resolution animation ~1-1.5 s |

## 13. Roadmap

1. Guided first possession (ghost hand showing "move here", "press PLAY").
2. Balance pass with real players (closeout frequency, AI shot selection, rebound odds).
3. Off-ball plays (screens, give-and-go) as free-play options.
4. Settings: reduced motion, camera height, left-handed layout.
5. Cosmetic jerseys and court themes per rival.
6. Analytics hooks for Coolmath (match length, option choices, drop-off).

## 14. Known risks

- Showing exact odds makes the best option obvious in isolation; depth comes from energy/specials, positioning (space bonus, lanes) and the AI adapting to your habits. Needs validation with players.
- Older phones: the scene is light, but CSS2D labels and WebGL on low-end Android need real-device testing.
- The free-play camera hides part of the court edges on very narrow screens.
