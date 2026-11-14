# Bumper Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Bumper Links, a simultaneous battle mini-golf game with an online mode (2 humans + 2 bots) and a practice mode (1 human + 3 bots).

**Architecture:** Pure shared rules in `public/games/bumper-links/shared/` (course generation, ball physics on the platform `sphereBody` controller, match rules, solver, bot). They run unchanged on the authoritative server adapter `server/platform-backend-engine/games/bumperLinks.js`. The browser renders interpolated snapshots with Three.js and only computes the aim line locally.

**Tech Stack:** ES modules with JSDoc, Three.js (already bundled by esbuild like Last Fuse), Socket.IO via the platform SDK, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-14-bumper-links-design.md`

## Global Constraints

- Mirror the Last Fuse package layout: `shared/`, `client/`, `rendering/`, `main.js`, `practice.js`, `catalog.js`, `cover.svg`, `hud.css`, `README.md`.
- Game IDs: `bumper-links` and `bumper-links-practice`; bundle entry URLs: `/games/bumper-links/dist/main.js` and `/games/bumper-links/dist/practice.js`.
- Fixed simulation step: 1/60 s. Input protocol: `INPUT_PROTOCOL.QUEUED`.
- No new dependencies. No engine or shared platform module may import Bumper Links.
- Points by sink order: 5, 3, 2, 1. Knockout bonus: +1. Water penalty: +1 stroke. Hole limit: 40 s. Holes per match: 6.
- Platform UX keeps platform visual language; the in-game HUD may use its own.
- Do not commit; the user commits on request.

## Review Focus

1. **A ball resting on a drop-step edge or against a rail** must still count as at rest and accept a shot (rest detection must not depend on being exactly on a floor).
2. **Two balls overlapping at the tee** after a respawn or hole start must separate without launching either ball (equal-mass positional correction, no impulse when relative normal speed ≥ 0).
3. **A disconnect mid-shot** must not freeze the hole: an away human's ball counts as unsunk at the time limit and the hole still ends.
4. **A shot sent while the ball is still rolling, or during `holeOver`**, is ignored without consuming a stroke.
5. **Hole generation cost**: generating and solving one hole must finish within 60 ms on the dev machine so a hole change never stalls the shared loop.

Each line has a test in the task that owns the code.

---

### Task 1: Config and course generation

**Files:**
- Create: `public/games/bumper-links/shared/config.js`
- Create: `public/games/bumper-links/shared/course.js`
- Test: `tests/bumper-links-course.test.js`

**Interfaces:**
- Produces (`config.js`):
  - `BUMPER_LINKS_GAME_ID = "bumper-links"`, `BUMPER_LINKS_PRACTICE_GAME_ID = "bumper-links-practice"`, `BUMPER_LINKS_FIXED_DT_SEC = 1/60`
  - `BUMPER_LINKS_ONLINE_PLAYER_IDS = ["p1","p2"]`, `BUMPER_LINKS_ONLINE_BOT_IDS = ["bot1","bot2"]`, `BUMPER_LINKS_PRACTICE_PLAYER_IDS = ["p1"]`, `BUMPER_LINKS_PRACTICE_BOT_IDS = ["bot1","bot2","bot3"]`
  - `BUMPER_LINKS_INPUT_TEMPLATE = {aimYaw:0,power:0,shoot:false}`, `BUMPER_LINKS_NUMERIC_INPUTS = {aimYaw:{min:-Math.PI,max:Math.PI},power:{min:0,max:1}}`, `BUMPER_LINKS_EDGE_KEYS = ["shoot"]`
  - `BUMPER_LINKS_BALL_COLORS` (6 colours), `BUMPER_LINKS_COURSE` (tileSize 4, minTiles 4, maxTiles 7, railHeight 0.35, railThickness 0.2, dropHeight 0.6, openRailChance 0.3, waterY -1.5, generateAttempts 30), `BUMPER_LINKS_BALL_SETTINGS` (sphere settings: radius 0.22, gravity 18, restitution 0.62, floorRestitution 0.2, linearDamping 0.25, groundFriction 2.4, restSpeed 0.4, maxSpeed 24; plus maxShotSpeed 13, minShotSpeed 1.2, restSpeedThreshold 0.12, ballRestitution 0.9, knockCreditSec 3), `BUMPER_LINKS_CUP` (radius 0.38, captureSpeed 4.2), `BUMPER_LINKS_SWEEPER` (length 2.6, thickness 0.3, angularSpeed 1.6, pushSpeed 5), `BUMPER_LINKS_MATCH_SETTINGS` (holes 6, holeTimeSec 40, holeResetSec 3, sinkPoints [5,3,2,1], knockoutPoints 1, waterPenaltyStrokes 1, maxStrokes 10)
  - Typedefs: `BumperLinksInputState`, `BumperLinksPhase = "waiting"|"countdown"|"playing"|"holeOver"|"paused"|"finished"`, `BumperLinksTileKind = "tee"|"straight"|"corner"|"drop"|"bumpers"|"sweeper"|"cup"`
- Produces (`course.js`):
  - `createBumperLinksCourse(seed:number): BumperLinksCourse` — pure and deterministic, layout only. `{seed, tiles:{col,row,kind,height,entry,exit}[], solids:SphereSolid[], tee:{x,y,z}, cup:{x,y,z}, sweepers:{x,y,z,phase}[], path:{x,z}[], bounds:{minX,maxX,minZ,maxZ}}`. `path` holds tile centres in order, used for remaining-distance scoring.
  - `listBumperLinksNearbySolids(course, x, z, out:SphereSolid[]): SphereSolid[]` — fills and returns `out` with solids whose XZ box is within one tile of the point.
  - `measureBumperLinksRemainingPath(course, x, z): number` — distance along `path` from the nearest segment to the cup.
  - `getBumperLinksSweeperSegment(sweeper, timeSec, out:{ax,az,bx,bz}): {ax,az,bx,bz}`

Generation: a seeded random walk on a grid without revisiting cells. Tile heights only stay equal or fall by `dropHeight` along the path, because the sphere controller has no slopes. Each tile has a floor box and rail boxes on sides not shared with the path. Some rail segments on straight tiles are skipped (`openRailChance`) so balls can be knocked into the water. Bumper tiles add 2–3 short post boxes; a sweeper tile adds a sweeper. The first tile is `tee` and the last is `cup`.

- [ ] **Step 1: Write the failing tests** in `tests/bumper-links-course.test.js`:
  - `course generation is deterministic per seed`: `assert.deepEqual(createBumperLinksCourse(7), createBumperLinksCourse(7))`; seeds 7 and 8 differ in `tiles`.
  - `course path never climbs`: for seeds 1..50, each successive tile `height <= previous height`, and tile count is in [4, 7].
  - `course stays within 256 solids and has a floor under tee and cup`: for seeds 1..50, `solids.length <= 256`; a downward ray at tee and cup XZ hits a solid whose `maxY` equals the tee/cup `y - radius` within 1e-6.
  - `nearby solids include the floor under the point`: `listBumperLinksNearbySolids(course, tee.x, tee.z, [])` contains a box covering the tee XZ.
  - `remaining path is zero at the cup and largest at the tee`.
- [ ] **Step 2: Run** `node --test tests/bumper-links-course.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `config.js` and `course.js` with the signatures above, using a small seeded PRNG (mulberry32) local to `course.js`.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Ball physics and match rules

