# Turn Ball - Planning (v3, turn-based possessions)

> A Coolmath-style 3x3 street hoops game in 3D. Every possession is a short chain of decisions: you pick a move, watch it play out, and decide again. All names, characters, art and audio are original and generated in code.

## 0. Why v3

Feedback on v2 (real-time movement plus turn-based clashes):

- Moving freely in real time and then stopping for a clash mixed two games; players did not know which one they were playing.
- The PLAY / CLASH buttons and the free movement were the confusing part, not the odds.
- Designer (Dado) and tester (Combo) recommendation: make everything turn-based, give the attack a few clear verbs with routes between marked spots, give the defense three visible stances chosen blind, cap the number of moves per possession, and teach the relations in a short guided tutorial. Validate the balance with a headless simulator before trusting the numbers.

v3 keeps the 3D court, the third-person-ish decision camera, the exact-odds previews and the league, and replaces the loop.

| v2 | v3 |
|---|---|
| Tap/drag/WASD movement in real time | Removed. Players stand on marked zones and move only through decisions. |
| PLAY / CLASH buttons, contact triggers | Removed. Every step is a decision. |
| 4 attack moves (shoot, pass, drive, shield) + 4 defense moves | Attack: shoot, pass, drive (with the ball), cut (a teammate without the ball). Defense: press, give space, deny pass. |
| Energy, specials, star toggle | Off in this version (`ENABLE_SPECIALS = false` in `data.ts`; technique data kept). Shield/Protect is out. |
| Shot clock and game clock | Removed. A visible limit of moves per possession instead; no decision timer. |
| Rivals with higher stats | Equal teams: the rival mirrors your starters' stats. Difficulty = how well the AI reads you. |
| Steal / block buttons | Gone. Steals, picks and blocks are outcomes of the stances. |

## 1. Pitch

**"3x3 street hoops, one move at a time. You see the real odds before every move, and the defense answers without seeing yours."**

## 2. The possession loop

1. **Decide.** The ball handler has the ball on a marked zone. You pick one action. The defense picks a stance at the same time (hidden).
2. **Watch.** The stance is revealed (the defenders slide into it, an icon pops over the on-ball defender), then the play animates: the shot, the pass, the drive along its route, the cut.
3. **Read why.** A one-line explanation in plain words appears for about a second: "Pressure cut the shot to 21%. Missed." It always names the cause and the odds, so a lucky or unlucky roll never reads as certain.
4. **Decide again** from the new situation, until the possession ends (score, miss, steal, pick, block) or the moves run out.

Possessions alternate. On defense the same loop runs from the other side: you pick a stance, the AI picks an action.

### Moves per possession

- 4 moves per possession, shown as pips on the decision bar. The last move can only be a shot. An offensive rebound gives 2 more (at most 2 rebounds per possession).
- Moving costs no energy. Its cost is that every move gives the defense another chance to answer (steals, picks, presses), and that it spends one of the four pips. Everyone can see the pips, including the AI: on the last move it knows a shot is coming and presses.

## 3. Court zones and routes

Nine marked spots drawn on the floor (dashed rings): two corners, two wings, the top (all 2-point), two elbows (mid-range, 1 point), two posts (close, 1 point). Routes link neighbors (corner-wing, corner-post, wing-top, wing-elbow, wing-post, top-elbow, elbow-elbow, elbow-post, post-post). One attacker per zone.

## 4. Attack actions

| Action | What it does | Main risk |
|---|---|---|
| **Shoot** | Always available, from wherever you are, against whatever defense is there. Position, shooter and stance only change the odds. | Miss (22% offensive rebound), block. Ends the possession. |
| **Pass** | Ball to a teammate. If that teammate is open, the advantage carries over. | Picked off (high against Deny, higher on long cross-court passes). |
| **Drive** | Handler moves along a route to a free neighbor zone. Beat the defender and you arrive open. Against Give space a drive into the elbow or post often pulls a help defender, which frees a teammate. | Stolen. Against Press a failed drive is stopped where it started. |
| **Cut** | A teammate without the ball runs a route to a free neighbor zone. Against Deny it is a backdoor and often ends wide open. | The handler holds the ball meanwhile: Press can strip it (6%). |

"Open" (green ring) lasts two decisions: enough to cut, then pass, then shoot; or drive past and shoot. An open shooter gets +20 points of make chance and ignores the stance (no contest, no block).

## 5. Defense stances

Chosen before seeing the attacker's action. The AI never sees your pending choice either: it only uses the public situation and your past decisions.

