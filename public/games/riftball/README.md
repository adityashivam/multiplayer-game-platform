# Riftball Duel

A two-player 3D arena sport. Score through your rival’s goal; first to five or the leader after two minutes wins. A tie goes to golden-goal overtime. Both athletes have the same abilities. Bank shots, charge timing, aerial contacts, interceptions and feints create the skill gap.

## Play locally

```sh
npm run build
npm start
```

Open `http://localhost:3000`, choose **Riftball Duel**, and send the generated room link to another browser/device. On the same Wi-Fi, open `http://<your-computer-LAN-IP>:3000` first so the invitation uses an address the other device can reach. Both players get the platform’s five-second countdown. `localhost` links only work on the computer that created them.

| Action | Keyboard / mouse | Console shell |
| --- | --- | --- |
| Move | WASD / arrows | Left stick / D-pad |
| Strike | Hold E / left mouse, then release | Hold A, then release |
| Dash | Shift | B |
| Jump / aerial play | Space | X |
| Feint a charge | Q | Y |
| Aim | Right mouse drag | Right stick |
| Center aim | R | Aim forward with the right stick |
| Invite | Platform invite / START | START |

Charge increases shot speed and lift but slows movement. Dash costs energy and has a cooldown. Feint cancels a charge at a small energy cost. Goals pause play briefly and reset both players and the ball. Series wins survive an accepted rematch; leaving the room starts a separate series.

On touch devices, use the platform’s movement stick, aim surface and action buttons. Strike also accepts an aiming drag while held. **Controls** opens the generic editor; layouts and two/three/four-finger presets are JSON in local storage, scoped by device orientation and game. The player can explicitly hide the shell there.

## Ownership and rendering

- Shared pure rules configure platform kinematic character movement and sphere-body collision. Server-owned scoring uses swept ball travel through the complete goal opening.
- The browser uses `createNetworkedGameSession` for command capture, prediction/reconciliation and interpolation. Local ball contact is a bounded preview; only authoritative snapshots award points. Remote intent cannot be predicted with certainty.
- `createGameRoomConnection` owns room/rejoin behavior. Reconnect pauses the current match and gets a fresh countdown. Rematch preserves seats, increments the round/input epoch, and resets gameplay while preserving series wins.
- Original rigged athletes and authored clips animate at render cadence. Visual posing never changes physics. The camera and renderer fit the host surface and respect quality and reduced-motion preferences.
- The final scoring point has a bounded presentation replay with a skip button. A timeout result does not fabricate a scoring replay.
- All platform invites, countdown, fullscreen, diagnostics, exit and result dialogs retain the shared platform design.

## Verification

```sh
node --test tests/riftball-*.test.js tests/sphere-body.test.js
npm run test:riftball:browser
npm test
npm run build
```

The browser script uses an isolated Chrome profile and legal controls in two real clients. It requires the project server on port 3000; `RIFTBALL_BASE_URL` selects another local test server. See the [SDK guide](../../../docs/game-sdk.md) for shared contracts. Browser tests and local timing do not measure global capacity or update the deployed service.