**Files:**
- Create: `public/games/bumper-links/shared/ball.js`
- Create: `public/games/bumper-links/shared/match.js`
- Test: `tests/bumper-links-rules.test.js`

**Interfaces:**
- Consumes: Task 1 exports; `createSphereBodyController` from `public/platform/shared/sphereBody.js`.
- Produces (`ball.js`):
  - `createBumperLinksBall(id:string, slotIndex:number, tee): BumperLinksBall` with fields `{id,slotIndex,x,y,z,vx,vy,vz,restX,restY,restZ,atRest,aimYaw,strokes,sunk,sinkOrder,holePoints,points,knockouts,splashes,lastHitById,lastHitAgeSec,shotId,lifeId,connected}`. `lifeId` increments on each respawn or hole start and is the interpolation continuity identity.
  - `shootBumperLinksBall(ball, aimYaw, power): boolean` — only when `atRest && !sunk`; sets velocity to `minShotSpeed + power*(maxShotSpeed-minShotSpeed)`, then `strokes += 1`, `shotId += 1`, `atRest = false`. With `power <= 0`, returns false.
  - `stepBumperLinksBall(ball, dtSec, course, timeSec): void` — sphere step with nearby solids, then sweeper push and rest detection. Rest: horizontal speed < `restSpeedThreshold` and `|vy| < 0.5` with a solid within `radius + 0.02` below. Zero the velocity and record the rest point.
  - `resolveBumperLinksBallContacts(balls): void` — pairwise equal-mass impulse with `ballRestitution`, positional split of the overlap, and `lastHitById`/`lastHitAgeSec = 0` set on both balls. Only when moving towards each other; a resting ball that is hit becomes `atRest = false`.
