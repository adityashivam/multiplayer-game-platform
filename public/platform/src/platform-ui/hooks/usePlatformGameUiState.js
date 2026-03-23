import { useEffect, useRef, useState } from "react";

const INITIAL_END_GAME_STATE = {
  open: false,
  title: "",
  subtitle: "",
  status: "",
  actionLabel: "",
  phase: "idle",
};

const INITIAL_CONNECTION_STATE = {
  status: "connecting",
  ping: null,
};

export default function usePlatformGameUiState(setShareModal) {
  const [endGameState, setEndGameState] = useState(INITIAL_END_GAME_STATE);
  const [connectionState, setConnectionState] = useState(INITIAL_CONNECTION_STATE);
  const endGameBridgeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let bridgeModule = null;

    import(/* @vite-ignore */ "/platform/frontend-engine/shareModalBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        bridgeModule = bridge;
        bridge.registerShareModalController(setShareModal);
      })
      .catch((error) => {
        console.warn("Share modal bridge unavailable", error);
      });

    return () => {
      cancelled = true;
      if (bridgeModule?.registerShareModalController) {
        bridgeModule.registerShareModalController(null);
      }
    };
  }, [setShareModal]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    import(/* @vite-ignore */ "/platform/frontend-engine/connectionBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        unsubscribe = bridge.subscribeConnectionState((nextState) => {
          setConnectionState(nextState);
        });
      })
      .catch((error) => {
        console.warn("Connection bridge unavailable", error);
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    import(/* @vite-ignore */ "/platform/frontend-engine/endGameBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        endGameBridgeRef.current = bridge;
        unsubscribe = bridge.subscribeEndGame((nextState) => {
          setEndGameState(nextState);
        });
      })
      .catch((error) => {
        console.warn("End game bridge unavailable", error);
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      endGameBridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (endGameState.open) {
      setShareModal(false);
    }
  }, [endGameState.open, setShareModal]);

  return {
    connectionState,
    endGameState,
    endGameBridgeRef,
  };
}
