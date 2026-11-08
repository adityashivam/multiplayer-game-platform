import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const browser = await createBrowserTestSession("room-start");
const { newPage, evaluate, waitFor, capture, send } = browser;
const inspectedPages = [];

function createEntryObserver(clockSkewMs = 0) {
  return `
    const realDateNow=Date.now.bind(Date);Date.now=()=>realDateNow()+${clockSkewMs};
    window.roomFlowProbe={inviteSeen:false,digits:[],goSeen:false};
    new MutationObserver(()=>{
      const probe=roomFlowProbe;
      if(document.querySelector('[aria-label="Invite players"]'))probe.inviteSeen=true;
      const digit=document.querySelector('[data-platform-room-start=countdown] [role=timer] strong')?.textContent;
      if(/^[1-5]$/.test(digit||'')&&probe.digits.at(-1)!==Number(digit))probe.digits.push(Number(digit));
      if(document.querySelector('[data-platform-room-go]'))probe.goSeen=true;
    }).observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label']});
  `;
}

async function attachSnapshots(sessionId, gameId) {
  await waitFor(sessionId, "document.querySelector('#game-canvas')", 30000);
  await evaluate(sessionId, `const {subscribeRoomLifecycle}=await import('/platform/frontend-engine/roomLifecycleBridge.js');window.roomFlowState=null;subscribeRoomLifecycle(${JSON.stringify(gameId)},state=>roomFlowState=state);`);
  await waitFor(sessionId, "roomFlowState?.joined&&roomFlowState.phase!=='connecting'");
}

try {
  for (const gameId of (process.env.PLATFORM_ROOM_TEST_GAMES || "sky-dash,pong").split(",")) {
    const creator = await newPage(baseUrl, 1440, 900, false, createEntryObserver());
    inspectedPages.push(creator);
    await waitFor(creator, `document.querySelector('[data-library-card-id="${gameId}"]')`);
    await evaluate(creator, `document.querySelector('[data-library-card-id="${gameId}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
    await attachSnapshots(creator, gameId);
    await waitFor(creator, "document.querySelector('[aria-label=\"Invite players\"]')");
    const roomUrl = await evaluate(creator, "window.initialRoomCanvas=document.querySelector('#game-canvas');return location.href;");
    assert.equal(await evaluate(creator, "return roomFlowState.phase==='playing';"), false);
    const phoneInvitee = gameId === "sky-dash";
    const invitee = await newPage(roomUrl, phoneInvitee ? 390 : 1440, phoneInvitee ? 844 : 900, phoneInvitee, createEntryObserver(6 * 60 * 60 * 1000));
    inspectedPages.push(invitee);
    await attachSnapshots(invitee, gameId);
    await waitFor(creator, "roomFlowProbe.digits.includes(5)");
    await waitFor(invitee, "roomFlowProbe.digits.includes(5)");
    await waitFor(creator, "roomFlowProbe.digits.includes(3)");
    await capture(creator, `${gameId}-creator-countdown`);
    await capture(invitee, `${gameId}-invitee-countdown`);
    assert.ok(await evaluate(invitee, "return Boolean(document.activeElement.closest('[aria-label=\"Game starting\"]'));"), "Countdown keeps focus inside its platform dialog");
    assert.ok(await evaluate(invitee, "return document.documentElement.scrollWidth<=innerWidth+1;"), "Countdown fits the available viewport");
    assert.equal(await evaluate(invitee, "return roomFlowProbe.inviteSeen;"), false, "Shared link recipient must never see an automatic invite dialog");
    assert.equal(await evaluate(creator, "return Boolean(document.querySelector('[aria-label=\"Invite players\"]'));"), false, "Creator invite closes automatically when room becomes ready");
    assert.equal(await evaluate(creator, "return roomFlowState.phase==='playing';"), false, "Gameplay remains stopped during countdown");
    await waitFor(creator, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    await waitFor(invitee, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    for (const page of [creator, invitee]) assert.deepEqual(await evaluate(page, "return roomFlowProbe.digits;"), [5, 4, 3, 2, 1]);
    assert.ok(await evaluate(creator, "return initialRoomCanvas===document.querySelector('#game-canvas');"), "Countdown must retain the renderer canvas");
    await capture(creator, `${gameId}-go`);
    console.log("CREATOR/INVITEE, SYNCHRONIZED FIVE DIGITS, SIX-HOUR CLOCK SKEW AND GO PASSED", gameId);

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
    await waitFor(invitee, "roomFlowProbe.digits.includes(5)");
    assert.equal(await evaluate(invitee, "return roomFlowProbe.inviteSeen;"), false);
    assert.equal(await evaluate(creator, "return Boolean(document.querySelector('[aria-label=\"Invite players\"]'));"), false, "Reconnect does not reopen the creator's invite");
    await waitFor(creator, "roomFlowState.phase==='playing'", 12000);
    await waitFor(invitee, "roomFlowState.phase==='playing'&&roomFlowProbe.goSeen", 12000);
    assert.deepEqual(await evaluate(invitee, "return roomFlowProbe.digits;"), [5, 4, 3, 2, 1]);
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
    console.error("PAGE DIAGNOSTIC", await evaluate(page, "return{url:location.href,kaboom:typeof window.kaboom,body:document.body?.innerText.slice(-1000),scripts:[...document.scripts].map(script=>script.src)};").catch(() => null));
  }
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
