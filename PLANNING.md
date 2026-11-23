# Turn Ball - Planning (v4, techniques and progression)

> A Coolmath-style 3x3 street hoops game in 3D. Every possession is a short chain of decisions: you pick a move, watch it play out, and decide again. All names, characters, art and audio are original and generated in code.

## 0. Why v4

Feedback on v3: passes, shots, drives and plays had no options. Players want to do different kinds of each, like in an RPG, and to learn new ones over time.

v4 keeps the v3 loop (turn-based possessions, blind stances, exact odds in the world, AI, league) and adds:

| v3 | v4 |
|---|---|
| One way to shoot, pass, drive, cut | Every action has techniques (4-5 each) with their own odds, trade-offs, preview and animation. "Cut" is now "Play". |
| Three stances | Three stance families, each with defensive techniques (press / ball hawk; give space / float / help and recover; deny / jump lanes / switch). Still chosen blind. |
| Specials and energy switched off (`ENABLE_SPECIALS`) | **Replaced** by the technique repertoire (section 4b). The old special/energy data and the flag are deleted: techniques are always available once equipped, cost nothing, and their only price is the trade-off built into their odds plus the limited slots. A spendable energy bar would add a second resource to every decision and make the shown odds depend on a hidden budget; slots move that choice to the team screen, between matches. |
| Everyone identical apart from stats | Each player has a role, a starting repertoire and a learning path (section 11b). Signings bring identity: shooters, playmakers, slashers, defenders. |
| Rival mirrors your stats | Still mirrors stats; its techniques come from its tier, so learning makes you stronger than early rivals and keeps you level with late ones. |

## 0b. Why v3

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
| Energy, specials, star toggle | Off in v3; replaced by techniques in v4. Shield/Protect is out. |
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

## 4b. Techniques (v4)

Every action is done with a technique. Basic techniques (in bold) are known by everyone and never take a slot. Shots, passes and drives use the ball handler's techniques; plays use the technique of the player who moves (the cutter, the screener who rolls, or the handler on a give and go), so a big who knows Pick and roll makes it available whenever someone else has the ball. Defensive techniques are a team pool: every defensive technique equipped by a starter.

| Action | Technique | Good when | Punished by / risk |
|---|---|---|---|
| Shoot | **Jump shot** | Any spot; best against Give space | Press (-13 make), blocks |
| | Bank shot | Wing, elbow, post (needs an angle). Suffers only 40% of the pressure penalty; fewer blocks | Gains only half of the space bonus |
| | Fadeaway | Anywhere. Ignores Press and most blocks | -5 base make; keeps 30% of the space bonus |
| | Layup | Post only. +12 make; 22% of makes are fouls for +1 (12% when open). Best when open or vs Deny | Help: 1.8x the paint penalty and 2x blocks vs Press / Float |
| Pass | **Chest pass** | Plain | Deny picks it |
| | Bounce pass | Short passes; halves Deny picks (x0.4) | Press tips it (+5 pick) |
| | Lob | To elbow or post, over Deny (-8 pick). To the post 70% of catches are open finishes (20% at the elbow) | Help in the paint picks it (+16 vs Give space) |
| | No-look pass | 22-35% of catches leave the catcher open | +5 pick everywhere |
| Drive | **Drive** | Beats Press; inside drives pull help vs Give space | Space walls it |
| | Crossover | Vs Press: beat x1.45 | +4 steal vs the other families |
| | Hesitation | Vs Give space: +20 beat | Vs Press: -15 beat, +3 steal |
| | Spin move | Steals x0.4 vs Press, never pulls help | Slower: beat x0.8 / x0.45 / x0.6 |
| | Step-back | Stays in place and makes room: open shot next (40% vs Press) | Useless vs Give space (12%); one decision of openness only |
| Play | **Cut** | Deny (70% open) | Help sees it |
| | Backdoor | Cuts toward the rim: x1.35 vs Deny | x0.5 vs Give space |
| | Screen cut | A teammate screens: 66% open vs Press; if covered the screener may slip free | Switch (22%) |
| | Pick and roll | Screener rolls to the post: handler free or roller open (Press 32% / 24%) | Switch kills it (10% / 12%) |
| | Give and go | Pass, run toward the rim, get it back open (60% vs Press) | Two passes: picks vs Deny |
| Press | **Press** | Shots, last-move shots | Drives |
| | Ball hawk | More steals on drives (19%), picks (10%) and strips during plays (10%) | Easier to beat (56%), weaker contest, screens and give and go get through more |
| Give space | **Give space** | Drives, cuts | Outside shots |
| | Float | Packs the paint: close shots -15, drives 5%, roller and cuts covered | Outside still open; help leaves a man free 55% |
| | Help and recover | Helps without leaving men free (35%) | Drives get by more (26%) |
| Deny pass | **Deny pass** | Passes | Backdoor cuts, drives |
| | Jump lanes | Picks 25% of passes | Cuts get open 78% |
| | Switch | Screens, pick and roll, cuts | Mismatch inside (+10 close shots) |

