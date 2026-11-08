import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const gameIds = (process.env.VOICE_TEST_GAMES || "pong,fight").split(",");
const browser = await createBrowserTestSession("platform-voice", {
  // Synthetic devices only: never capture the developer's actual microphone.
  extraArgs: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const { evaluate, waitFor, newPage, send, click, clickText, capture, key } = browser;
const pages = [];
const voiceInstrumentation = `
  if (location.origin === ${JSON.stringify(new URL(baseUrl).origin)}) {
  window.voiceTest = { peers: [], streams: [], captureRequests: [], state: null, playerId: null };
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(configuration) {
      super(configuration);
      voiceTest.peers.push(this);
    }
  };
  const captureMicrophone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    voiceTest.captureRequests.push(constraints);
    const stream = await captureMicrophone(constraints);
    voiceTest.streams.push(stream);
    return stream;
  };
  }
`;

/** Open the actual game and observe its authoritative room without another socket. */
async function openPlayer(gameId, roomId) {
  const page = await newPage(`${baseUrl}/games/${gameId}/${roomId}`, 1200, 720, false, voiceInstrumentation);
  pages.push(page);
  await waitFor(page, "document.querySelector('#game-canvas')");
  await evaluate(page, `
    const { subscribeRoomLifecycle } = await import('/platform/frontend-engine/roomLifecycleBridge.js');
    subscribeRoomLifecycle(${JSON.stringify(gameId)}, room => {
      voiceTest.room = room;
      voiceTest.playerId = room.playerId;
    });
  `);
  await waitFor(page, "voiceTest.room?.joined");
  return page;
}

async function waitUntilPlaying(page, gameId) {
  await waitFor(page, "voiceTest.room?.phase === 'playing' && !document.querySelector('[aria-modal=true]')", 30000);
  await evaluate(page, `
    const { getGameSocket } = await import('/platform/frontend-engine/gameSocket.js');
    getGameSocket(${JSON.stringify(gameId)}).onEvent('state', snapshot => voiceTest.state = snapshot);
    voiceTest.canvas = document.querySelector('#game-canvas');
  `);
  await waitFor(page, "voiceTest.state");
}

async function openVoice(page) {
  const toolbarAvailable = await evaluate(page, `
    const voiceButton = document.querySelector('[aria-label="Voice chat"]');
    return Boolean(voiceButton && !voiceButton.disabled);
  `);
  await click(page, toolbarAvailable ? '[aria-label="Voice chat"]' : '[aria-label="Open room voice settings"]');
  await waitFor(page, "document.querySelector('[aria-label=\"Room voice chat\"]')");
}

async function closeVoice(page) {
  await key(page, "Escape", "Escape", true);
  await key(page, "Escape", "Escape", false);
  await waitFor(page, "!document.querySelector('[aria-label=\"Room voice chat\"]')");
}

async function waitForConnectedAudio(page) {
  await waitFor(page, "voiceTest.peers.some(peer => peer.connectionState === 'connected')", 30000);
  const resumeNeeded = await evaluate(page, "return Boolean(document.querySelector('[aria-label=\"Play voice audio\"]'));");
  if (resumeNeeded) await click(page, '[aria-label="Play voice audio"]');
}

async function readAudioStatistics(page) {
  return evaluate(page, `
    const audioStatistics = { sentBytes: 0, receivedBytes: 0, codecs: [], bitrateCaps: [] };
    for (const peer of voiceTest.peers.filter(peer => peer.connectionState === 'connected')) {
      const reports = await peer.getStats();
      for (const report of reports.values()) {
        if (report.type === 'outbound-rtp' && report.kind === 'audio') audioStatistics.sentBytes += report.bytesSent || 0;
        if (report.type === 'inbound-rtp' && report.kind === 'audio') audioStatistics.receivedBytes += report.bytesReceived || 0;
        if (report.type === 'codec') audioStatistics.codecs.push(report.mimeType);
      }
      for (const sender of peer.getSenders()) {
        if (sender.track?.kind === 'audio') {
          audioStatistics.bitrateCaps.push(...(sender.getParameters().encodings || []).map(encoding => encoding.maxBitrate));
        }
      }
    }
    return audioStatistics;
  `);
}

async function verifyGameplayDuringVoice(page, gameId) {
  if (gameId === "ludo") {
    const previousRollSerial = await evaluate(page, "return voiceTest.state.rollSerial;");
    await click(page, '[aria-label="Roll dice"]');
    await waitFor(page, `voiceTest.state.rollSerial > ${previousRollSerial}`);
    const diceValue = await evaluate(page, "return voiceTest.state.diceValue;");
    assert.ok(Number.isInteger(diceValue) && diceValue >= 1 && diceValue <= 6);
    assert.equal(await evaluate(page, "return voiceTest.canvas === document.querySelector('#game-canvas');"), true);
    return;
  }
  const movementField = gameId === "pong" ? "y" : "x";
  const movementCode = gameId === "pong" ? "ArrowUp" : "ArrowRight";
  const initialPlayer = await evaluate(page, "return { ...voiceTest.state.players[voiceTest.playerId] };");
  await click(page, "#game-canvas");
  await key(page, movementCode, movementCode, true);
  await delay(250);
  await key(page, movementCode, movementCode, false);
  await delay(200);
  const movedPlayer = await evaluate(page, "return { ...voiceTest.state.players[voiceTest.playerId] };");
  assert.ok(Math.abs(movedPlayer[movementField] - initialPlayer[movementField]) > 1, `${gameId} movement still reaches authority`);
  assert.ok(movedPlayer.inputSeqAck > initialPlayer.inputSeqAck);
  assert.equal(await evaluate(page, "return voiceTest.canvas === document.querySelector('#game-canvas');"), true);
  assert.equal(await evaluate(page, "return voiceTest.peers.some(peer => peer.connectionState === 'connected');"), true);
}

try {
  for (const gameId of gameIds) {
    const roomResponse = await fetch(`${baseUrl}/api/games/${gameId}/new-room`);
    assert.equal(roomResponse.status, 200);
    const { roomId } = await roomResponse.json();
    const first = await openPlayer(gameId, roomId);
    const second = await openPlayer(gameId, roomId);
    await waitUntilPlaying(first, gameId);
    await waitUntilPlaying(second, gameId);
    assert.equal(await evaluate(first, "return voiceTest.captureRequests.length;"), 0, "the game never opens a microphone automatically");
    assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Voice chat\"]'));"), true);

    await click(first, '[aria-label="Turn on voice"]');
    await waitFor(first, "voiceTest.streams.length === 1");
    assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Room voice chat\"]'));"), false, "starting voice keeps gameplay visible");
    await waitFor(first, "document.querySelector('[aria-label=\"Mute microphone\"]')");
    await click(first, '[aria-label="Mute microphone"]');
    assert.equal(await evaluate(first, "return voiceTest.streams[0].getAudioTracks().every(track => !track.enabled);"), true);
    await click(first, '[aria-label="Unmute microphone"]');
    await capture(first, `${gameId}-quick-voice`);
    await openVoice(second);
    await clickText(second, "Listen only");
    await closeVoice(second);
    await waitForConnectedAudio(first);
    await waitForConnectedAudio(second);
    assert.equal(await evaluate(second, "return voiceTest.captureRequests.length;"), 0, "listening requests no microphone permission");
    await delay(1500);
    const receivingStatistics = await readAudioStatistics(second);
    assert.ok(receivingStatistics.receivedBytes > 0, "real RTP audio reaches the listening player");
    assert.ok(receivingStatistics.codecs.includes("audio/opus"));
    assert.equal(await evaluate(second, `
      const remoteAudio = document.querySelector('[data-platform-voice-peer]');
      return Boolean(remoteAudio && !remoteAudio.paused && remoteAudio.srcObject?.getAudioTracks().some(track => track.readyState === 'live'));
    `), true, "received audio is attached to a playing audio element");

    await click(second, '[aria-label="Unmute microphone"]');
    await waitFor(second, "voiceTest.streams.length === 1 && voiceTest.streams[0].getAudioTracks()[0].enabled");
    await delay(1200);
    const firstStatistics = await readAudioStatistics(first);
    const secondStatistics = await readAudioStatistics(second);
    console.log("TWO-WAY AUDIO STATISTICS", { firstStatistics, secondStatistics });
    assert.ok(firstStatistics.receivedBytes > 0 && secondStatistics.sentBytes > 0, "listen-only can upgrade to a two-way call");
    for (const statistics of [firstStatistics, secondStatistics]) {
      assert.ok(statistics.bitrateCaps.length > 0 && statistics.bitrateCaps.every(cap => cap === 24000));
    }
    const processingConstraints = await evaluate(first, "return voiceTest.captureRequests[0];");
    assert.equal(processingConstraints.video, false);
    for (const processingName of ["noiseSuppression", "echoCancellation", "autoGainControl"]) {
      const processingPreference = processingConstraints.audio[processingName];
      assert.ok(processingPreference === true || processingPreference?.ideal === true, `${processingName} is requested`);
    }

    await click(second, '[aria-label="Mute microphone"]');
    assert.equal(await evaluate(second, "return voiceTest.streams[0].getAudioTracks().every(track => !track.enabled);"), true);
    await click(second, '[aria-label="Mute incoming voice"]');
    assert.equal(await evaluate(second, "return [...document.querySelectorAll('[data-platform-voice-peer]')].every(audio => audio.muted);"), true);
    await click(second, '[aria-label="Unmute incoming voice"]');
    assert.equal(await evaluate(second, "return Boolean(document.querySelector('[aria-modal=true]'));"), false, "quick audio toggles never open a modal");
    await openVoice(second);
    assert.equal(await evaluate(second, "return document.querySelector('[aria-label=\"Voice volume\"]').checkVisibility();"), false, "extra settings start collapsed");
    await click(second, '[data-voice-options] > summary');
    assert.equal(await evaluate(second, "return document.querySelector('[aria-label=\"Voice volume\"]').checkVisibility();"), true, "volume is available when requested");
    await evaluate(second, `
      const volumeSlider = document.querySelector('[aria-label="Voice volume"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(volumeSlider, 25);
      for (const eventName of ['input', 'change']) {
        const sliderEvent = document.createEvent('Event');
        sliderEvent.initEvent(eventName, true, false);
        volumeSlider.dispatchEvent(sliderEvent);
      }
    `);
    assert.equal(await evaluate(second, "return [...document.querySelectorAll('[data-platform-voice-peer]')].every(audio => audio.volume === 0.25);"), true);
    await closeVoice(second);
    await verifyGameplayDuringVoice(first, gameId);
    console.log("VOICE AUDIO / PROCESSING / CONTROLS / GAMEPLAY PASSED", gameId, { firstStatistics, secondStatistics });

    await evaluate(first, `
      const { showEndGameModal } = await import('/platform/frontend-engine/endGameBridge.js');
      showEndGameModal({ title: 'Voice controls test', subtitle: 'Keep microphone controls available', phase: 'ready' });
    `);
    await waitFor(first, "document.querySelector('[aria-label=\"Match results\"]')");
    await openVoice(first);
    assert.equal(await evaluate(first, "return document.querySelectorAll('[aria-modal=true]').length;"), 1);
    await click(first, '[aria-label="Room voice chat"] [aria-label="Mute microphone"]');
    await click(first, '[aria-label="Room voice chat"] [aria-label="Unmute microphone"]');
    await closeVoice(first);
    await waitFor(first, "document.querySelector('[aria-label=\"Match results\"]')");
    await evaluate(first, "const { hideEndGameModal } = await import('/platform/frontend-engine/endGameBridge.js'); hideEndGameModal();");
    await waitFor(first, "!document.querySelector('[aria-modal=true]')");

    for (const viewport of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
      await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: true }, first);
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, first);
      await openVoice(first);
      const dialogBounds = await evaluate(first, `
        const dialog = document.querySelector('[aria-label="Room voice chat"]');
        const buttons = [...dialog.querySelectorAll('button')];
        const toolbar = document.querySelector('[aria-label="Game session controls"]');
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          buttons: buttons.filter(button => button.checkVisibility()).map(button => button.getBoundingClientRect().toJSON()),
          toolbarButtons: [...toolbar.querySelectorAll('button')].filter(button => button.checkVisibility()).map(button => button.getBoundingClientRect().toJSON()) };
      `);
      assert.ok(dialogBounds.scrollWidth <= dialogBounds.width + 1);
      assert.ok(dialogBounds.buttons.every(bounds => bounds.x >= 0 && bounds.right <= dialogBounds.width + 1 && bounds.bottom <= dialogBounds.height + 1), `voice actions fit ${viewport.width}×${viewport.height}`);
      assert.ok(dialogBounds.toolbarButtons.every(bounds => bounds.x >= 0 && bounds.right <= dialogBounds.width + 1), "quick controls stay within the viewport");
      await delay(200);
      await capture(first, `${gameId}-mobile-voice-${viewport.width}`);
      await closeVoice(first);
    }
    await evaluate(first, `
      const failedPeer = voiceTest.peers.find(peer => peer.connectionState === 'connected');
      Object.defineProperty(failedPeer, 'connectionState', { configurable: true, get: () => 'failed' });
      const failureEvent = document.createEvent('Event');
      failureEvent.initEvent('connectionstatechange', false, false);
      failedPeer.dispatchEvent(failureEvent);
      delete failedPeer.connectionState;
    `);
    await waitFor(first, "document.querySelector('[aria-label=\"Voice chat\"]').dataset.voiceStatus === 'error'");
    assert.equal(await evaluate(first, "return voiceTest.streams.some(stream => stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled));"), true, "a peer-link error does not end the local voice membership");
    assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Mute microphone\"]'));"), true, "live microphones always keep a quick mute control");
    await click(first, '[aria-label="Mute microphone"]');
    await delay(100);
    assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Room voice chat\"]'));"), false, "a successful mute does not reopen an old connection error");
    await click(first, '[aria-label="Unmute microphone"]');
    await delay(100);
    assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Room voice chat\"]'));"), false, "a successful unmute does not reopen an old connection error");
    assert.equal(await evaluate(first, "return voiceTest.streams.some(stream => stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled));"), true);
    console.log("VOICE FAILED-PEER MUTE / ACCURATE CAPTURE STATE PASSED", gameId);
    await send("Page.navigate", { url: "about:blank" }, second);
    await waitFor(first, "voiceTest.room?.phase === 'waiting' && document.querySelector('[aria-label=\"Room connection\"]')");
    await openVoice(first);
    assert.equal(await evaluate(first, "return document.querySelectorAll('[aria-modal=true]').length;"), 1);
    await click(first, '[aria-label="Room voice chat"] [aria-label="Mute microphone"]');
    await clickText(first, "Turn off voice");
    assert.equal(await evaluate(first, "return voiceTest.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));"), true);
    await closeVoice(first);
    await waitFor(first, "voiceTest.peers.every(peer => peer.connectionState === 'closed')");
    assert.equal(await evaluate(first, "return voiceTest.canvas === document.querySelector('#game-canvas');"), true);
    console.log("VOICE MOBILE LAYOUT / WAITING AND RESULTS ACCESS / LEAVE CLEANUP PASSED", gameId);

    if (gameId === "pong") {
      await evaluate(first, `
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Synthetic permission denial', 'NotAllowedError');
        };
      `);
      await openVoice(first);
      await clickText(first, "Turn on voice");
      await waitFor(first, "document.querySelector('[aria-label=\"Room voice chat\"] [role=alert]')?.textContent.includes('denied')");
      assert.equal(await evaluate(first, "return voiceTest.canvas === document.querySelector('#game-canvas') && voiceTest.room.joined;"), true);
      await clickText(first, "Listen only");
      await waitFor(first, "document.querySelector('[aria-label=\"Room voice chat\"] [data-voice-status=waiting]')");

      const returningPlayer = await openPlayer(gameId, roomId);
      await waitUntilPlaying(returningPlayer, gameId);
      await waitFor(first, "voiceTest.room.phase === 'playing' && !document.querySelector('[aria-modal=true]')");
      await openVoice(first);
      await openVoice(returningPlayer);
      assert.equal(await evaluate(returningPlayer, "return voiceTest.captureRequests.length;"), 0, "returning to a room never automatically rejoins voice");
      await clickText(returningPlayer, "Turn on voice");
      await waitForConnectedAudio(first);
      await waitForConnectedAudio(returningPlayer);
      await delay(700);
      assert.ok((await readAudioStatistics(first)).receivedBytes > 0, "a player denied microphone access can still hear a newly joined peer");
      assert.equal(await evaluate(first, "return voiceTest.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));"), true);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await closeVoice(first);
        await click(first, '[aria-label="Unmute microphone"]');
        await waitFor(first, "document.querySelector('[aria-label=\"Room voice chat\"] [role=alert]')?.textContent.includes('denied')");
        assert.equal(await evaluate(first, "return voiceTest.canvas === document.querySelector('#game-canvas') && voiceTest.room.joined;"), true);
      }
      await closeVoice(first);
      await evaluate(first, `
        navigator.mediaDevices.getUserMedia = () => new Promise((_resolve, reject) => {
          voiceTest.rejectPendingCapture = reject;
        });
      `);
      await click(first, '[aria-label="Unmute microphone"]');
      await waitFor(first, "typeof voiceTest.rejectPendingCapture === 'function'");
      await openVoice(first);
      await clickText(first, "Turn off voice");
      await clickText(first, "Listen only");
      await waitFor(first, "document.querySelector('[aria-label=\"Room voice chat\"] [aria-label=\"Unmute microphone\"]')");
      await closeVoice(first);
      await evaluate(first, "voiceTest.rejectPendingCapture(new DOMException('Late synthetic denial', 'NotAllowedError')); ");
      await delay(150);
      assert.equal(await evaluate(first, "return Boolean(document.querySelector('[aria-label=\"Room voice chat\"]'));"), false, "an old capture cannot reopen settings after leaving and rejoining voice");
      await openVoice(first);
      await clickText(first, "Turn off voice");
      await closeVoice(first);
      await send("Page.navigate", { url: "about:blank" }, returningPlayer);
      console.log("VOICE PERMISSION DENIAL / LISTEN-ONLY RECOVERY / PEER REJOIN PASSED");
    }

    for (const page of [first, second]) await send("Page.navigate", { url: "about:blank" }, page);
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("PLATFORM VOICE BROWSER CHECKS PASSED");
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error("VOICE PAGE", index, await evaluate(page, "return { url: location.href, text: document.body?.innerText.slice(-1800), captures: voiceTest?.captureRequests.length, peers: voiceTest?.peers.map(peer => ({ state: peer.connectionState, signaling: peer.signalingState, transceivers: peer.getTransceivers().map(transceiver => ({ direction: transceiver.direction, currentDirection: transceiver.currentDirection, sender: transceiver.sender.track ? { enabled: transceiver.sender.track.enabled, readyState: transceiver.sender.track.readyState } : null, receiver: transceiver.receiver.track?.readyState })) })) };").catch(() => null));
    await capture(page, `failure-${index}`).catch(() => {});
  }
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
