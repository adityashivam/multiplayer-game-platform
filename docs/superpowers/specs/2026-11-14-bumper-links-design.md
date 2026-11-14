# Bumper Links design

Approved in conversation on 2026-11-14.

## Intent

Battle mini-golf for the platform: everyone putts the same hole at the same time, balls knock each other around, and the aim is to sink first and push rivals into the water. It fills the one genre gap left after Last Fuse (from `reports/2026-11-14-ideas.md`).

## Goals

- Online: 2 human seats plus 2 bots (four balls per hole). Practice: 1 human plus 3 bots.
- Simultaneous putting: aim, hold to charge, release. A ball can be shot again as soon as it stops. No turns.
- Server-authoritative ball physics on the platform `sphereBody` controller, plus ball-on-ball impulses, a moving sweeper arm and cup capture.
- 6 holes per match, generated from tile pieces (straight, corner, drop step, bumper posts, sweeper). A bot shot search proves every hole can be finished and sets par; holes that fail are regenerated.
- Scoring per hole by sink order: 5, 3, 2, 1. Knocking a rival into the water: +1 to the last ball that touched it. Water: back to the last resting spot plus 1 stroke. A hole ends after 40 s or when every ball has sunk. Most points after 6 holes wins.
- Controls: mouse drag to aim and hold to charge; keyboard arrows plus Space; touch drag plus a shoot button.
- HUD, minimap, audio, cover, catalog entry, build script and tests, matching the Last Fuse package.

## Non-goals

- Cosmetic ball styles, course editor, power-ups, more than 6 balls.
- Local prediction of ball movement. Only the aim line is local.

## Anti-goals

- Hole generation or bot planning must not stall the shared server loop.
- Bots must not shoot faster or more precisely than a human could.

## Approaches

1. **Authoritative balls with snapshot interpolation, local aim only (picked).** Shots are rare discrete events, so interpolation delay (~70 ms) is invisible next to the putt itself and nobody can disagree about collisions.
2. Predict the local ball after a shot. Rejected: ball-on-ball contact makes prediction wrong exactly when it matters, and corrections would snap.
3. Turn-based putting. Rejected: it removes the simultaneous chaos that makes the idea.

## Calls made by the builder

- 6 holes rather than 9 so a match lasts about 4 minutes.
- The sphere controller only handles axis-aligned boxes, so there are no slopes: height changes are one-way drop steps, and the sweeper is a custom moving segment.
- Some rail segments are left open so knockouts into the water are possible.
