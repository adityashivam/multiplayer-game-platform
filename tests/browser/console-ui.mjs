import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

/**
 * Console-grade look-and-feel checks at the four target screen sizes: nothing
 * overflows or truncates, the backdrop follows focus, the focus ring sits on
 * the selected card, launching zooms into a title card, and the first-load
 * reveal respects reduced motion. Portrait phones also get the disc library:
 * names on a turning disc beside the selected game's art and description.
 */
const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3100";
const browser = await createBrowserTestSession("console-ui");
const { evaluate, waitFor, newPage, send, key, capture } = browser;
const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080, mobile: false },
  { name: "handheld", width: 1280, height: 800, mobile: false },
  { name: "phone-landscape", width: 844, height: 390, mobile: true },
  { name: "phone-portrait", width: 390, height: 844, mobile: true },
];
const BACKDROP_SWAP_BUDGET_MS = 400;
const pages = [];

async function openLibrary(viewport, initScript = "") {
  const page = await newPage("about:blank", viewport.width, viewport.height, viewport.mobile, initScript);
  pages.push(page);
  await send("Page.navigate", { url: baseUrl }, page);
  await waitFor(page, "document.querySelectorAll('[data-library-card-id]').length>=4&&document.querySelector('[data-library-backdrop] img')", 20000);
  // Measure layout only after web fonts load, so text widths are final.
  await evaluate(page, "await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,700));");
  return page;
}

async function verifyFit(page, viewport) {
  const fit = await evaluate(page, `
    const label=document.querySelector('[class*="filterTriggerLabel"]');
    const dock=document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect();
    return{scrollWidth:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight,
      labelTruncated:label?label.scrollWidth>label.clientWidth+1:false,
      analogSticks:document.querySelectorAll('[data-stick]').length,
      dock:{left:dock.left,right:dock.right,bottom:dock.bottom}};
  `);
  assert.ok(fit.scrollWidth <= fit.width + 1, `${viewport.name}: no horizontal overflow (${fit.scrollWidth} > ${fit.width})`);
  assert.equal(fit.labelTruncated, false, `${viewport.name}: the genre filter label is not truncated`);
  assert.equal(fit.analogSticks, 0, `${viewport.name}: the library shell shows no analog sticks`);
  assert.ok(fit.dock.left >= 0 && fit.dock.right <= fit.width + 1 && fit.dock.bottom <= fit.height + 1, `${viewport.name}: the dock fits the screen`);
}

async function verifyFocusRing(page, viewport) {
  const alignment = await evaluate(page, `
    const ring=document.querySelector('[class*="focusGlide"]');
    const selected=document.querySelector('[data-library-card-id][aria-pressed="true"] [data-card-media]');
    if(!ring||!selected)return null;
    const a=ring.getBoundingClientRect(),b=selected.getBoundingClientRect();
    return{dx:Math.abs((a.left+a.width/2)-(b.left+b.width/2)),gap:a.top-b.bottom,barHeight:a.height,ready:ring.dataset.ready,
      outline:getComputedStyle(selected).outlineStyle,borderWidth:parseFloat(getComputedStyle(ring).borderTopWidth)||0};
  `);
  assert.ok(alignment, `${viewport.name}: a selection bar and a selected card exist`);
  assert.equal(alignment.ready, "true");
  assert.ok(alignment.dx < 3, `${viewport.name}: the selection bar is centred under the selected card ${JSON.stringify(alignment)}`);
  assert.ok(alignment.gap > 0 && alignment.gap < 14 && alignment.barHeight <= 4, `${viewport.name}: the selection is a short bar just below the card, not an outline ${JSON.stringify(alignment)}`);
  assert.equal(alignment.borderWidth, 0, `${viewport.name}: the selection draws no outline`);
}

async function verifyBackdropFollowsFocus(page, viewport) {
  const before = await evaluate(page, "return document.querySelector('[data-library-backdrop]').dataset.libraryBackdrop;");
  await evaluate(page, "document.querySelector('[data-library-card-id][aria-pressed=\"true\"]').focus();");
  const startedAt = Date.now();
  await key(page, "ArrowRight", "ArrowRight", true);
  await key(page, "ArrowRight", "ArrowRight", false);
  await waitFor(page, `document.querySelector('[data-library-backdrop]').dataset.libraryBackdrop!==${JSON.stringify(before)}`, 3000);
  await waitFor(page, "[...document.querySelectorAll('[data-library-backdrop] img')].at(-1)?.complete", 3000);
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs <= BACKDROP_SWAP_BUDGET_MS + 250, `${viewport.name}: the next backdrop was ready in ${elapsedMs} ms`);
}

