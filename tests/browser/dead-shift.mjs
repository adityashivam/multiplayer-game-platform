import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const baseUrl = process.env.DEAD_SHIFT_BASE_URL || "http://localhost:3100";
const chromeExecutable = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(path.join(tmpdir(), "dead-shift-chrome-"));
const chrome = spawn(chromeExecutable, [
  "--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
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
  await writeFile(path.join(tmpdir(), `dead-shift-${name}.png`), Buffer.from(screenshot.data, "base64"));
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
async function verifyRenderCap(id) {
  await evaluate(id, `
    const gl=document.querySelector('#game-canvas').getContext('webgl2');
    window.dsGpuCounter={frames:0,rafSerial:0,lastRenderedSerial:-1};const counter=dsGpuCounter;const clear=gl.clear.bind(gl);
    function markFrame(){counter.rafSerial++;requestAnimationFrame(markFrame)}requestAnimationFrame(markFrame);
    gl.clear=(mask)=>{if((mask&gl.COLOR_BUFFER_BIT)&&!gl.getParameter(gl.FRAMEBUFFER_BINDING)&&counter.lastRenderedSerial!==counter.rafSerial){counter.frames++;counter.lastRenderedSerial=counter.rafSerial;}return clear(mask);};
    const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');
    publishRuntimePerformanceProfile({mode:'manual',targetFps:30,resolutionScale:1});
  `);
  await sleep(350);
  const beforeCap = await evaluate(id, "return {frames:dsGpuCounter.frames,ack:dsProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  await sleep(2000);
  const afterCap = await evaluate(id, "return {frames:dsGpuCounter.frames,ack:dsProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  const actualFps = (afterCap.frames - beforeCap.frames) * 1000 / (afterCap.time - beforeCap.time);
  assert.ok(actualFps > 27 && actualFps < 33, `Requested 30 FPS must control actual WebGL frames, observed ${actualFps}`);
  assert.ok(afterCap.ack - beforeCap.ack > 100, "Input simulation must keep running near 60 Hz at a 30 FPS render cap");
  await evaluate(id, "const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');publishRuntimePerformanceProfile({mode:'manual',targetFps:60,resolutionScale:1});");
  console.log("INDEPENDENT RENDER/SIMULATION CADENCE PASSED", {actualFps, acknowledgedCommands:afterCap.ack-beforeCap.ack});
}
async function probePage(id) {
  await waitFor(id, "document.querySelector('[data-dead-shift-hud]')", 30000);
  await evaluate(id, `
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.dsSocket=getGameSocket('dead-shift');
    window.dsProbe={last:null,joined:null,events:{},seenEvents:new Set(),types:[],projectiles:[],minHealth:100,maxKills:0,states:0,frames:[],previous:performance.now()};
    dsSocket.onEvent('gameJoined', joined=>dsProbe.joined=joined);
    dsSocket.onEvent('state', snapshot=>{dsProbe.last=snapshot;dsProbe.states++;for(const enemy of snapshot.enemies)if(enemy.id&&!dsProbe.types.includes(enemy.type))dsProbe.types.push(enemy.type);for(const projectile of snapshot.projectiles)if(projectile.id&&!dsProbe.projectiles.includes(projectile.kind))dsProbe.projectiles.push(projectile.kind);for(const event of snapshot.events)if(event.id&&!dsProbe.seenEvents.has(event.id)){dsProbe.seenEvents.add(event.id);dsProbe.events[event.kind]=(dsProbe.events[event.kind]||0)+1;}for(const player of Object.values(snapshot.players)){dsProbe.minHealth=Math.min(dsProbe.minHealth,player.health);dsProbe.maxKills=Math.max(dsProbe.maxKills,player.kills);}});
    function frame(now){const elapsed=now-dsProbe.previous;dsProbe.previous=now;dsProbe.frames.push(elapsed);if(dsProbe.frames.length>600)dsProbe.frames.shift();requestAnimationFrame(frame)}requestAnimationFrame(frame);
  `);
  await waitFor(id, "dsProbe.last");
  await evaluate(id, "const back=[...document.querySelectorAll('[aria-modal=true] button')].find(button=>/back to game/i.test(button.textContent));back?.click();");
  await sleep(120);
}

try {
  const p1 = await newPage(baseUrl);
  await waitFor(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]')");
  const libraryShell = await evaluate(p1, "return document.querySelector('[class*=platformConsole]').getBoundingClientRect().toJSON();");
  await evaluate(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await probePage(p1);
  const roomUrl = await evaluate(p1, "return location.href;");
  assert.match(roomUrl, /\/games\/dead-shift\/[a-z0-9]+$/i);
  const gameShell = await evaluate(p1, "return document.querySelector('[class*=platformConsole]').getBoundingClientRect().toJSON();");
  for (const field of ["x", "y", "width", "height"]) assert.ok(Math.abs(libraryShell[field] - gameShell[field]) <= 1, `Shell ${field} must stay stable on game entry`);
  assert.equal(await evaluate(p1, "return Boolean(document.fullscreenElement);"), false);
  await capture(p1, "intro");
  console.log("FIRST CLIENT READY", await evaluate(p1, "return {canvas:document.querySelector('#game-canvas').getBoundingClientRect().toJSON(),hud:document.querySelector('.ds-hud').getBoundingClientRect().toJSON(),messages:document.body.innerText.slice(-500)}"));
  const p2 = await newPage(roomUrl);
  await probePage(p2);
  await waitFor(p1, "dsProbe.last.started");
  await waitFor(p1, "!document.querySelector('[aria-modal=true]')");
  await waitFor(p2, "!document.querySelector('[aria-modal=true]')");
  await click(p1, "#game-canvas");
  await click(p2, "#game-canvas");
  await sleep(1000);
  await capture(p1, "arena");
  console.log("TWO CLIENTS STARTED", await evaluate(p1, "return {connected:Object.values(dsProbe.last.players).map(p=>p.connected),enemies:dsProbe.last.enemies.filter(e=>e.id).length,lock:Boolean(document.pointerLockElement)}"));
  const before = await evaluate(p1, "return {...dsProbe.last.players.p1}");
  await key(p1, "KeyA", "a", true); await sleep(500); await key(p1, "KeyA", "a", false); await sleep(300);
  const after = await evaluate(p1, "return {...dsProbe.last.players.p1}");
  assert.ok(after.x < before.x - 1, "Actual keyboard movement must reach the server");
  await key(p1, "Space", " ", true); await sleep(180);
  assert.ok(await evaluate(p1, "return dsProbe.last.players.p1.y>0.2"), "Short jump must reach the server");
  await key(p1, "Space", " ", false);
  await evaluate(p1, "document.exitPointerLock?.();");
  await sleep(120);
  const stick = await evaluate(p1, "const b=document.querySelector('[data-stick=left]').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,r:b.width*.4};");
  const beforeStick = await evaluate(p1, "return dsProbe.last.players.p1.z;");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: stick.x, y: stick.y }, p1);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: stick.x, y: stick.y - stick.r }, p1);
  await sleep(550);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: stick.x, y: stick.y - stick.r }, p1);
  await sleep(250);
  assert.ok(await evaluate(p1, `return dsProbe.last.players.p1.z<${beforeStick}-0.5`), "Actual analog drag must move the operator");
  console.log("KEYBOARD, SHORT JUMP AND ANALOG MOVEMENT PASSED");
  await evaluate(p1, "document.querySelector('#game-canvas').click();");
  for (let weapon = 0; weapon < 5; weapon += 1) {
    await evaluate(p1, `document.exitPointerLock?.();document.querySelector('[data-weapon="${weapon}"]').click();`);
    const action = await evaluate(p1, "const b=document.querySelector('[data-action=a]').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...action }, p1);
    await sleep(700);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...action }, p1);
    await sleep(300);
    assert.equal(await evaluate(p1, "return dsProbe.last.players.p1.weapon"), weapon);
    await capture(p1, `weapon-${weapon}`);
  }
  console.log("FIVE WEAPONS FIRED", await evaluate(p1, "return dsProbe.projectiles"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await sleep(600);
  await capture(p1, "portrait");
  const portrait = await evaluate(p1, "return {scroll:document.documentElement.scrollWidth,width:innerWidth,sticks:[...document.querySelectorAll('[data-stick]')].map(s=>s.getBoundingClientRect().toJSON()).filter(s=>s.width>0),hud:document.querySelector('.ds-hud').getBoundingClientRect().toJSON()};");
  console.log("PORTRAIT MEASUREMENTS", portrait);
  assert.ok(portrait.scroll <= portrait.width + 1, "Portrait must not overflow horizontally");
  assert.ok(portrait.sticks.every(stick=>stick.width>=40&&stick.x>=0&&stick.right<=portrait.width+1), "Both portrait analog sticks must remain usable");
  console.log("PORTRAIT FIT PASSED", portrait);
  await waitFor(p1, "dsProbe.last.players.p1.health>0");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p1);
  const leftTouch = { id: 1, x: portrait.sticks[0].x + 32, y: portrait.sticks[0].y + 32, radiusX: 2, radiusY: 2, force: 1 };
  const rightTouch = { id: 2, x: portrait.sticks[1].x + 32, y: portrait.sticks[1].y + 32, radiusX: 2, radiusY: 2, force: 1 };
  const beforeTouch = await evaluate(p1, "return {...dsProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [leftTouch, rightTouch] }, p1);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...leftTouch, y: leftTouch.y - 25 }, { ...rightTouch, x: rightTouch.x + 25 }] }, p1);
  await sleep(450);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p1);
  await sleep(180);
  const afterTouch = await evaluate(p1, "return {...dsProbe.last.players.p1};");
  assert.ok(Math.abs(afterTouch.yaw - beforeTouch.yaw) > 0.25, "Right touch stick must aim while left touch stick is held");
  assert.ok(Math.hypot(afterTouch.x - beforeTouch.x, afterTouch.z - beforeTouch.z) > 0.4, "Left touch stick must move while right touch stick aims");
  await evaluate(p1, "const {getGameControls}=await import('/platform/frontend-engine/gameDom.js');const sticks=getGameControls().sticks;if(sticks.left.getState().x||sticks.left.getState().y||sticks.right.getState().x||sticks.right.getState().y)throw Error('Touch sticks failed to reset');");
  await send("Emulation.setTouchEmulationEnabled", { enabled: false }, p1);
  console.log("SIMULTANEOUS TOUCH MOVEMENT/AIM AND RELEASE PASSED");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, p1);
  await verifyRenderCap(p1);
  for (let attempts = 0; attempts < 25; attempts += 1) {
    if (await evaluate(p1, "return dsProbe.last.gameOver")) break;
    await sleep(4000);
    if (attempts % 4 === 0) console.log("ROUND PROGRESS", await evaluate(p1, "return {timer:dsProbe.last.timer,minHealth:dsProbe.minHealth,kills:dsProbe.maxKills,types:dsProbe.types,projectiles:dsProbe.projectiles}"));
  }
  await waitFor(p1, "dsProbe.last.gameOver", 10000);
  await capture(p1, "results");
  const final = await evaluate(p1, "const frames=[...dsProbe.frames].sort((a,b)=>a-b);return{winner:dsProbe.last.winner,timer:dsProbe.last.timer,types:dsProbe.types,projectiles:dsProbe.projectiles,minHealth:dsProbe.minHealth,kills:dsProbe.maxKills,events:dsProbe.events,states:dsProbe.states,frameMedianMs:frames[Math.floor(frames.length*.5)],frameP95Ms:frames[Math.floor(frames.length*.95)]};");
  assert.equal(final.timer, 0);
  assert.ok(final.minHealth < 100, "Enemies must deal authoritative damage");
  assert.ok(final.types.length === 4, "All four enemy types must appear");
  assert.ok(final.projectiles.includes("grenade") && final.projectiles.includes("rocket"), "Both launchers must create shared projectiles");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("LIVE FULL ROUND PASSED", JSON.stringify({final,failures}));

  for (const id of [p1, p2]) {
    await evaluate(id, "const rematch=[...document.querySelectorAll('[aria-modal=true] button')].find(button=>/challenge again|accept rematch/i.test(button.textContent));if(!rematch)throw Error('Missing rematch action');rematch.click();");
  }
  await waitFor(p1, "!dsProbe.last.gameOver&&dsProbe.last.timer>89&&dsProbe.last.players.p1.kills===0&&dsProbe.last.players.p2.kills===0");
  await waitFor(p1, "dsProbe.last.started");
  await sleep(1700);
  const beforeReload = await evaluate(p1, "return {timer:dsProbe.last.timer,epoch:dsProbe.last.players.p2.inputEpoch};");
  await send("Page.reload", {}, p2);
  await probePage(p2);
  await waitFor(p1, "dsProbe.last.players.p1.connected&&dsProbe.last.players.p2.connected&&dsProbe.last.started");
  const afterReload = await evaluate(p1, "return {timer:dsProbe.last.timer,epoch:dsProbe.last.players.p2.inputEpoch};");
  assert.ok(afterReload.timer <= beforeReload.timer && afterReload.timer > beforeReload.timer - 4, "Reload must preserve remaining round time");
  assert.ok(afterReload.epoch > beforeReload.epoch, "Reload must obtain a fresh input epoch for the same seat");
  assert.equal(await evaluate(p2, "return document.querySelector('.ds-error').hidden;"), true);
  await waitFor(p2, "!document.querySelector('[aria-modal=true]')");
  await click(p2, "#game-canvas");
  await key(p2, "KeyA", "a", true); await sleep(800); await key(p2, "KeyA", "a", false);
  await key(p2, "KeyW", "w", true); await sleep(800); await key(p2, "KeyW", "w", false);
  await sleep(250);
  await capture(p1, "visible-rival");
  console.log("REMATCH AND TOKEN RELOAD PASSED", {beforeReload,afterReload});

  await evaluate(p1, "document.exitPointerLock?.();document.querySelector('[data-action=home]').click();");
  await waitFor(p1, "document.querySelector('[aria-label=\"Exit game confirmation\"]')");
  await evaluate(p1, "[...document.querySelectorAll('[aria-modal=true] button')].find(button=>/go to home/i.test(button.textContent)).click();");
  await waitFor(p1, "!document.querySelector('[data-dead-shift-hud]')&&document.querySelector('[data-library-card-id=\"dead-shift\"]')");
  const stoppedFrames = await evaluate(p1, "return dsGpuCounter.frames;");
  await sleep(550);
  assert.equal(await evaluate(p1, "return dsGpuCounter.frames;"), stoppedFrames, "Disposed renderer must stop drawing");
  assert.equal(await evaluate(p1, "return document.querySelectorAll('link[href=\"/games/dead-shift/hud.css\"]').length;"), 0);
  const returnedShell = await evaluate(p1, "return document.querySelector('[class*=platformConsole]').getBoundingClientRect().toJSON();");
  for (const field of ["x", "y", "width", "height"]) assert.ok(Math.abs(libraryShell[field] - returnedShell[field]) <= 1, `Shell ${field} must stay stable on return`);
  await evaluate(p1, "document.querySelector('[data-library-card-id=\"dead-shift\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await probePage(p1);
  assert.equal(await evaluate(p1, "return document.querySelectorAll('[data-dead-shift-hud]').length;"), 1);
  assert.notEqual(await evaluate(p1, "return location.href;"), roomUrl, "Relaunch from library must create a fresh room");
  await capture(p1, "relaunch");
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log("SHELL STABILITY, CLEANUP AND RELAUNCH PASSED");
} finally {
  chrome.kill("SIGTERM");
}
