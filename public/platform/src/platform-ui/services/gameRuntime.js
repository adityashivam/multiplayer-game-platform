import { loadScript } from "../utils/loadScript.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const PLATFORM_DISPOSE_GAME_EVENT = "platform:dispose-game";
const GAME_SCRIPT_PREFIX = "game-runtime-";
const UNITY_SCRIPT_PREFIX = "unity-runtime-";
const GAME_ROOT_ID = "game-root";
const DOM_GAME_CONTAINER_ID = "dom-game-container";
const GAME_CANVAS_ID = "game-canvas";
const UNITY_CONTAINER_ID = "unity-game-container";
const UNITY_CANVAS_ID = "unity-game-canvas";
const GAME_IFRAME_ID = "game-iframe";

export function getGameRoute() {
  const match = window.location.pathname.match(/^\/games\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  return { gameId: match[1], roomId: match[2] || null };
}

export function getGameRuntimeSpec(game) {
  const engine = game?.engine || "kaboom";
  const runtime = game?.runtime || {};
  const runtimeKind = runtime.kind || (engine === "unity-webgl" ? "unity-webgl" : "module");
  const mount = runtime.mount || (runtimeKind === "module" ? "canvas" : runtimeKind === "iframe" ? "iframe" : "unity");

  return {
    engine,
    kind: runtimeKind,
    mount,
    runtime,
  };
}

function appendSessionKey(src, sessionKey) {
  if (!src) return src;

  try {
    const url = new URL(src, window.location.origin);
    url.searchParams.set("session", sessionKey);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}session=${sessionKey}`;
  }
}

async function loadOptionalScript(src, id) {
  if (!src) return;
  await loadScript(src, id ? { id } : undefined);
}

async function preloadModuleDependencies(game) {
  const { engine, runtime } = getGameRuntimeSpec(game);
  const preloadScripts = Array.isArray(runtime.preloadScripts) ? runtime.preloadScripts : [];

  if (runtime.socketIo !== false && (runtime.socketIo === true || engine === "kaboom")) {
    await loadOptionalScript("/socket.io/socket.io.js", "socket-io");
  }

  if (runtime.kaboom !== false && (runtime.kaboom === true || engine === "kaboom")) {
    await loadOptionalScript("https://unpkg.com/kaboom/dist/kaboom.js", "kaboom-lib");
  }

  for (const preload of preloadScripts) {
    if (typeof preload === "string") {
      await loadOptionalScript(preload);
      continue;
    }

    if (preload?.src) {
      await loadScript(preload.src, {
        id: preload.id,
        type: preload.type,
      });
    }
  }
}

function getUnityRuntimeConfig(game) {
  const { runtime } = getGameRuntimeSpec(game);
  const config = runtime.unity || runtime;

  if (!config.loaderUrl || !config.dataUrl || !config.frameworkUrl || !config.codeUrl) {
    throw new Error(`Unity game "${game?.id || "unknown"}" is missing loader/data/framework/code URLs.`);
  }

  return config;
}

function resetUnityMount() {
  if (typeof document === "undefined") return;

  const container = document.getElementById(UNITY_CONTAINER_ID);
  const canvas = document.getElementById(UNITY_CANVAS_ID);

  if (container) {
    delete container.dataset.unityLoading;
    delete container.dataset.unityReady;
    container.style.removeProperty("--unity-load-progress");
  }

  if (canvas) {
    const width = canvas.width || 0;
    const height = canvas.height || 0;

    if (width || height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
}

function resetIframeMount() {
  if (typeof document === "undefined") return;

  const frame = document.getElementById(GAME_IFRAME_ID);
  if (!frame) return;

  frame.removeAttribute("src");
  frame.removeAttribute("srcdoc");
}

async function loadModuleGame(game) {
  const gameRoot = document.getElementById(GAME_ROOT_ID);
  const mountTarget =
    document.getElementById(DOM_GAME_CONTAINER_ID) ||
    document.getElementById(GAME_CANVAS_ID) ||
    document.getElementById("game-view");

  if (!gameRoot || !mountTarget) {
    throw new Error("Module game requires a game root and mount target in the platform view.");
  }

  await preloadModuleDependencies(game);

  const sessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptId = `${GAME_SCRIPT_PREFIX}${game.id}-${sessionKey}`;
  const entryUrl = game?.runtime?.entryUrl || `/games/${game.id}/main.js`;

  await loadScript(appendSessionKey(entryUrl, sessionKey), { id: scriptId, type: "module" });

  return {
    engine: getGameRuntimeSpec(game).engine,
    kind: "module",
    mount: getGameRuntimeSpec(game).mount,
    gameId: game.id,
    scriptId,
  };
}

async function loadUnityGame(game) {
  const runtime = getUnityRuntimeConfig(game);
  const container = document.getElementById(UNITY_CONTAINER_ID);
  const canvas = document.getElementById(UNITY_CANVAS_ID);

  if (!container || !canvas) {
    throw new Error("Unity WebGL requires #unity-game-container and #unity-game-canvas in the platform view.");
  }

  resetUnityMount();

  const sessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptId = `${UNITY_SCRIPT_PREFIX}${game.id}-${sessionKey}`;

  await loadScript(appendSessionKey(runtime.loaderUrl, sessionKey), { id: scriptId });

  if (typeof window.createUnityInstance !== "function") {
    throw new Error("Unity loader did not expose createUnityInstance().");
  }

  container.dataset.unityLoading = "true";

  const unityInstance = await window.createUnityInstance(
    canvas,
    {
      dataUrl: runtime.dataUrl,
      frameworkUrl: runtime.frameworkUrl,
      codeUrl: runtime.codeUrl,
      streamingAssetsUrl: runtime.streamingAssetsUrl,
      companyName: runtime.companyName || "Kaboom",
      productName: runtime.productName || game.name || game.id,
      productVersion: runtime.productVersion || "1.0",
      devicePixelRatio: runtime.devicePixelRatio ?? Math.min(window.devicePixelRatio || 1, 2),
      matchWebGLToCanvasSize: runtime.matchWebGLToCanvasSize ?? true,
      webglContextAttributes: runtime.webglContextAttributes,
    },
    (progress) => {
      container.style.setProperty("--unity-load-progress", String(progress));
    },
  );

  delete container.dataset.unityLoading;
  container.dataset.unityReady = "true";

  return {
    engine: "unity-webgl",
    kind: "unity-webgl",
    mount: "unity",
    gameId: game.id,
    scriptId,
    unityInstance,
  };
}

async function loadIframeGame(game) {
  const { runtime } = getGameRuntimeSpec(game);
  const frame = document.getElementById(GAME_IFRAME_ID);

  if (!frame) {
    throw new Error("Iframe game requires #game-iframe in the platform view.");
  }

  const src = runtime.src || runtime.url || game.path;
  if (!src) {
    throw new Error(`Iframe game "${game?.id || "unknown"}" is missing src/url.`);
  }

  frame.src = src;

  return {
    engine: getGameRuntimeSpec(game).engine,
    kind: "iframe",
    mount: "iframe",
    gameId: game.id,
  };
}

export async function loadGameClient(game) {
  if (!game?.id) return null;

  const runtimeSpec = getGameRuntimeSpec(game);

  switch (runtimeSpec.kind) {
    case "unity-webgl":
      return loadUnityGame(game);
    case "iframe":
      return loadIframeGame(game);
    case "module":
    default:
      return loadModuleGame(game);
  }
}

export function removeGameClientScripts(gameId) {
  if (!gameId || typeof document === "undefined") return;

  const selector = [
    `script[id^="${GAME_SCRIPT_PREFIX}${gameId}-"]`,
    `script[id^="${UNITY_SCRIPT_PREFIX}${gameId}-"]`,
    `script[id="game-${gameId}"]`,
  ].join(", ");

  document.querySelectorAll(selector).forEach((node) => node.remove());
}

export async function disposeGameRuntime(runtimeSessionOrGame) {
  if (!runtimeSessionOrGame || typeof window === "undefined") return;

  const runtimeSession =
    typeof runtimeSessionOrGame === "string"
      ? { gameId: runtimeSessionOrGame, kind: "module", engine: "kaboom" }
      : runtimeSessionOrGame;

  switch (runtimeSession.kind) {
    case "unity-webgl":
      try {
        if (typeof runtimeSession.unityInstance?.Quit === "function") {
          await runtimeSession.unityInstance.Quit();
        }
      } catch (error) {
        console.warn("Failed to quit Unity runtime cleanly", error);
      } finally {
        resetUnityMount();
      }
      return;
    case "iframe":
      resetIframeMount();
      return;
    case "module":
    default:
      if (!runtimeSession.gameId) return;
      window.dispatchEvent(new CustomEvent(DISPOSE_GAME_EVENT, { detail: { gameId: runtimeSession.gameId } }));
      window.dispatchEvent(new CustomEvent(PLATFORM_DISPOSE_GAME_EVENT, { detail: { gameId: runtimeSession.gameId } }));
  }
}
