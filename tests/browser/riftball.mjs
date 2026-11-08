import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const baseUrl = process.env.RIFTBALL_BASE_URL || "http://localhost:3000";
const quickRun = process.env.RIFTBALL_BROWSER_QUICK === "1";
const browser = await createBrowserTestSession("riftball");
const { send, evaluate, waitFor, newPage, capture, click, clickText, key } = browser;
// Three's inspection hook exposes the actual rendered bones to this isolated
// browser test. The shipped game does not publish scene or test globals.
const sceneInspectionSetup = `
  window.rbObservedScenes=[];
  window.__THREE_DEVTOOLS__=new EventTarget();
  __THREE_DEVTOOLS__.addEventListener('observe',event=>{if(event.detail.isScene)rbObservedScenes.push(event.detail)});
`;

async function verifyRenderedHeadTracking(sessionId) {
  await waitFor(sessionId, "rbObservedScenes.some(scene=>scene.getObjectByName('riftball-athlete-p2'))");
  await evaluate(sessionId, `
    const scene=rbObservedScenes.find(candidate=>candidate.getObjectByName('riftball-athlete-p2'));
    const heads=['p1','p2'].map(playerId=>scene.getObjectByName('riftball-athlete-'+playerId).getObjectByName('Head'));
    const initial=heads.map(head=>head.quaternion.clone().normalize());
    const current=initial.map(rotation=>rotation.clone());
    window.rbHeadProbe={active:true,samples:0,maxDeviationRad:0};
    function recordHeads(){
      if(!rbHeadProbe.active)return;
      for(let index=0;index<heads.length;index++){
        current[index].copy(heads[index].quaternion).normalize();
        rbHeadProbe.maxDeviationRad=Math.max(rbHeadProbe.maxDeviationRad,current[index].angleTo(initial[index]));
      }
      rbHeadProbe.samples++;requestAnimationFrame(recordHeads);
    }
    requestAnimationFrame(recordHeads);
  `);
  await delay(1300);
  const observation = await evaluate(sessionId, "rbHeadProbe.active=false;return{samples:rbHeadProbe.samples,maxDeviationRad:rbHeadProbe.maxDeviationRad};");
  assert.ok(observation.samples > 20, "Inspect actual rendered head bones over repeated frames");
  assert.ok(observation.maxDeviationRad < 0.002, `Stationary head gaze must not accumulate rotation: ${observation.maxDeviationRad} rad`);
  console.log("RENDERED HEAD TRACKING STAYS STABLE", observation);
}

async function attachMatchProbe(sessionId) {
  await waitFor(sessionId, "document.querySelector('[data-riftball-hud]')", 30000);
  await evaluate(sessionId, `
    const {getGameSocket}=await import('/platform/frontend-engine/gameSocket.js');
    window.rbSocket=getGameSocket('riftball');
    window.rbProbe={last:null,states:0,actions:[],minSeparation:Infinity,invalidBodies:0,goalSerial:0,replaySeen:false};
    window.rbReplayObserver=new MutationObserver(()=>{if(document.querySelector('.rb-replay:not([hidden])'))rbProbe.replaySeen=true});
    rbReplayObserver.observe(document.querySelector('[data-riftball-hud]'),{subtree:true,attributes:true,attributeFilter:['hidden']});
    rbSocket.onEvent('state',snapshot=>{
      rbProbe.last=snapshot;rbProbe.states++;rbProbe.goalSerial=Math.max(rbProbe.goalSerial,snapshot.goalSerial);
      const players=Object.values(snapshot.players);
      for(const player of players){if(!rbProbe.actions.includes(player.action))rbProbe.actions.push(player.action);if(![player.x,player.y,player.z,player.vx,player.vy,player.vz].every(Number.isFinite))rbProbe.invalidBodies++;}
      if(players.every(player=>player.connected)&&Math.abs(players[0].y-players[1].y)<1.8)rbProbe.minSeparation=Math.min(rbProbe.minSeparation,Math.hypot(players[0].x-players[1].x,players[0].z-players[1].z));
    });
  `);
  await waitFor(sessionId, "rbProbe.last");
  if (await evaluate(sessionId, "return Boolean(document.querySelector('[aria-label=\"Invite players\"]'));")) await clickText(sessionId, "Back to game");
}

