# Sky Dash Challenges and Room Start Implementation Plan

**Goal:** Make the obstacle race harder and replace accidental invite dialogs with a reusable synchronized room-start experience.

**Architecture:** Optional pure sloped platform support extends the reusable character controller; Sky Dash owns seesaw and gate rules/assets. Platform room metadata and a generic client lifecycle subscriber drive creator-aware invites and countdown presentation for every registered multiplayer game.

**Spec:** [Design](../specs/2026-11-08-sky-dash-challenges-and-room-start.md).

- [x] Extend `public/platform/shared/kinematicCharacter.js` with tested optional slopeX/slopeZ support; preserve flat and translating-platform tests.
- [x] Extend Sky Dash shared config/course/simulation and its server snapshots with weight-reactive seesaws, jump hurdles and circular gates; verify bots, ordered checkpoints, contacts and stable snapshots.
- [x] Extend game renderer/course presentation and client prediction context for matching seesaws and gates; honor quality, disposal and reduced motion.
- [x] Trace and test platform invite/start lifecycle before implementation. Add shared server countdown constants/metadata and a generic lifecycle subscriber with monotonic clock synchronization.
- [x] Replace unconditional auto-share behavior with creator-aware intent and reusable joining/countdown UI. Cover focus, cancellation, existing games, rematch, late joins and clock skew.
- [x] Run focused regressions, `npm test`, `npm run build` and multi-client browser verification. Review and resolve material findings, preserve the local running project, and report verification limits.
