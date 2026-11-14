# Driftline

A 3D drift racer. Six cars race three laps of Sunset Cliffs, a coastal loop at
golden hour. Drifting charges your boost, so the cleanest, longest slides win
races, not just holding the throttle. There is no catch-up help for trailing cars.

## Modes

| Catalog entry | Route | Grid | Notes |
|---|---|---|---|
| Driftline | `/games/driftline` | `p1`, `p2` (humans) + 4 bots | Online race; the countdown starts when both humans connect. |
| Driftline Practice | `/games/driftline-practice` | `p1` (human) + 5 bots | Solo practice and testing. Bots are server-owned and outside seat ownership. |

The platform starts a room only when every human seat is filled, so seats are
fixed per mode. Letting 3–6 humans start a race with bots filling empty seats
needs a platform readiness change (start on host action or a minimum count).

## Controls

| Action | Keyboard | Console shell | Touch |
|---|---|---|---|
| Throttle | W / Up | A or D-pad up | Throttle |
| Brake, then reverse | S / Down | B or D-pad down | Brake |
| Steer | A D / Left Right | Left stick / D-pad | Steer stick |
| Handbrake | Space | X | Handbrake |
| Reset car | R | Y | Reset car |

## Skill systems

- **Drift initiation:** handbrake flick, a brake tap that shifts weight forward,
  a feint (steer away, then snap in), or power-oversteer from the throttle.
- **Holding the angle:** throttle and counter-steer control the slide. A
  stabiliser keeps slides holdable, but precise inputs keep more speed than
  lazy full lock.
- **Boost tiers:** sliding charges tiers at 0.9, 2.0 and 3.3 charge units.
  Charge grows with angle and speed. The boost fires when the drift ends;
  barrier hits drain charge and spinning out forfeits it.
- **Slipstream:** within 22 m directly behind a rival, drag drops by up to 45%.
- **Perfect start:** hold throttle for the last 0.5 s of the countdown for a
  launch boost; holding it longer than 1 s bogs the engine.
- **Contact:** cars bump, with a capped impulse so nobody can be punted off.

Tuning lives in `shared/config.js`: `DRIFTLINE_CAR_SETTINGS`,
`DRIFTLINE_SKILL_SETTINGS`, `DRIFTLINE_RACE_SETTINGS` and `DRIFTLINE_BOT_SETTINGS`.

## Physics model

A rear-wheel-drive bicycle model (`shared/vehicle.js`). It has:

- a Pacejka-style tyre curve
- weight transfer
- a friction circle on the rear tyres, so throttle and handbrake trade grip for
  slide
- road slope
- four physics substeps per 60 Hz tick

A one-directional slip-rate damper and a capped stabilising force stop
pendulum spins. Browser and server run the same pure function. The browser
predicts only the local car; contacts, drafting, laps and results are
authoritative.

## Tracks

A track (`shared/tracks/`) is a closed loop of control points
`[x, z, height, width]`. It is sampled every 2 m into typed arrays, and each
query walks from a hint, so finding a car's track position allocates nothing.
The same data drives:

- barrier collision
- lap progress
- bot racing lines
- the minimap
- the road, curb, runoff and rail meshes

Add a location by adding a definition to `shared/tracks/index.js` with a
matching environment theme.

## Layout

| Path | Role |
|---|---|
| `shared/` | Pure rules shared by browser and server: config, track, vehicle, race, bots, prediction. |
| `client/` | Input, SDK session adapter, pose mapping, race events, HUD with minimap, synthesized audio. |
| `rendering/` | Three.js sky, sea, terrain and scenery, road meshes, cars, smoke, skid marks, chase camera. |
| `assets/cars/` | The realistic car model and its credits. |
| `main.js`, `practice.js` | Entry points for the two modes; both call `startDriftline`. |

## Cars

Cars use a realistic concept-car model adapted from the Khronos glTF sample
**Car Concept**: © 2024 Darmstadt Graphics Group GmbH, model by Eric Chadwick,
CC BY 4.0.

Every car shares one cached template (`rendering/carModel.js`). Each car owns
only its paint and brake-light materials, and its named wheel nodes are
steered and spun at render cadence.

The model:
- has its logos and hidden interior removed
- is simplified and meshopt-compressed to about 0.9 MB

**Looks are cosmetic only.** Every car has the same body, physics and
handling, so races stay fair. `rendering/liveries.js` assigns each grid slot
one of six styles:

| Style | Look |
|---|---|
| Muscle | Twin racing stripes, hood scoop, ducktail, black rims |
| Tuner | Pearl paint, side stripe, carbon GT wing, bronze rims |
| GT | Clean gloss paint, chrome rims |
| Stealth | Matte paint, black accents, low wing, gunmetal rims |
| Classic | Candy paint, centre stripe, ducktail, chrome rims |
| Two-Tone | Gloss paint, white roof and sills, hood scoop, gold rims |

Each car keeps its slot colour, so the HUD and minimap still match. Stripes
are drawn in car space by a small shader patch. Car-space vertex positions are
baked once into the shared template, so stripes stay fixed to the body.

See `assets/cars/CREDITS.md` for the exact changes, and
`scripts/prepare-driftline-car.mjs` to rebuild it. Until the model loads, or
if it fails to load, the procedural car is shown. The scenery is procedural.

## Build and verify

```sh
npm run build:driftline
npm test
```

Tests:

- `tests/driftline-physics.test.js`: track geometry and car feel scenarios
- `tests/driftline-race.test.js`: launch, laps, positions, slipstream, contact, bots
- `tests/driftline-server.test.js`: lifecycle, countdown launch, snapshots, rematch
- `tests/driftline-client.test.js`: prediction parity, events, and convergence at 150, 300 and 500 ms RTT