The AI defense chooses, for each family, the technique that leaves the attack the smallest best option in the current public state (exact expectimax value). The stance mix itself still comes from court reading / the opponent model, so the blind choice and the exact odds are unchanged: the lean chip shows the mix and the technique per family.

## 6. Previews and wording

Selecting an option shows its consequence in the 3D world and the exact odds as labels anchored there:

- Shot: dotted arc to the rim, ghost ball, red contest wall over the defender, IN / MISS / BLOCK.
- Pass: dotted pass line, green ring on the receiver, red ring on the receiver's defender, CATCH / PICKED.
- Drive and cut: dotted route between zones, green ring on the final zone, red ring on the defender who covers the route, orange ring on the help defender when help is possible; PAST / MATE FREE / HELD / STOLEN or OPEN / COVERED / STRIPPED.
- Stances: ghost rings where each defender would stand, the lanes you would close, BALL / GOES ON / SCORE.

Shots, passes, drives and plays each draw differently per technique: a bank shot bounces its dotted arc off the glass, a fadeaway shows the step back and a higher arc, a layup shows the run to the rim and the AND ONE chance; a bounce pass dips to the floor, a lob arcs high, a no-look pass is a fast pink line with an eye mark; a crossover route zigzags, a hesitation marks the pause, a spin loops, a step-back draws a short arrow back; a backdoor dips toward the baseline, a screen cut shows the screener and the screen wall, a pick and roll shows the screen on your defender and the roll, a give and go shows both passes. Non-basic techniques also carry a gold name tag in the world. Defensive techniques preview their own spots and marks (hands in the lanes for ball hawk, the deep paint ring for float, help-and-back lines for recover, thick lanes for jump lanes, crossing lines for switch).

Next to the GO button a three-line card says in a few words what you gain, what you risk and what changes, with numbers ("+2 at 38%", "Block 6%", "Ends the possession"; "Past 41%: then 72%", "Stolen 9%", "Help may free #11").

On attack the decision bar also shows the defense lean: the exact mix of stances the AI will sample from in this situation, each with the icon of the defensive technique it would use. That is the "defensive coverage" before you commit. On defense it shows the mirror: the exact mix of shoot / pass / drive / cut the AI attacker samples from, so a stance whose odds read "BALL 1%, GOES ON 99%" (early in a possession the AI rarely shoots) still has a visible reason.

**The odds are exact.** Every (action, technique, defensive technique) triple is a list of explicit weighted branches (`rules.ts`). The preview sums them over the defense's stance distribution (or the AI attacker's action distribution, on defense) and the resolution samples from the very same lists. Percentages are rounded with a largest-remainder method so they add up to 100. The simulator checks calibration (section 9).

## 7. AI