| Stance | Strong against | Weak against |
|---|---|---|
| **Press** (tight on the ball) | Shots (-13 make, blocks), forced last-move shots, cuts (strip chance) | Drives (45% to get past) |
| **Give space** (sag and help) | Drives (12% past; help in the paint) and cuts (help sees them) | Outside shots (+12 make) |
| **Deny pass** (lanes closed) | Passes (18% base pick, more on long passes) | Backdoor cuts (70% open), drives (no help behind) |

## 6. Previews and wording

Selecting an option shows its consequence in the 3D world and the exact odds as labels anchored there:

- Shot: dotted arc to the rim, ghost ball, red contest wall over the defender, IN / MISS / BLOCK.
- Pass: dotted pass line, green ring on the receiver, red ring on the receiver's defender, CATCH / PICKED.
- Drive and cut: dotted route between zones, green ring on the final zone, red ring on the defender who covers the route, orange ring on the help defender when help is possible; PAST / MATE FREE / HELD / STOLEN or OPEN / COVERED / STRIPPED.
- Stances: ghost rings where each defender would stand, the lanes you would close, BALL / GOES ON / SCORE.

Next to the GO button a three-line card says in a few words what you gain, what you risk and what changes, with numbers ("+2 at 38%", "Block 6%", "Ends the possession"; "Past 41%: then 72%", "Stolen 9%", "Help may free #11").

On attack the decision bar also shows the defense lean: the exact mix of stances the AI will sample from in this situation. That is the "defensive coverage" before you commit. On defense it shows the mirror: the exact mix of shoot / pass / drive / cut the AI attacker samples from, so a stance whose odds read "BALL 1%, GOES ON 99%" (early in a possession the AI rarely shoots) still has a visible reason.

**The odds are exact.** Every (action, stance) pair is a list of explicit weighted branches (`rules.ts`). The preview sums them over the defense's stance distribution (or the AI attacker's action distribution, on defense) and the resolution samples from the very same lists. Percentages are rounded with a largest-remainder method so they add up to 100. The simulator checks calibration (section 9).

## 7. AI

- **Defense (court reading).** Weights from public information only: last move (press), shooter quality at a 2-point spot (press good shooters, sag off poor ones), handler in the post (sag), fast handler (sag), an open teammate (deny).
- **Defense (adaptive).** Watches your past decisions and scores how well six simple models of a player would have predicted them (shoot now, best immediate play, full planner, feed the best shooter, drive in, cut first). It then predicts your next action from the models that fit and leans toward the stance that answers it. Lean strength grows with the rival's tier (`smart` 0.2 to 0.6).
- **Attack.** Softmax over exact expected values (an expectimax planner of the rest of the possession). It assumes you defend like a mix of uniform and your own recent stance habits. Higher tiers are sharper (lower temperature) and read you more.

## 8. Tutorial

Three guided possessions, one relation each, then one possession without help. The stance is shown in advance (the lean chip shows 100%), only the lesson's options are enabled, and the roll lands on the lesson's outcome (the odds shown are the real ones).

1. **Space: shoot.** The shooter on the wing, defense gives space. Shoot.
2. **Pressure: drive.** Defense presses. Drive past to an elbow, then shoot open.
3. **Help: pass.** Defense sags. Drive inside, help leaves a teammate, pass to the free teammate, shoot.
4. **Your call.** Normal possession against the court-reading defense, no hints.

It starts automatically before the first league match and can be replayed from Help.

## 9. Simulator and balance

`npm run sim` (options `--seed N --poss N --matches N`) runs the same `rules.ts` without graphics. Same seed, same numbers.

Strategies (attack): **alwaysShoot** (shoot every time), **bestNow** (best immediate play: the option with the highest expected points counting only the shot you get right after it, using the odds shown on screen), **bestShooter** (get the ball to the best shooter, then shoot), **reposition** (move the handler toward their ideal spot, then shoot), **attackWeakest** (get the ball to whoever the weakest defender guards and drive), **random**, and **expert** (exact expectimax planner, used as a skill ceiling reference). Defense: fixed stances, uniform, **read** (court reading, the base AI) and **adaptive** (opponent model, `smart` 0.6).

Results below are the literal output of `npm run sim` (seed 2026, 4000 possessions per cell, 400 matches per pairing, 295 s):

### Points per possession (attack strategy vs defense policy)

