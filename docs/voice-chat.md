# Room voice chat

Voice is a platform feature shared by registered multiplayer games. Press **Voice off** in the game toolbar to turn it on, then use the **Mic on/off** and **Sound on/off** buttons while playing. Turning voice on requests microphone permission. To listen without sharing audio, open the adjacent voice settings arrow and choose **Listen only**. Microphones never start on initial game load or automatically after a disconnect.

The compact voice panel repeats the microphone/sound controls and offers **Turn off voice**. Volume and the participant list are under **More options**. Microphone and incoming-voice controls are independent. Opening settings or closing the voice dialog leaves the call running. Waiting and results screens also expose Voice chat so microphone controls remain accessible between matches. Leaving the game or losing the game connection stops capture and closes voice peers. Rematches in the same connected room retain the call.

## Audio and gameplay

- WebRTC carries audio between participants, independently of Socket.IO game inputs and snapshots. The game server exchanges bounded call-setup messages only; it does not record or forward audio samples.
- The browser requests mono input, echo cancellation, noise suppression and automatic gain control. A speech content hint helps browsers choose suitable processing. Support and noise-removal quality vary by browser, device and microphone; headphones help prevent speaker echo.
- Opus speech targets 24,000 bits/sec per outgoing peer, with mono, variable bitrate, in-band error-correction and discontinuous-transmission preferences. Silence can use less bandwidth when supported. Native WebRTC congestion control manages media transmission.
- At 24 kbps, one outgoing encoded stream is about 3 KB/sec or 10.8 MB/hour, excluding RTP/UDP/IP, encryption, repair and connectivity overhead. Incoming audio consumes additional data. These are payload estimates, not a measured total-data guarantee.
- Audio does not run in the authoritative simulation, prediction, input capture or game rendering loop. There are no high-frequency React audio meters or custom main-thread noise-filter callbacks. Encoding and network traffic still use device resources; measure gameplay under load and on target mobile connections.

The initial topology is a bounded mesh for up to four human participants; current bundled rooms have two humans. Larger rooms require a media-server/SFU integration rather than expanding the mesh without bounds.

## Deployment

Microphone access requires HTTPS, except browsers' trusted localhost development exception. Plain HTTP on a LAN IP may not expose microphone APIs. The application reports permission/unsupported-context errors; players can use Listen only when capture is unavailable.

STUN discovers routes, but some carrier, enterprise, symmetric-NAT and firewall configurations require TURN. A working local call does not establish that all deployed networks can connect. Supply a TURN relay for reliable coverage; voice connection failure must not disconnect or pause the game.

Server configuration:

| Variable | Meaning |
| --- | --- |
| `VOICE_STUN_URLS` | Comma-separated STUN URLs. Unset defaults to `stun:stun.l.google.com:19302`; an empty value disables STUN. |
| `VOICE_TURN_URLS` | Comma-separated `turn:`/`turns:` relay URLs. Optional. |
| `VOICE_TURN_SECRET` | Shared coturn REST authentication secret. Required when TURN URLs are configured; keep server-side. |
| `VOICE_TURN_TTL_SECONDS` | Lifetime for issued credentials; default 600 seconds, maximum 3600. |

Example environment configuration:

```sh
VOICE_STUN_URLS=stun:stun.l.google.com:19302
VOICE_TURN_URLS=turn:relay.example.com:3478?transport=udp,turns:relay.example.com:5349?transport=tcp
VOICE_TURN_SECRET=<server-only-coturn-shared-secret>
VOICE_TURN_TTL_SECONDS=600
```

The relay must be provisioned separately with matching shared-secret authentication. Declaring these variables does not create a relay. Short-lived HMAC credentials are issued only to an authorized voice participant and refreshed for existing participants before connecting to a newly joined peer; never place the shared secret in game metadata, public JavaScript, screenshots or logs. Relay usage has its own bandwidth and hosting costs.

Voice setup accepts only bounded, versioned audio offers/answers and ICE candidates between current consenting voice members of the same authoritative room. Unique voice identities change on rejoin so delayed setup packets cannot address a replacement session. Signaling is rate limited; the protocol has no audio-chunk transport.

## Browser SDK

The platform UI owns voice automatically for registered game rooms. Game packages do not need to implement signaling, WebRTC or call controls. A custom platform host can use the same SDK with its existing game socket:

```js
import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createVoiceChatSession } from "/platform/frontend-engine/voiceChatSession.js";

const gameSocket = getGameSocket(gameMetadata.networking.namespace);
const roomVoice = createVoiceChatSession({
  transport: gameSocket,
  onStateChange: renderVoiceControls,
});

// Call only after the game socket has joined its authoritative room,
// and from the player's explicit Join voice action.
await roomVoice.join({ listenOnly: false });
await roomVoice.setMicrophoneMuted(true);
roomVoice.setDeafened(true);
roomVoice.setVolume(0.5);

// Stop capture and release all peers when the host leaves the room.
roomVoice.dispose();
```

`join`, `setMicrophoneMuted` and `resumePlayback` return promises. Operational errors appear in state so platform UI can explain them without throwing into gameplay callbacks. `resumePlayback()` belongs behind a labeled player action when autoplay blocks incoming audio. `leave()` ends voice while allowing reuse of the controller; `dispose()` additionally releases its transport subscriptions. Cleanup is idempotent and stops streams returned by late permission requests.

Voice state reports call status, microphone mute, incoming-voice mute, volume, participant connection state, blocked playback and browser-reported processing settings. These are lifecycle changes, not game-frame updates. Keep platform dialogs within the existing host and preserve renderer/canvas identity.

## Verification

```sh
npm test
npm run build
npm start
# In another terminal:
npm run test:voice:browser
```

The browser suite runs isolated Chrome with synthetic microphone devices. It verifies real Opus RTP, listen-only upgrade, processing preferences, mute/volume, gameplay inputs, mobile layout and capture cleanup across Fight and Pong. Ludo's event-driven gameplay and shared voice controls are also verified with `VOICE_TEST_GAMES=ludo npm run test:voice:browser`. `VOICE_TEST_GAMES=pong` narrows the default scenario; `PLATFORM_BASE_URL` and `CHROME_PATH` select the server/browser. This synthetic test does not establish real-world noise removal or TURN connectivity; also make a real two-device call on the intended deployed networks.

Native API references: [media constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints), [sender bitrate parameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters), [Opus RTP preferences](https://www.rfc-editor.org/rfc/rfc7587).
