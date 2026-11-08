import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.SKY_DASH_BASE_URL || "http://localhost:3000";
const quickRun = process.env.SKY_DASH_BROWSER_QUICK === "1";
const browser = await createBrowserTestSession("sky-dash");
const { send, evaluate, waitFor, newPage, capture, click, clickText, key } = browser;

async function attachRaceProbe(sessionId) {
  await waitFor(sessionId, "document.querySelector('[data-sky-dash-hud]')", 30000);
  await evaluate(sessionId, `
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.sdSocket=getGameSocket('sky-dash');
    window.sdProbe={last:null,states:0,actions:[],botFinish:[],minSeparation:Infinity,previousFrame:performance.now(),frameGaps:[]};
    sdSocket.onEvent('state', snapshot=>{
      sdProbe.last=snapshot;sdProbe.states++;
      const runners=[...Object.values(snapshot.players),...snapshot.bots];
      for(const runner of runners){if(!sdProbe.actions.includes(runner.action))sdProbe.actions.push(runner.action);if(runner.isBot&&runner.finished&&!sdProbe.botFinish.includes(runner.id))sdProbe.botFinish.push(runner.id)}
      const solid=runners.filter(runner=>runner.connected&&!runner.finished&&runner.action!=='respawn');
      for(let i=0;i<solid.length;i++)for(let j=i+1;j<solid.length;j++)if(Math.abs(solid[i].y-solid[j].y)<1.4)sdProbe.minSeparation=Math.min(sdProbe.minSeparation,Math.hypot(solid[i].x-solid[j].x,solid[i].z-solid[j].z));
    });
    function recordFrame(now){if(sdProbe.frameGaps.length<2000)sdProbe.frameGaps.push(now-sdProbe.previousFrame);sdProbe.previousFrame=now;requestAnimationFrame(recordFrame)}requestAnimationFrame(recordFrame);
  `);
  await waitFor(sessionId, "sdProbe.last");
  const modal = await evaluate(sessionId, "return Boolean(document.querySelector('[aria-label=\"Invite players\"]'));" );
  if (modal) await clickText(sessionId, "Back to game");
}

async function startAutopilot(sessionId, playerId) {
  await evaluate(sessionId, `
    const {createSkyDashBotInput}=await import('/games/sky-dash/shared/simulation.js');
    window.sdAutopilot=setInterval(()=>{
      const snapshot=sdProbe.last;if(!snapshot||snapshot.gameOver||document.querySelector('[aria-modal=true]'))return;
      const input=createSkyDashBotInput(snapshot,snapshot.players[${JSON.stringify(playerId)}]);
      window.dispatchEvent(new CustomEvent('platformtouchinput',{detail:{gameId:'sky-dash',type:'axis',controlId:'move',x:input.moveX,y:-input.moveZ}}));
      for(const action of ['jump','dash','dive'])window.dispatchEvent(new CustomEvent('platformtouchinput',{detail:{gameId:'sky-dash',type:'action',controlId:action,active:input[action]}}));
    },1000/60);
  `);
}

