import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** An isolated browser profile; never attaches to or closes a user's Chrome. */
export async function createBrowserTestSession(prefix) {
  const profile = await mkdtemp(path.join(tmpdir(), `${prefix}-chrome-`));
  const executable = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chrome = spawn(executable, ["--headless", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const closed = new Promise((resolve) => { chrome.once("exit", resolve); chrome.once("error", resolve); });
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
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result);
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
  async function evaluate(sessionId, source) {
    const evaluated = await send("Runtime.evaluate", { expression: `(async()=>{${source}})()`, awaitPromise: true, returnByValue: true }, sessionId);
    if (evaluated.exceptionDetails) throw Error(JSON.stringify(evaluated.exceptionDetails));
    return evaluated.result.value;
  }
  async function waitFor(sessionId, expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(sessionId, `return Boolean(${expression});`)) return;
      await delay(90);
    }
    throw Error(`Timed out: ${expression}`);
  }
  async function newPage(url, width = 1440, height = 900, mobile = false, initializationScript = "") {
    const { targetId } = await send("Target.createTarget", { url: "about:blank", newWindow: true });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    for (const domain of ["Page", "Runtime", "Network"]) await send(`${domain}.enable`, {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
    if (initializationScript) await send("Page.addScriptToEvaluateOnNewDocument", { source: initializationScript }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    return sessionId;
  }
  async function capture(sessionId, name) {
    const screenshot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    const screenshotPath = path.join(tmpdir(), `${prefix}-${name}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    return screenshotPath;
  }
  async function click(sessionId, selector) {
    const point = await evaluate(sessionId, `const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing control '+${JSON.stringify(selector)});const bounds=element.getBoundingClientRect();return{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};`);
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point }, sessionId);
  }
  async function clickText(sessionId, text) {
    await evaluate(sessionId, `const button=[...document.querySelectorAll('button')].find(button=>{const clone=button.cloneNode(true);clone.querySelectorAll('[aria-hidden=true]').forEach(icon=>icon.remove());return clone.textContent.trim()===${JSON.stringify(text)}&&button.getBoundingClientRect().width>0});if(!button)throw Error('Missing button '+${JSON.stringify(text)});button.click();`);
  }
  async function key(sessionId, code, keyValue, active) {
    const keyCodes = { KeyW: 87, KeyA: 65, KeyD: 68, KeyS: 83, KeyC: 67, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32, ShiftLeft: 16, KeyE: 69, KeyR: 82, Escape: 27 };
    await send("Input.dispatchKeyEvent", { type: active ? "keyDown" : "keyUp", code, key: keyValue, windowsVirtualKeyCode: keyCodes[code] || 0 }, sessionId);
  }
  return {
    send, evaluate, waitFor, newPage, capture, click, clickText, key, exceptions, failures,
    async close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error("Browser closed")); }
      pending.clear();
      chrome.kill("SIGTERM");
      await Promise.race([closed, delay(3000)]);
      if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill("SIGKILL"); await closed; }
      await rm(profile, { recursive: true, force: true });
    },
  };
}

export const delay = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