| attack \ defense | alwaysPress | alwaysSpace | alwaysDeny | uniform | read | adaptive | avg |
|---|---|---|---|---|---|---|---|
| alwaysShoot | 0.42 | 0.97 | 0.62 | 0.68 | 0.69 | 0.56 | 0.66 |
| bestNow | 0.97 | 1.13 | 0.91 | 0.98 | 0.94 | 0.92 | 0.98 |
| bestShooter | 0.68 | 1.20 | 0.78 | 0.90 | 0.86 | 0.74 | 0.86 |
| reposition | 0.66 | 0.93 | 0.70 | 0.69 | 0.71 | 0.69 | 0.73 |
| attackWeakest | 0.60 | 0.57 | 0.58 | 0.58 | 0.59 | 0.58 | 0.58 |
| random | 0.44 | 0.82 | 0.57 | 0.59 | 0.57 | 0.57 | 0.59 |
| expert | 0.99 | 1.18 | 1.12 | 1.09 | 1.06 | 1.00 | 1.08 |

Decisions per possession and action mix:

| strategy | decisions/poss | shoot | pass | drive | cut |
|---|---|---|---|---|---|
| alwaysShoot | 1.18 | 100% | 0% | 0% | 0% |
| bestNow | 2.67 | 36% | 26% | 38% | 1% |
| bestShooter | 1.85 | 57% | 43% | 0% | 0% |
| reposition | 2.68 | 36% | 0% | 64% | 0% |
| attackWeakest | 3.22 | 28% | 21% | 51% | 0% |
| random | 3.50 | 29% | 14% | 20% | 37% |
| expert | 3.21 | 30% | 22% | 17% | 31% |

### Full matches, both teams defend with "read" (row win % vs column)

| vs | alwaysShoot | bestNow | bestShooter | reposition | attackWeakest | random | expert | avg vs simple |
|---|---|---|---|---|---|---|---|---|
| alwaysShoot | - | 28% | 41% | 54% | 65% | 65% | 18% | 47% |
| bestNow | 72% | - | 59% | 72% | 84% | 81% | 42% | 72% |
| bestShooter | 60% | 41% | - | 61% | 76% | 75% | 32% | 59% |
| reposition | 46% | 29% | 40% | - | 60% | 63% | 19% | 43% |
| attackWeakest | 35% | 17% | 25% | 41% | - | 56% | 13% | 29% |
| random | 36% | 19% | 25% | 37% | 44% | - | 13% | 32% |
| expert | 82% | 58% | 68% | 81% | 87% | 88% | - | 75% |

Match length in decisions (both teams): median 45, p10 30, p90 61.
Dominant simple strategy (beats every other simple one >55%): bestNow.

### Full matches, both teams defend with "adaptive" (row win % vs column)

| vs | alwaysShoot | bestNow | bestShooter | reposition | attackWeakest | random | expert | avg vs simple |
|---|---|---|---|---|---|---|---|---|
| alwaysShoot | - | 18% | 37% | 41% | 53% | 55% | 14% | 37% |
| bestNow | 82% | - | 65% | 71% | 84% | 85% | 38% | 76% |
| bestShooter | 63% | 35% | - | 57% | 69% | 67% | 25% | 56% |
| reposition | 60% | 29% | 43% | - | 60% | 67% | 23% | 48% |
| attackWeakest | 47% | 16% | 31% | 40% | - | 55% | 11% | 34% |
| random | 45% | 15% | 33% | 33% | 45% | - | 13% | 34% |
| expert | 86% | 62% | 75% | 78% | 89% | 87% | - | 78% |

Match length in decisions (both teams): median 45, p10 31, p90 60.
Dominant simple strategy (beats every other simple one >55%): bestNow.

### When is each action the best one? (expert planner, court-reading defense, decisions with a choice)

| action | best in | avg edge over best other kind (pts) |
|---|---|---|
| shoot | 17% | 0.230 |
| pass | 26% | 0.245 |
| drive | 21% | 0.060 |
| cut | 37% | 0.101 |

### Calibration (announced probability vs observed frequency)

| announced bin | samples | mean announced | observed |
|---|---|---|---|
| 0-10% | 111589 | 4.4% | 4.4% |
| 10-20% | 23619 | 13.4% | 13.2% |
| 20-30% | 14817 | 24.2% | 24.4% |
| 30-40% | 57293 | 35.8% | 35.7% |
| 40-50% | 22256 | 45.1% | 45.2% |
| 50-60% | 7292 | 53.6% | 53.0% |
| 60-70% | 10076 | 63.6% | 63.6% |
| 70-80% | 6163 | 74.2% | 74.9% |
| 80-90% | 12219 | 88.0% | 88.4% |
| 90-100% | 15695 | 91.8% | 91.7% |