async function verifyRenderCadence(sessionId) {
  await evaluate(sessionId, `
    const gl=document.querySelector('#game-canvas').getContext('webgl2');
    window.sdGpuCounter={frames:0,rafSerial:0,lastRenderedSerial:-1};const counter=sdGpuCounter;const clear=gl.clear.bind(gl);
    function markFrame(){counter.rafSerial++;requestAnimationFrame(markFrame)}requestAnimationFrame(markFrame);
    gl.clear=(mask)=>{if((mask&gl.COLOR_BUFFER_BIT)&&!gl.getParameter(gl.FRAMEBUFFER_BINDING)&&counter.lastRenderedSerial!==counter.rafSerial){counter.frames++;counter.lastRenderedSerial=counter.rafSerial;}return clear(mask);};
    const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');
    publishRuntimePerformanceProfile({mode:'manual',targetFps:30,resolutionScale:1});
  `);
  await delay(350);
  const before = await evaluate(sessionId, "return{frames:sdGpuCounter.frames,ack:sdProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  await delay(2000);
  const after = await evaluate(sessionId, "return{frames:sdGpuCounter.frames,ack:sdProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  const actualFps = (after.frames - before.frames) * 1000 / (after.time - before.time);
  assert.ok(actualFps > 27 && actualFps < 33, `Actual WebGL frames must follow the 30 FPS preference, observed ${actualFps}`);
  assert.ok(after.ack - before.ack > 95, "Input must continue near 60 Hz while rendering at 30 FPS");
  await evaluate(sessionId, "const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');publishRuntimePerformanceProfile({mode:'manual',targetFps:60,resolutionScale:1});");
  console.log("INDEPENDENT RENDER/INPUT CADENCE PASSED", { actualFps, acknowledgedCommands: after.ack - before.ack });
}

try {
  const p1 = await newPage(baseUrl, 1440, 900);
  await waitFor(p1, "document.querySelector('[data-library-card-id=sky-dash]')");
  const homeShell = await evaluate(p1, "const shell=document.querySelector('[data-platform-presentation]');return shell?.getBoundingClientRect().toJSON();");
  await evaluate(p1, "document.querySelector('[data-library-card-id=sky-dash]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await attachRaceProbe(p1);
  await capture(p1, "intro-landscape");
  const roomUrl = await evaluate(p1, "return location.href;");
  assert.match(roomUrl, /\/games\/sky-dash\/[a-z0-9]+/);
  const p2 = await newPage(roomUrl, 1440, 900);
  await attachRaceProbe(p2);
  await waitFor(p1, "sdProbe.last.started", 15000);
  await waitFor(p1, "!document.querySelector('[aria-modal=true]')");
  assert.equal(await evaluate(p1, "return Object.keys(sdProbe.last.players).length;"), 2);
  assert.equal(await evaluate(p1, "return sdProbe.last.bots.length;"), 3);
  const gameShell = await evaluate(p1, "return document.querySelector('[data-platform-presentation]')?.getBoundingClientRect().toJSON();");
  if (homeShell && gameShell) for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(homeShell[dimension] - gameShell[dimension]) < 1, `Shell ${dimension} must remain stable`);
  const before = await evaluate(p1, "return {...sdProbe.last.players.p1};");
  await key(p1, "KeyW", "w", true);
  await key(p1, "Space", " ", true);
  await delay(55);
  await key(p1, "Space", " ", false);
  await delay(450);
  await key(p1, "ShiftLeft", "Shift", true);
  await delay(50);
  await key(p1, "ShiftLeft", "Shift", false);
  await delay(250);
  await key(p1, "KeyE", "e", true);
  await delay(50);
  await key(p1, "KeyE", "e", false);
  await key(p1, "KeyW", "w", false);
  const after = await evaluate(p1, "return {...sdProbe.last.players.p1};");
  assert.ok(after.z < before.z - 3, "Keyboard movement must reach authority");
  await waitFor(p1, "sdProbe.last.players.p1.grounded", 5000);
  await key(p1, "Space", " ", true);
  await delay(160);
  await key(p1, "KeyE", "e", true);
  await delay(120);
  await key(p1, "Space", " ", false);
  await key(p1, "KeyE", "e", false);
  await waitFor(p1, "sdProbe.actions.includes('dive')", 3000);
  await capture(p1, "race-landscape");
  console.log("TWO CLIENTS, THREE BOTS, STABLE SHELL AND KEYBOARD ACTIONS PASSED", { roomUrl, movedMeters: before.z - after.z });
  await verifyRenderCadence(p1);

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p1);
  await delay(500);
  await capture(p1, "race-portrait");
  const dimensions = await evaluate(p1, "return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,canvas:document.querySelector('#game-canvas').getBoundingClientRect().toJSON(),host:document.querySelector('#game-canvas').parentElement.getBoundingClientRect().toJSON()};");
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, "Portrait viewport must not overflow horizontally");
  assert.ok(dimensions.canvas.width <= dimensions.host.width + 1, "Canvas must fit its host");
  await waitFor(p1, "document.querySelector('[data-platform-touch-game=sky-dash][data-active=true]')&&sdProbe.last.players.p1.grounded", 5000);
  const touchPoints = await evaluate(p1, `
    const point=id=>{const b=document.querySelector('[data-platform-touch-game=sky-dash] [data-touch-control-id='+id+']').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}};
    return{move:{...point('move'),id:1},jump:{...point('jump'),id:2},before:{...sdProbe.last.players.p1}};
  `);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoints.move, touchPoints.jump] }, p1);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchPoints.move, y: touchPoints.move.y - 30 }, touchPoints.jump] }, p1);
  await delay(260);
  const touchMovement = await evaluate(p1, "return{...sdProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p1);
  assert.ok(touchMovement.z < touchPoints.before.z - 0.2, "Platform touch stick must move while jumping");
  assert.ok(touchMovement.y > touchPoints.before.y + 0.2, "Platform touch jump must survive its short press");
  await evaluate(p1, "window.originalRaceCanvas=document.querySelector('#game-canvas');");
  await click(p1, '[aria-label="Customize touch controls"]');
  await waitFor(p1, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  assert.ok(await evaluate(p1, "return ['Jump','Dash','Dive'].every(label=>document.querySelector('[role=dialog]').textContent.includes(label));"));
  await clickText(p1, "Cancel");
  assert.ok(await evaluate(p1, "return originalRaceCanvas===document.querySelector('#game-canvas');"), "Touch editing must retain the live canvas");
  console.log("PLATFORM TOUCH MOVEMENT/JUMP AND LIVE LAYOUT EDITOR PASSED");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p2);
  const shellPoints = await evaluate(p2, `
    const visible=selector=>[...document.querySelectorAll(selector)].find(element=>element.getBoundingClientRect().width>0);
    const point=element=>{const b=element.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}};
    return{move:{...point(visible('[data-stick=left]')),id:1},jump:{...point(visible('[data-action=a]')),id:2},before:{...sdProbe.last.players.p2}};
  `);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [shellPoints.move, shellPoints.jump] }, p2);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...shellPoints.move, y: shellPoints.move.y - 26 }, shellPoints.jump] }, p2);
  await delay(280);
  const shellMovement = await evaluate(p2, "return{...sdProbe.last.players.p2};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p2);
  assert.ok(shellMovement.z < shellPoints.before.z - 0.25, "Standard shell stick must move while A jumps");
  assert.ok(shellMovement.y > shellPoints.before.y + 0.2, "Standard shell A must jump during movement");
  await waitFor(p2, "!sdProbe.last.players.p2.jumpHeld", 2000);
  console.log("STANDARD SHELL SIMULTANEOUS ANALOG MOVEMENT AND JUMP PASSED");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, p1);
  await delay(300);
  const noModal = await evaluate(p1, "return !document.querySelector('[aria-modal=true]');");
  assert.ok(noModal);

  if (!quickRun) {
    await startAutopilot(p1, "p1");
    await startAutopilot(p2, "p2");
    for (let attempt = 0; attempt < 19; attempt += 1) {
      await delay(5000);
      const status = await evaluate(p1, "return{timer:sdProbe.last.timer,gameOver:sdProbe.last.gameOver,runners:[...Object.values(sdProbe.last.players),...sdProbe.last.bots].map(r=>({id:r.id,z:r.z,checkpoint:r.checkpoint,finished:r.finished,respawns:r.respawnId,jumpHeld:r.jumpHeld})),actions:sdProbe.actions};");
      console.log("RACE PROGRESS", status);
      if (status.gameOver) break;
    }
    await waitFor(p1, "sdProbe.last.gameOver", 5000);
    await waitFor(p2, "sdProbe.last.gameOver", 5000);
    await capture(p1, "results");
    const finish = await evaluate(p1, "return{bots:sdProbe.botFinish,players:Object.values(sdProbe.last.players).map(r=>({id:r.id,finished:r.finished,rank:r.rank})),minSeparation:sdProbe.minSeparation,actions:sdProbe.actions,standings:sdProbe.last.standings};");
    assert.ok(finish.players.every((runner) => runner.finished), "Both SDK-controlled human racers must be able to finish");
    assert.ok(finish.bots.length >= 2, "At least two bots must finish with human traffic");
    assert.ok(finish.minSeparation >= 0.79, `Persistent runner overlap: ${finish.minSeparation}`);
    assert.ok(finish.actions.includes("jump") && finish.actions.includes("dash") && finish.actions.includes("dive") && finish.actions.includes("hit"));
    console.log("FULL RACE, OBSTACLE CONTACT, BOT FINISH AND SEPARATION PASSED", finish);
    await clickText(p1, "Race again");
    await waitFor(p2, "[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Accept rematch'))");
    await clickText(p2, "Accept rematch");
    await waitFor(p1, "sdProbe.last.roundId===2&&!sdProbe.last.gameOver");
    await waitFor(p2, "sdProbe.last.roundId===2&&!sdProbe.last.gameOver");
    await evaluate(p1, "clearInterval(sdAutopilot);");
    await evaluate(p2, "clearInterval(sdAutopilot);");
    await send("Page.reload", {}, p1);
    await attachRaceProbe(p1);
    assert.equal(await evaluate(p1, "return sdProbe.last.roundId;"), 2);
    assert.ok(await evaluate(p1, "return sdProbe.last.players.p1.connected&&sdProbe.last.players.p2.connected;"));
    await waitFor(p1, "sdProbe.last.started&&!document.querySelector('[aria-modal=true]')", 15000);
    console.log("REMATCH AND SEAT-PRESERVING RELOAD PASSED");
  }
  await evaluate(p1, "const button=[...document.querySelectorAll('[data-action=home]')].find(element=>element.getBoundingClientRect().width>0);button.click();");
  await waitFor(p1, "document.querySelector('[aria-label=\"Exit game confirmation\"]')");
  await clickText(p1, "Go to Home");
  await waitFor(p1, "!document.querySelector('[data-sky-dash-hud]')&&document.querySelector('[data-library-card-id=sky-dash]')");
  assert.equal(await evaluate(p1, "return document.querySelectorAll('[data-platform-touch-game]').length;"), 0);
  await evaluate(p1, "document.querySelector('[data-library-card-id=sky-dash]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await attachRaceProbe(p1);
  assert.equal(await evaluate(p1, "return sdProbe.last.bots.length;"), 3);
  await capture(p1, "reopened");
  console.log("DISPOSAL AND WEBGL RELAUNCH PASSED");
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("SKY DASH BROWSER CHECKS PASSED");
} catch (error) {
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
