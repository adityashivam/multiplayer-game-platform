# Platform voice chat implementation plan

> **For agentic workers:** Use independent backend, browser media, and platform UI tasks with the contracts below, followed by integrated verification and review.

**Goal:** Add clear, low-bandwidth room voice across networked games, including background-noise suppression, without placing audio in gameplay messages or simulation.

**Architecture:** Browser WebRTC peer connections carry encrypted mono Opus audio; existing room-owned Socket.IO connections carry bounded signaling only. The platform supplies the media controller and shared UX. Game rules, rendering and input capture are unchanged.

**Tech stack:** Existing JavaScript ES modules, React, Socket.IO, native WebRTC/getUserMedia, Node tests and isolated Chrome browser tests. No new dependencies or hosting changes.

## Decisions

- Microphones require explicit player action and native browser permission. Start voice off; offer Turn on voice and Listen only, microphone mute, incoming-audio mute, volume and Turn off voice.
- Request ideal echo cancellation, noise suppression, automatic gain control and mono input. Use speech content hints; prefer Opus, 24,000 bits/sec, mono, variable bitrate, in-band FEC and DTX preferences. Codec limits exclude packet overhead; silence reduction and processing depend on browser support.
- Keep remote audio outside game renderers and tick loops. No audio recording, raw samples, Web Audio DSP callbacks or high-frequency React meters.
- Voice membership derives from authoritative game-room/socket ownership. Unique per-join participant IDs reject stale sessions; room boundaries, sender identities, payload sizes, candidate queues, peer counts and signaling rates are bounded.
- Mesh is bounded to four participants (current games have two humans). Larger rooms must use a separate scalable media topology rather than unbounded mesh.
- Configure STUN and optional short-lived TURN credentials server-side. A TURN secret never enters static assets. Without a relay, restrictive NAT/mobile networks may fail; voice failure must leave the game running.
- Leaving/disconnecting/route changes dispose peers and capture; reconnect requires explicit rejoin. Rematches in the same live room retain voice. Rapid permission resolution after leaving must stop late tracks.
- Surface browser permission, secure-context, unsupported APIs, relay/connection and playback-blocking failures clearly. A labeled playback-resume action handles autoplay restrictions.

## Public boundaries

`public/platform/shared/voiceProtocol.js` defines version 1, event names, limits and packet JSDoc. JOIN is `{version,requestId}` with a fresh bounded nonce per explicit join. Server-authorized READY echoes `{version,requestId,participantId,participants:[{id,playerId,muted}],iceServers,maxParticipants}`. PEER_JOINED carries `{version,participant:{id,playerId,muted},iceServers}` with fresh credentials scoped to the receiving existing participant; PEER_LEFT carries `{version,participantId}`. STATE receives `{version,muted}` and broadcasts `{version,participantId,muted}`. SIGNAL receives `{version,to,description?,candidate?}` and forwards only sanitized `{version,from,description?,candidate?}`. DESCRIPTION is an audio SDP offer/answer. ERROR is `{version,requestId?,code,message}`, echoing a valid join nonce for join errors. LEAVE carries `{version}`. Audio packets are never accepted as signaling.

`createVoiceChatSession({transport,onStateChange,...browserDependencies})` owns media and peers. Methods: `join({listenOnly=false}={})`, `setMicrophoneMuted(boolean)`, `setDeafened(boolean)`, `setVolume(number)`, `resumePlayback()`, `leave()`, `dispose()`, `getState()`. Transport is `{onEvent(event,listener):unsubscribe,send(event,packet),isConnected():boolean}` from the existing game socket. State has `status`, `microphoneMuted`, `deafened`, `volume`, `participants`, `playbackBlocked`, `errorCode`, `errorMessage`, plus processing support feedback. Join/mic changes/resume return promises; cleanup is idempotent.

## Tasks

1. Backend: implement namespace-local voice signaling and environment configuration, connect to generic registration, write room-ownership/rate/validation/leave/rejoin tests.
2. Browser: implement injected/testable WebRTC session, bounded ICE buffering, deterministic initial offer ownership, media constraints/codec settings, microphone/volume/playback controls and cleanup tests.
3. UI: implement shared hook and a compact Voice toolbar entry plus platform-styled dialog; game/room lifecycle supplies the existing socket and cleanup. Preserve canvas/shell identity and modal/input priorities.
4. Integration: document configuration and limits; exercise actual two-browser audio transport, mute/listen-only, denied access, room isolation, leave/rejoin/rematch, game movement and mobile UI. Run `npm test`, `npm run build`, and independent review.

