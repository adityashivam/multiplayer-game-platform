import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const chromeExecutable = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(path.join(tmpdir(), "kaboom-touch-editor-chrome-"));
const chrome = spawn(chromeExecutable, [
  "--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const chromeClosed = new Promise((resolve) => {
  chrome.once("exit", resolve);
  chrome.once("error", resolve);
});
const pending = new Map();
const exceptions = [];
const failures = [];
let nextId = 0;
let received = "";
chrome.stdio[4].on("data", (chunk) => {
  received += chunk.toString();
  let end;
  while ((end = received.indexOf("\0")) >= 0) {
    const raw = received.slice(0, end);
    received = received.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const job = pending.get(message.id);
      if (!job) continue;
      pending.delete(message.id);
      clearTimeout(job.timer);
      message.error ? job.reject(Error(JSON.stringify(message.error))) : job.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    else if (message.method === "Network.loadingFailed" && !message.params.canceled) failures.push(message.params);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
}
async function evaluate(id, source) {
  const evaluated = await send("Runtime.evaluate", { expression: `(async()=>{${source}})()`, awaitPromise: true, returnByValue: true }, id);
  if (evaluated.exceptionDetails) throw Error(JSON.stringify(evaluated.exceptionDetails));
  return evaluated.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(id, expression, timeoutMs = 20000) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    if (await evaluate(id, `return Boolean(${expression});`)) return;
    await sleep(90);
  }
  throw Error(`Timed out: ${expression}`);
}
async function newPage(url, width = 1440, height = 900, mobile = false) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank", newWindow: true });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  await send("Page.navigate", { url }, sessionId);
  return sessionId;
}
async function capture(id, name) {
  const screenshot = await send("Page.captureScreenshot", { format: "png" }, id);
  await writeFile(path.join(tmpdir(), `touch-layout-${name}.png`), Buffer.from(screenshot.data, "base64"));
}
async function click(id, selector) {
  const point = await evaluate(id, `const bounds=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point }, id);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }, id);
}
async function key(id, code, key, active) {
  const keyCodes = { KeyW: 87, KeyA: 65, KeyD: 68, KeyS: 83, Space: 32, KeyR: 82, Escape: 27 };
  await send("Input.dispatchKeyEvent", { type: active ? "keyDown" : "keyUp", code, key, windowsVirtualKeyCode: keyCodes[code] || 0 }, id);
}

async function clickText(id, label, scope = "document") {
  await evaluate(id, `const button=[...${scope}.querySelectorAll('button')].find(button=>{const copy=button.cloneNode(true);copy.querySelectorAll('[aria-hidden=true]').forEach(icon=>icon.remove());return copy.textContent.trim()===${JSON.stringify(label)}&&button.getBoundingClientRect().width>0});if(!button)throw Error('Missing button '+${JSON.stringify(label)});button.click();`);
}
async function setRange(id, selector, value) {
  await evaluate(id, `const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));`);
}
async function readProfile(id, orientation = "landscape") {
  return evaluate(id, `const {loadTouchProfile}=await import('/platform/frontend-engine/touchControlSettings.js');const response=await fetch('/api/games/dead-shift');const {game}=await response.json();return loadTouchProfile('dead-shift',game.touchControls,${JSON.stringify(orientation)});`);
}

async function selectLivePreset(id, presetId) {
  await click(id, '[aria-label="Customize touch controls"]');
  await waitFor(id, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  await evaluate(id, `
    const select=[...document.querySelectorAll('[role=dialog] select')].find(select=>[...select.options].some(option=>option.value===${JSON.stringify(presetId)}));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(presetId)});
    select.dispatchEvent(new Event('change',{bubbles:true}));
  `);
  await clickText(id, "Save");
  await waitFor(id, "!document.querySelector('[aria-modal=true]')&&document.querySelector('[data-platform-touch-game][data-active=true]')");
}

async function verifyThumbPreset(id, presetId, fingers) {
  await selectLivePreset(id, presetId);
  await waitFor(id, "touchProbe.last.players.p1.health>0");
  const points = await evaluate(id, `
    function point(controlId,id){const b=document.querySelector('[data-platform-touch-game] [data-touch-control-id="'+controlId+'"]').getBoundingClientRect();return{id,x:b.x+b.width/2,y:b.y+b.height/2,radiusX:2,radiusY:2,force:1};}
    return{move:point('move',1),fire:point('fire',2),look:{id:3,x:610,y:310,radiusX:2,radiusY:2,force:1}};
  `);
  const startPoints = fingers === 2 ? [points.move, points.fire] : Object.values(points);
  const movePoints = fingers === 2
    ? [{ ...points.move, x: points.move.x + 30 }, { ...points.fire, x: points.fire.x + 35, y: points.fire.y - 10 }]
    : [{ ...points.move, x: points.move.x + 30 }, points.fire, { ...points.look, x: points.look.x + 35, y: points.look.y - 10 }];
  const before = await evaluate(id, "return {...touchProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: startPoints }, id);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: movePoints }, id);
  await sleep(350);
  const during = await evaluate(id, "return {...touchProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, id);
  await sleep(150);
  assert.ok(during.shotId > before.shotId, `${presetId} must fire`);
  assert.ok(Math.hypot(during.x-before.x,during.z-before.z) > 0.2, `${presetId} must move while firing`);
  assert.ok(Math.abs(during.yaw-before.yaw) > 0.08, `${presetId} must aim while firing`);
  console.log(`${fingers}-FINGER MOVEMENT, AIM AND FIRE PASSED`);
}

try {
  const p1 = await newPage(baseUrl, 1600, 1000);
  await waitFor(p1, "document.querySelector('[aria-label=Config]')");
  await click(p1, "[aria-label=Config]");
  await waitFor(p1, "document.querySelector('[aria-labelledby=touch-settings-title]')?.textContent.includes('Dead Shift')&&document.querySelector('[aria-label=\"Choose game for touch controls\"]')");
  await sleep(300);
  await capture(p1, "touch-settings-desktop");
  console.log("CONFIG READY", await evaluate(p1, "return document.querySelector('[aria-labelledby=touch-settings-title]').innerText;"));
  await click(p1, "[aria-label=\"Choose game for touch controls\"]");
  await waitFor(p1, "document.querySelector('[aria-label=\"Choose a game for touch controls\"]')?.textContent.includes('Dead Shift')");
  const pickerText = await evaluate(p1, "return document.querySelector('[aria-label=\"Choose a game for touch controls\"]').innerText;");
  assert.ok(!pickerText.includes("Kaboom Pong"), "Games without developer opt-in must not appear");
  await key(p1, "Escape", "Escape", true); await key(p1, "Escape", "Escape", false);
  await clickText(p1, "Edit layout");
  await waitFor(p1, "[...document.querySelectorAll('[role=dialog]')].some(dialog=>dialog.textContent.includes('Edit controls'))");
  await capture(p1, "touch-editor-desktop");
  const fireButton = await evaluate(p1, "const button=[...document.querySelectorAll('[role=dialog] button')].find(button=>button.getAttribute('aria-label')?.startsWith('Fire,'));if(!button)throw Error('Missing editable fire');button.focus();const b=button.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...fireButton }, p1);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: fireButton.x - 60, y: fireButton.y - 40 }, p1);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: fireButton.x - 60, y: fireButton.y - 40 }, p1);
  await setRange(p1, 'input[aria-label="Fire size"]', 92);
  await setRange(p1, 'input[aria-label="Fire opacity"]', 0.55);
  await capture(p1, "touch-editor-selected");
  await clickText(p1, "Save");
  await waitFor(p1, "!document.querySelector('[role=dialog]')");
  const saved = await readProfile(p1);
  console.log("SAVED PROFILE", saved);
  assert.equal(saved.layouts[saved.presetId].fire.size, 92);
  assert.equal(saved.layouts[saved.presetId].fire.opacity, 0.55);
  assert.ok(saved.layouts[saved.presetId].fire.x < 0.8);
  await clickText(p1, "Edit layout");
  await evaluate(p1, "[...document.querySelectorAll('[role=dialog] button')].find(button=>button.getAttribute('aria-label')?.startsWith('Fire,')).click();");
  await setRange(p1, 'input[aria-label="Fire size"]', 120);
  await clickText(p1, "Cancel");
  assert.deepEqual(await readProfile(p1), saved, "Cancel must discard the draft");
  await send("Page.reload", {}, p1);
  await waitFor(p1, "document.querySelector('[aria-label=Config]')");
  await click(p1, "[aria-label=Config]");
  await waitFor(p1, "document.querySelector('[aria-labelledby=touch-settings-title]')?.textContent.includes('Dead Shift')");
  assert.deepEqual(await readProfile(p1), saved, "Saved layout must survive reload");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await clickText(p1, "Portrait");
  await clickText(p1, "Edit layout");
  await sleep(250);
  await capture(p1, "touch-editor-portrait");
  const fit = await evaluate(p1, "const modal=document.querySelector('[role=dialog]');const save=[...modal.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save').getBoundingClientRect();return{width:innerWidth,scroll:document.documentElement.scrollWidth,save:save.toJSON(),dialog:modal.getBoundingClientRect().toJSON()};");
  console.log("PORTRAIT EDITOR MEASUREMENTS", fit);
  assert.ok(fit.scroll <= fit.width + 1);
  assert.ok(fit.save.x >= 0 && fit.save.right <= fit.width + 1 && fit.save.bottom <= 844);
  await clickText(p1, "Cancel");
  await capture(p1, "touch-settings-portrait");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("CONFIG, CUSTOMIZATION, CANCEL, PERSISTENCE AND PORTRAIT PASSED");

  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 600, deviceScaleFactor: 1, mobile: true }, p1);
  await clickText(p1, "Landscape");
  await evaluate(p1, `
    const section=document.querySelector('[aria-labelledby=touch-settings-title]');
    [...section.querySelectorAll('fieldset button')].find(button=>button.textContent.includes('Four fingers')).click();
    const select=document.querySelector('#touch-control-mode');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'on');select.dispatchEvent(new Event('change',{bubbles:true}));
  `);
  await evaluate(p1, "const expanded=document.querySelector('#touch-expanded');if(!expanded.checked)expanded.click();");
  assert.equal((await readProfile(p1)).presetId, "four-finger", "Rapid preference changes must retain the chosen preset");
  await click(p1, '[aria-label="Multi"]');
  await waitFor(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]')");
  await evaluate(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await waitFor(p1, "document.querySelector('[data-dead-shift-hud]')");
  async function attachProbe(id) {
    await evaluate(id, `
      const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
      window.touchProbe={last:null,states:0};getGameSocket('dead-shift').onEvent('state',state=>{touchProbe.last=state;touchProbe.states++});
    `);
    await waitFor(id, "touchProbe.last");
    await evaluate(id, "[...document.querySelectorAll('[aria-modal=true] button')].find(button=>button.textContent.includes('Back to game'))?.click();");
    await sleep(160);
  }
  await attachProbe(p1);
  const roomUrl = await evaluate(p1, "return location.href;");
  const p2 = await newPage(roomUrl, 1000, 600, true);
  await waitFor(p2, "document.querySelector('[data-dead-shift-hud]')");
  await attachProbe(p2);
  await waitFor(p1, "touchProbe.last.started&&!document.querySelector('[aria-modal=true]')");
  await waitFor(p2, "touchProbe.last.started&&!document.querySelector('[aria-modal=true]')");
  for (const page of [p1, p2]) {
    await click(page, "#game-canvas");
    await evaluate(page, "document.exitPointerLock?.();");
  }
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p1);
  const playArea = await evaluate(p1, "return{presentation:document.querySelector('[data-platform-presentation]').dataset.platformPresentation,canvas:document.querySelector('#game-canvas').getBoundingClientRect().toJSON(),fullscreen:Boolean(document.fullscreenElement)};");
  assert.equal(playArea.presentation, "expanded");
  assert.equal(playArea.fullscreen, false);
  assert.ok(playArea.canvas.width >= 998 && playArea.canvas.height >= 598, "Explicit expanded mode must fill the host");
  const points = await evaluate(p1, `
    function point(controlId,id){const b=document.querySelector('[data-platform-touch-game] [data-touch-control-id="'+controlId+'"]').getBoundingClientRect();return{id,x:b.x+b.width/2,y:b.y+b.height/2,radiusX:2,radiusY:2,force:1};}
    return{move:point('move',1),fire:point('fire',2),aim:point('aim',3),look:{id:4,x:610,y:310,radiusX:2,radiusY:2,force:1}};
  `);
  const beforeTouch = await evaluate(p1, "return {...touchProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: Object.values(points) }, p1);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...points.move, x: points.move.x + 45 }, points.fire, points.aim, { ...points.look, x: points.look.x + 40, y: points.look.y - 15 }] }, p1);
  await sleep(550);
  await capture(p1, "touch-four-finger-live");
  const duringTouch = await evaluate(p1, "return {...touchProbe.last.players.p1};");
  assert.ok(duringTouch.shotId > beforeTouch.shotId, "Index fire must reach the authoritative game");
  assert.ok(Math.hypot(duringTouch.x-beforeTouch.x,duringTouch.z-beforeTouch.z) > 0.4, "Movement thumb must work while other fingers are held");
  assert.ok(Math.abs(duringTouch.yaw-beforeTouch.yaw) > 0.08, "Look thumb must work during fire and aim");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p1);
  await sleep(180);
  const releasedTouch = await evaluate(p1, "return {...touchProbe.last.players.p1};");
  await sleep(250);
  const settledTouch = await evaluate(p1, "return {...touchProbe.last.players.p1};");
  assert.equal(settledTouch.shotId, releasedTouch.shotId, "Fire must stop after release");
  console.log("FOUR SIMULTANEOUS POINTERS PASSED", {shots:duringTouch.shotId-beforeTouch.shotId,move:Math.hypot(duringTouch.x-beforeTouch.x,duringTouch.z-beforeTouch.z),yaw:duringTouch.yaw-beforeTouch.yaw});
  await verifyThumbPreset(p1, "two-thumb", 2);
  await verifyThumbPreset(p1, "three-finger", 3);
  await selectLivePreset(p1, "four-finger");

  await evaluate(p1, "window.savedGameCanvas=document.querySelector('#game-canvas');");
  await click(p1, '[aria-label="Customize touch controls"]');
  await waitFor(p1, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  await sleep(180);
  await capture(p1, "touch-editor-live");
  const editingTimer = await evaluate(p1, "return touchProbe.last.timer;");
  await evaluate(p1, "[...document.querySelectorAll('[role=dialog] button')].find(button=>button.getAttribute('aria-label')?.startsWith('Fire,')).click();");
  await setRange(p1, 'input[aria-label="Fire opacity"]', 0.5);
  await sleep(500);
  assert.ok(await evaluate(p1, `return touchProbe.last.timer<${editingTimer};`), "Multiplayer round must keep running while editing");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await sleep(180);
  assert.ok(await evaluate(p1, "return document.querySelector('[role=dialog]').textContent.includes('Landscape');"), "Rotation must preserve the draft's original orientation");
  await clickText(p1, "Save");
  await waitFor(p1, "!document.querySelector('[aria-modal=true]')");
  assert.ok(await evaluate(p1, "return savedGameCanvas===document.querySelector('#game-canvas');"), "Saving must keep the same renderer canvas");
  assert.equal((await readProfile(p1)).layouts["four-finger"].fire.opacity, 0.5);
  console.log("LIVE EDITING AND CANVAS CONTINUITY PASSED");

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await sleep(160);
  await click(p1, '[aria-label="Customize touch controls"]');
  await waitFor(p1, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  await evaluate(p1, `
    const editor=document.querySelector('[role=dialog]');editor.querySelector('details').open=true;
    const selects=[...editor.querySelectorAll('select')];
    const mode=selects.find(select=>[...select.options].some(option=>option.value==='on'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(mode,'on');mode.dispatchEvent(new Event('change',{bubbles:true}));
  `);
  await evaluate(p1, "const checkbox=document.querySelector('[role=dialog] input[type=checkbox]');if(!checkbox.checked)checkbox.click();");
  await clickText(p1, "Save");
  await waitFor(p1, "document.querySelector('[data-platform-presentation=expanded]')&&!document.querySelector('[aria-modal=true]')");
  const portraitPlayArea = await evaluate(p1, "return document.querySelector('#game-canvas').getBoundingClientRect().toJSON();");
  console.log("EXPANDED PORTRAIT MEASUREMENTS", portraitPlayArea);
  assert.ok(portraitPlayArea.width >= 388 && portraitPlayArea.height >= 842, "Portrait expanded mode must not retain an empty controller row");
  await capture(p1, "touch-expanded-portrait");
  await click(p1, '[aria-label="Customize touch controls"]');
  await waitFor(p1, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  await sleep(180);
  await capture(p1, "touch-editor-live-portrait");
  await evaluate(p1, "const bridge=await import('/platform/frontend-engine/endGameBridge.js');bridge.showEndGameModal({title:'Focus test',subtitle:'Touch editor priority',phase:'ready'});");
  await waitFor(p1, "document.querySelector('[aria-label=\"Match results\"]')");
  await key(p1, "Tab", "Tab", true); await key(p1, "Tab", "Tab", false);
  assert.equal(await evaluate(p1, "return document.activeElement.closest('[role=dialog]')?.getAttribute('aria-label');"), "Match results");
  await evaluate(p1, "const bridge=await import('/platform/frontend-engine/endGameBridge.js');bridge.hideEndGameModal();");
  await clickText(p1, "Cancel");
  assert.ok(await evaluate(p1, "return savedGameCanvas===document.querySelector('#game-canvas');"));
  await click(p1, '[aria-label="Leave game"]');
  await waitFor(p1, "document.querySelector('[aria-label=\"Exit game confirmation\"]')");
  await clickText(p1, "Go to Home");
  await waitFor(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]')");
  assert.equal(await evaluate(p1, "return document.querySelector('[data-platform-presentation]').dataset.platformPresentation;"), "console");
  assert.equal(await evaluate(p1, "return document.querySelectorAll('[data-platform-touch-game]').length;"), 0);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("EXPANDED PORTRAIT, MODAL PRIORITY, RETURN AND CLEANUP PASSED");
  await evaluate(p1, "document.querySelector('[data-library-card-id=pong]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await waitFor(p1, "document.querySelector('[aria-label=\"Landscape game startup\"]')");
  assert.equal(await evaluate(p1, "return document.querySelectorAll('script[id^=game-runtime-pong-]').length;"), 0, "Landscape startup also applies to games without customizable touch controls");
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, p1);
  await waitFor(p1, "location.pathname.startsWith('/games/pong/')&&typeof get==='function'&&document.querySelector('#game-canvas')", 25000);
  assert.equal(await evaluate(p1, "return document.querySelectorAll('[aria-label=\"Customize touch controls\"],[data-platform-touch-game]').length;"), 0, "An existing game without opt-in must keep its own controls");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("EXISTING GAME PERMISSIONS AND RUNTIME PASSED");
} finally {
  chrome.kill("SIGTERM");
  const closeTimeout = setTimeout(() => chrome.kill("SIGKILL"), 3000);
  await chromeClosed;
  clearTimeout(closeTimeout);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
