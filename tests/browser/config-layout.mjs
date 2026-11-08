import assert from "node:assert/strict";
import { createBrowserTestSession, delay } from "./support/chrome.mjs";

const browser = await createBrowserTestSession("config-layout");
const baseUrl = process.env.PLATFORM_BASE_URL || "http://localhost:3000";
const { send, evaluate, waitFor, newPage, capture, click, clickText } = browser;

async function readSettingsGeometry(sessionId) {
  return evaluate(sessionId, `
    const heading=[...document.querySelectorAll('h1')].find(element=>element.textContent==='Settings');
    const panel=heading.parentElement;
    const preview=document.querySelector('[role=img][aria-label*="touch layout"]');
    const bounds=element=>element.getBoundingClientRect().toJSON();
    return{
      panel:bounds(panel),scrollTop:panel.scrollTop,scrollHeight:panel.scrollHeight,
      preview:bounds(preview),previewFigure:bounds(preview.closest('figure')),
      mode:bounds(document.querySelector('#touch-control-mode')),
      expanded:bounds(document.querySelector('#touch-expanded')),
      audio:bounds(document.querySelector('[aria-label="Lobby music volume"]')),
      mute:bounds(document.querySelector('[aria-label="Mute lobby music"], [aria-label="Unmute lobby music"]')),
      audioRow:bounds(document.querySelector('[aria-label="Lobby music volume"]').parentElement.parentElement),
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      shell:bounds(document.querySelector('[data-platform-presentation]')),
    };
  `);
}

function assertInsidePanel(element, panel, description) {
  assert.ok(element.left >= panel.left - 1 && element.right <= panel.right + 1, `${description} must fit horizontally`);
  assert.ok(element.top >= panel.top - 1 && element.bottom <= panel.bottom + 1, `${description} must be visible inside the settings screen`);
}

try {
  const page = await newPage(baseUrl, 2105, 1170);
  await waitFor(page, "document.querySelector('[aria-label=Config]')");
  const homeShell = await evaluate(page, "return document.querySelector('[data-platform-presentation]').getBoundingClientRect().toJSON();");
  await click(page, "[aria-label=Config]");
  await waitFor(page, "document.querySelector('#touch-control-mode')");
  await delay(300);
  const desktop = await readSettingsGeometry(page);
  await capture(page, "desktop");
  assertInsidePanel(desktop.mode, desktop.panel, "Touch visibility preference");
  assertInsidePanel(desktop.expanded, desktop.panel, "Expanded play area preference");
  assertInsidePanel(desktop.audio, desktop.panel, "Audio preference");
  assert.ok(desktop.mute.left > desktop.audio.right, "Mute action belongs at the right end of the music row");
  assert.ok(desktop.audioRow.right - desktop.mute.right <= 24, "Mute action aligns with the right row padding");
  await click(page, '[aria-label="Mute lobby music"]');
  await waitFor(page, "document.querySelector('[aria-label=\"Unmute lobby music\"]')?.getAttribute('aria-pressed')==='true'");
  const muted = await readSettingsGeometry(page);
  assert.ok(Math.abs(muted.mute.right - desktop.mute.right) < 1, "The Muted state stays aligned at the far right");
  await click(page, '[aria-label="Unmute lobby music"]');
  assert.ok(desktop.preview.width >= desktop.previewFigure.width * 0.97, "Landscape preview should fill its column instead of sitting inside a wide empty frame");
  for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(desktop.shell[dimension] - homeShell[dimension]) < 1, `Stable console ${dimension}`);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const mobile = viewport.width <= 844;
    await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile }, page);
    await evaluate(page, "[...document.querySelectorAll('h1')].find(element=>element.textContent==='Settings').parentElement.scrollTop=0;");
    await delay(200);
    const geometry = await readSettingsGeometry(page);
    assert.ok(geometry.scrollWidth <= geometry.width + 1, `No page overflow at ${viewport.width}px`);
    assert.ok(geometry.preview.left >= geometry.panel.left - 1 && geometry.preview.right <= geometry.panel.right + 1, "Preview stays within the available screen");
    assert.ok(Math.abs(geometry.preview.width / geometry.preview.height - 844 / 390) < 0.02, "Landscape preview keeps its authored aspect ratio");
    if (viewport.width >= 1440) {
      assertInsidePanel(geometry.expanded, geometry.panel, "Desktop play area preference");
      assertInsidePanel(geometry.audio, geometry.panel, "Desktop audio preference");
    }
    const scrollPoint = { x: geometry.panel.x + geometry.panel.width / 2, y: geometry.panel.y + geometry.panel.height / 2 };
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...scrollPoint, deltaX: 0, deltaY: 1800 }, page);
    await delay(200);
    const scrolled = await readSettingsGeometry(page);
    assertInsidePanel(scrolled.audio, scrolled.panel, "Audio remains reachable by scrolling");
    await capture(page, `${viewport.width}-scrolled`);
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page);
  await evaluate(page, "[...document.querySelectorAll('h1')].find(element=>element.textContent==='Settings').parentElement.scrollTop=0;");
  await delay(150);
  await capture(page, "phone");
  await clickText(page, "Portrait");
  await delay(150);
  const portrait = await readSettingsGeometry(page);
  assert.ok(Math.abs(portrait.preview.width / portrait.preview.height - 390 / 700) < 0.02);
  await clickText(page, "Edit layout");
  await waitFor(page, "document.querySelector('[aria-modal=true]')?.textContent.includes('Edit controls')");
  await clickText(page, "Cancel");
  assert.equal(browser.exceptions.length, 0, JSON.stringify(browser.exceptions));
  assert.equal(browser.failures.length, 0, JSON.stringify(browser.failures));
  console.log("CONFIG LAYOUT / PREVIEW FIT / SCROLL REACHABILITY / STABLE SHELL PASSED");
} finally {
  await browser.close();
}