async function startLegalScoringDriver(sessionId) {
  await evaluate(sessionId, `
    window.rbDriver={chargeSince:null,releaseUntil:0};
    window.rbAutopilot=setInterval(()=>{
      const snapshot=rbProbe.last;if(!snapshot||snapshot.gameOver||document.querySelector('[aria-modal=true]'))return;
      const player=snapshot.players.p1;const ball=snapshot.ball;const now=performance.now();
      const targetX=Math.max(-8.8,Math.min(8.8,ball.x));
      const targetZ=Math.max(-16,Math.min(16,ball.z+1.05));
      let dx=targetX-player.x,dz=targetZ-player.z;
      const length=Math.hypot(dx,dz);const scale=length>0.16?Math.min(1,length*2)/Math.max(0.01,length):0;
      // Controls remain legal platform inputs; no authoritative coordinates,
      // score, clock, ball velocity or result are changed by this driver.
      const moveX=dx*scale;const moveY=dz*scale;
      window.dispatchEvent(new CustomEvent('platformtouchinput',{detail:{gameId:'riftball',type:'axis',controlId:'move',x:moveX,y:moveY}}));
      const near=Math.hypot(ball.x-player.x,ball.z-player.z)<1.85;
      const inFront=ball.z<player.z+0.05;
      let strike=false;
      if(now>rbDriver.releaseUntil&&near&&inFront&&snapshot.phase!=='goal'){
        rbDriver.chargeSince??=now;strike=true;
        if(now-rbDriver.chargeSince>600){strike=false;rbDriver.chargeSince=null;rbDriver.releaseUntil=now+480;}
      }else if(rbDriver.chargeSince!==null){rbDriver.chargeSince=null;rbDriver.releaseUntil=now+450;}
      window.dispatchEvent(new CustomEvent('platformtouchinput',{detail:{gameId:'riftball',type:'action',controlId:'strike',active:strike}}));
    },1000/60);
  `);
}

