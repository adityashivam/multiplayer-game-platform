# Skybreak

A 3D jet dogfight over a desert canyon at sunset. Every jet is identical, so
fights are won on energy management, lead aim, missile timing and terrain use.

## Modes

| Catalog entry | Route | Jets | Notes |
|---|---|---|---|
| Skybreak | `/games/skybreak` | `p1`, `p2` (humans) + 4 bots | Online dogfight to 10 kills or 4 minutes. |
| Skybreak Practice | `/games/skybreak-practice` | `p1` + 5 bots | Solo dogfight for practice and testing. |
| Skybreak Time Trial | `/games/skybreak-time-trial` | `p1` | 12 gates through the canyon and over the ridges, a best-run ghost and medals. |

Bots are server-owned and sit outside seat ownership, so room readiness counts
only humans.

**Keeping jets together.** The arena is a 1700 m circle under a 1500 m
ceiling. Past the edge, the jet is gently steered back and, after a 4 s grace,
takes damage. The radar and on-screen target markers always point at rivals,
so nobody gets lost.

## Controls

| Action | Keyboard / mouse | Console shell | Touch |
|---|---|---|---|
| Pitch | W / S (S pulls up), arrows | Left stick | Flight stick |
| Roll | A / D, arrows | Left stick | Flight stick |
| Yaw (rudder) | Q / E | — | — |
| Cannon | Space / J / left mouse | A | Cannon |
| Missile | F / K / right mouse | B | Missile |
| Boost | Shift | X | Boost |
| Flares | C | Y | Flares |
| Airbrake | X | — | Airbrake |
| Restart run (time trial) | R | — | — |

## Skill systems

- **Corner speed.** Turn authority peaks near 165 m/s and falls off when
  faster or slower. Boost and airbrake manage energy; hard pulls bleed speed.
- **G strain.** Sustained pulls above 7.5 G build strain and cause a 1.4 s
  blackout.
- **Cannon heat.** About 3 s of continuous fire overheats the gun for 1.6 s.
  A lead pip shows where to aim.
- **Missiles.** Hold a rival inside the lock cone for 1.1 s to lock. Two
  missiles reload every 9 s. Missiles turn at a limited rate, so a hard break
  can outturn them.
- **Flares.** Three charges, each recharging in 12 s. A timely flare decoys
  nearby missiles.
- **Terrain.** Crashing counts as a kill for the last pilot who hit you within
  5 s.

Tuning lives in `shared/config.js`: `SKYBREAK_FLIGHT_SETTINGS`,
`SKYBREAK_COMBAT_SETTINGS`, `SKYBREAK_ARENA`, `SKYBREAK_MATCH_SETTINGS`,
`SKYBREAK_TIME_TRIAL_SETTINGS` and `SKYBREAK_BOT_SETTINGS`.

## Networking

- Flight is predicted for the local jet only; the browser and server share
  `stepSkybreakFlight`.
- Hits, missiles, deaths, gates and results are authoritative.
- **Lag compensation.** Each input carries `viewLagTicks`: the 80 ms
  interpolation delay plus half the measured round trip. The server keeps 32
  ticks of pose history and tests cannon rounds against rivals rewound by that
  amount (clamped to 18 ticks), so shots that look on target land.
- Rounds, flare decoys and pose history never leave the server. Missiles are
  snapshotted and extrapolated in the client's delayed timeline.
- Each life (`matchId:respawnId`) is a separate interpolation identity, so
  respawns never smear across the map.

## Time trial

Pass each gate forward, inside its ring. A crash restarts the run after 1 s,
and R restarts instantly. The best run is stored as a ghost in
`localStorage` (`skybreak:time-trial:best:v1`).

Medals were calibrated with the course autopilot, which finishes in about 25 s:

| Medal | Time |
|---|---|
| Platinum | 23.6 s |
| Gold | 25.5 s |
| Silver | 28.5 s |
| Bronze | 33 s |

## Art

Everything is procedural, with no downloaded assets:

- the jet: lofted fuselage, swept wings, canted twin tails tinted per slot,
  gold canopy, animated stabilators, afterburner flames
- terrain from deterministic ridged noise, shared with the server for crash
  tests
- sky, sea, river, clouds, tracers, vapour trails, flares and explosions

## Layout

| Path | Role |
|---|---|
| `shared/` | Pure rules shared by browser and server: config, terrain and course, flight, combat, match, bots, prediction, touch descriptor. |
| `client/` | Input, SDK session adapter, pose mapping, match events, HUD with radar, ghost, synthesized audio. |
| `rendering/` | Three.js jet model, environment, effects and chase camera. |
| `main.js`, `practice.js`, `time-trial.js` | Entry points; each calls `startSkybreak`. |

## Build and verify

```sh
npm run build:skybreak
npm test
```

Tests:

- `tests/skybreak-rules.test.js`: flight feel, crashes, rewound hits, heat,
  missiles and flares, kill credit, time-trial runs and gates, bot determinism
- `tests/skybreak-server.test.js`: seats and bots per mode, restart, snapshot
  privacy, pause, rematch, prediction parity, interpolation identity
