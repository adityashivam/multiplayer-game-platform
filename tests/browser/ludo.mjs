import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";
import { createLatencyProxy } from "./support/latencyProxy.mjs";

const targetUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const roundTripMs = Number(process.env.LUDO_TEST_RTT_MS || 0);
const fixtureServer = await startFixtureServer();
const latencyProxy = await createLatencyProxy({
  targetUrl: fixtureServer.url,
  roundTripMs,
  jitterMs: roundTripMs ? 35 : 0,
  stallEveryMs: roundTripMs ? 6000 : 0,
  stallDurationMs: roundTripMs ? 200 : 0,
});
const browser = await createBrowserTestSession("ludo");
const { evaluate, waitFor, newPage, send, click, clickText, capture } = browser;
const pages = [];

/** Launch a test-only authority; dice/position fixtures are parent IPC, not APIs. */
async function startFixtureServer() {
  const child = fork(new URL("./support/ludoFixtureServer.mjs", import.meta.url), [], {
    silent: true,
    env: { ...process.env, PLATFORM_BASE_URL: targetUrl, VOICE_STUN_URLS: "", VOICE_TURN_URLS: "", VOICE_TURN_SECRET: "" },
  });
  const pendingRequests = new Map();
  let requestSequence = 0;
  let serverErrors = "";
  child.stderr.on("data", (chunk) => { serverErrors = (serverErrors + chunk).slice(-6000); });
  const ready = await new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => reject(new Error(`Ludo fixture startup timed out: ${serverErrors}`)), 10000);
    child.on("message", (message) => {
      if (message.ready) {
        clearTimeout(startupTimer);
        resolve(message);
      } else if (pendingRequests.has(message.id)) {
        const request = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        clearTimeout(request.timer);
        message.ok ? request.resolve(message) : request.reject(new Error(message.message));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      reject(new Error(`Ludo fixture exited ${code}: ${serverErrors}`));
    });
    child.once("error", reject);
  }).catch((error) => { child.kill("SIGTERM"); throw error; });

  return {
    url: ready.url,
    request(command) {
      return new Promise((resolve, reject) => {
        const id = ++requestSequence;
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error("Ludo fixture request timed out"));
        }, 5000);
        pendingRequests.set(id, { resolve, reject, timer });
        child.send({ ...command, id });
      });
    },
    async close() {
      for (const request of pendingRequests.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Fixture closed"));
      }
      pendingRequests.clear();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await closed;
    },
  };
}

async function observeLudo(page) {
  await waitFor(page, "document.querySelector('[data-ludo-hud]') && typeof window.io === 'function'", 30000);
  await evaluate(page, `
    const { getGameSocket } = await import('/platform/frontend-engine/gameSocket.js');
    const { subscribeRoomLifecycle } = await import('/platform/frontend-engine/roomLifecycleBridge.js');
    window.ludoProbe = { snapshot: null, room: null, roomFull: 0, canvas: document.querySelector('#game-canvas') };
    window.ludoSocket = getGameSocket('ludo');
    ludoSocket.onEvent('state', snapshot => ludoProbe.snapshot = snapshot);
    ludoSocket.onEvent('roomFull', () => ludoProbe.roomFull++);
    subscribeRoomLifecycle('ludo', room => ludoProbe.room = room);
  `);
  await waitFor(page, "ludoProbe.snapshot && ludoProbe.room?.joined", 30000);
}

async function waitForTurnInput(page) {
  await waitFor(page, "ludoProbe.snapshot.started && !document.querySelector('[aria-modal=true]')", 30000);
}

async function installFixture(roomId, fixture, diceValue = 6) {
  await fixtureServer.request({ type: "dice", values: [diceValue] });
  const update = await fixtureServer.request({ type: "fixture", roomId, fixture });
  for (const page of pages) {
    await waitFor(page, `ludoProbe.snapshot.revision >= ${update.revision} && ludoProbe.snapshot.phase === 'roll'`);
  }
  return update;
}

async function rollAndChoose(first) {
  await waitFor(first, "!document.querySelector('[aria-label=\"Roll dice\"]').disabled");
  await click(first, '[aria-label="Roll dice"]');
  await waitFor(first, "ludoProbe.snapshot.phase === 'choose'", 15000);
  return evaluate(first, "return { revision: ludoProbe.snapshot.revision, roundId: ludoProbe.snapshot.roundId, rollSerial: ludoProbe.snapshot.rollSerial, diceValue: ludoProbe.snapshot.diceValue };");
}