- Produces (`match.js`):
  - `createBumperLinksMatch({playerIds, botIds, matchId=1, holeSeeds?:number[], pars?:number[]}): BumperLinksMatch` = `{matchId, holeIndex, holes:number, holeSeed, par, course, players:Record<string,BumperLinksBall>, bots:BumperLinksBall[], phase, started, startAt, gameOver, winner, holeTimeSec, holeResetRemainingSec, sinkCount, holeSerial, eventSerial, lastEvent:{serial,type:"sink"|"splash"|"knockout",ballId,byId?,points?}|null}`. Tee spawns are spread across the tee tile so balls do not overlap.
  - `listBumperLinksBalls(match, out:BumperLinksBall[]): BumperLinksBall[]`
  - `requestBumperLinksShot(match, ballId, aimYaw, power): boolean` — false unless `phase === "playing"`.
  - `stepBumperLinksWorld(match, dtSec): void` — when playing: step balls, resolve contacts, cup capture (horizontal distance < cup radius and speed < captureSpeed → sunk, `holePoints = sinkPoints[sinkCount]`), water (`y < waterY`: respawn at rest point, `strokes += waterPenaltyStrokes`, credit the knockout to `lastHitById` if `lastHitAgeSec < knockCreditSec` and the hitter is another ball, `lifeId += 1`), hole end (all sunk or `holeTimeSec >= 40` → `holeOver`, add `holePoints` to `points`). During `holeOver`, count down `holeResetSec`, then load the next hole or finish (`winner` = top of `rankBumperLinksBalls`).
  - `rankBumperLinksBalls(balls): BumperLinksBall[]` — points descending, then fewer total strokes, then slot index.
  - `loadBumperLinksHole(match, seed, par): void` — exported so the server can supply solved seeds.

- [ ] **Step 1: Write the failing tests** in `tests/bumper-links-rules.test.js`:
  - `a shot moves a resting ball and costs one stroke`; `a second shot while rolling is ignored` (Review Focus 4): returns false, strokes still 1.
  - `shots outside the playing phase are ignored` (Review Focus 4): with phase `holeOver`, `requestBumperLinksShot` is false and strokes are unchanged.
  - `a rolling ball comes to rest and records its rest point`: shoot with power 0.3 on a flat test course; after 600 steps `atRest` is true and the rest point equals the position.
  - `a ball stopped against a rail can be shot again` (Review Focus 1).
  - `overlapping balls separate without launch` (Review Focus 2): two resting balls at 0.3 m apart; after one contact step both are ≥ 2·radius apart and both speeds are < 0.01.
  - `a moving ball knocks a resting ball and both record the hit`: momentum along the normal is conserved within 1e-6 times (1 + restitution).
  - `a slow ball over the cup sinks and scores by order`: first sink gives `holePoints === 5`, second gives 3.
  - `a fast ball over the cup does not sink`.
  - `a ball knocked into the water respawns at its rest point with a penalty and credits the hitter`: `strokes += 1`, hitter `knockouts === 1`, hitter `holePoints` increases by 1, `lastEvent.type === "knockout"`.
  - `the hole ends at 40 seconds with unsunk balls scoring zero` (Review Focus 3): includes a ball whose `connected` is false.
  - `six holes then a winner`: after forcing every hole to end, `phase === "finished"`, `gameOver`, and `winner` is the highest-points ball.
