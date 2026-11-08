import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const browser = await createBrowserTestSession("game-presentation");
const { evaluate, waitFor, newPage, send, click, clickText, capture } = browser;
const pages = [];
const nativeProbeScript = `
  window.presentationProbe={requests:[]};
  const nativeRequest=Element.prototype.requestFullscreen;
  if(nativeRequest)Element.prototype.requestFullscreen=function(...options){
    presentationProbe.requests.push({path:location.pathname,activated:navigator.userActivation?.isActive});
    return nativeRequest.apply(this,options);
  };
`;

async function verifyExpanded(page) {
  await waitFor(page, "document.querySelector('[data-platform-presentation=expanded]')");
  const bounds = await evaluate(page, `
    const root=document.querySelector('[data-platform-presentation]');
    const r=root.getBoundingClientRect();
    const controller=[...root.querySelectorAll('[data-dir]')].find(element=>element.getBoundingClientRect().width>0);
    return{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,controllerVisible:Boolean(controller)};
  `);
  assert.ok(Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1);
  assert.ok(Math.abs(bounds.width - bounds.viewportWidth) < 2 && Math.abs(bounds.height - bounds.viewportHeight) < 2);
  assert.equal(bounds.controllerVisible, false, "the outer console's controllers are hidden");
}

async function returnToLibrary(page) {
  await evaluate(page, "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
  const hitTarget = await evaluate(page, `const button=document.querySelector('[aria-label="Leave game"]');const r=button.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{disabled:button.disabled,hit:target?.closest('[aria-label="Leave game"]')===button,target:target?.outerHTML.slice(0,200)};`);
  assert.equal(hitTarget.disabled, false);
  assert.equal(hitTarget.hit, true, JSON.stringify(hitTarget));
  await click(page, '[aria-label="Leave game"]');
  await waitFor(page, "document.querySelector('[aria-label=\"Exit game confirmation\"]')");
  await clickText(page, "Go to Home");
  await waitFor(page, "location.pathname==='/'&&document.querySelector('[data-platform-presentation=console]')");
  assert.equal(await evaluate(page, "return Boolean(document.fullscreenElement)||document.documentElement.hasAttribute('data-pseudo-fullscreen');"), false);
}

async function launchFromLibrary(page, gameId) {
  await waitFor(page, `document.querySelector('[data-library-card-id="${gameId}"]')`);
  await evaluate(page, `document.querySelector('[data-library-card-id="${gameId}"]').focus();`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await waitFor(page, `location.pathname.startsWith('/games/${gameId}')`);
}

async function openTouchGame(game, roomId) {
  const page = await newPage("about:blank", 844, 390, true, nativeProbeScript);
  pages.push(page);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, page);
  if (game.id === "pong") {
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `if(location.origin===${JSON.stringify(new URL(baseUrl).origin)})localStorage.setItem('platform.touch-controls.v1:pong:landscape',JSON.stringify({version:1,presetId:'two-thumb',mode:'off',hideShell:false,layouts:{'two-thumb':{paddle:{x:0.21,y:0.74,size:108,opacity:0.9}}}}));` }, page);
  }
  const gamePath = roomId ? `/games/${game.id}/${roomId}` : game.path;
  await send("Page.navigate", { url: baseUrl + gamePath }, page);
  await verifyExpanded(page);
  await waitFor(page, `document.querySelector('[data-platform-touch-game="${game.id}"]')`, 30000);
  await evaluate(page, "window.presentationCanvas=document.querySelector('#game-canvas');");
  if (roomId) {
    await evaluate(page, `const {subscribeRoomLifecycle}=await import('/platform/frontend-engine/roomLifecycleBridge.js');subscribeRoomLifecycle(${JSON.stringify(game.id)},room=>{window.presentationRoom=room;window.presentationPlayerId=room.playerId});`);
    await waitFor(page, "presentationRoom?.joined&&presentationPlayerId", 30000);
  }
  return page;
}

async function attachAuthority(page, gameId) {
  await evaluate(page, `
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.presentationSocket=getGameSocket(${JSON.stringify(gameId)});
    window.presentationState=null;
    presentationSocket.onEvent('state',state=>presentationState=state);
  `);
  await waitFor(page, "presentationState");
  if (gameId !== "draw") await waitFor(page, "presentationState.players[presentationPlayerId].inputSeqAck>5");
}