- **Defense (court reading).** Weights from public information only: last move (press), shooter quality at a 2-point spot (press good shooters, sag off poor ones), handler in the post (sag), fast handler (sag), an open teammate (deny).
- **Defense (adaptive).** Watches your past decisions and scores how well six simple models of a player would have predicted them (shoot now, best immediate play, full planner, feed the best shooter, drive in, cut first). It then predicts your next action from the models that fit and leans toward the stance that answers it. Lean strength grows with the rival's tier (`smart` 0.2 to 0.6).
- **Attack.** Softmax over exact expected values (an expectimax planner of the rest of the possession). It assumes you defend like a mix of uniform and your own recent stance habits. Higher tiers are sharper (lower temperature) and read you more.

## 8. Tutorial

Three guided possessions, one relation each, then one possession without help. The stance is shown in advance (the lean chip shows 100%), only the lesson's options are enabled, and the roll lands on the lesson's outcome (the odds shown are the real ones).

1. **Space: shoot.** The shooter on the wing, defense gives space. Shoot.
2. **Pressure: crossover.** Defense presses. Drive, pick the Crossover technique (the tutorial handler knows it; it glows), then an elbow; shoot open. This is the only lesson about techniques: it shows that a move opens its techniques and how to pick one, without adding a step.
3. **Help: pass.** Defense sags. Drive inside, help leaves a teammate, pass to the free teammate, shoot.
4. **Your call.** Normal possession against the court-reading defense, no hints.

It starts automatically before the first league match and can be replayed from Help.

## 9. Simulator and balance

`npm run sim` (options `--seed N --poss N --matches N`, `--quick` for a short run, `--tech` for only the technique and progression sections) runs the same `rules.ts` without graphics. Same seed, same numbers.

Attack strategies: **alwaysShoot** (best shot technique every time), **bestNow** (best immediate play using the odds shown on screen), **bestShooter**, **reposition**, **attackWeakest**, **random**, and **expert** (exact expectimax planner, the skill ceiling). Defense policies: fixed stances, uniform, **read** (court reading, the base AI) and **adaptive** (opponent model, `smart` 0.6). With defensive techniques, every policy plays, inside the chosen family, the technique that leaves the attack the smallest best option. Kits: **base** (basic techniques only), **learned** (starters at level 5: first 3 path techniques), **veteran** (all 5 path techniques, 4 slots), **rival5** (a tier-5 rival), **all** (everyone knows every technique; used to check dominance).

What it checks for v4:

1. **No technique dominates.** With every technique known, for each decision and each action kind with two or more legal techniques, which one is the best of its kind (and by how much), and how often the planner actually uses each.
2. **Progression.** Exact expected points per possession for every pair of kits (no sampling noise), plus full matches between kits.
3. **Calibration** of every announced event of every technique.

### Reading the results

