import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3100";
const delayedDelivery = process.env.PLATFORM_ROOM_TEST_DELAYED === "true";
const browser = await createBrowserTestSession("room-start");
const { newPage, evaluate, waitFor, capture, send } = browser;
const inspectedPages = [];

function createEntryObserver(clockSkewMs = 0) {
  return `
    const realDateNow=Date.now.bind(Date);Date.now=()=>realDateNow()+${clockSkewMs};
    window.roomFlowProbe={inviteSeen:false,digits:[],goSeen:false,phases:[]};
    window.roomFlowTransports=[];
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket{
      constructor(...args){super(...args);roomFlowTransports.push(this);}
    };
    new MutationObserver(()=>{
      const probe=roomFlowProbe;
      if(document.querySelector('[role="dialog"][aria-label="Invite players"]'))probe.inviteSeen=true;
      const digit=document.querySelector('[data-platform-room-start=countdown] [role=timer] strong')?.textContent;
      if(/^[1-5]$/.test(digit||'')&&probe.digits.at(-1)!==Number(digit))probe.digits.push(Number(digit));
      if(document.querySelector('[data-platform-room-go]'))probe.goSeen=true;
    }).observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label']});
  `;
}

async function attachSnapshots(sessionId, gameId) {
  await waitFor(sessionId, "document.querySelector('#game-canvas')", 30000);
  await evaluate(sessionId, `
    const {subscribeRoomLifecycle}=await import('/platform/frontend-engine/roomLifecycleBridge.js');
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.roomFlowState=null;
    window.roomFlowSnapshot=null;
    window.roomFlowSocket=getGameSocket(${JSON.stringify(gameId)});
    subscribeRoomLifecycle(${JSON.stringify(gameId)},state=>{
      roomFlowState=state;
      roomFlowProbe.phases.push(state.phase);
    });
  `);
  await waitFor(sessionId, "roomFlowState?.joined&&roomFlowState.phase!=='connecting'");
}

/** Delayed first authority may omit elapsed digits, but received countdowns cannot rewind or skip. */
function assertRoomCountdown(digits) {
  if (!delayedDelivery) {
    assert.deepEqual(digits, [5, 4, 3, 2, 1]);
    return;
  }
  assert.ok(digits.length > 0 && digits[0] >= 1 && digits[0] <= 5);
  assert.equal(digits.at(-1), 1);
  for (let digitIndex = 1; digitIndex < digits.length; digitIndex += 1) {
    assert.equal(digits[digitIndex], digits[digitIndex - 1] - 1);
  }
}

/** Exercise retry acknowledgements and real transport loss without reloading a renderer. */
async function verifyActiveRoomRecovery(creator, invitee, gameId) {
  for (const page of [creator, invitee]) {
    await waitFor(page, "!document.querySelector('[data-platform-room-go]')");
    await evaluate(page, `
      roomFlowSocket.onEvent('state',snapshot=>roomFlowSnapshot=snapshot);
      window.retainedRoomSeat=roomFlowState.playerId;
      window.retainedRoomCanvas=document.querySelector('#game-canvas');
      roomFlowProbe.phases=[];
      roomFlowProbe.goSeen=false;
    `);
    await waitFor(page, "roomFlowSnapshot");
  }
  const roomId = new URL(await evaluate(creator, "return location.href;")).pathname.split("/").at(-1);
  const previousSequence = await evaluate(creator, "return roomFlowSnapshot.net.seq;");
  await evaluate(creator, `
    const rejoinToken=sessionStorage.getItem(${JSON.stringify(`rejoinToken:${gameId}:${roomId}`)});
    for(let retry=0;retry<3;retry++)roomFlowSocket.send('joinGame',{gameId:${JSON.stringify(roomId)},rejoinToken});
  `);
  await waitFor(creator, `roomFlowSnapshot.net.seq>${previousSequence + 3}`);
  assert.equal(await evaluate(creator, "return roomFlowProbe.phases.every(phase=>phase==='playing');"), true, "Duplicate acknowledgements cannot reopen joining or stop a match");

  await evaluate(invitee, `
    const transport=roomFlowTransports.find(transport=>transport.readyState===WebSocket.OPEN);
    if(!transport)throw Error('No active game WebSocket');
    transport.close();
  `);
  await waitFor(invitee, "roomFlowProbe.phases.includes('reconnecting')");
  for (const page of [creator, invitee]) {
    await waitFor(page, "document.querySelector('[data-platform-room-recovery]')");
    assert.equal(await evaluate(page, "return Boolean(document.querySelector('[aria-modal=true]'));"), false, "Connection recovery must retain the visible game without a joining modal");
    assert.equal(await evaluate(page, "return retainedRoomCanvas===document.querySelector('#game-canvas');"), true);
    assert.equal(await evaluate(page, "return roomFlowState.playerId===retainedRoomSeat;"), true);
    await waitFor(page, "roomFlowSnapshot.started===false && roomFlowState.phase!=='playing'");
    assert.equal(await evaluate(page, "return roomFlowSnapshot.started;"), false, "Controls stay paused until the server resumes");
    assert.ok(await evaluate(page, "const bounds=document.querySelector('[data-platform-room-recovery]').getBoundingClientRect();const toolbarBounds=document.querySelector('[aria-label=\"Game session controls\"]').getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=toolbarBounds.bottom&&bounds.bottom<=innerHeight;"), "Recovery notice fits the host viewport and clears the toolbar");
  }
  await capture(invitee, `${gameId}-connection-recovery`);
  for (const page of [creator, invitee]) {
    await waitFor(page, "roomFlowState.phase==='playing'&&!document.querySelector('[data-platform-room-recovery]')", 15000);
    assert.equal(await evaluate(page, "return roomFlowProbe.phases.includes('connecting');"), false, "An existing match cannot return to initial joining");
    assert.equal(await evaluate(page, "return roomFlowProbe.goSeen;"), false, "Resuming a match does not announce a new game");
    assert.equal(await evaluate(page, "return retainedRoomCanvas===document.querySelector('#game-canvas');"), true);
  }
  console.log("DUPLICATE JOIN / TRANSPORT LOSS / RETAINED SEATS AND CANVAS / AUTOMATIC RECOVERY PASSED", gameId);
}