async function verifyReadableText(page, viewport) {
  const tinyText = await evaluate(page, `
    const screen=document.querySelector('[data-platform-screen]');
    return [...screen.querySelectorAll('*')].filter((element)=>{
      if(element.closest('svg'))return false;
      const style=getComputedStyle(element);
      const ownText=[...element.childNodes].some((node)=>node.nodeType===3&&node.textContent.trim());
      const box=element.getBoundingClientRect();
      return ownText&&box.width>0&&style.visibility!=='hidden'&&!style.fontFamily.includes('Material')&&parseFloat(style.fontSize)<11;
    }).map((element)=>element.textContent.trim().slice(0,30)+' '+getComputedStyle(element).fontSize);
  `);
  assert.deepEqual(tinyText, [], `${viewport.name}: platform text is at least 11px`);
}

async function readGridZoom(page) {
  return evaluate(page, `
    const grid=document.querySelector('[data-game-grid]');
    return{columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      scale:Number(getComputedStyle(grid).getPropertyValue('--library-card-scale')),
      morphing:document.getAnimations().filter((animation)=>animation.effect?.target?.dataset?.libraryCardId).length};
  `);
}

async function verifyCardZoom(page, viewport) {
  const before = await readGridZoom(page);
  await evaluate(page, "document.querySelector('[aria-label=\"Smaller cards\"]').click();");
  const firstStep = await readGridZoom(page);
  assert.ok(firstStep.scale < before.scale, `${viewport.name}: smaller cards shrink the scale`);
  assert.ok(firstStep.morphing > 0, `${viewport.name}: cards glide to their new places instead of jumping`);
  await evaluate(page, "for(let step=0;step<8;step+=1){const button=document.querySelector('[aria-label=\"Smaller cards\"]');if(button.disabled)break;button.click();await new Promise(resolve=>setTimeout(resolve,60));}");
  const zoomedOut = await readGridZoom(page);
  assert.ok(zoomedOut.columns > before.columns, `${viewport.name}: zooming out shows more columns (${before.columns} -> ${zoomedOut.columns})`);

  await evaluate(page, `
    const grid=document.querySelector('[data-game-grid]');
    const box=grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,ctrlKey:true,bubbles:true,cancelable:true,clientX:box.left+20,clientY:box.top+20}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  `);
  const pinched = await readGridZoom(page);
  assert.ok(pinched.scale > zoomedOut.scale && pinched.scale < 1, `${viewport.name}: a pinch zooms continuously (${zoomedOut.scale} -> ${pinched.scale})`);

  await evaluate(page, "const slider=document.querySelector('input[type=range][aria-label=\"Card size\"]');if(slider&&getComputedStyle(slider).display!=='none'){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'1');slider.dispatchEvent(new Event('input',{bubbles:true}));}else{for(let step=0;step<8;step+=1){const button=document.querySelector('[aria-label=\"Bigger cards\"]');const scale=Number(getComputedStyle(document.querySelector('[data-game-grid]')).getPropertyValue('--library-card-scale'));if(scale>=1)break;button.click();await new Promise(resolve=>setTimeout(resolve,60));}}");
  await delay(500);
  await verifyFocusRing(page, viewport);
  await evaluate(page, "localStorage.removeItem('platform.library-card-scale.v1');");
}

const GRID_LAYOUT_SCRIPT = "try{localStorage.setItem('platform.library-layout.v1','grid')}catch{}";

async function readDiscState(page) {
  return evaluate(page, `
    const selected=document.querySelector('[data-library-disc] [data-library-card-id][aria-pressed="true"]');
    const spotlight=document.querySelector('[data-disc-spotlight]');
    const band=document.querySelector('[data-library-disc] [class*="band"]')?.getBoundingClientRect();
    const box=selected?.getBoundingClientRect();
    return{selected:selected?.dataset.libraryCardId,spotlight:spotlight?.dataset.discSpotlight,
      order:[...document.querySelectorAll('[data-library-disc] [data-library-card-id]')].map((item)=>item.dataset.libraryCardId),
      title:spotlight?.querySelector('h2')?.textContent,description:spotlight?.querySelector('p:nth-of-type(2)')?.textContent??'',
      playLabel:spotlight?.querySelector('[aria-label^="Play "]')?.getAttribute('aria-label'),
      inBand:Boolean(box&&band&&Math.abs((box.top+box.height/2)-(band.top+band.height/2))<4),
      overflow:document.documentElement.scrollWidth>innerWidth};
  `);
}

