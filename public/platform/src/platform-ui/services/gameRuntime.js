import { loadScript } from "../utils/loadScript.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const GAME_SCRIPT_PREFIX = "game-runtime-";

export function getGameRoute() {
  const match = window.location.pathname.match(/^\/games\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  return { gameId: match[1], roomId: match[2] || null };
}

export async function loadGameClient(gameId) {
  const gameView = document.getElementById("game-view");
  if (!gameView) return null;

  if (!window.io) {
    await loadScript("/socket.io/socket.io.js", { id: "socket-io" });
  }

  if (!window.kaboom) {
    await loadScript("https://unpkg.com/kaboom/dist/kaboom.js", { id: "kaboom-lib" });
  }

  const sessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptId = `${GAME_SCRIPT_PREFIX}${gameId}-${sessionKey}`;
  await loadScript(`/games/${gameId}/main.js?session=${sessionKey}`, { id: scriptId, type: "module" });
  return scriptId;
}

export function removeGameClientScripts(gameId) {
  if (!gameId || typeof document === "undefined") return;
  const selector = `script[id^="${GAME_SCRIPT_PREFIX}${gameId}-"], script[id="game-${gameId}"]`;
  document.querySelectorAll(selector).forEach((node) => node.remove());
}

export function disposeGameRuntime(gameId) {
  if (!gameId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DISPOSE_GAME_EVENT, { detail: { gameId } }));
}
