import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3100";
const browser = await createBrowserTestSession("game-orientation");
const { send, evaluate, waitFor, newPage, capture, clickText } = browser;

async function openTouchPage(url, orientationApi = "unsupported", landscape = false) {
  const page = await newPage("about:blank", landscape ? 844 : 390, landscape ? 390 : 844, true);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, page);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.orientationProbe={locks:[],unlocks:0,fullscreen:0,newRooms:0};
    const capability=${JSON.stringify(orientationApi)};
    Object.defineProperty(screen.orientation,'lock',{configurable:true,value:capability==='unsupported'?undefined:async mode=>{orientationProbe.locks.push(mode);if(capability==='denied')throw new DOMException('Rotation blocked','NotSupportedError');if(capability==='pending'&&orientationProbe.locks.length===1)await new Promise(resolve=>{window.finishAutomaticOrientation=resolve})}});
    Object.defineProperty(screen.orientation,'unlock',{configurable:true,value:()=>{orientationProbe.unlocks++}});
    Element.prototype.requestFullscreen=()=>{orientationProbe.fullscreen++;return Promise.reject(new DOMException('Fullscreen blocked','NotAllowedError'))};
    const originalFetch=window.fetch.bind(window);
    window.fetch=(request,options)=>{if(String(request).includes('/new-room'))orientationProbe.newRooms++;return originalFetch(request,options)};
  ` }, page);
  await send("Page.navigate", { url }, page);
  return page;
}

async function subscribeToRoom(page, gameId) {
  await evaluate(page, `const {subscribeRoomLifecycle}=await import('/platform/frontend-engine/roomLifecycleBridge.js');window.orientationRoom=null;subscribeRoomLifecycle(${JSON.stringify(gameId)},state=>orientationRoom=state);`);
}

async function rotateToLandscape(page) {
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, page);
}

/** Fullscreen needs a trusted pointer gesture; DOM click() has no user activation. */
async function requestLandscapeFullscreen(page) {
  const buttonPoint = await evaluate(page, `
    const fullscreenButton = [...document.querySelectorAll('[aria-label="Landscape game startup"] button')]
      .find(button => button.textContent.trim() === "Use landscape fullscreen");
    const bounds = fullscreenButton.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  `);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...buttonPoint }, page);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...buttonPoint }, page);
}

try {
  for (const fixture of [{ gameId: "riftball", capability: "unsupported" }, { gameId: "pong", capability: "denied" }]) {
    let url = `${baseUrl}/games/${fixture.gameId}`;
    if (fixture.gameId === "pong") {
      const roomResponse = await fetch(`${baseUrl}/api/games/pong/new-room`);
      const room = await roomResponse.json();
      url += `/${room.roomId}`;
    }
    const page = await openTouchPage(fixture.gameId === "riftball" ? baseUrl : url, fixture.capability);
    if (fixture.gameId === "riftball") {
      await waitFor(page, "document.querySelector('[data-library-card-id=riftball]')");
      await evaluate(page, "document.querySelector('[data-library-card-id=riftball]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
    }
    await waitFor(page, "document.querySelector('[aria-label=\"Landscape game startup\"]')");
    await delay(250);
    assert.equal(await evaluate(page, "return matchMedia('(any-pointer:coarse)').matches;"), true);
    assert.equal(await evaluate(page, "return document.querySelectorAll('script[id^=game-runtime-]').length;"), 0, "Portrait startup must wait before loading a runtime");
    assert.equal(await evaluate(page, "return orientationProbe.newRooms;"), 0, "No room is created before landscape startup");
    assert.equal(await evaluate(page, "return orientationProbe.fullscreen;"), 0, "Portrait startup waits for rotation or a labeled fullscreen action");
    await capture(page, `${fixture.gameId}-portrait-start`);
    if (fixture.capability === "denied") {
      await requestLandscapeFullscreen(page);
      await waitFor(page, "document.querySelector('[aria-label=\"Landscape game startup\"]').textContent.includes('Automatic rotation isn’t available')");
      assert.equal(await evaluate(page, "return orientationProbe.fullscreen;"), 1);
    }
    await subscribeToRoom(page, fixture.gameId);
    await rotateToLandscape(page);
    await waitFor(page, "!document.querySelector('[aria-label=\"Landscape game startup\"]')&&orientationRoom?.joined", 30000);
    const roomUrl = await evaluate(page, "return location.href;");
    const partner = await openTouchPage(roomUrl, "unsupported", true);
    await subscribeToRoom(partner, fixture.gameId);
    await waitFor(page, "orientationRoom?.phase==='playing'", 15000);
    await waitFor(partner, "orientationRoom?.phase==='playing'", 15000);
    await capture(page, `${fixture.gameId}-landscape-playing`);
    await evaluate(page, "window.initialOrientationCanvas=document.querySelector('#game-canvas');window.initialRuntimeScript=document.querySelector('script[id^=game-runtime-]');");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page);
    await delay(250);
    assert.ok(await evaluate(page, "return !document.querySelector('[aria-label=\"Landscape game startup\"]')&&initialOrientationCanvas===document.querySelector('#game-canvas')&&initialRuntimeScript===document.querySelector('script[id^=game-runtime-]');"), "Later rotation keeps the loaded game and canvas");
    assert.equal(await evaluate(page, "return orientationRoom.phase;"), "playing");
    console.log("LANDSCAPE STARTUP / ROTATION FALLBACK / ROOM JOIN / RUNTIME CONTINUITY PASSED", fixture.gameId);
    await send("Page.navigate", { url: "about:blank" }, page);
    await send("Page.navigate", { url: "about:blank" }, partner);
  }

  const lockedPage = await openTouchPage(`${baseUrl}/games/pong`, "locked");
  await waitFor(lockedPage, "document.querySelector('[aria-label=\"Landscape game startup\"]')");
  assert.ok(await evaluate(lockedPage, "return orientationProbe.locks.includes('landscape');"));
  assert.equal(await evaluate(lockedPage, "return document.querySelectorAll('script[id^=game-runtime-]').length;"), 0, "A claimed API lock still waits for an actual landscape viewport");
  await clickText(lockedPage, "Back to library");
  await waitFor(lockedPage, "document.querySelector('[data-library-card-id=pong]')");
  assert.ok(await evaluate(lockedPage, "return orientationProbe.unlocks>0;"));
  const pendingPage = await openTouchPage(`${baseUrl}/games/pong`, "pending");
  await waitFor(pendingPage, "document.querySelector('[aria-label=\"Landscape game startup\"]')&&orientationProbe.locks.length===1");
  await requestLandscapeFullscreen(pendingPage);
  await waitFor(pendingPage, "orientationProbe.fullscreen===1&&orientationProbe.locks.length===2");
  await evaluate(pendingPage, "finishAutomaticOrientation();");
  assert.equal(await evaluate(pendingPage, "return orientationProbe.newRooms;"), 0);
  await clickText(pendingPage, "Back to library");
  await waitFor(pendingPage, "document.querySelector('[data-library-card-id=pong]')");
  assert.ok(await evaluate(pendingPage, "return orientationProbe.unlocks>0;"));
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("ORIENTATION LOCK CLEANUP / BROWSER CHECKS PASSED");
} catch (error) {
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