- [ ] **Step 2: Run** `node --test tests/bumper-links-rules.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `ball.js` and `match.js`. The tests build a flat course through a small helper in the test file; `stepBumperLinksBall` takes the course object, so test courses need only `solids`, `cup`, `sweepers` and `waterY`, with `listBumperLinksNearbySolids` falling back to all solids when the course has no tile grid.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 3: Solver and bot

**Files:**
- Create: `public/games/bumper-links/shared/solver.js`
- Create: `public/games/bumper-links/shared/bot.js`
- Test: `tests/bumper-links-solver.test.js`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (`solver.js`):
  - `planBumperLinksShot(course, fromBall:{x,y,z}, {yawSamples=9, powerSamples=5, maxSimSec=4, rng?}): {aimYaw,power,score}`. It simulates a solo ball (no other balls) for each candidate. The yaw fan is centred on the next path waypoint ±40°. The score is `measureBumperLinksRemainingPath` at rest; sunk scores −1 and water scores +∞. It returns the best candidate.
  - `solveBumperLinksHole(seed): {seed, par}|null` — at most 6 planned shots from the tee. When it sinks, `par = clamp(shots + 1, 2, 5)`; otherwise null.
  - `generateSolvableBumperLinksHole(firstSeed): {seed, par}` — tries `firstSeed, firstSeed+1, …` up to `generateAttempts`; the last resort is a straight 4-tile course seed that always solves.
- Produces (`bot.js`):
  - `createBumperLinksBotBrain(seed): BumperLinksBotBrain` `{rng, thinkSec, pending:{aimYaw,power}|null, candidateIndex, best}`.
  - `decideBumperLinksBotShot(bot, brain, match, dtSec): {aimYaw,power}|null`. When the bot rests, it waits a 0.8–1.6 s reaction, then evaluates at most 3 candidates per call (spread across ticks, Anti-goal). It adds aim noise of ±4° and power noise of ±8%, and returns a shot when done.

- [ ] **Step 1: Write the failing tests** in `tests/bumper-links-solver.test.js`:
  - `every generated hole is solvable with par 2 to 5`: for first seeds 1..20, `generateSolvableBumperLinksHole(s)` returns par in [2,5], and `solveBumperLinksHole(result.seed)` is not null.
  - `generating and solving a hole stays within 60 ms` (Review Focus 5): median of 5 runs < 60 ms.
  - `a bot never shoots before its reaction delay and plans across ticks`: decide calls during the first 0.7 s return null; each call evaluates ≤ 3 candidates (expose `brain.candidatesEvaluatedLastCall`).
  - `bots finish a practice hole within the time limit`: drive a match with 3 bots and no humans for 40 s; at least 2 bots sink.
- [ ] **Step 2: Run** `node --test tests/bumper-links-solver.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules. If the time budget fails, lower `yawSamples` or `maxSimSec`; do not drop the check.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 4: Server adapter, registration, catalog and build

**Files:**
- Create: `server/platform-backend-engine/games/bumperLinks.js`
- Create: `public/games/bumper-links/catalog.js`, `public/games/bumper-links/shared/touchControls.js`, `public/games/bumper-links/cover.svg`
- Modify: `server/platform-backend-engine/games/builtInGames.js` (2 entries after Last Fuse), `public/platform/src/data/games.js` (2 entries and names), `package.json` (`build:bumper-links` plus the chain in `build`)
- Modify: `tests/catalog-network-ownership.test.js` (movement games 17 → 18 and add `bumper-links` to the id list), `tests/touch-controls-catalog.test.js` (20 → 22 and add both ids)
- Test: `tests/bumper-links-server.test.js`

