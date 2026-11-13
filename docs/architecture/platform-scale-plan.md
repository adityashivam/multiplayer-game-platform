# Platform scale plan

Living plan for growing the Kaboom platform into a production game platform while learning the system design behind each step. Update the progress tracker and decision log as steps complete.

- **Started:** 2026-11-13
- **Status:** Step 0 (target architecture) not started
- **Related:** [Architecture review](https://claude.ai/artifact/8EeCPyWPiPWxMrX95UTd6T) (private page), [AGENTS.md](../../AGENTS.md), [game SDK guide](../game-sdk.md)

## Goals

1. **Build** the platform into a product that serves millions of users with lakhs (hundreds of thousands) of concurrent game rooms.
2. **Learn** system design for real-time multiplayer platforms by understanding each part before and while building it.

## Requirements

| Area | Requirement |
|------|-------------|
| Gameplay feel | Smooth on good connections; still playable on weak, slow, high-ping, jittery, or switching networks (Wi-Fi to 4G, brief drops). |
| Scale | Millions of users, lakhs of concurrent rooms, multiple regions, no single point of failure, deploys without dropping matches. |
| Game types | Real-time multiplayer, turn-based multiplayer, solo games; catalog with a trending section. |
| Social | Accounts, profiles, friends, presence, chat, voice calls, leaderboards, random matchmaking, invites, notifications. |
| Clients | Web now, mobile app later, sharing the same backend APIs. |
| Efficiency and cost | Low CPU, memory, and bandwidth per room and per player; infrastructure cost that grows slower than usage; idle capacity scaled down. Tracked as cost per 1,000 concurrent players and per 1,000 concurrent rooms. |
| Quality | No compromise on architecture or coding standards: Clean Architecture base and [AGENTS.md](../../AGENTS.md) rules, tests, observability, security. |
| Learning | Each step teaches its concept, trade-offs, and how large platforms solve it. |

## Principles

- **Design for the target, build in stages.** The target architecture is designed up front for full scale. Implementation grows step by step, with each step production-quality and no rewrites between steps.
- **Game servers are separate from day one**, because they scale by CPU and room count. Platform services (identity, social, catalog, matchmaking) start as one modular service and split only when load or team size requires it.
- **Keep what works.** The authoritative simulation, input pipeline, prediction, and interpolation stay; most work is around them.
- **Measure, don't guess.** Capacity numbers come from load tests and probes, not assumptions.
- **Efficiency and cost are design inputs, not a final phase.** Every step states its effect on CPU, memory, bandwidth, and monthly cost. Prefer the cheapest design that meets the requirements: optimize per-room cost before adding servers, pay only for capacity in use, and choose managed services only where they cost less than running the equivalent.
- **One step at a time.** Each step is explained, built, verified, and committed before the next one starts.

## Working method

Each step follows the same loop:

1. **Learn:** what problem the step solves, how large platforms solve it, alternatives and trade-offs.
2. **Design:** the specific change for this codebase, with a diagram when it helps.
3. **Build:** implement it following AGENTS.md.
4. **Verify:** tests, browser or network checks where relevant, and the step's effect on CPU, memory, bandwidth, and cost.
5. **Record:** update the progress tracker and decision log below, then commit.

The owner says **"next"** to move to the following step. No step starts early.

## Working assumptions

Change these here if they turn out wrong; every design decision that depends on them should cite them.

| ID | Assumption |
|----|------------|
| A1 | Size for worst case: real-time games at 60 Hz, 2–4 players per room. |
| A2 | India first, designed so more regions can be added without redesign. |
| A3 | Start low-cost and scale with usage. |
| A4 | Third-party developer games are a future goal, so sandboxing is part of the design. |
| A5 | "Millions of users" means registered users; concurrent peak is sized separately in Step 0. |

## Roadmap

This is a draft order. Step 0 produces the target architecture and may reorder or refine later steps.

### Step 0: Target architecture

- **0. Target architecture and capacity model:** full-system diagram, subsystem diagrams (game fleet, netcode, matchmaking, social, voice, data/events, mobile), capacity math (servers, bandwidth, memory per room), cost model (monthly cost at 1k, 10k, 100k, and 1 lakh concurrent rooms, and cost per 1,000 concurrent players), key trade-offs.

### Phase 1: Harden the current server

- **1. Crash isolation and input validation:** guard every socket handler, isolate failing rooms, add process-level error handling.
- **2. Secure room identity:** cryptographic room ids, server-issued rooms only, room caps.
- **3. Abuse limits and backpressure:** per-socket rate limits, message size limits, slow-client handling.
- **4. Health, readiness, and graceful shutdown:** draining deploys that let matches finish.
- **5. CI and code quality gates:** GitHub Actions, lint, JSDoc type checking, build and test on every change.
- **6. TypeScript foundation:** strict `tsconfig`, type checking in CI, build/run pipeline for server and browser bundles, migrate shared contracts (`public/platform/shared/`) first, then modules as they are touched.
- **7. Observability basics:** structured logs, metrics (rooms, sockets, tick time, dropped steps), error reporting.

### Phase 2: Network resilience

- **8. Protocol versioning and resync:** version handshake, explicit keyframe requests.
- **9. Input redundancy and adaptive buffering:** survive packet loss and jitter without visible stalls.
- **10. Bandwidth efficiency:** schema ids, quantization, batched inputs, interest management.
- **11. Network condition lab:** repeatable loss, jitter, latency, and handoff scenarios in tests.
- **12. Unreliable transport:** WebTransport or WebRTC data channels with WebSocket fallback.
- **13. Reconnect and mobile handoff:** fast session resume across network changes and app backgrounding.

### Phase 3: Identity and data

- **14. Accounts and authentication:** guest and registered accounts, tokens shared by web and mobile.
- **15. Primary database:** Postgres, migrations, data access boundaries.
- **16. Profiles and persistent settings:** move preferences from localStorage to accounts.

### Phase 4: Scale out game servers

- **17. Room directory:** which server owns each room (Redis).
- **18. Room allocation service:** create rooms on the least-loaded server.
- **19. Gateway routing:** route each connection to the owning server with signed join tickets.
- **20. Multi-core sharding:** rooms spread across worker threads or processes.
- **21. Load testing and capacity limits:** measured rooms per core and per server, and the resulting cost per 1,000 concurrent rooms and players.
- **22. Autoscaling and zero-downtime deploys:** add and drain servers safely.
- **23. Multi-region placement:** latency probes and region selection.

### Phase 5: Social platform

- **24. Presence:** who is online and in which game.
- **25. Friends and invites.**
- **26. Chat and moderation:** real-time messaging, history, reporting, blocking.
- **27. Matchmaking:** queues by game, region, and skill rating.
- **28. Leaderboards:** global, friends, and seasonal rankings.
- **29. Notifications:** in-app and push.
- **30. Voice at scale:** TURN per region, group voice through an SFU.
- **31. Events pipeline and trending:** gameplay analytics events feeding the trending section.

### Phase 6: Platform and clients

- **32. Asset delivery:** CDN, immutable versioned assets, asset size budgets.
- **33. Versioned SDK and game manifests:** one manifest per game, discovered builds.
- **34. Sandboxed game runtime:** isolated iframe runtime with an SDK bridge.
- **35. Solo games:** offline-capable play, progress saving, score validation.
- **36. Mobile app:** packaging, push notifications, app lifecycle handling.

### Phase 7: Production operations

- **37. Security review and hardening.**
- **38. Backups, disaster recovery, incident response.**
- **39. Cost monitoring and optimization:** cost dashboards and budget alerts. Cost is designed in from Step 0; this step adds ongoing tracking.

## Progress tracker

| Step | Status | Commit | Notes |
|------|--------|--------|-------|
| 0. Target architecture | Not started | | |

Add a row when a step starts. Status values: Not started, In progress, Done.

## Decision log

Record each significant decision: date, decision, alternatives considered, reason, and which assumption it depends on.

| Date | Decision | Alternatives | Reason |
|------|----------|--------------|--------|
| 2026-11-13 | Local default server port 3100 | Keep 3000 | Avoid collision with another local project; hosts set `PORT`. |
| 2026-11-14 | Node.js for platform services (accounts, social, chat, catalog, matchmaking API, leaderboards) | Go, Java/Kotlin, Elixir | I/O-bound work suits Node; same language as web and mobile clients; large ecosystem; a rewrite costs months for little gain. |
| 2026-11-14 | Node.js for authoritative game servers, pending Step 21 measurements | Rewrite in Go or Rust | Client prediction and server authority run the same rule code from `public/games/<game>/shared/`; a second-language server would duplicate rules and lose tested netcode. One local Riftball probe recorded p95 0.57 ms simulation per tick, so CPU cost must be measured (A1). |
| 2026-11-14 | Escape hatch for simulation cost: Rust compiled to WebAssembly for hot simulation code, shared by browser and server | Full server rewrite | Keeps one source of truth for game rules while reaching native speed. Used only if Step 21 shows simulation CPU is the cost driver after JavaScript optimizations. |
| 2026-11-14 | Use proven infrastructure: PostgreSQL, Redis, NATS (Kafka/Redpanda if needed), ClickHouse (later), LiveKit + coturn for voice, Kubernetes + Agones (later) for the game fleet, a CDN for assets | Build equivalents in-house | Each is a mature, purpose-built tool; building them would dominate the project (A3). |
| 2026-11-14 | Adopt TypeScript (strict), migrating gradually | Keep JavaScript with JSDoc and `tsc --checkJs` | Owner decision for long-term safety at platform scale and with more contributors. Toolchain set up in Step 6; modules migrate as they are touched, shared contracts first. |

## Open questions

- Concurrent peak users target (affects Step 0 sizing; see A5).
- Hosting provider and budget limit (affects Phase 4; see A3).
- Mobile app technology: wrapped web app or native shell (affects Step 36).
- Simulation language: stay in TypeScript or move hot simulation code to Rust/WebAssembly (decided by Step 21 load-test results).
- Unreliable transport server: Node, or a small Go gateway if Node's WebTransport support is not production-ready (decided in Step 12).