- **Every technique has situations where it is the best of its kind** ("never the best: none" against both defenses) and the use is spread: passes chest 45% / no-look 34% / bounce 21% of passes; plays cut 37% / pick and roll 35% / screen cut 26%; among shot techniques the best one is the jump shot in 71% of the decisions where it competes, the bank shot in 29% and the fadeaway in 16% of those where they are legal (when the planner actually shoots before the last move it always uses the jump shot; bank shot and fadeaway win mostly on the forced last shot against pressure). Defensive techniques are all used: press 50% / ball hawk 50%; give space 22% / float 24% / help and recover 54%; deny 38% / jump lanes 18% / switch 44% (court-reading defense).
- **The one 100% line is the Layup** at the post (59 states in the run): the expert only holds the ball at the post when open (after a drive past, a lob or a roll), and an open layup with its and-one chance is always the best finish there. Contested at the post on the last move (Press-heavy), bank shot and fadeaway beat it (checked by hand: bank 0.547, fade 0.553, layup 0.450 expected points). Interior techniques (Layup, Lob, Backdoor) matter less than outside ones because inside shots are worth 1 point and outside 2 (3x3 scoring); see Known risks.
- **Learned techniques make a team stronger, not unbeatable.** Exact values: learned attack vs basic defense 1.112 points per possession vs 1.059 for basic vs basic (+0.053), and a learned defense holds a basic attack to 1.019 (-0.040). In full matches the learned team beats the basic one 54% (court-reading defense) and 61% (adaptive); veteran 59% / 60%; a tier-5 rival kit 55% / 64%. Kits of similar size play each other around 50%.
- **Calibration:** in nine of the ten 10% bins the gap between announced and observed is at most 0.6 points; the 70-80% bin, the smallest one (2522 samples), shows 1.0 points with a standard error of 0.9 points, which is sampling noise (the odds are exact by construction: the preview and the roll use the same branch lists). Largest gap: 1.02 points, just above the 1-point target in this run (an earlier run of the same code before the last Float tweak gave 0.84); a bigger sample would shrink it. Per technique, e.g. pick and roll roll-open 23.0% announced vs 22.9% observed, jump shot make and chest pass catch within 0.3 points; the noisiest is no-look feed (23.8% vs 25.1%, 3361 samples).
- **v3 behaviour is preserved with basic techniques** (same strategy ranking: expert first, bestNow the strongest simple strategy, always shooting punished by pressure and by the adaptive defense; match length median 45 decisions).

Results below are the literal output of `npm run sim` (Turn Ball simulation (seed 2026, 1500 possessions per cell, 200 matches per pairing), 323.9 s):

Rules: 4 decisions per possession, first to 9 or most points after 9 possessions each. Equal stats (mirrored starters).

### Technique balance: expert planner vs "read" defense, every technique known (4325 decisions with a choice)

"share of kind" = how often the planner picks this technique when it picks that action kind. "best of its kind" = in decisions where two or more techniques of that kind are legal, how often this one is the best of them; "edge" = average points over the next best technique of the same kind when it is.

| technique | kind | legal in | share of kind | best of its kind | edge (pts) |
|---|---|---|---|---|---|
| Jump shot | shoot | 5056 | 100% | 71% | 0.059 |
| Bank shot | shoot | 2200 | 0% | 29% | 0.034 |
| Fadeaway | shoot | 5056 | 0% | 16% | 0.027 |
| Layup | shoot | 59 | 0% | 100% | 0.127 |
| Chest pass | pass | 4325 | 45% | 23% | 0.036 |
| Bounce pass | pass | 3960 | 21% | 23% | 0.011 |
| Lob | pass | 829 | 0% | 62% | 0.071 |
| No-look pass | pass | 4325 | 34% | 44% | 0.032 |
| Drive | drive | 4325 | 0% | 11% | 0.005 |
| Crossover | drive | 4325 | 100% | 10% | 0.020 |
| Hesitation | drive | 4325 | 0% | 15% | 0.008 |
| Spin move | drive | 4325 | 0% | 40% | 0.009 |
| Step-back | drive | 4266 | 0% | 24% | 0.034 |
| Cut | cut | 4325 | 37% | 30% | 0.003 |
| Backdoor | cut | 4125 | 0% | 5% | 0.007 |
| Screen cut | cut | 4325 | 26% | 17% | 0.006 |
| Pick and roll | cut | 4325 | 35% | 41% | 0.083 |
| Give and go | cut | 4266 | 1% | 8% | 0.021 |

Defensive technique chosen per family (states where the family has a choice):

| family | technique share |
|---|---|
| press | Press 50%, Ball hawk 50% |
| space | Give space 22%, Float 24%, Help and recover 54% |
| deny | Deny pass 38%, Jump lanes 18%, Switch 44% |

Highest "best of its kind" share: Layup 100%. Techniques that are never the best of their kind: none.

### Technique balance: expert planner vs "adaptive" defense, every technique known (4342 decisions with a choice)

