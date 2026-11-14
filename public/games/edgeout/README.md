# Edgeout

A competitive 3D ring-out brawler. Two fighters share a floating tile arena
whose outer rings crumble on a fixed schedule. Shove, dash and parry your rival
off the edge; the last fighter standing takes the round and the first to three
rounds wins the match.

## Modes

| Catalog entry | Route | Seats | Notes |
|---|---|---|---|
| Edgeout | `/games/edgeout` | `p1`, `p2` (humans) | Competitive duel; the countdown starts when both connect. |
| Edgeout Practice | `/games/edgeout-practice` | `p1` (human) + `cpu` (bot) | Solo sparring for testing and learning. The bot is server-owned and outside seat ownership, so it never counts toward readiness. |

Both modes share every rule, input schema and client module. They differ only
in their registered ID, namespace and roster (`registerEdgeoutGame` and
`registerEdgeoutPracticeGame` in `server/platform-backend-engine/games/edgeout.js`).

## Controls

| Action | Keyboard / mouse | Console shell | Touch |
|---|---|---|---|
| Move | WASD or arrows | D-pad / left stick | Move stick |
| Aim | Move the mouse over the floor | Movement direction | Movement direction |
| Shove | Hold Space, J or left mouse to charge; release to shove | A | Shove (hold) |
| Dash | Shift or L | B | Dash |
| Block / parry | Hold E, K or right mouse | X | Block (hold) |

Moving the mouse aims at the floor point under it. Any keyboard, shell or stick
movement hands aim back to the movement direction until the mouse moves again.

## Rules

- **Damage and knockback.** Every hit adds damage percent. Knockback grows by
  one percent per point of damage, so late hits travel much further.
- **Shove.** Tap for a quick shove or hold up to 0.7 s to charge. Charging slows
  you down. Each shove lands at most once.
- **Block and parry.** A held block covers your front and reduces knockback to a
  quarter. Raising it within 0.18 s of a shove landing parries it: the attacker
  recoils and is stunned instead.
- **Dash.** A short burst with a cooldown. A dash into a rival is a body check
  that breaks a block. Shove beats idle, block beats shove, and dash beats block.
- **Arena.** A 7 x 7 tile grid. The outer ring falls at 14 s of round time, then
  one ring every 9 s, each with a 2.4 s warning; the centre tile falls last.
  Fighters below `y = -4` are out. Simultaneous ring-outs make a drawn round.

Tuning lives in `shared/config.js` (`EDGEOUT_ARENA`, `EDGEOUT_COMBAT_SETTINGS`,
`EDGEOUT_MATCH_SETTINGS`, `EDGEOUT_BOT_SETTINGS`).

## Layout

| Path | Role |
|---|---|
| `shared/` | Pure rules shared by browser and server: config, arena schedule, fighter movement, combat, bot and prediction. |
| `client/` | Input capture, SDK session adapter, snapshot pose mapping, match events, HUD and synthesized audio. |
| `rendering/` | Three.js arena, fighter rigs with a distinct pose per action, effects and camera. |
| `main.js`, `practice.js` | Entry points for the two modes; both call `startEdgeout`. |

Fighters move with the platform's `createKinematicCharacterController`. The
standing floor is always one centred square, so the arena is a single cached
platform whose size shrinks as rings fall. The server owns hits, eliminations
and results. The browser predicts only the local fighter's movement and action
timing; knockback arrives through reconciliation.

## Build and verify

The server loads `/games/edgeout/dist/main.js` and `/games/edgeout/dist/practice.js`,
so rebuild after editing the package:

```sh
npm run build:edgeout
npm test
```

Tests: `tests/edgeout-simulation.test.js`, `edgeout-bot.test.js`,
`edgeout-server.test.js`, `edgeout-client.test.js` and
`edgeout-network-delay.test.js` (150, 300 and 500 ms RTT with jitter and stalls).
