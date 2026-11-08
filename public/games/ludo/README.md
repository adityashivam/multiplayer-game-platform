# Ludo Table

A two-player Ludo table with a procedural Three.js board, animated dice and hopping pieces. Coral and Gold play opposite homes; the full board retains the traditional four-color layout. Room voice uses the platform's existing **Voice chat** control, including Listen only, microphone/speaker mute and noise-suppression preferences. No game-specific voice connection is created.

## Play

Open **Ludo Table** in the library, share the room link and wait for the platform countdown. The current player rolls the die and selects a highlighted piece. Bring all four pieces home to win; results offer a rematch while preserving the room and voice call.

| Input | Action |
| --- | --- |
| Click/tap the die or Roll dice | Roll on your turn |
| Click/tap a highlighted piece or its numbered button | Move that legal piece |
| Left/right arrows | Select among legal pieces |
| Keys 1–4 | Select a numbered legal piece |
| A, Space, Enter, or platform Confirm | Roll or confirm the selected piece |

The platform's optional translucent touch button can be repositioned, resized or hidden through the existing Controls editor. The game also supports direct board taps. Platform dialogs keep focus and disable game actions; they do not replace the canvas.

## Rules used by this game

Ludo has regional variants; these are the rules implemented here:

- Each player has four pieces. Roll six to release one from its yard onto its colored start square.
- Pieces follow the clockwise outer track, then their own colored home lane. An exact roll is required to finish.
- The eight starred safe squares allow shared occupancy without capture.
- Landing on a lone opponent outside a safe square sends that piece back to its yard. Two same-color pieces form a blockade that opponents cannot pass or land on. Own stacks outside safe squares contain at most two pieces.
- A six, capture or newly finished piece earns another roll. Three consecutive sixes forfeit the turn.
- Each roll/piece decision has 30 seconds; an expired decision passes the turn.
- The first player to finish all four pieces wins.

Traditional rule context: [Masters Traditional Games' Ludo guide](https://www.mastersofgames.com/rules/ludo-rules-instructions-guide.htm). This package documents its own release, safe-square and bonus-turn variant explicitly.

## Package boundaries

| Module | Responsibility |
| --- | --- |
| `shared/config.js` | Palette, track/home/yard coordinates, closed input/seat identifiers and timings |
| `shared/rules.js` | Pure legality, captures, blockades, phases, deadlines and win rules |
| `server/platform-backend-engine/games/ludo.js` | Authoritative random dice, command validation, snapshot projection, pause/reconnect and rematch callbacks |
| `client/ludoClientState.js` | Read-only board readiness, bounded pending actions, selection and legal-choice presentation |
| `client/ludoHud.js` | Responsive game-owned controls, player progress and inline rule help |
| `rendering/` | Procedural materials/geometry, canonical dice faces, animation identities, picking and resource ownership |
| `main.js` | Compose existing SDK room/socket, game input, renderer, performance settings and results bridge |

The authoritative server uses `crypto.randomInt(1,7)` for dice. Clients submit only `{type,roundId,revision,tokenIndex?}` and cannot choose a roll. Wrong players, invalid phases, illegal pieces and stale/duplicate actions are rejected before consuming randomness. There is no client movement prediction for board turns.

Room snapshots run at 10 Hz, independently of rendering FPS. Token progress arrays have exactly four entries and action records have fixed fields. Legal-piece highlights are derived from authoritative token/die state using the same pure rules; redundant variable-length legal-choice arrays are omitted from the packed wire schema. Reconnect acquires a fresh authoritative baseline, including when a fully abandoned room has been recreated. Server-only rejoin tokens and pause metadata never enter public snapshots.

Disconnecting pauses decision/animation deadlines without changing the board. Rejoining uses the platform seat-recovery contract and countdown. Rematches require both connected players and reset the board under a new round identity while retaining series results, room ownership and shared voice membership.

The current registered room has two humans. Pure rules are also tested with three and four seats; changing the public room size is a future game-configuration change, not an advertised four-player mode in this release.

## Rendering and performance

The board uses shared geometries/materials, static material batches and instanced track cells. Dynamic work is bounded to four pieces per active player plus one die. Rendering honors platform performance settings and pixel budgets; low quality disables shadows. The die settles to a quaternion whose upper face matches the server value. Pieces hop from cell to cell with separate visual offsets, while logical positions remain server-owned.

Stable `(roundId,actionId)` identities prevent 10 Hz snapshots from restarting effects. Initial hydration, stale events and round recovery snap to current authority; reduced motion avoids tumbling/hopping. Resources, listeners, observers and animation frames are released when leaving the game. Landscape/fullscreen and the console shell remain platform-owned.

## Verification

```sh
npm test
npm run build
npm start
# In another terminal:
npm run test:ludo:browser
LUDO_TEST_RTT_MS=500 npm run test:ludo:browser
VOICE_TEST_GAMES=ludo npm run test:voice:browser
```

The Ludo browser test launches a separate, loopback-only test authority with deterministic dice and board fixtures delivered over parent-process IPC. Production has no fixture/cheat HTTP API. It checks actual browser controls, rejected/duplicate commands, safe squares, blockades, capture, exact finishing, rematch, seat recovery and mobile layout. Optional impairment adds actual WebSocket delay, jitter and ordered stalls; assets remain unthrottled. Voice tests use synthetic audio devices, never a developer's microphone.

Voice still needs HTTPS outside trusted localhost and a configured TURN relay on restrictive networks; see [platform voice setup](../../../docs/voice-chat.md). Rendering quality and browser processing vary by device; these correctness tests are not a server-capacity or global-latency guarantee.