"share of kind" = how often the planner picks this technique when it picks that action kind. "best of its kind" = in decisions where two or more techniques of that kind are legal, how often this one is the best of them; "edge" = average points over the next best technique of the same kind when it is.

| technique | kind | legal in | share of kind | best of its kind | edge (pts) |
|---|---|---|---|---|---|
| Jump shot | shoot | 5117 | 100% | 72% | 0.060 |
| Bank shot | shoot | 2109 | 0% | 35% | 0.029 |
| Fadeaway | shoot | 5117 | 0% | 13% | 0.026 |
| Layup | shoot | 46 | 0% | 100% | 0.138 |
| Chest pass | pass | 4342 | 42% | 22% | 0.036 |
| Bounce pass | pass | 3982 | 23% | 23% | 0.010 |
| Lob | pass | 749 | 0% | 60% | 0.072 |
| No-look pass | pass | 4342 | 35% | 46% | 0.027 |
| Drive | drive | 4342 | 0% | 12% | 0.005 |
| Crossover | drive | 4342 | 0% | 15% | 0.011 |
| Hesitation | drive | 4342 | 0% | 10% | 0.005 |
| Spin move | drive | 4342 | 0% | 40% | 0.010 |
| Step-back | drive | 4296 | 0% | 24% | 0.039 |
| Cut | cut | 4342 | 36% | 31% | 0.003 |
| Backdoor | cut | 4154 | 0% | 5% | 0.006 |
| Screen cut | cut | 4342 | 27% | 18% | 0.006 |
| Pick and roll | cut | 4342 | 33% | 42% | 0.080 |
| Give and go | cut | 4296 | 3% | 4% | 0.012 |

Defensive technique chosen per family (states where the family has a choice):

| family | technique share |
|---|---|
| press | Press 48%, Ball hawk 52% |
| space | Give space 21%, Float 23%, Help and recover 56% |
| deny | Deny pass 35%, Jump lanes 19%, Switch 46% |

Highest "best of its kind" share: Layup 100%. Techniques that are never the best of their kind: none.

### Learned techniques: exact expected points per possession

Expectimax value of a possession averaged over every starting formation and handler: the attack plays its best line knowing the defense mix, the defense reads the court and plays the technique per family that leaves the attack the smallest best option. Rows: attack kit; columns: defense kit.

| attack \ defense | base | learned | veteran | rival5 | all |
|---|---|---|---|---|---|
| base | 1.059 | 1.019 | 1.005 | 0.992 | 0.989 |
| learned | 1.112 | 1.067 | 1.067 | 1.054 | 1.048 |
| veteran | 1.114 | 1.069 | 1.069 | 1.055 | 1.047 |
| rival5 | 1.112 | 1.067 | 1.067 | 1.054 | 1.048 |
| all | 1.131 | 1.093 | 1.093 | 1.080 | 1.074 |

### Learned techniques vs base kit (full matches, equal stats, row win % vs column)

Both teams: expert planner on attack, court-reading or adaptive defense (each team defends with its own defensive techniques). Kits: base = basics only; learned = starters at level 5 (3 path techniques each); veteran = all 5 path techniques, 4 slots; rival5 = a tier-5 rival.

Defense "read":

| vs | base | learned | veteran | rival5 |
|---|---|---|---|---|
| base | - | 46% | 41% | 45% |
| learned | 54% | - | 50% | 50% |
| veteran | 59% | 51% | - | 50% |
| rival5 | 55% | 50% | 50% | - |

Defense "adaptive":

| vs | base | learned | veteran | rival5 |
|---|---|---|---|---|
| base | - | 39% | 40% | 36% |
| learned | 61% | - | 49% | 51% |
| veteran | 60% | 51% | - | 49% |
| rival5 | 64% | 49% | 51% | - |

Points per possession, expert attack vs court-reading defense, by attack kit / defense kit:

