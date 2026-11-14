# Bumper Links

Battle mini-golf. Everyone putts the same hole at the same time, and the balls
knock each other around. Sink first for the most points, and knock rivals into
the water for a bonus.

## Modes

| Catalog entry | Route | Balls | Notes |
|---|---|---|---|
| Bumper Links | `/games/bumper-links` | `p1`, `p2` (humans) + 2 bots | Online; the countdown starts when both humans connect. |
| Bumper Links Practice | `/games/bumper-links-practice` | `p1` + 3 bots | Solo practice and testing. |

Bots are server-owned and sit outside seat ownership, so room readiness
counts only humans.

## Controls

| Action | Keyboard | Mouse / finger | Console shell | Touch |
|---|---|---|---|---|
| Aim | A / D or ← / → (Shift for fine aim) | Drag back from the ball | Left stick / D-pad | Aim stick |
| Putt | Hold and release Space or K | Let go of the drag | Hold and release A | Hold and release Putt |

Holding the charge raises power over 1.2 s and then lowers it again, so
release at the right moment. A drag sets the aim and the power directly.
You can only putt while your ball is resting.

## Rules

- **Simultaneous play.** There are no turns. A ball can be putted again as
  soon as it stops.
- **Scoring.** The order balls drop into the cup scores 5, 3, 2 and 1 points.
- **Water.** A ball in the water returns to where it last rested and costs a
  penalty stroke. If another ball struck it in the last 3 s, that ball's
  owner gets +1 point.
- **Ending a hole.** A hole ends when every connected ball is in the cup or
  out of strokes (10), or after 40 s. Balls still out score nothing for that
  hole.
- **Match.** A match is 6 holes. The most points wins, with fewer total
  strokes as the tie-break.

## Courses

Each hole is generated from a seed (`shared/course.js`):

- **Layout.** A random walk of 4–7 tiles, each 4 m square, with rails on
  every side that does not join the path.
- **Features.**
  - One-way drop steps.
  - Bumper posts.
  - At most one rotating sweeper bar.
  - Some open rail gaps over the water.
- **No slopes.** The platform sphere controller collides with axis-aligned
  boxes only, so height changes are drops rather than ramps.

The server proves every hole before it is played. `shared/solver.js` putts a
solo ball greedily from the tee with real physics. If it cannot sink within
6 shots, the next seed is tried. Par is one more than the solver needed,
between 2 and 5. Generating and solving a hole takes under 60 ms (median
about 18 ms), and `tests/bumper-links-solver.test.js` enforces that budget.

Clients rebuild the course from the snapshot's `holeSeed`; boxes never cross
the network.

## Networking

- **Authority.** Balls are server-authoritative and interpolated
  (`client/multiplayer.js`, 80 ms delay).
- **Prediction.** No ball is predicted: contacts decide outcomes, and a
  predicted ball would snap exactly when it matters. The SDK prediction
  session runs a no-op step only so it still owns queued commands,
  acknowledgement and ownership epochs.
- **Aim line.** It is local only (`client/aim.js`). It simulates the first
  0.8 s of a solo putt, so it bends off rails like the real ball.
- **Interpolation identity.** Each ball's `lifeId` is part of its identity,
  so a water return or a new hole teleports instead of sliding.
- **Bots.** They evaluate one candidate shot per tick inside a 1.2–2.4 s
  reaction delay (`shared/bot.js`), with aim and power error added. Planning
  never stalls the shared server loop.

## Files

| Path | Responsibility |
|---|---|
| `shared/config.js` | Contracts, tuning and seats |
| `shared/course.js` | Seeded hole generation, nearby solids, path distance, sweepers |
| `shared/ball.js` | Ball physics on the platform sphere controller, ball contacts, cup capture |
| `shared/match.js` | Holes, scoring, water returns, events |
| `shared/solver.js` | Shot search and hole proving |
| `shared/bot.js` | Bot planning spread across ticks |
| `client/` | Controls, aim, networking, events, HUD, minimap, audio, app |
| `rendering/` | Three.js course, balls, aim line, effects, camera |
| `server/platform-backend-engine/games/bumperLinks.js` | Server adapter for both modes |

Build with `npm run build:bumper-links`. Tests:
`tests/bumper-links-course.test.js`, `tests/bumper-links-rules.test.js`,
`tests/bumper-links-solver.test.js` and `tests/bumper-links-server.test.js`.