| event | samples | mean announced | observed |
|---|---|---|---|
| cut:open | 19471 | 47.3% | 47.0% |
| drive:beat | 47066 | 33.9% | 33.8% |
| drive:steal | 47066 | 7.9% | 7.8% |
| pass:catch | 27914 | 90.1% | 90.3% |
| pass:pick | 27914 | 9.9% | 9.7% |
| shoot:block | 55794 | 1.4% | 1.3% |
| shoot:make | 55794 | 44.3% | 44.5% |

### Reading the results

- **Calibration holds.** In every 10% bin the observed frequency is within 0.7 points of the announced probability (e.g. announced 35.8% vs observed 35.7%; shot make 44.3% vs 44.5%). The odds on screen are the real ones.
- **No fixed rule dominates.** Always shooting averages 0.66 points per possession and collapses to 0.42 against pressure and 0.56 against the adaptive defense, which learns the habit and presses. Feeding the best shooter (0.86) is beaten by always pressing (0.68). Repositioning and attacking the weakest defender stay around 0.58-0.73. Each one has a defense that punishes it.
- **Shooting now, moving and passing have different jobs.** With best play, shooting is the right call in 17% of decisions with a choice (open looks, good shooters against space, last move), passing in 26% (to the open man or the shooter; the biggest edge when it is right: +0.25 points), driving in 21% (against pressure) and cutting in 37% (setting up the next pass against denial). Fixed defenses show the triangle: always pressing kills shots, always giving space kills drives (attackWeakest 0.57) but feeds shooters (1.20), always denying hurts passing plans.
- **Thinking ahead pays.** The expert planner beats every simple strategy (58-89% in full matches) and scores more points per possession than bestNow: +0.12 against the court-reading defense, +0.08 against the adaptive one, +0.10 on average over all six defenses (1.08 vs 0.98; the gap is smallest against always pressing, +0.02).
- **Open issue: "best immediate play" is the strongest simple strategy** (72% average against the other simple ones with the court-reading defense, 76% with the adaptive one). It is a best response to the exact odds on screen, so the adaptive defense cannot exploit it the way it exploits fixed habits; it still loses to planning (42% and 38%). In the game this is the "follow the numbers" baseline we want new players to reach; depth beyond it comes from setting up plays two moves ahead. If playtests show it feels solved, levers are: hide the defense lean (show only the stance icons), make advantages last one decision longer, or add per-player hot zones.
- **Match length:** median 45 decisions per match (both sides), 10th-90th percentile 30-61.


## 10. Match format and pacing

| Target | Value |
|---|---|
| Match | First to 9, or most points after 9 possessions each; tie = sudden death by possession pairs |
| Decisions per match (both sides) | median 45, p10-p90 30-61 (simulated, section 9) |
| Decision | No timer |
| Resolution | ~0.5 s stance reveal + 1-2 s play + ~1 s explanation |

## 11. Equal teams, league and levels

- The rival plays with copies of your three starters' stats (same slot = same role), in its own colors and names. League order, unlocks, coins, XP, levels, scouting and the roster stay. Signing or leveling a player changes both teams the same way, so the league is about reading the AI (its tier sets how much it adapts and how sharp it attacks).
- Specials and energy are off (`ENABLE_SPECIALS`). The technique list is hidden on player cards.

## 12. Tech

- TypeScript + Vite + Three.js. DOM for menus, HUD and decision bar; CSS2D labels for the world-anchored odds.
- `rules.ts`: pure possession engine (zones, routes, branches, odds, AI policies, planner, explanations, seeded RNG). No DOM, runs in Node.
- `sim.ts`: headless simulator (Node 22.6+ type stripping, no extra dependencies).
- `match.ts`: turn loop, positions per stance, previews, animations, tutorial script. `decisionui.ts`: decision bar. `world.ts`: scene, zones on the floor, camera rig, preview primitives. `main.ts`: screens. `game.ts`: save and progression. `data.ts`: players, rivals, flags.
- Deployed to GitHub Pages via Actions with `base: /coolmath-turn-ball/`.

## 13. Roadmap

1. Bring specials back as rare, visible one-shot cards per match (not energy), and re-check balance in the simulator.
2. Screens and give-and-go as two-player routes.
3. Per-player hot zones (shooters strong from specific spots) to make the zone choice richer.
4. Analytics hooks (moves per possession, action mix, tutorial drop-off).
5. Settings: reduced motion, left-handed layout.

## 14. Known risks

- The odds are exact and visible, so a player who always picks the best-looking immediate option plays reasonably well; the simulator shows planning a step ahead beats it, but the gap has to be felt by real players.
- The adaptive AI can feel "unfair" if it reads you too fast; its strength is capped and tied to the rival tier.
- Older phones: CSS2D labels and WebGL need real-device testing.