| attack \ defense | base | learned | veteran | rival5 |
|---|---|---|---|---|
| base | 1.02 | 1.03 | 0.99 | 0.97 |
| learned | 1.14 | 1.05 | 1.09 | 1.04 |
| veteran | 1.12 | 1.09 | 1.06 | 1.08 |
| rival5 | 1.07 | 1.04 | 1.09 | 1.03 |

### Basic techniques only: points per possession (attack strategy vs defense policy)

| attack \ defense | alwaysPress | alwaysSpace | alwaysDeny | uniform | read | adaptive | avg |
|---|---|---|---|---|---|---|---|
| alwaysShoot | 0.45 | 0.96 | 0.59 | 0.67 | 0.71 | 0.59 | 0.66 |
| bestNow | 0.94 | 1.10 | 0.90 | 0.93 | 0.94 | 0.93 | 0.96 |
| bestShooter | 0.64 | 1.24 | 0.76 | 0.89 | 0.87 | 0.75 | 0.86 |
| reposition | 0.67 | 0.92 | 0.74 | 0.67 | 0.68 | 0.66 | 0.72 |
| attackWeakest | 0.60 | 0.57 | 0.56 | 0.57 | 0.57 | 0.59 | 0.58 |
| random | 0.44 | 0.86 | 0.57 | 0.59 | 0.58 | 0.56 | 0.60 |
| expert | 1.01 | 1.19 | 1.10 | 1.11 | 1.06 | 1.06 | 1.09 |

| strategy | decisions/poss | shoot | pass | drive | cut |
|---|---|---|---|---|---|
| alwaysShoot | 1.18 | 100% | 0% | 0% | 0% |
| bestNow | 2.65 | 36% | 26% | 37% | 1% |
| bestShooter | 1.84 | 57% | 43% | 0% | 0% |
| reposition | 2.68 | 36% | 0% | 64% | 0% |
| attackWeakest | 3.21 | 28% | 21% | 52% | 0% |
| random | 3.50 | 29% | 14% | 20% | 37% |
| expert | 3.23 | 30% | 22% | 17% | 31% |

Same table, every technique known by both sides:

| attack \ defense | alwaysPress | alwaysSpace | alwaysDeny | uniform | read | adaptive | avg |
|---|---|---|---|---|---|---|---|
| alwaysShoot | 0.63 | 0.95 | 0.62 | 0.71 | 0.72 | 0.64 | 0.71 |
| bestNow | 1.00 | 1.16 | 0.95 | 1.04 | 1.05 | 1.01 | 1.04 |
| random | 0.48 | 0.69 | 0.58 | 0.57 | 0.61 | 0.56 | 0.58 |
| expert | 1.03 | 1.19 | 1.10 | 1.13 | 1.06 | 0.99 | 1.09 |

### Full matches, basic techniques, both teams defend with "read" (row win % vs column)

| vs | alwaysShoot | bestNow | bestShooter | reposition | attackWeakest | random | expert | avg vs simple |
|---|---|---|---|---|---|---|---|---|
| alwaysShoot | - | 32% | 43% | 43% | 55% | 62% | 19% | 43% |
| bestNow | 68% | - | 59% | 78% | 87% | 82% | 42% | 73% |
| bestShooter | 57% | 41% | - | 61% | 75% | 70% | 33% | 58% |
| reposition | 57% | 22% | 39% | - | 63% | 61% | 22% | 45% |
| attackWeakest | 45% | 13% | 26% | 38% | - | 56% | 8% | 30% |
| random | 38% | 19% | 30% | 39% | 44% | - | 17% | 34% |
| expert | 81% | 59% | 68% | 79% | 92% | 84% | - | 76% |

Match length in decisions (both teams): median 45, p10 30, p90 60.
Dominant simple strategy (beats every other simple one >55%): bestNow.

### Calibration (announced probability vs observed frequency, every technique)

