# Platform SDK review fixes

**Goal:** Fix the four confirmed review findings while preserving generic game configuration, command ownership, normal latency behavior and existing gameplay.

**Scope:** Current uncommitted platform SDK on codex/netcode-smoothness, based on 6830285. User authorized fixing all four findings. No deployment, push or commit is included.

**Baseline:** 170 tests pass. The reviewed defects were reproduced separately and are not covered by the current assertions.

## 1. Prediction after capture gaps

- [x] Add failing client/server session tests for a 100 ms capture pause, attaching when simulationTick exceeds acknowledgement, and preserving unacknowledged action edges.
- [x] Add advanceSequenceBaseline(sequenceNumber) to the input timeline. Move its next-command counter forward without acknowledging or deleting retained frames.
- [x] Align the prediction session's sequence baseline with accepted authoritative simulation time before capture/replay. Keep acknowledgement and simulation time as separate concepts.
- [x] Verify normal RTT/burst scenarios, custom cadence, epoch/reset behavior, queue bounds and action delivery.

## 2. Rendering without current authority

- [x] Reproduce a retained predicted pose overriding current interpolation after readAuthority returns null.
- [x] Supply no local predicted render pose while current ownership is unavailable; retain sequence/history where appropriate for authority restoration.
- [x] Verify recovery, no command capture while unowned, interpolation-only sessions and lifecycle resets.

## 3. Snapshot keys inherited from Object.prototype

- [x] Add real encoding/decoding regression tests for accepted inherited names such as toString, valueOf and hasOwnProperty; assert correct own player objects and no prototype mutation.
- [x] Harden snapshot object construction to traverse/create own properties and write dangerous keys as data properties. Keep supported player IDs generic rather than growing a game-specific blacklist.
- [x] Verify full/delta snapshots, rematch baselines and prediction state cloning.

## 4. JSON catalog metadata

- [x] Add failing registration tests for BigInt and circular runtime metadata, plus valid shared/non-circular metadata.
- [x] Reject metadata that cannot be serialized into the public JSON catalog before mounting any game. Preserve valid metadata ownership and existing registration behavior.
- [x] Verify registry/catalog contracts and CLI configuration.

## Final verification

- [x] Run complete tests, production build and whitespace checks.
- [x] Run direct/delayed two-client Fight/Pong checks, including local input recovery, rematches and reconnects where affected.
- [x] Obtain focused independent review of the four fixes, update developer documentation if contracts need clarification, and refresh the local server.

## Progress

- Review evidence: local prediction remains skipped after a short capture pause; lost authority leaves stale render overrides; inherited player keys decode to prototype functions; structuredClone accepts metadata that fails catalog JSON serialization.

- All four fixes are implemented in generic SDK/transport/registration code. No per-game patches were required.
- Regression evidence: 100 ms capture pauses recover at 30/60 Hz; future sequences advance without deleting late action commands; missing authority uses interpolation and resumes without a stale correction; inherited/prototype-named fields decode as own data; array length descriptors remain valid; BigInt/cyclic metadata fail before mounting.
- Final verification: 182/182 tests, production build and whitespace checks pass. Focused independent review found no actionable findings.
- Direct two-player Fight/Pong browser checks passed, including a forced 120 ms browser stall, rematches and Pong reconnects. Both passed delayed-network checks at 150 ms RTT with jitter and a 100 ms delivery burst.
- One concurrent delayed Fight run failed its fixed 350 ms short-jump assertion. The isolated rerun passed, and a concurrent traced/state-based rerun recorded a 9 ms native press, a transmitted jump command and authoritative jump observation after 270 ms, then passed the remaining checks. The timing-sensitive fixed-delay assertion is not used as the final condition-based verification.
- Temporary delay proxy and isolated browsers are stopped. The final local server remains running on port 3000. No commit, push or deployment was performed.
