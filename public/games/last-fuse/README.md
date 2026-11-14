# Last Fuse

Bomb tag across night rooftops. One lit bomb, six runners. Touch someone to
pass it. Whoever holds it when the fuse runs out is out, and a building
collapses. The last runner standing wins the round.

## Modes

| Catalog entry | Route | Runners | Notes |
|---|---|---|---|
| Last Fuse | `/games/last-fuse` | `p1`, `p2` (humans) + 4 bots | Online; the countdown starts when both humans connect. |
| Last Fuse Practice | `/games/last-fuse-practice` | `p1` + 5 bots | Solo practice and testing. |

Bots are server-owned and sit outside seat ownership, so room readiness
counts only humans.

## Controls

| Action | Keyboard | Console shell | Touch |
|---|---|---|---|
| Run | WASD / arrows (camera-relative) | Left stick / D-pad | Run stick |
| Jump | Space / K | A | Jump |
| Dash | Shift / J | B | Dash |
| Turn camera 45° | Q / E | — | — |

## Rules

- **Bomb.** After a 2.2 s delay a bomb lights in a random runner's hands.
  The first fuse of a round is 18 s; each later one is 2 s shorter, down to
  10 s.
- **Passing.** The holder passes the bomb by touching a runner. Each pass
  burns 0.4 s of fuse. The receiver staggers for 0.4 s, and the previous
  holder can't be tagged straight back for 1 s. The holder runs 8% faster.
- **Blast.** The holder is out. Runners within 4.5 m are thrown and stunned.
  Every survivor scores 1 point.
- **Collapse.** After each blast, the blasted roof (or the outermost one)
  flashes red for 1.6 s and then falls. The city never drops below 4 roofs.
- **Falling.** Below the roofline you respawn after 1.4 s on the roof
  farthest from the bomb. A bomb you hold keeps burning while you fall.
- **Scoring.** The last runner standing scores 3 points. A match is 3
  rounds, each in a new city, and the most points wins. Ties go to round wins.

Tuning lives in `shared/config.js`: `LAST_FUSE_CITY`,
`LAST_FUSE_CHARACTER_SETTINGS`, `LAST_FUSE_BOMB_SETTINGS`,
`LAST_FUSE_MATCH_SETTINGS` and `LAST_FUSE_BOT_SETTINGS`.

## City

`shared/city.js` builds a deterministic 5 × 5 rooftop grid per round seed.
Roof sizes, offsets and heights vary. A layout is accepted only if every roof
is reachable through jumpable gaps (≤ 3.1 m, rises ≤ 1.2 m). Roofs are SDK
kinematic platforms that reach the street, so walls block runners. The same
roof graph drives bot routing and the minimap.

## Networking

- Movement uses the platform kinematic character controller and is predicted
  for the local runner only.
- Passes, blasts, falls, collapses and scores are authoritative.
- **Lag-compensated passes.** Inputs carry `viewLagTicks` (the 70 ms
  interpolation delay plus half the ping). The server keeps 24 ticks of pose
  history. A pass counts if the holder touches a rival where they are now or
  where the holder saw them.
- The choice stream, pose history and view lag never leave the server.
- Each life (`matchId:roundNumber:respawnId`) is its own interpolation
  identity, so respawns never slide across the map.

## HUD

- fuse timer and bar
- standings
- a red marker over the bomb holder, or an edge arrow when the holder is
  off-screen
- a minimap of the rooftops with every runner, which turns with the camera
  so the way you face is up
- a red vignette while you hold the bomb, amber when it is close

## Art

Everything is procedural: lit-window facades, rooftops, neon signs, a
skyline ring, hooded runners in slot colours with distinct run, jump, dash,
stagger, fall and victory poses, and a fizzing bomb with blast, smoke and
collapse effects. The sound is synthesized.

## Layout

| Path | Role |
|---|---|
| `shared/` | Pure rules shared by browser and server: config, city, runner, match, bots, prediction, touch descriptor. |
| `client/` | Input, SDK session adapter, pose mapping, events, HUD and minimap, audio. |
| `rendering/` | Three.js city, runners, effects and chase camera. |
| `main.js`, `practice.js` | Entry points; both call `startLastFuse`. |

## Build and verify

```sh
npm run build:last-fuse
npm test
```

Tests:

- `tests/last-fuse-rules.test.js`: city connectivity, gap jumps, passing,
  tag-back, rewound passes, blasts, collapses, respawns, rounds, bot
  determinism
- `tests/last-fuse-server.test.js`: seats and bots per mode, input, snapshot
  privacy, pause, rematch, prediction parity, interpolation identity,
  events, camera-relative movement, minimap orientation