**Interfaces:**
- Consumes: Tasks 1–3; `createAuthoritativeInputSession`, `registerPluggableGame`, `scheduleStart`, `emitEvent` exactly as `lastFuse.js` uses them.
- Produces: `bumperLinksGameMeta`, `bumperLinksPracticeGameMeta`, `registerBumperLinksGame(io)`, `registerBumperLinksPracticeGame(io)`, `createBumperLinksServerState(roomOptions, matchId=1)`, `serializeBumperLinksState(state)`.
  - The snapshot carries the match fields from Task 2 except `course` (clients rebuild it from `holeSeed`). Each ball adds `getPlayerSnapshotMetadata`. Rejoin tokens, bot brains and the SDK queue stay private.
  - Input simulation: on each fixed input, `ball.aimYaw = input.aimYaw`; when `input.shoot`, call `requestBumperLinksShot`.
  - Hole seeds: generate each hole with `generateSolvableBumperLinksHole(matchId*1009 + holeIndex*97)` when the hole loads.
  - Lifecycle copies Last Fuse: brief drops are held by the platform grace; a deliberate leave pauses; rematch needs every connected human.
  - Systems: `round-lifecycle` (-200), `player-input` (-100), `bots` (-50), `shared-world` (0).
- Touch descriptor: `apiVersion 1`, `customizable true`, preset `"two-thumb"`, controls `[{id:"aim",type:"stick",role:"move",label:"Aim",icon:"joystick"},{id:"shoot",type:"button",role:"primary",label:"Putt",icon:"sports_golf",behavior:"hold"}]`.
- Presentation: `coverUrl "/games/bumper-links/cover.svg"`, accent `#5fd38d`, controls `["keyboard","mouse","touch"]`.

- [ ] **Step 1: Write the failing tests** in `tests/bumper-links-server.test.js`, copying the Last Fuse in-memory harness:
  - `metadata registers queued input, two seats online and one in practice`.
  - `a shot input moves the player's ball and is acknowledged`: after the countdown, send `{aimYaw:0,power:0.5,shoot:true}`; within 3 ticks `strokes === 1` and `inputSeqAck >= seq`.
  - `snapshots hide rejoin tokens, bot brains and the course solids`: no `rejoinToken`, `botBrains` or `course` keys.
  - `a brief transport drop keeps the hole running and a deliberate leave pauses`, mirroring the Last Fuse tests.
  - `a hole still ends at the time limit while a human is away` (Review Focus 3).
  - `rematch needs both humans online and practice needs one`.
- [ ] **Step 2: Run** `node --test tests/bumper-links-server.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the adapter, registration, catalog entries, cover and build script.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, including the updated catalog counts and `tests/platform-boundaries.test.js`.

### Task 5: Client networking and event tracking

**Files:**
- Create: `public/games/bumper-links/client/snapshotPose.js`, `client/multiplayer.js`, `client/matchEvents.js`, `client/ballNames.js`
- Test: append to `tests/bumper-links-server.test.js`

**Interfaces:**
- Produces:
  - `listBumperLinksSnapshotBalls(snapshot)`, `extractBumperLinksPositions(snapshot)` (paths `${id}.x/y/z`, plus `matchId`, `holeIndex`), `extractBumperLinksContinuityKeys(snapshot)` (key `${matchId}:${holeIndex}:${lifeId}` per ball), and `createBumperLinksPresentedBalls(snapshot, pose)`.
  - `createBumperLinksMultiplayerSession({gameId, controls:{capture():BumperLinksInputState,reset()}, onReset, onJoined, onError, onRematchRequested})`. It uses `createNetworkedGameSession` with a prediction config whose `simulate` is a no-op and whose `extractPose` returns the authority ball position, so the SDK still owns queued input, acknowledgement and epochs. `composeRenderPose` always returns the remote pose (no local ball prediction, per the spec). The interpolation delay is 80 ms.
  - `createBumperLinksEventTracker()` → `{update(snapshot): BumperLinksMatchEvent[], reset()}`. It emits `shot` (on a `shotId` change), `sink`, `splash`, `knockout`, `holeStart` and `holeOver` once each, using serials.
  - `nameBumperLinksBall(ball, playerId)` → "You", "Rival" or "Bot 1"…
- [ ] **Step 1: Write the failing tests**:
  - `continuity keys change when a ball respawns so it never slides across water`.
  - `the event tracker reports each sink and knockout once`.
  - `presented balls use interpolated positions only for the current hole`.
- [ ] **Step 2: Run** `node --test tests/bumper-links-server.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 6: Rendering, controls, HUD, audio and app

