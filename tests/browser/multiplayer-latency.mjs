import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";
import { createLatencyProxy } from "./support/latencyProxy.mjs";

const targetUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const roundTripMs = Number(process.env.PLATFORM_TEST_RTT_MS || 500);
const gameIds = (process.env.PLATFORM_TEST_GAMES || "fight,pong,mario,mario-touch,roadrash,dead-shift,sky-dash,riftball,draw").split(",");
const latencyProxy = await createLatencyProxy({ targetUrl, roundTripMs, jitterMs: 40, stallEveryMs: 7000, stallDurationMs: 200 });
const browser = await createBrowserTestSession("multiplayer-latency");
const { evaluate, waitFor, newPage, send, key, capture } = browser;
const pages = [];

async function attachProbe(page, gameId) {
  await waitFor(page, "document.querySelector('#game-canvas')&&typeof window.io==='function'", 30000);
  await evaluate(page, `
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.mpSocket=getGameSocket(${JSON.stringify(gameId)});
    window.mpCanvas=document.querySelector('#game-canvas');
    window.mpProbe={last:null,states:0,roomFull:0,sent:[],events:[],board:null,keys:[]};
    window.addEventListener('keydown',event=>mpProbe.keys.push({code:event.code,key:event.key,prevented:event.defaultPrevented,hidden:document.hidden}));
    const sendInput=mpSocket.send.bind(mpSocket);
    mpSocket.send=(eventName,payload)=>{if(eventName==='input'&&payload?.type==='inputFrame')mpProbe.sent.push({protocol:payload.protocol,seq:payload.seq,epoch:payload.epoch,state:payload.state});return sendInput(eventName,payload)};
    const observeState=snapshot=>{mpProbe.last=snapshot;mpProbe.states++};
    let unsubscribeState=mpSocket.onEvent('state',observeState);
    // Legacy Kaboom scene setup clears its gameplay STATE subscribers once.
    // Keep this external inspection subscriber attached after that scene boot.
    setInterval(()=>{unsubscribeState();unsubscribeState=mpSocket.onEvent('state',observeState)},250);
    mpSocket.onEvent('roomFull',()=>mpProbe.roomFull++);
    mpSocket.onEvent('drawEvent',event=>mpProbe.events.push(event));
    mpSocket.onEvent('drawBoard',board=>mpProbe.board=board);
  `);
  await waitFor(page, "mpProbe.last", 30000);
}

async function readPlayer(page, playerId = "p1") {
  return evaluate(page, `const player=mpProbe.last.players[${JSON.stringify(playerId)}];return{x:player.x,y:player.y,z:player.z,progress:player.progress,inputSeqAck:player.inputSeqAck,inputEpoch:player.inputEpoch};`);
}

async function requestDrawingBoard(page) {
  await evaluate(page, "mpProbe.board=null;mpSocket.send('input',{type:'syncBoard'});");
  await waitFor(page, "mpProbe.board");
  return evaluate(page, "return mpProbe.board;");
}

async function drawStroke(page) {
  const bounds = await evaluate(page, "const r=mpCanvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};");
  const start = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.5 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...start }, page);
  for (let index = 1; index <= 12; index += 1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: start.x + index * 4, y: start.y + Math.sin(index / 3) * 10 }, page);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: start.x + 48, y: start.y }, page);
}

