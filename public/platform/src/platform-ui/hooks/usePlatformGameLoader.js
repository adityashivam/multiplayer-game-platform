import { useCallback, useEffect, useRef, useState } from "react";
import { disposeGameRuntime, loadGameClient, removeGameClientScripts } from "../services/gameRuntime.js";

/**
 * Load one runtime after platform startup requirements are satisfied. Callers
 * keep canStart true after initial admission so viewport changes cannot reload it.
 * @param {{game:object|null,setShareModal:(open:boolean)=>void,canStart?:boolean}} options
 */
export default function usePlatformGameLoader({ game, setShareModal, canStart = true }) {
  const [gameLoadError, setGameLoadError] = useState(null);
  const activeRuntimeRef = useRef(null);
  const gameId = game?.id || null;

  const disposeGameSession = useCallback(
    async (targetGameId) => {
      if (!targetGameId) return;

      const activeRuntime = activeRuntimeRef.current;
      if (activeRuntime?.gameId === targetGameId) {
        await disposeGameRuntime(activeRuntime);
        activeRuntimeRef.current = null;
      } else {
        await disposeGameRuntime(targetGameId);
      }

      removeGameClientScripts(targetGameId);
      setShareModal(false);
    },
    [setShareModal],
  );

  useEffect(() => {
    const previousGameId = activeRuntimeRef.current?.gameId;
    if (previousGameId && previousGameId !== gameId) {
      void disposeGameSession(previousGameId);
    }
  }, [disposeGameSession, gameId]);

  useEffect(() => {
    if (!gameId || !game) {
      setGameLoadError(null);
      return;
    }
    if (!canStart) return undefined;

    let cancelled = false;

    async function startGameClient() {
      try {
        await disposeGameRuntime(activeRuntimeRef.current || gameId);
        removeGameClientScripts(gameId);

        const runtimeSession = await loadGameClient(game);
        if (cancelled) {
          await disposeGameRuntime(runtimeSession);
          removeGameClientScripts(gameId);
          return;
        }

        activeRuntimeRef.current = runtimeSession;
        setGameLoadError(null);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          activeRuntimeRef.current = null;
          setGameLoadError("Failed to load game.");
        }
      }
    }

    void startGameClient();

    return () => {
      cancelled = true;
    };
  }, [game, gameId, canStart]);

  useEffect(() => {
    return () => {
      const activeGameId = activeRuntimeRef.current?.gameId;
      if (activeGameId) {
        void disposeGameSession(activeGameId);
      }
    };
  }, [disposeGameSession]);

  return {
    disposeGameSession,
    gameLoadError,
  };
}