async function verifyRenderCadence(sessionId) {
  await evaluate(sessionId, `
    const gl=document.querySelector('#game-canvas').getContext('webgl2');
    window.rbGpuCounter={frames:0,rafSerial:0,lastRenderedSerial:-1};const counter=rbGpuCounter;const clear=gl.clear.bind(gl);
    function markFrame(){counter.rafSerial++;requestAnimationFrame(markFrame)}requestAnimationFrame(markFrame);
    gl.clear=(mask)=>{if((mask&gl.COLOR_BUFFER_BIT)&&!gl.getParameter(gl.FRAMEBUFFER_BINDING)&&counter.lastRenderedSerial!==counter.rafSerial){counter.frames++;counter.lastRenderedSerial=counter.rafSerial;}return clear(mask);};
    const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');
    publishRuntimePerformanceProfile({mode:'manual',targetFps:30,resolutionScale:0.75});
  `);
  await delay(350);
  const before = await evaluate(sessionId, "return{frames:rbGpuCounter.frames,ack:rbProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  await delay(2000);
  const after = await evaluate(sessionId, "return{frames:rbGpuCounter.frames,ack:rbProbe.last.players.p1.inputSeqAck,time:performance.now()};");
  const actualFps = (after.frames - before.frames) * 1000 / (after.time - before.time);
  assert.ok(actualFps > 24 && actualFps < 34, `30 FPS preference must affect real WebGL frames, observed ${actualFps}`);
  assert.ok(after.ack - before.ack > 90, "Input cadence stays near 60 Hz while rendering at 30 FPS");
  await evaluate(sessionId, "const {publishRuntimePerformanceProfile}=await import('/platform/frontend-engine/performanceSettings.js');publishRuntimePerformanceProfile({mode:'manual',targetFps:60,resolutionScale:1});");
  console.log("INDEPENDENT RENDER / INPUT CADENCE", { actualFps, commands: after.ack - before.ack });
}

try {
  const p1 = await newPage(baseUrl, 1440, 900, false, sceneInspectionSetup);
  await waitFor(p1, "document.querySelector('[data-library-card-id=riftball]')");
  const shellBefore = await evaluate(p1, "return document.querySelector('[data-platform-presentation]').getBoundingClientRect().toJSON();");
  await evaluate(p1, "document.querySelector('[data-library-card-id=riftball]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await attachMatchProbe(p1);
  await capture(p1, "waiting-landscape");
  const roomUrl = await evaluate(p1, "return location.href;");
  assert.match(roomUrl, /\/games\/riftball\/[a-z0-9]+/);
  const p2 = await newPage(roomUrl, 1440, 900, false, sceneInspectionSetup);
  await attachMatchProbe(p2);
  await waitFor(p1, "rbProbe.last.started&&!document.querySelector('[aria-modal=true]')", 15000);
  await waitFor(p2, "rbProbe.last.started&&!document.querySelector('[aria-modal=true]')", 15000);
  await verifyRenderedHeadTracking(p1);
  await verifyRenderedHeadTracking(p2);
  await capture(p1, "opening-court");
  const shellAfter = await evaluate(p1, "return document.querySelector('[data-platform-presentation]').getBoundingClientRect().toJSON();");
  for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(shellAfter[dimension] - shellBefore[dimension]) < 1, `Stable shell ${dimension}`);

  await key(p1, "KeyW", "w", true);
  await key(p2, "KeyW", "w", true);
  await delay(850);
  await key(p1, "KeyW", "w", false);
  await key(p2, "KeyW", "w", false);
  await key(p1, "Space", " ", true);
  await delay(120);
  await key(p1, "Space", " ", false);
  await key(p2, "ShiftLeft", "Shift", true);
  await delay(60);
  await key(p2, "ShiftLeft", "Shift", false);
  await key(p1, "KeyE", "e", true);
  await delay(300);
  await key(p1, "KeyQ", "q", true);
  await delay(65);
  await key(p1, "KeyQ", "q", false);
  await key(p1, "KeyE", "e", false);
  await delay(500);
  await key(p1, "KeyE", "e", true);
  await delay(650);
  await key(p1, "KeyE", "e", false);
  await delay(300);
  await capture(p1, "duel-landscape");
  const actions = await evaluate(p1, "return{actions:rbProbe.actions,players:rbProbe.last.players,ball:rbProbe.last.ball,minSeparation:rbProbe.minSeparation};");
  for (const action of ["run", "jump", "dash", "charge", "strike", "feint"]) assert.ok(actions.actions.includes(action), `Missing real authoritative ${action}`);
  assert.ok(actions.minSeparation >= 0.84, `Athletes overlap: ${actions.minSeparation}`);
  console.log("TWO CLIENTS / ACTIONS / SEPARATION", { roomUrl, actions: actions.actions, minSeparation: actions.minSeparation });
  await verifyRenderCadence(p1);

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p1);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p1);
  await delay(650);
  await capture(p1, "duel-portrait");
  const dimensions = await evaluate(p1, "const canvas=document.querySelector('#game-canvas');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,canvas:canvas.getBoundingClientRect().toJSON(),host:canvas.parentElement.getBoundingClientRect().toJSON()};");
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1);
  assert.ok(dimensions.canvas.width <= dimensions.host.width + 1);
  await waitFor(p1, "document.querySelector('[data-platform-touch-game=riftball][data-active=true]')&&rbProbe.last.players.p1.grounded", 5000);
  const touchPoints = await evaluate(p1, `
    const point=id=>{const b=document.querySelector('[data-platform-touch-game=riftball] [data-touch-control-id='+id+']').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}};
    return{move:{...point('move'),id:1},jump:{...point('jump'),id:2},before:{...rbProbe.last.players.p1}};
  `);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoints.move, touchPoints.jump] }, p1);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchPoints.move, y: touchPoints.move.y - 30 }, touchPoints.jump] }, p1);
  await delay(260);
  const touchMovement = await evaluate(p1, "return{...rbProbe.last.players.p1};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p1);
  assert.ok(Math.hypot(touchMovement.x - touchPoints.before.x, touchMovement.z - touchPoints.before.z) > 0.2);
  assert.ok(touchMovement.y > touchPoints.before.y + 0.2, "Simultaneous touch movement/jump reaches authority");
  await waitFor(p1, "rbProbe.last.players.p1.grounded", 3000);
  const strikeTouch = await evaluate(p1, `
    const b=document.querySelector('[data-platform-touch-game=riftball] [data-touch-control-id=strike]').getBoundingClientRect();
    return{point:{x:b.x+b.width/2,y:b.y+b.height/2,id:3},facing:rbProbe.last.players.p1.facing};
  `);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoints.move, strikeTouch.point] }, p1);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchPoints.move, y: touchPoints.move.y - 18 }, { ...strikeTouch.point, x: strikeTouch.point.x + 28 }] }, p1);
  await delay(220);
  const heldStrike = await evaluate(p1, "return{charge:rbProbe.last.players.p1.chargeSec,facing:rbProbe.last.players.p1.facing};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p1);
  assert.ok(heldStrike.charge > 0.1, "A touch strike can charge during analog movement");
  assert.ok(Math.abs(Math.atan2(Math.sin(heldStrike.facing - strikeTouch.facing), Math.cos(heldStrike.facing - strikeTouch.facing))) > 0.06, "A held strike accepts an aiming drag");
  await evaluate(p1, "window.originalRiftballCanvas=document.querySelector('#game-canvas');");
  await click(p1, '[aria-label="Customize touch controls"]');
  await waitFor(p1, "document.querySelector('[role=dialog]')?.textContent.includes('Edit controls')");
  assert.ok(await evaluate(p1, "return ['Strike','Dash','Jump','Feint'].every(label=>document.querySelector('[role=dialog]').textContent.includes(label));"));
  await clickText(p1, "Cancel");
  assert.ok(await evaluate(p1, "return originalRiftballCanvas===document.querySelector('#game-canvas');"));
  console.log("SIMULTANEOUS TOUCH / LIVE EDITOR / PORTRAIT PASSED");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, p1);
  await delay(350);
  await key(p1, "KeyR", "r", true);
  await key(p1, "KeyR", "r", false);
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, p2);
  await waitFor(p2, "rbProbe.last.players.p2.grounded", 3000);
  const shellPoints = await evaluate(p2, `
    const visible=selector=>[...document.querySelectorAll(selector)].find(element=>element.getBoundingClientRect().width>0);
    const point=element=>{const b=element.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}};
    return{move:{...point(visible('[data-stick=left]')),id:1},jump:{...point(visible('[data-action=x]')),id:2},before:{...rbProbe.last.players.p2}};
  `);
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [shellPoints.move, shellPoints.jump] }, p2);
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...shellPoints.move, y: shellPoints.move.y - 26 }, shellPoints.jump] }, p2);
  await delay(280);
  const shellMovement = await evaluate(p2, "return{...rbProbe.last.players.p2};");
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, p2);
  assert.ok(Math.hypot(shellMovement.x - shellPoints.before.x, shellMovement.z - shellPoints.before.z) > 0.25);
  assert.ok(shellMovement.y > shellPoints.before.y + 0.2, "Standard shell X jumps during analog movement");
  console.log("STANDARD SHELL ANALOG MOVEMENT / JUMP PASSED");

  if (!quickRun) {
    // Leave the rival in a clear defensive lane, then score through real inputs.
    await key(p2, "KeyD", "d", true);
    await delay(900);
    await key(p2, "KeyD", "d", false);
    await evaluate(p2, `window.rbSideline=setInterval(()=>{const snapshot=rbProbe.last;if(!snapshot||snapshot.gameOver||document.querySelector('[aria-modal=true]'))return;const player=snapshot.players.p2;window.dispatchEvent(new CustomEvent('platformtouchinput',{detail:{gameId:'riftball',type:'axis',controlId:'move',x:player.x>-6?0.8:0,y:0}}));},1000/60);`);
    await startLegalScoringDriver(p1);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await delay(5000);
      const status = await evaluate(p1, "return{timer:rbProbe.last.timer,phase:rbProbe.last.phase,goals:rbProbe.last.goalSerial,players:Object.values(rbProbe.last.players).map(player=>({id:player.id,x:player.x,z:player.z,score:player.score,action:player.action})),ball:rbProbe.last.ball};");
      console.log("MATCH PROGRESS", status);
      if (status.phase === "finished") break;
    }
    await waitFor(p1, "rbProbe.last.gameOver", 10000);
    await waitFor(p2, "rbProbe.last.gameOver", 10000);
    await waitFor(p1, "document.querySelector('[aria-label=\"Match results\"]')", 8000);
    const finish = await evaluate(p1, "return{winner:rbProbe.last.winner,goals:rbProbe.last.goalSerial,score:rbProbe.last.players.p1.score,minSeparation:rbProbe.minSeparation,invalidBodies:rbProbe.invalidBodies,replaySeen:rbProbe.replaySeen};");
    assert.equal(finish.winner, "p1");
    assert.ok(finish.goals >= 1, "Actual input-driven scoring must occur");
    assert.equal(finish.invalidBodies, 0);
    assert.equal(finish.replaySeen, true, "A real winning point must show its bounded replay before results");
    await capture(p1, "results");
    await evaluate(p1, "clearInterval(rbAutopilot);");
    await evaluate(p2, "clearInterval(rbSideline);");
    await clickText(p1, "Run it back");
    await waitFor(p2, "[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Accept rematch'))");
    await clickText(p2, "Accept rematch");
    await waitFor(p1, "rbProbe.last.roundId===2&&!rbProbe.last.gameOver");
    assert.equal(await evaluate(p1, "return rbProbe.last.players.p1.seriesWins;"), 1);
    await send("Page.reload", {}, p1);
    await attachMatchProbe(p1);
    assert.equal(await evaluate(p1, "return rbProbe.last.roundId;"), 2);
    await waitFor(p1, "rbProbe.last.started&&!document.querySelector('[aria-modal=true]')", 15000);
    console.log("SCORING / RESULTS / SERIES / REMATCH / REJOIN", finish);
  }
  await evaluate(p1, "[...document.querySelectorAll('[data-action=home]')].find(element=>element.getBoundingClientRect().width>0).click();");
  await waitFor(p1, "document.querySelector('[aria-label=\"Exit game confirmation\"]')");
  await clickText(p1, "Go to Home");
  await waitFor(p1, "!document.querySelector('[data-riftball-hud]')&&document.querySelector('[data-library-card-id=riftball]')");
  await evaluate(p1, "document.querySelector('[data-library-card-id=riftball]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
  await attachMatchProbe(p1);
  await capture(p1, "reopened");
  assert.equal(await evaluate(p1, "return document.querySelectorAll('[data-riftball-hud]').length;"), 1);
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("RIFTBALL BROWSER CHECKS PASSED");
} catch (error) {
  console.error("BROWSER ERRORS", browser.exceptions, browser.failures);
  throw error;
} finally {
  await browser.close();
}