| announced bin | samples | mean announced | observed | gap (pts) | std. error (pts) |
|---|---|---|---|---|---|
| 0-10% | 68753 | 5.3% | 5.3% | 0.0 | 0.1 |
| 10-20% | 31527 | 13.8% | 13.8% | 0.0 | 0.2 |
| 20-30% | 24651 | 25.4% | 25.7% | 0.2 | 0.3 |
| 30-40% | 50533 | 35.7% | 35.6% | 0.0 | 0.2 |
| 40-50% | 32663 | 43.7% | 44.3% | 0.6 | 0.3 |
| 50-60% | 4450 | 54.1% | 54.0% | 0.1 | 0.7 |
| 60-70% | 21746 | 63.1% | 62.8% | 0.3 | 0.3 |
| 70-80% | 2522 | 74.2% | 73.2% | 1.0 | 0.9 |
| 80-90% | 8495 | 88.1% | 88.1% | 0.0 | 0.4 |
| 90-100% | 17513 | 91.9% | 91.6% | 0.2 | 0.2 |

Largest bin gap: 1.02 points.

| technique:event | samples | mean announced | observed |
|---|---|---|---|
| backdoor:open | 1064 | 42.9% | 44.1% |
| bank:block | 2433 | 1.1% | 1.0% |
| bank:make | 2615 | 38.2% | 39.3% |
| bounce:catch | 729 | 92.1% | 90.7% |
| bounce:pick | 729 | 7.9% | 9.3% |
| chest:catch | 25279 | 90.6% | 90.5% |
| chest:pick | 25279 | 9.4% | 9.5% |
| cross:beat | 1650 | 42.4% | 41.7% |
| cross:steal | 1650 | 10.2% | 10.8% |
| cut:open | 15042 | 44.0% | 43.9% |
| drive:beat | 19870 | 34.0% | 34.1% |
| drive:steal | 19870 | 7.9% | 7.9% |
| fade:block | 7037 | 0.4% | 0.3% |
| fade:make | 7347 | 40.3% | 39.4% |
| giveandgo:open | 454 | 34.4% | 33.9% |
| hesi:beat | 805 | 35.8% | 35.0% |
| hesi:steal | 805 | 8.7% | 8.2% |
| jumper:block | 16585 | 2.0% | 2.1% |
| jumper:make | 40212 | 50.3% | 50.4% |
| nolook:catch | 3361 | 60.8% | 59.1% |
| nolook:feed | 3361 | 23.8% | 25.1% |
| nolook:pick | 3361 | 15.4% | 15.7% |
| pnr:beat | 14648 | 33.4% | 33.8% |
| pnr:open | 14648 | 23.0% | 22.9% |
| screen:open | 15006 | 42.8% | 43.4% |
| screen:slip | 15006 | 13.5% | 13.2% |
| spin:beat | 639 | 22.7% | 23.9% |
| spin:steal | 639 | 4.6% | 4.5% |
| stepback:room | 1111 | 30.3% | 30.6% |
| stepback:steal | 1111 | 4.1% | 4.2% |

Run time 323.9 s.

## 10. Match format and pacing

| Target | Value |
|---|---|
| Match | First to 9, or most points after 9 possessions each; tie = sudden death by possession pairs |
| Decisions per match (both sides) | median 45, p10-p90 30-60 (simulated, section 9) |
| Decision | No timer |
| Resolution | ~0.5 s stance reveal + 1-2 s play + ~1 s explanation |

## 11. Equal teams, league and levels

- The rival plays with copies of your three starters' stats (same slot = same role), in its own colors and names. League order, unlocks, coins, XP, levels, scouting and the roster stay. Signing or leveling a player changes both teams the same way, so the league is about reading the AI (its tier sets how much it adapts and how sharp it attacks).
- Specials and energy are gone (replaced by techniques, section 4b).

## 11b. Progression and build (v4)