try {
  for (const gameId of (process.env.PLATFORM_ROOM_TEST_GAMES || "sky-dash,pong").split(",")) {
    const creator = await newPage(baseUrl, 1440, 900, false, createEntryObserver());
    inspectedPages.push(creator);
    await waitFor(creator, `document.querySelector('[data-library-card-id="${gameId}"]')`);
    await evaluate(creator, `document.querySelector('[data-library-card-id="${gameId}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
    await attachSnapshots(creator, gameId);
    await waitFor(creator, "document.querySelector('[role=\"dialog\"][aria-label=\"Invite players\"]')");
    const roomUrl = await evaluate(creator, "window.initialRoomCanvas=document.querySelector('#game-canvas');return location.href;");
    assert.equal(await evaluate(creator, "return roomFlowState.phase==='playing';"), false);
    const phoneInvitee = gameId === "sky-dash";
    const invitee = await newPage(roomUrl, phoneInvitee ? 390 : 1440, phoneInvitee ? 844 : 900, phoneInvitee, createEntryObserver(6 * 60 * 60 * 1000));
    inspectedPages.push(invitee);
    await attachSnapshots(invitee, gameId);
    await waitFor(creator, "roomFlowProbe.digits.length>0");
    await waitFor(invitee, "roomFlowProbe.digits.length>0");
    if (!delayedDelivery) await waitFor(creator, "roomFlowProbe.digits.includes(3)");
    await capture(creator, `${gameId}-creator-countdown`);
    await capture(invitee, `${gameId}-invitee-countdown`);
    assert.ok(await evaluate(invitee, "return Boolean(document.activeElement.closest('[aria-label=\"Game starting\"]'));"), "Countdown keeps focus inside its platform dialog");
    assert.ok(await evaluate(invitee, "return document.documentElement.scrollWidth<=innerWidth+1;"), "Countdown fits the available viewport");
    assert.equal(await evaluate(invitee, "return roomFlowProbe.inviteSeen;"), false, "Shared link recipient must never see an automatic invite dialog");
    assert.equal(await evaluate(creator, "return Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Invite players\"]'));"), false, "Creator invite closes automatically when room becomes ready");
    assert.equal(await evaluate(creator, "return roomFlowState.phase==='playing';"), false, "Gameplay remains stopped during countdown");
    await waitFor(creator, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    await waitFor(invitee, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    for (const page of [creator, invitee]) assertRoomCountdown(await evaluate(page, "return roomFlowProbe.digits;"));
    assert.ok(await evaluate(creator, "return initialRoomCanvas===document.querySelector('#game-canvas');"), "Countdown must retain the renderer canvas");
    await capture(creator, `${gameId}-go`);
    console.log("CREATOR/INVITEE, AUTHORITATIVE COUNTDOWN, SIX-HOUR CLOCK SKEW AND GO PASSED", gameId);
    await verifyActiveRoomRecovery(creator, invitee, gameId);

    const extraPlayer = await newPage(roomUrl, 1100, 750, false, createEntryObserver());
    inspectedPages.push(extraPlayer);
    await waitFor(extraPlayer, "document.querySelector('[aria-label=\"Unable to join room\"]')?.textContent.includes('Room is full')", 30000);
    assert.equal(await evaluate(extraPlayer, "return roomFlowProbe.inviteSeen;"), false);
    await capture(extraPlayer, `${gameId}-room-full`);
    await send("Page.navigate", { url: "about:blank" }, extraPlayer);
    console.log("FULL ROOM ERROR REPLACES JOINING STATUS PASSED", gameId);
    const previousDeadline = await evaluate(creator, "return roomFlowState.startAtMs;");
    await send("Page.reload", {}, invitee);
    await attachSnapshots(invitee, gameId);
    await waitFor(creator, `roomFlowState.phase==='countdown'&&roomFlowState.startAtMs!==${previousDeadline}`);
    await waitFor(invitee, "roomFlowProbe.digits.length>0");
    assert.equal(await evaluate(invitee, "return roomFlowProbe.inviteSeen;"), false);
    assert.equal(await evaluate(creator, "return Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Invite players\"]'));"), false, "Reconnect does not reopen the creator's invite");
    await waitFor(creator, "roomFlowState.phase==='playing'", 12000);
    await waitFor(invitee, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    assertRoomCountdown(await evaluate(invitee, "return roomFlowProbe.digits;"));
    console.log("SEAT-PRESERVING RELOAD AND FRESH COUNTDOWN PASSED", gameId);
    await send("Page.navigate", { url: "about:blank" }, creator);
    await send("Page.navigate", { url: "about:blank" }, invitee);
    await delay(100);
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("PLATFORM ROOM START BROWSER CHECKS PASSED");
} catch (error) {
  for (const [index, page] of inspectedPages.entries()) {
    await capture(page, `failure-${index}`).catch(() => {});
    console.error("PAGE DIAGNOSTIC", await evaluate(page, "return{url:location.href,kaboom:typeof window.kaboom,room:window.roomFlowState,hasSnapshot:Boolean(window.roomFlowSnapshot),phases:window.roomFlowProbe?.phases.slice(-12),body:document.body?.innerText.slice(-1000),scripts:[...document.scripts].map(script=>script.src)};").catch(() => null));
  }
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