**Files:**
- Create: `public/games/bumper-links/rendering/renderer.js`, `rendering/courseView.js`, `rendering/ballView.js`, `rendering/effects.js`
- Create: `public/games/bumper-links/client/controls.js`, `client/aim.js`, `client/hud.js`, `client/minimap.js`, `client/audio.js`, `client/app.js`
- Create: `public/games/bumper-links/main.js`, `practice.js`, `hud.css`, `README.md`
- Test: append to `tests/bumper-links-server.test.js` for the pure helpers in `aim.js` and `minimap.js`

**Interfaces:**
- `aim.js` (pure):
  - `predictBumperLinksAimLine(course, ball, aimYaw, power, out:{x,z}[], maxPoints=24)` simulates a solo ball for 0.8 s and samples its path, so the aim line bends off rails like the real putt.
  - `applyBumperLinksAimInput(aim, {turn, chargeHeld, dtSec})` → `{aimYaw, power, release:boolean}`. Power ramps from 0 to 1 over 1.2 s, then back down, while charge is held; the shot fires on release.
- `controls.js`: `createBumperLinksControls({canvas, gameId, getCameraHeading, onActivate})` → `{capture(), reset(), isEngaged(), activate(), dispose()}`.
  - Mouse: drag back from the ball to aim and set power; release shoots.
  - Keyboard: ←/→ or A/D to turn, hold and release Space to shoot.
  - Touch: through the platform controls: the stick sets direction relative to the camera, and holding and releasing Putt charges and shoots.
  - `capture()` latches the shot edge for one fixed capture.
- `renderer.js`: `createBumperLinksRenderer({canvas})` → `{render(frame), resize(w,h), setQuality(profile), project(x,y,z), getViewHeading(), clearEffects(), dispose()}`.
  - The course view rebuilds only when `holeSeed` changes.
  - The camera sits behind the local ball along the aim yaw.
  - Effects: splash, cup sparkle, bump flash and the aim line.
- `minimap.js`: `projectBumperLinksMinimapPoint(bounds, x, z, sizePx)` (pure). Draws the path, cup and all balls.
- `hud.js`: hole n/6 with par, strokes, a timer, a 4-row scoreboard, the power meter, event toasts ("Knocked Bot 2 into the water +1"), and a start/engage prompt, following the Last Fuse HUD structure.
- `app.js`: `startBumperLinks({gameId})`, mirroring `startLastFuse`, with results via `showEndGameModal` and the share modal on Start online.
- [ ] **Step 1: Write the failing tests**:
  - `the aim line starts at the ball and bends off a rail`.
  - `holding charge ramps power and releasing fires once`.
  - `minimap points stay inside the map`.
- [ ] **Step 2: Run** `node --test tests/bumper-links-server.test.js`. Expected: the new tests fail.
- [ ] **Step 3: Implement** all files.
- [ ] **Step 4: Run** `npm test && npm run build:bumper-links && npm run platform:build`. Expected: PASS and both bundles are written.
- [ ] **Step 5: Verify in the browser** (`npm run dev`, port 3100):
  - Practice: a putt rolls, sinks, scores and advances holes.
  - Bots shoot and finish.
  - A ball knocked into the water respawns with a +1 toast.
  - Online with two tabs: both balls move and collide, and the results modal and rematch work.
  - Touch emulation shows the Aim stick and the Putt button.
  - The layout fits a 375×812 landscape viewport.