- **Start.** The three starters know only the basic techniques. Signings arrive with 1-2 signature techniques (Kiki: No-look pass; Benny: Switch; Nova: Lob + Bank shot; Taro: Help and recover; Jax: Ball hawk; Ruby: Fadeaway; Zed: Hesitation; Fern: Layup + Crossover; Ola: Crossover + Hesitation).
- **Learning.** Each player has a five-technique path that fits the role (Pip, slasher: Crossover, Ball hawk, Spin move, Give and go, Step-back; Mo, big: Pick and roll, Switch, Layup, Float, Bank shot; Luz, shooter: Fadeaway, Screen cut, Bounce pass, Bank shot, Help and recover). The next one is learned at levels 2, 3, 5, 7 and 9, or right away by **training** in the team screen (80 coins + 40 per technique already known). The **first win against each league team** teaches its signature technique (Bounce pass, Backdoor, Hesitation, Lob, Jump lanes, No-look pass) to the starter who scored most and does not know it yet.
- **Slots.** 2 slots (3 from level 4, 4 from level 8). A new technique is equipped automatically if a slot is free; otherwise it waits on the bench. Equipping is a tap on the team screen, and only equipped techniques exist in a match. Since defensive techniques form a team pool and plays belong to the mover, building is about who carries what (e.g. Mo with Pick and roll and Switch, Luz with Fadeaway and Screen cut).
- **Notices.** The result screen lists every new technique first, with icon, one line, how it was learned and whether it was equipped; the team screen marks new ones as NEW and shows the next unlock and its level or training cost.
- **Rivals.** Stats still mirror your starters; rival player i of tier t knows the first min(t, 4) techniques of its role path (guard: Crossover, Ball hawk, Give and go, Spin move; big: Pick and roll, Switch, Layup, Float; wing: Fadeaway, Screen cut, Bounce pass, Jump lanes).

## 12. Tech

- TypeScript + Vite + Three.js. DOM for menus, HUD and decision bar; CSS2D labels for the world-anchored odds.
- `rules.ts`: pure possession engine (zones, routes, technique and defensive-technique tables, branches, odds, AI policies, planner, explanations, seeded RNG). `techs.ts`: technique identity (name, icon, one line), slots and learning levels. No DOM, both run in Node.
- `sim.ts`: headless simulator (Node 22.6+ type stripping, no extra dependencies).
- `match.ts`: turn loop, positions per defensive technique, previews and animations per technique, tutorial script. `decisionui.ts`: decision bar (action, technique, target). `world.ts`: scene, zones on the floor, camera rig, preview primitives. `main.ts`: screens. `game.ts`: save, progression, learning, training, slots (old saves are migrated from template + level). `data.ts`: players, paths, rivals.
- Deployed to GitHub Pages via Actions with `base: /coolmath-turn-ball/`.

## 13. Roadmap

1. More techniques per role (post moves, catch-and-shoot, hedge) and technique upgrades (rank 2) instead of only new ones.
2. Interior play is still worth less than outside (1 point vs 2): watch whether Layup, Lob and Backdoor feel useful in playtests.
3. Per-player hot zones (shooters strong from specific spots) to make the zone choice richer.
4. Analytics hooks (moves per possession, action mix, tutorial drop-off).
5. Settings: reduced motion, left-handed layout.

## 14. Known risks

- Interior techniques (Layup, Lob, Backdoor) are niche: 1-point inside shots are worth less than 2-point outside ones, so the planner rarely goes inside. They are the best option in their situations, but playtests should confirm they feel useful.
- The odds are exact and visible, so a player who always picks the best-looking immediate option plays reasonably well; the simulator shows planning a step ahead beats it, but the gap has to be felt by real players.
- The adaptive AI can feel "unfair" if it reads you too fast; its strength is capped and tied to the rival tier.
- Older phones: CSS2D labels and WebGL need real-device testing.