async function verifyDiscLibrary() {
  // Pages share storage, so clear the grid choice the portrait grid checks made.
  const page = await openLibrary({ width: 390, height: 844, mobile: true }, "try{localStorage.removeItem('platform.library-layout.v1')}catch{}");
  await waitFor(page, "document.querySelector('[data-library-disc]')&&document.querySelector('[data-disc-spotlight]')");
  await evaluate(page, "await new Promise(resolve=>setTimeout(resolve,500));");
  await capture(page, "phone-portrait-disc");
  const start = await readDiscState(page);
  assert.ok(start.selected && start.selected === start.spotlight, `the spotlight shows the selected game ${JSON.stringify(start)}`);
  assert.ok(start.inBand, "the selected name rests in the notch band");
  assert.ok(start.description.length > 20 && start.playLabel === `Play ${start.title}`, "the spotlight shows the description and a Play button");
  assert.equal(start.overflow, false, "the disc layout fits the screen");
  assert.equal(await evaluate(page, "return document.querySelector('[aria-label=\"Disc layout\"]').getAttribute('aria-pressed');"), "true");

  // Arrow keys and the wheel step one game along the rim.
  await evaluate(page, "document.querySelector('[data-library-disc] [aria-pressed=\"true\"]').focus();");
  await key(page, "ArrowDown", "ArrowDown", true);
  await key(page, "ArrowDown", "ArrowDown", false);
  await evaluate(page, "await new Promise(resolve=>setTimeout(resolve,500));");
  const stepped = await readDiscState(page);
  assert.notEqual(stepped.selected, start.selected, "ArrowDown moves to the next game");
  assert.equal(stepped.spotlight, stepped.selected);
  assert.ok(stepped.inBand, "the disc turns the new selection into the band");
  await evaluate(page, "const disc=document.querySelector('[data-library-disc]');disc.dispatchEvent(new WheelEvent('wheel',{deltaY:-40,bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,500));");
  assert.equal((await readDiscState(page)).selected, start.selected, "one wheel notch back returns to the first game");

  // A drag turns the disc and settles on a game.
  await evaluate(page, `
    const disc=document.querySelector('[data-library-disc]');const box=disc.getBoundingClientRect();
    const send=(type,y)=>disc.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:9,button:0,isPrimary:true,clientX:box.left+60,clientY:y}));
    const startY=box.top+box.height/2;send('pointerdown',startY);
    for(let step=1;step<=10;step+=1){send('pointermove',startY-step*10);await new Promise(resolve=>setTimeout(resolve,16));}
    send('pointerup',startY-100);await new Promise(resolve=>setTimeout(resolve,800));
  `);
  const dragged = await readDiscState(page);
  assert.notEqual(dragged.selected, start.selected, "dragging up turns the disc to later games");
  assert.ok(dragged.inBand && dragged.spotlight === dragged.selected, `the disc settles on a game ${JSON.stringify(dragged)}`);

  // Switching to the grid is remembered; switching back restores the disc.
  await evaluate(page, "document.querySelector('[aria-label=\"Grid layout\"]').click();");
  await waitFor(page, "document.querySelector('[data-game-grid]')&&!document.querySelector('[data-library-disc]')");
  assert.equal(await evaluate(page, "return localStorage.getItem('platform.library-layout.v1');"), "grid");
  await evaluate(page, "document.querySelector('[aria-label=\"Disc layout\"]').click();");
  await waitFor(page, "document.querySelector('[data-library-disc]')");

  // More opens the full preview: title-free scene art that bleeds to the
  // edges, the description, and Play, all inside the screen.
  await evaluate(page, "document.querySelector('[aria-label^=\"More about\"]').click();");
  await waitFor(page, "document.querySelector('dialog[open] [data-showcase-art]')");
  await evaluate(page, "await new Promise(resolve=>setTimeout(resolve,500));");
  const preview = await evaluate(page, `
    const dialog=document.querySelector('dialog[open]');const art=dialog.querySelector('[class*=showcaseArtwork]').getBoundingClientRect();
    const play=dialog.querySelector('[aria-label^="Play "]').getBoundingClientRect();
    return {art:dialog.querySelector('[data-showcase-art]').dataset.showcaseArt,artLeft:art.left,artWidth:art.width,
      description:dialog.querySelector('[class*=showcaseDescription]')?.getClientRects().length>0,
      playInside:play.bottom<=innerHeight&&play.top>=0};
  `);
  assert.equal(preview.art, "scene", "the preview uses the game's scene art, not the titled cover");
  assert.ok(preview.artLeft === 0 && preview.artWidth === 390, `the art bleeds edge to edge ${JSON.stringify(preview)}`);
  assert.ok(preview.description && preview.playInside, `the preview shows the description and Play ${JSON.stringify(preview)}`);
  await capture(page, "phone-portrait-preview");
  await evaluate(page, "document.querySelector('dialog[open] button').click();");
  await waitFor(page, "!document.querySelector('dialog[open]')");

  // Each theme's disc style keeps the selection in the band and fits the screen.
  for (const [themeName, discStyle] of [["Ember", "editorial"], ["Graphite", "instrument"], ["8-Bit", "instrument"], ["Classic Disc", "classic"], ["Kaboom", "cinematic"]]) {
    await evaluate(page, `
      document.querySelector('[aria-label=Config]').click();await new Promise(resolve=>setTimeout(resolve,700));
      [...document.querySelectorAll('[aria-label="Platform themes"] button[aria-pressed]')].find((button)=>button.textContent.startsWith(${JSON.stringify(themeName)})).click();
      await new Promise(resolve=>setTimeout(resolve,700));document.querySelector('[aria-label=Multi]').click();
    `);
    await waitFor(page, `document.querySelector('[data-disc-style="${discStyle}"]')`);
    await evaluate(page, "await new Promise(resolve=>setTimeout(resolve,900));");
    const styled = await readDiscState(page);
    assert.ok(styled.inBand && !styled.overflow, `${themeName} (${discStyle}) keeps the selection in place and fits ${JSON.stringify(styled)}`);
    await capture(page, `phone-portrait-disc-${themeName.toLowerCase().replace(/\s+/g, "-")}`);
  }

  // Enter plays the selected game with the launch zoom.
  await evaluate(page, "await new Promise(resolve=>setTimeout(resolve,400));document.querySelector('[data-library-disc] [aria-pressed=\"true\"]').focus();");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await waitFor(page, "location.pathname.startsWith('/games/')", 10000);
  console.log("DISC LIBRARY PASSED");
}