try {
  for (const gameId of gameIds) {
    const roomResponse = await fetch(`${latencyProxy.url}/api/games/${gameId}/new-room`);
    assert.equal(roomResponse.ok, true);
    const room = await roomResponse.json();
    const roomUrl = `${latencyProxy.url}/games/${gameId}/${room.roomId}`;
    const first = await newPage(roomUrl);
    pages.push(first);
    await attachProbe(first, gameId);
    const second = await newPage(roomUrl);
    pages.push(second);
    await attachProbe(second, gameId);
    for (const page of [first, second]) {
      await waitFor(page, "mpProbe.last.started&&(mpProbe.last.connected?Object.values(mpProbe.last.connected).every(Boolean):Object.values(mpProbe.last.players).every(player=>player.connected))&&![...document.querySelectorAll('[aria-modal=true]')].some(dialog=>dialog.getBoundingClientRect().width>0)", 20000);
    }
    if (gameId === "pong") {
      const paddleCenters = await evaluate(first, "return [...get('*')].filter(actor=>actor.width===26&&actor.height===160).map(actor=>actor.pos.x).sort((left,right)=>left-right);");
      assert.deepEqual(paddleCenters, [70, 1210], "rendered paddles use the authoritative 1280-unit arena");
    }
    if (gameId === "draw") {
      await drawStroke(first);
      await waitFor(second, "mpProbe.events.some(event=>event.action==='end')");
      const firstBoard = await requestDrawingBoard(first);
      const secondBoard = await requestDrawingBoard(second);
      assert.deepEqual(firstBoard, secondBoard);
      assert.equal(firstBoard.strokes.length, 1);
      assert.ok(firstBoard.strokes[0].points.length >= 8);
      assert.equal(firstBoard.strokes[0].completed, true);
      await Promise.all([key(first, "KeyC", "c", true), key(second, "KeyC", "c", true)]);
      await Promise.all([key(first, "KeyC", "c", false), key(second, "KeyC", "c", false)]);
      await delay(roundTripMs + 500);
      assert.equal((await requestDrawingBoard(first)).strokes.length, 0);
      assert.equal((await requestDrawingBoard(second)).strokes.length, 0);
    } else {
      await browser.click(first, "#game-canvas");
      const before = await readPlayer(first);
      const control = gameId === "pong" ? ["ArrowDown", "ArrowDown"]
        : gameId === "roadrash" ? ["ArrowUp", "ArrowUp"]
          : ["fight", "mario", "mario-touch"].includes(gameId) ? ["ArrowRight", "ArrowRight"] : ["KeyW", "w"];
      await key(first, ...control, true);
      await delay(700);
      await key(first, ...control, false);
      await delay(roundTripMs + 800);
      const after = await readPlayer(first);
      console.log("MOVEMENT OBSERVATION", gameId, { before, after, keys: await evaluate(first, "return mpProbe.keys;"), activeElement: await evaluate(first, "return document.activeElement?.outerHTML.slice(0,200);"), activePackets: await evaluate(first, "return mpProbe.sent.filter(packet=>Object.values(packet.state||{}).some(value=>value===true)).slice(0,3);") });
      const distanceMoved = Math.hypot(...["x", "y", "z", "progress"].map((field) => Number.isFinite(after[field]) && Number.isFinite(before[field]) ? after[field] - before[field] : 0));
      assert.ok(distanceMoved > 0.05, `${gameId} legal controls move the authoritative player`);
      assert.ok(after.inputSeqAck > before.inputSeqAck, "command acknowledgements advance");
      await waitFor(second, `mpProbe.last.players.p1.inputSeqAck>=${after.inputSeqAck}`);
      const observed = await readPlayer(second);
      assert.ok(observed.inputSeqAck >= after.inputSeqAck, "the opponent receives the same moving actor");
      const packets = await evaluate(first, "return mpProbe.sent;");
      assert.ok(packets.length > 20 && packets.every((packet) => packet.protocol === 2), "browser uses queued protocol2");
      if (gameId === "mario-touch") {
        await send("Emulation.setTouchEmulationEnabled", { enabled: true }, first);
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, first);
        await delay(400);
        assert.equal(await evaluate(first, "return mpCanvas===document.querySelector('#game-canvas')&&mpCanvas.isConnected;"), true);
        assert.equal(await evaluate(first, "return getComputedStyle(mpCanvas).transform;"), "none", "game renderer does not rotate the platform host");
      }
    }
    const tokenBeforeReload = await evaluate(second, `return sessionStorage.getItem('rejoinToken:${gameId}:${room.roomId}');`);
    const oldEpoch = (await readPlayer(first, "p2")).inputEpoch;
    await send("Page.reload", { ignoreCache: true }, second);
    await attachProbe(second, gameId);
    await waitFor(second, "mpProbe.last.started&&(mpProbe.last.connected?Object.values(mpProbe.last.connected).every(Boolean):Object.values(mpProbe.last.players).every(player=>player.connected))&&![...document.querySelectorAll('[aria-modal=true]')].some(dialog=>dialog.getBoundingClientRect().width>0)", 20000);
    const tokenAfterReload = await evaluate(second, `return sessionStorage.getItem('rejoinToken:${gameId}:${room.roomId}');`);
    assert.equal(tokenAfterReload, tokenBeforeReload, "reload retains the same seat");
    assert.equal(await evaluate(second, "return mpProbe.roomFull;"), 0);
    if (gameId !== "draw") assert.ok((await readPlayer(second, "p2")).inputEpoch > oldEpoch);
    const connection = await evaluate(first, "return mpSocket.getConnectionSnapshot();");
    assert.ok(connection.ping >= roundTripMs * 0.7, `real WebSocket impairment is measured (${connection.ping}ms)`);
    assert.equal(await evaluate(first, "return mpProbe.roomFull;"), 0);
    console.log("TWO-CLIENT IMPAIRED GAME PASSED", gameId, { measuredRttMs: connection.ping, states: await evaluate(first, "return mpProbe.states;") });
    await capture(first, gameId);
    for (const page of [first, second]) await send("Page.navigate", { url: "about:blank" }, page);
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("MULTIPLAYER BROWSER LATENCY CHECKS PASSED", latencyProxy.getStats());
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error("LATENCY PAGE", index, await evaluate(page, "return{url:location.href,state:window.mpProbe?.last,body:document.body?.innerText.slice(-800)};").catch(() => null));
  }
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  console.error("PROXY STATS", latencyProxy.getStats());
  throw error;
} finally {
  await browser.close();
  await latencyProxy.close();
}