async function movePiece(first, tokenIndex) {
  await click(first, `[data-ludo-token-index="${tokenIndex}"]`);
  await waitFor(first, "ludoProbe.snapshot.phase === 'moving' || ludoProbe.snapshot.phase === 'finished'", 15000);
}

async function waitForSharedPosition(playerId, tokenIndex, progress) {
  for (const page of pages) {
    await waitFor(page, `ludoProbe.snapshot.players.${playerId}.tokens[${tokenIndex}] === ${progress}`);
  }
}

try {
  const roomResponse = await fetch(`${latencyProxy.url}/api/games/ludo/new-room`);
  assert.equal(roomResponse.status, 200, "Ludo is served through normal catalog room routes");
  const { roomId } = await roomResponse.json();
  const roomUrl = `${latencyProxy.url}/games/ludo/${roomId}`;
  const first = await newPage(roomUrl, 1440, 900);
  pages.push(first);
  await observeLudo(first);
  const second = await newPage(roomUrl, 1440, 900);
  pages.push(second);
  await observeLudo(second);
  for (const page of pages) await waitForTurnInput(page);
  assert.equal(await evaluate(first, "return ludoProbe.room.playerId;"), "p1");
  assert.equal(await evaluate(second, "return ludoProbe.room.playerId;"), "p2");

  await installFixture(roomId, "yard");
  await evaluate(second, "const state = ludoProbe.snapshot; ludoSocket.send('input', { type: 'roll', roundId: state.roundId, revision: state.revision });");
  await evaluate(first, "const state = ludoProbe.snapshot; ludoSocket.send('input', { type: 'roll', roundId: state.roundId, revision: state.revision, diceValue: 6 });");
  await delay(roundTripMs + 200);
  assert.equal(await evaluate(first, "return ludoProbe.snapshot.phase;"), "roll", "wrong-player and forged rolls are ignored");
  const chosenRoll = await rollAndChoose(first);
  assert.equal(chosenRoll.diceValue, 6, "invalid commands never consumed the injected die");
  await movePiece(first, 0);
  await waitForSharedPosition("p1", 0, 0);
  await evaluate(first, `ludoSocket.send('input', { type: 'move', roundId: ${chosenRoll.roundId}, revision: ${chosenRoll.revision}, tokenIndex: 0 });`);
  await delay(roundTripMs + 200);
  assert.equal(await evaluate(first, "return ludoProbe.snapshot.players.p1.tokens[0];"), 0, "a duplicate old move cannot advance the piece twice");
  await capture(first, `rtt-${roundTripMs}-release`);

  await installFixture(roomId, "yard");
  await fixtureServer.request({ type: "dice", values: [2, 3, 4, 5, 1, 2, 4] });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    for (const [page, playerId] of [[first, "p1"], [second, "p2"]]) {
      await waitFor(page, "!document.querySelector('[aria-label=\"Roll dice\"]').disabled");
      await click(page, '[aria-label="Roll dice"]');
      for (const observer of pages) {
        await waitFor(observer, `ludoProbe.snapshot.players.${playerId}.entryMisses === ${attempt} && ludoProbe.snapshot.phase === 'roll' && ludoProbe.snapshot.currentPlayerId !== '${playerId}'`);
      }
    }
  }
  await waitFor(first, "document.querySelector('[data-ludo-hud]').textContent.includes('Quick entry: your next roll is 6.')");
  await capture(first, `rtt-${roundTripMs}-quick-entry`);
  await send("Page.reload", { ignoreCache: true }, second);
  await observeLudo(second);
  for (const page of pages) {
    await waitForTurnInput(page);
    assert.equal(await evaluate(page, "return ludoProbe.snapshot.players.p1.entryMisses;"), 2);
    assert.equal(await evaluate(page, "return ludoProbe.snapshot.players.p2.entryMisses;"), 2);
  }
  assert.equal((await rollAndChoose(first)).diceValue, 6, "the third entry roll overrides the natural one with six");
  await movePiece(first, 0);
  await waitForSharedPosition("p1", 0, 0);
  assert.equal((await rollAndChoose(first)).diceValue, 2, "active pieces keep their natural roll");
  await movePiece(first, 0);
  await waitForSharedPosition("p1", 0, 2);
  assert.equal((await rollAndChoose(second)).diceValue, 6, "the other player receives the identical entry guarantee");
  await movePiece(second, 0);
  await waitForSharedPosition("p2", 0, 0);
  console.log("QUICK ENTRY / SEAT SYMMETRY / REJOIN COUNTERS / NATURAL ACTIVE ROLLS PASSED", { roundTripMs });

  await installFixture(roomId, "yard", 4);
  await click(first, '[aria-label="Roll dice"]');
  for (const page of pages) {
    await waitFor(page, "ludoProbe.snapshot.phase === 'roll' && ludoProbe.snapshot.currentPlayerId === 'p2' && ludoProbe.snapshot.lastAction.diceValue === 4");
  }
  for (let timeoutIndex = 0; timeoutIndex < 2; timeoutIndex += 1) {
    const expiredDecision = await fixtureServer.request({ type: "expireDecision", roomId });
    for (const page of pages) {
      await waitFor(page, `ludoProbe.snapshot.revision >= ${expiredDecision.revision} && ludoProbe.snapshot.lastAction.kind === 'pass'`);
      assert.equal(await evaluate(page, "return ludoProbe.snapshot.lastAction.diceValue;"), 4);
      await waitFor(page, "document.querySelector('[data-ludo-dice-value=\"4\"]')");
      await waitFor(page, "ludoProbe.snapshot.phase === 'roll'");
    }
  }

  await installFixture(roomId, "blockade");
  await rollAndChoose(first);
  assert.equal(await evaluate(first, "return document.querySelector('[data-ludo-token-index=\"0\"]').disabled;"), true, "blocked pieces are visibly unavailable");
  await evaluate(first, "const state = ludoProbe.snapshot; ludoSocket.send('input', { type: 'move', roundId: state.roundId, revision: state.revision, tokenIndex: 0 });");
  await delay(roundTripMs + 200);
  assert.equal(await evaluate(first, "return ludoProbe.snapshot.players.p1.tokens[0];"), 0);

  await installFixture(roomId, "safe");
  await rollAndChoose(first);
  await movePiece(first, 0);
  await waitForSharedPosition("p1", 0, 8);
  await waitForSharedPosition("p2", 0, 34);
  await delay(1300);
  await capture(first, `rtt-${roundTripMs}-safe-stack`);

  await installFixture(roomId, "capture");
  await rollAndChoose(first);
  await movePiece(first, 0);
  await waitForSharedPosition("p1", 0, 6);
  await waitForSharedPosition("p2", 0, -1);
  assert.equal(await evaluate(second, "return ludoProbe.snapshot.players.p1.captures;"), 1);
  await waitFor(first, "ludoProbe.snapshot.phase === 'roll'");

  const seatToken = await evaluate(second, `return sessionStorage.getItem('rejoinToken:ludo:${roomId}');`);
  await send("Page.reload", { ignoreCache: true }, second);
  await observeLudo(second);
  for (const page of pages) await waitForTurnInput(page);
  assert.equal(await evaluate(second, "return ludoProbe.room.playerId;"), "p2");
  assert.equal(await evaluate(second, `return sessionStorage.getItem('rejoinToken:ludo:${roomId}');`), seatToken);
  await waitForSharedPosition("p1", 0, 6);
  assert.equal(await evaluate(first, "return ludoProbe.canvas === document.querySelector('#game-canvas');"), true);

  await installFixture(roomId, "win");
  await rollAndChoose(first);
  await movePiece(first, 3);
  for (const page of pages) {
    await waitFor(page, "ludoProbe.snapshot.gameOver && document.querySelector('[aria-label=\"Match results\"]')", 15000);
    assert.equal(await evaluate(page, "return ludoProbe.snapshot.winner;"), "p1");
    assert.equal(await evaluate(page, "return ludoProbe.snapshot.players.p1.finished;"), 4);
  }
  const finishedRound = await evaluate(first, "return ludoProbe.snapshot.roundId;");
  const rematchButtonText = await evaluate(first, `
    const dialog = document.querySelector('[aria-label="Match results"]');
    const button = dialog.querySelector('button');
    const actionButtons = [...dialog.querySelectorAll('button')].filter(button => !button.getAttribute('aria-label'));
    return actionButtons[0]?.textContent.replace(/\s+/g, ' ').trim();
  `);
  await evaluate(first, "ludoSocket.send('rematch');");
  await evaluate(second, "ludoSocket.send('rematch');");
  for (const page of pages) {
    await waitFor(page, `ludoProbe.snapshot.roundId > ${finishedRound} && ludoProbe.snapshot.started && !document.querySelector('[aria-modal=true]')`, 30000);
    assert.deepEqual(await evaluate(page, "return ludoProbe.snapshot.players.p1.tokens;"), [-1, -1, -1, -1]);
    assert.equal(await evaluate(page, "return ludoProbe.roomFull;"), 0);
    assert.equal(await evaluate(page, "return ludoProbe.canvas === document.querySelector('#game-canvas');"), true);
  }
  assert.ok(rematchButtonText, "results offer a readable rematch action");

  await fixtureServer.request({ type: "recreate", roomId });
  for (const page of pages) {
    await waitFor(page, "ludoProbe.snapshot.roundId === 1 && ludoProbe.snapshot.started && document.querySelector('[data-ludo-round-id=\"1\"]') && !document.querySelector('[aria-modal=true]')", 30000);
    assert.equal(await evaluate(page, "return ludoProbe.canvas === document.querySelector('#game-canvas');"), true);
  }
  const firstSeat = await evaluate(first, "return ludoProbe.room.playerId;");
  const activePlayer = firstSeat === "p1" ? first : second;
  await fixtureServer.request({ type: "dice", values: [6] });
  await rollAndChoose(activePlayer);
  assert.equal(await evaluate(activePlayer, "return ludoProbe.snapshot.rollSerial;"), 1, "a recreated room accepts a fresh low action identity");
  const displayedDie = await evaluate(activePlayer, `
    const die = document.querySelector('[data-ludo-dice-value="6"]');
    return { pips: [...die.querySelectorAll('i')].filter(pip => getComputedStyle(pip).visibility !== 'hidden' && getComputedStyle(pip).display !== 'none').length,
      placeholderVisible: getComputedStyle(die.querySelector('b')).display !== 'none' };
  `);
  assert.equal(displayedDie.pips, 6);
  assert.equal(displayedDie.placeholderVisible, false, "the unrolled dash never covers a real die result");
  await movePiece(activePlayer, 0);
  await waitForSharedPosition("p1", 0, 0);
  console.log("RECREATED ROOM / FRESH ACTION IDENTITY / DIE DISPLAY PASSED", { roundTripMs });

  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, first);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, first);
  await waitFor(first, "document.querySelector('[data-platform-touch-game=ludo]')");
  await delay(250);
  const mobileBounds = await evaluate(first, `
    const hud = document.querySelector('[data-ludo-hud]').getBoundingClientRect();
    const roll = document.querySelector('[aria-label="Roll dice"]').getBoundingClientRect();
    return { viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      hud: hud.toJSON(), roll: roll.toJSON(), canvasWidth: ludoProbe.canvas.width, canvasHeight: ludoProbe.canvas.height };
  `);
  assert.ok(mobileBounds.scrollWidth <= 845 && mobileBounds.roll.right <= 845 && mobileBounds.roll.bottom <= 391);
  assert.ok(mobileBounds.canvasWidth > 0 && mobileBounds.canvasHeight > 0);
  assert.equal(await evaluate(first, "return ludoProbe.canvas === document.querySelector('#game-canvas');"), true);
  await capture(first, `rtt-${roundTripMs}-mobile`);
  await capture(second, `rtt-${roundTripMs}-desktop`);
  if (roundTripMs > 0) {
    const connection = await evaluate(first, "return ludoSocket.getConnectionSnapshot();");
    assert.ok(connection.ping >= roundTripMs * 0.65, "the impaired transport is measured by actual application RTT");
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("LUDO RULES / TWO-CLIENT RECOVERY / REMATCH / MOBILE PASSED", { roundTripMs, mobileBounds, proxy: latencyProxy.getStats() });
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error("LUDO PAGE", index, await evaluate(page, "return { url: location.href, state: window.ludoProbe?.snapshot, text: document.body?.innerText.slice(-1500) };").catch(() => null));
    await capture(page, `failure-${roundTripMs}-${index}`).catch(() => {});
  }
  console.error("LUDO BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
  await latencyProxy.close();
  await fixtureServer.close();
}
