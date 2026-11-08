# Riftball Duel

## Approved direction

Build the proposed two-player, skill-based 3D arena sport inside the existing platform. The user approved implementation and asked for immersive views, expressive characters, convincing physics and a strong rematch loop. Preserve the console shell, generic controls, platform countdown, invite UX and networking contracts.

## Match and controls

- Two equally capable athletes, one physical energy ball, opposing goals, one enclosed court.
- Two minutes; first to five wins early. A tied clock enters golden-goal overtime.
- Hold/release strike for power; tap for a quick shot. Dash to intercept, jump for aerial contact, feint to cancel a charge. Cooldowns and stamina prevent repeated dash spam.
- Shell A strike, B dash, X jump, Y feint. Keyboard WASD/arrows, E/left pointer strike, Shift dash, Space jump, Q feint. Right stick/drag changes aim; the camera also keeps the ball readable.
- Configurable platform touch controls support movement, aim, strike, dash, jump and feint with saved device/game layouts.
- The server owns contacts, scoring, clock and winner. Prediction improves local movement and contact presentation without awarding speculative points.
- Brief goal celebrations, final-point replay, winner/loser expressions and series wins across rematches make the outcome readable.

## Visual thesis

A premium stylized indoor sports court: deep blue concrete and metal, crisp white court markings, teal and warm coral team colors, warm overhead lighting and a visible energy ball. Original skinned athletic characters have stable identities, authored move clips and expressive faces. The canvas is the dominant surface, with a restrained score/clock HUD.

## Content plan

The catalog has one strong cover and concise rules. The playable screen contains score, time, charge/stamina, and a small control hint that disappears during play. Invites, countdown, connection metrics, errors and results use existing platform UI. Court geometry and lit character silhouettes carry the presentation; decorative UI does not cover play.

## Interaction thesis

Immediate movement and charge feedback, a readable windup/contact/follow-through, and short ball trails communicate skill. Camera follow and ball framing use damped motion without changing shell geometry. Goal light pulses and a bounded final-point replay reward the finish; reduced-motion preferences suppress camera impulses and excessive effects.

## Architecture and shared interfaces

Game ID `riftball`; all game packages import SDK modules, never the reverse. Shared configuration declares inputs, court dimensions, physics and action timing. A focused configurable sphere-body mechanic belongs to the shared platform; goal rules, attacks, scoring and presentation belong to this game.

Shared simulation exports `createRiftballPlayer(id,index)`, `createRiftballRound()`, `stepRiftballPlayer(player,input,dtSec,context)`, `stepRiftballWorld(state,dtSec)` and bounded prediction helpers. State has `players`, `ball`, `roundId`, `timeSec`, `timer`, `durationSec`, `started`, `startAt`, `gameOver`, `winner`, `phase`, `suddenDeath`, `goalSerial`, `lastScorer`, and `goalResetRemainingSec`. Player poses include `x,y,z,vx,vy,vz,facing,grounded,action,actionId,actionTimeSec,chargeSec,stamina,score,seriesWins`; `y` is the feet position. Ball includes `x,y,z,vx,vy,vz,serveId,hitSerial,bounceSerial,lastTouchPlayerId`.

Renderer exports `createRiftballRenderer({canvas})` with `resize`, `setQuality`, `render`, `getCameraHeading`, `getStats`, and `dispose`. Render frames contain `dtSec,timeSec,gameTimeSec,roundId,playerId,players,ball,phase,goalSerial,lastScorer,reducedMotion,cameraOrbit,replay`. Athlete module exports `createRiftballAthletes(scene)` with `update(players,frame)`, `getStats`, and `dispose`; the scene renderer owns only court/camera/ball/effects. No renderer requests fullscreen, forces context loss, or mutates authority.

Browser uses `createNetworkedGameSession` and `createGameRoomConnection`. Server uses `createAuthoritativeInputSession` and registered game callbacks. Replay history and extrapolation are bounded. Serve/action identities prevent blending across resets. Reconnect pauses the existing match and invalidates stale input; rematch preserves seat ownership and series wins with fresh epochs and the shared five-second countdown.

## Verification

Meaningful pure tests cover ball tunneling/rebound/resting contact, posts and goals, charged/quick/aerial strikes, feint/cooldowns, body separation, deterministic prediction, timeout/overtime, stale input, reconnect and rematch. Exercise real two-browser clients through legal controls, including scoring and delayed delivery, plus touch, portrait, shell stability, quality settings, replay and disposal. Run all Node tests and the production build. Browser evidence does not imply measured global capacity or deployed changes.
