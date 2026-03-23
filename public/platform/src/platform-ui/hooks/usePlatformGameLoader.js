import { useCallback, useEffect, useRef, useState } from "react";
import { disposeGameRuntime, loadGameClient, removeGameClientScripts } from "../services/gameRuntime.js";

export default function usePlatformGameLoader({ gameId, setShareModal }) {
  const [gameLoadError, setGameLoadError] = useState(null);
  const activeGameRef = useRef({ gameId: null, scriptId: null });

  const disposeGameSession = useCallback(
    (targetGameId) => {
      if (!targetGameId) return;

      disposeGameRuntime(targetGameId);
      removeGameClientScripts(targetGameId);

      if (activeGameRef.current.gameId === targetGameId) {
        activeGameRef.current = { gameId: null, scriptId: null };
      }

      setShareModal(false);
    },
    [setShareModal],
  );

  useEffect(() => {
    const previousGameId = activeGameRef.current.gameId;
    if (previousGameId && previousGameId !== gameId) {
      disposeGameSession(previousGameId);
    }
  }, [disposeGameSession, gameId]);

  useEffect(() => {
    if (!gameId) {
      setGameLoadError(null);
      return;
    }

    let cancelled = false;

    async function startGameClient() {
      try {
        disposeGameRuntime(gameId);
        removeGameClientScripts(gameId);

        const scriptId = await loadGameClient(gameId);
        if (cancelled) {
          removeGameClientScripts(gameId);
          return;
        }

        activeGameRef.current = { gameId, scriptId };
        setGameLoadError(null);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setGameLoadError("Failed to load game.");
        }
      }
    }

    startGameClient();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    return () => {
      const activeGameId = activeGameRef.current.gameId;
      if (activeGameId) {
        disposeGameSession(activeGameId);
      }
    };
  }, [disposeGameSession]);

  return {
    disposeGameSession,
    gameLoadError,
  };
}