## Visual and interaction direction

Keep gameplay dominant. Voice actions join the existing dark toolbar; its dialog uses platform surfaces, cyan actions, Space Grotesk headings and Manrope body text. Keep mic/sound toggles available during play and show one short status in settings, with volume/participants behind More options. Reuse existing dialog focus containment, Escape, reduced-motion and focus restoration. Avoid animated audio meters and extra permanent HUD panels.

## Review focus

- Late getUserMedia/SDP promises after leaving cannot revive voice or leak capture.
- Spectators, stale transports and another room cannot relay voice packets.
- ICE arrives before SDP, peers join simultaneously, reconnect/rejoin IDs change.
- Deafen, permission denial, autoplay blocking and unavailable TURN never stop gameplay.
- Audio bitrate limits and low-rate UI updates remain independent of game cadence.

No commit, merge, push, purchased services or deployment is included in this implementation request.

## Voice UI simplification

The user requested simpler voice controls after trying the initial dialog. Keep the existing dark platform surfaces and cyan active states, with gameplay as the main workspace.

- Start voice from an explicit **Turn on voice** toolbar action. Keep capture opt-in and leave the board visible.
- Show direct **Mic on/off** and **Sound on/off** buttons while joined, plus a separate labeled settings control. Share button behavior between the toolbar and dialog.
- Reduce the dialog to one short connection message, the two audio toggles, **More options** and **Turn off voice**. Put volume and any real participant list inside collapsed options; remove duplicate empty-state and audio-processing prose. Keep Listen only before joining.
- Preserve permission-error feedback, playback-resume actions, joining cancellation, modal focus/Escape restoration and stable game/canvas ownership. Audio transport, processing and room membership rules remain unchanged.
- Verify the new direct-join and modal-free toggle behavior in the existing synthetic-audio browser test, then rerun normal voice, denied permission, waiting/results access and landscape touch checks across different games. Run the full Node suite and production build.

### Simplified UI verification

- `npm test`: 901 tests passed after the UI changes.
- The voice browser suite passed with Pong, Fight and Ludo: real Opus audio, explicit direct join, modal-free mic/sound toggles, collapsed options, volume and waiting/results access.
- Desktop and 844×390/568×320 touch screenshots inspected; voice controls and the compact dialog fit the host without replacing the game canvas.
- Failed-peer tests keep microphone capture accurately labeled with usable mute controls. Successful toggles do not reopen old connection warnings. Repeated permission denial still surfaces an actionable error.
- A delayed-capture regression leaves and rejoins voice before rejecting the old permission request; the stale action cannot reopen settings. UI feedback is scoped to participation and per-action intent, independently of the SDK's existing media lifecycle.
- Independent review findings were reproduced before fixes and re-reviewed afterward. Audio encoding, bitrate limits, processing, signaling and server rules were unchanged.

## Completed verification

- Baseline: 767 tests passed. Final `npm test`: 853 passed, zero failures.
- `npm run build`: passed; shared runtime/socket modules remain external to the UI bundle, preserving the existing socket cache.
- `npm run test:voice:browser`: passed in isolated Chrome with synthetic microphone devices across Fight and Pong. Actual Opus RTP flows both ways, a listen-only user can later speak, sender caps report 24 kbps, processing preferences are requested and remote audio is attached to playing media elements.
- Browser checks also passed microphone and incoming-audio mute, volume, movement/acknowledgements during voice, mobile landscape layout, unchanged canvas, waiting/results voice access, permission-denial recovery, peer rejoin and capture cleanup. A returning player does not automatically rejoin voice.
- Independent review findings were fixed and re-reviewed: join response correlation, departed-target errors, expired TURN credentials before new-peer allocation and microphone controls behind persistent game overlays. Native answerer transceiver adoption was additionally verified with real browser media.
- TURN configuration/credential expiry and renewal were tested at the contract boundary. No live TURN relay, real-world mobile network or subjective noise-removal test was available; deployment should verify a real two-device call. Native processing support and effectiveness vary by browser/device.