async function verifyLaunchZoom(page, viewport) {
  await evaluate(page, "document.querySelector('[data-library-card-id][aria-pressed=\"true\"]').focus();");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page);
  await waitFor(page, "location.pathname.startsWith('/games/')", 10000);
  await waitFor(page, "document.querySelector('[data-launch-overlay]')", 3000);
  await capture(page, `${viewport.name}-launch`);
  await waitFor(page, "!document.querySelector('[data-launch-overlay]')", 4000);
}

try {
  for (const viewport of VIEWPORTS) {
    // Grid checks run on every size; portrait phones choose the grid explicitly
    // because their default is the disc, which has its own checks below.
    const page = await openLibrary(viewport, viewport.name === "phone-portrait" ? GRID_LAYOUT_SCRIPT : "");
    await capture(page, `${viewport.name}-library`);
    await verifyFit(page, viewport);
    await verifyFocusRing(page, viewport);
    await verifyBackdropFollowsFocus(page, viewport);
    await delay(400);
    await verifyFocusRing(page, viewport);
    await verifyReadableText(page, viewport);
    await verifyCardZoom(page, viewport);
    if (!viewport.mobile) await verifyLaunchZoom(page, viewport);
    console.log("CONSOLE UI PASSED", viewport.name);
  }

  await verifyDiscLibrary();

  const reducedMotion = await newPage("about:blank", 1280, 800, false);
  pages.push(reducedMotion);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, reducedMotion);
  await send("Page.navigate", { url: baseUrl }, reducedMotion);
  await waitFor(reducedMotion, "document.querySelectorAll('[data-library-card-id]').length>=4", 20000);
  assert.equal(await evaluate(reducedMotion, "return Boolean(document.querySelector('[data-boot-reveal]'));"), false, "reduced motion skips the logo reveal");
  console.log("REDUCED MOTION PASSED");

  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  console.log("CONSOLE UI CHECKS PASSED");
} finally {
  await browser.close();
}