async function controlPoint(page, selector, id) {
  return evaluate(page, `const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{id:${id},x:r.x+r.width/2,y:r.y+r.height/2,radiusX:2,radiusY:2,force:1};`);
}

try {
  const desktop = await newPage(baseUrl, 1440, 900, false, nativeProbeScript);
  pages.push(desktop);
  await launchFromLibrary(desktop, "webgl-sample");
  await verifyExpanded(desktop);
  await waitFor(desktop, "document.fullscreenElement&&document.querySelector('#game-canvas')", 15000);
  await waitFor(desktop, "[...document.querySelectorAll('#game-root button')].some(button=>button.textContent==='Start Run')");
  const requests = await evaluate(desktop, "return presentationProbe.requests;");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].activated, true);
  assert.equal(requests[0].path, "/", "fullscreen is requested before navigation consumes the gesture");
  await evaluate(desktop, "window.presentationCanvas=document.querySelector('#game-canvas');");
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 }, desktop);
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27 }, desktop);
  // Headless CDP routes keys to the page, not Chrome's own Escape shortcut.
  // Native exit produces the same browser fullscreenchange as an external exit.
  await evaluate(desktop, "if(document.fullscreenElement)await document.exitFullscreen();");
  await waitFor(desktop, "!document.fullscreenElement");
  await verifyExpanded(desktop);
  assert.equal(await evaluate(desktop, "return presentationCanvas===document.querySelector('#game-canvas')&&presentationProbe.requests.length===1;"), true);
  await evaluate(desktop, `const gameOverlay=document.createElement('div');gameOverlay.dataset.testGameOverlay='';Object.assign(gameOverlay.style,{position:'absolute',inset:'0',zIndex:'2147483647',pointerEvents:'auto'});document.querySelector('#game-root').appendChild(gameOverlay);`);
  await returnToLibrary(desktop);
  console.log("NATIVE FULLSCREEN PLAY, EXTERNAL EXIT AND LIBRARY RESTORATION PASSED");

  const denied = await newPage(baseUrl, 1440, 900, false, "Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));");
  pages.push(denied);
  await launchFromLibrary(denied, "webgl-sample");
  await verifyExpanded(denied);
  await waitFor(denied, "document.documentElement.dataset.pseudoFullscreen==='true'");
  await waitFor(denied, "[...document.querySelectorAll('#game-root button')].some(button=>button.textContent==='Start Run')");
  await returnToLibrary(denied);
  console.log("DENIED FULLSCREEN FALLBACK PASSED");

  const catalogResponse = await fetch(`${baseUrl}/api/games`);
  const { games } = await catalogResponse.json();
  const selectedGameIds = process.env.PLATFORM_PRESENTATION_GAMES?.split(",");
  const selectedGames = selectedGameIds ? games.filter((game) => selectedGameIds.includes(game.id)) : games;
  for (const game of selectedGames) {
    assert.ok(game.touchControls?.controls.length, `${game.id} declares its usable touch controls`);
    let roomId = null;
    if (game.networked !== false) {
      const roomResponse = await fetch(`${baseUrl}/api/games/${game.id}/new-room`);
      roomId = (await roomResponse.json()).roomId;
    }
    const player = await openTouchGame(game, roomId);
    let opponent = null;
    if (roomId) {
      opponent = await newPage(`${baseUrl}/games/${game.id}/${roomId}`);
      pages.push(opponent);
      await waitFor(player, "!document.querySelector('[aria-modal=true]')&&document.querySelector('[data-platform-touch-game][data-disabled=false]')", 25000);
      await attachAuthority(player, game.id);
    }
    const controls = await evaluate(player, `return [...document.querySelectorAll('[data-platform-touch-game] button[data-touch-control-id]')].map(button=>({id:button.dataset.touchControlId,type:button.dataset.controlType,opacity:Number(getComputedStyle(button.querySelector('[aria-hidden=true]')).opacity),width:button.getBoundingClientRect().width}));`);
    assert.ok(controls.length > 0 && controls.every((control) => control.width >= 40 && control.opacity > 0 && control.opacity <= 0.45), `${game.id} controls remain visible and translucent`);
    if (game.id === "pong") {
      const migrated = await evaluate(player, `const {loadTouchProfile}=await import('/platform/frontend-engine/touchControlSettings.js');const {game}=await (await fetch('/api/games/pong')).json();return loadTouchProfile('pong',game.touchControls,'landscape');`);
      assert.equal(migrated.version, 2);
      assert.equal(migrated.hideShell, true);
      assert.equal(migrated.mode, "auto");
      assert.equal(migrated.layouts["two-thumb"].paddle.x, 0.21);
      assert.equal(migrated.layouts["two-thumb"].paddle.size, 108);
      assert.equal(migrated.layouts["two-thumb"].paddle.opacity, 0.4);
    }
    assert.equal(await evaluate(player, "return presentationProbe.requests.length;"), 0, "shared links do not request native fullscreen without a Play gesture");
    const move = game.touchControls.controls.find((control) => control.type === "stick");
    const primary = game.touchControls.controls.find((control) => control.type === "button" && control.role === "primary");
    if (move && game.networked !== false) {
      await evaluate(player, `window.presentationInputs=[];window.addEventListener('platformvirtualgamecontrol',event=>presentationInputs.push(event.detail));`);
      const initial = await evaluate(player, "const p=presentationState.players[presentationPlayerId];return{x:p.x,y:p.y,z:p.z,progress:p.progress,inputSeqAck:p.inputSeqAck};");
      const stick = await controlPoint(player, `[data-platform-touch-game] [data-touch-control-id="${move.id}"]`, 1);
      const movedStick = { ...stick, x: stick.x + (move.platformBinding === "vertical" ? 0 : 35), y: stick.y + (move.platformBinding === "vertical" ? 35 : -15) };
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [stick] }, player);
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [movedStick] }, player);
      if (primary) {
        const action = await controlPoint(player, `[data-platform-touch-game] [data-touch-control-id="${primary.id}"]`, 2);
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [movedStick, action] }, player);
      }
      await delay(500);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, player);
      await delay(350);
      const current = await evaluate(player, "const p=presentationState.players[presentationPlayerId];return{x:p.x,y:p.y,z:p.z,progress:p.progress,inputSeqAck:p.inputSeqAck};");
      console.log("TOUCH MOVEMENT", game.id, { initial, current, virtual: await evaluate(player, "return presentationInputs;") });
      const displacement = Math.hypot(...["x", "y", "z", "progress"].map((field) => Number.isFinite(initial[field]) && Number.isFinite(current[field]) ? current[field] - initial[field] : 0));
      assert.ok(displacement > 0.05, `${game.id} touch movement reaches authority while holding an action`);
      assert.ok(current.inputSeqAck > initial.inputSeqAck);
    }
    if (game.id === "draw") {
      const clear = game.touchControls.controls.find((control) => control.type === "button");
      const point = await controlPoint(player, `[data-platform-touch-game] [data-touch-control-id="${clear.id}"]`, 1);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }, player);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, player);
      await waitFor(player, "presentationState.clearVersion>0");
    }
    if (game.id === "webgl-sample") {
      await waitFor(player, "[...document.querySelectorAll('#game-root button')].some(button=>button.textContent==='Start Run'&&button.getBoundingClientRect().width>0)");
      const playPoint = await controlPoint(player, '[data-platform-touch-game] [data-touch-control-id="play"]', 1);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [playPoint] }, player);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, player);
      await waitFor(player, "![...document.querySelectorAll('#game-root button')].some(button=>button.textContent==='Start Run'&&button.getBoundingClientRect().width>0)");
    }
    if (game.id === "mario-touch") assert.equal(await evaluate(player, "return [...document.querySelectorAll('button')].some(button=>button.textContent==='RUN'&&button.getBoundingClientRect().width>0);"), false, "legacy Mario controls do not duplicate the SDK layout");
    assert.equal(await evaluate(player, "return presentationCanvas===document.querySelector('#game-canvas')&&presentationCanvas.isConnected;"), true);
    await capture(player, game.id);
    console.log("EXPANDED TOUCH GAME PASSED", game.id, controls.map(({ id, opacity }) => ({ id, opacity })));
    for (const page of [player, opponent].filter(Boolean)) await send("Page.navigate", { url: "about:blank" }, page);
  }
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("GAME PRESENTATION CHECKS PASSED", { touchGames: selectedGames.length });
} catch (error) {
  for (const [index, page] of pages.entries()) {
    console.error("PRESENTATION PAGE", index, await evaluate(page, "return{url:location.href,fullscreen:Boolean(document.fullscreenElement),body:document.body?.innerText.slice(-700)};").catch(() => null));
    await capture(page, `failure-${index}`).catch(() => {});
  }
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
