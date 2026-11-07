# Networking readability refactor

**Goal:** Apply the user's repository coding conventions to the networking fixes while preserving their behavior.

**Spec:** Root `AGENTS.md`, based on the user's nine conventions and request for simple, scalable, human-readable code.

**Constraints:** Keep JavaScript ES modules, public game APIs, protocol values/fields, simulation rules, timing, CLI JSON fields, defaults, failure behavior, and hosting unchanged. Use JSDoc for explicit shapes and generics for plugin-defined keys. Refactor only the earlier networking changes and their tests/docs. Existing 49 tests are the behavior baseline.

- [x] Add root guidance and shared wire constants.
- [x] Refactor shared Fight rules and server command handling with domain names, typed contracts, focused helpers, and named settings.
- [x] Refactor the client prediction/input/timing changes and Fight adapter without changing algorithms or public method contracts.
- [x] Refactor the diagnostic CLI into clear parsing, connection, packet, sampling, reporting, and cleanup operations; encapsulate health HTTP handling.
- [x] Review the combined refactor and run the complete test suite, frontend build, local protocol probe, and two-player Fight regression.

**Review focus:** Pure refactoring must retain input edge consumption, acknowledgement timing, starvation/epoch resets, snapshot baseline resets, correction decay, bounded queues, CLI output and error status, and the same externally observable simulation results.

**Baseline:** `npm test` passes 49/49 on `codex/netcode-smoothness` before this refactor.

**Verification:**

- All 49 tests pass; the production build and whitespace checks pass.
- Before/after comparisons match for 10,000 Fight simulation cases, 12,000 input-protocol operations, 21,000 client operations, and diagnostic metrics/packet fixtures.
- The local six-second probe reports 60 Hz for both clients, advancing command acknowledgements, and no dropped simulation steps or snapshot intervals over 50 ms.
- An isolated two-player browser check passes match start, movement, short jump, landing, contact, rematch, and movement after rematch without runtime errors.
- Refactored entry/helper syntax and five CLI failure cases pass. Independent review has no outstanding findings.

The local server runs the refactored code. No deployment or hosting change was made.
