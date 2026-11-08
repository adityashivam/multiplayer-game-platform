import { useEffect, useState } from "react";
import { ROOM_START_COUNTDOWN_MS } from "../../../shared/roomLifecycle.js";

const INITIAL_ROOM_STATE = Object.freeze({ phase: "connecting", roomId: null, playerId: null, joined: false, secondsRemaining: null, startAtMs: null, countdownDurationMs: ROOM_START_COUNTDOWN_MS, connectedPlayers: 0, requiredPlayers: 0, showGo: false, errorCode: null, errorMessage: null });

/** Subscribe to transport-owned room state without opening a second game socket. */
export default function useRoomLifecycle(game, enabled) {
  const [roomState, setRoomState] = useState(INITIAL_ROOM_STATE);
  const namespace = game?.networking?.namespace || game?.namespace || game?.id;
  useEffect(() => {
    setRoomState(INITIAL_ROOM_STATE);
    if (!enabled || !namespace) return undefined;
    let cancelled = false;
    let unsubscribe = null;
    import(/* @vite-ignore */ "/platform/frontend-engine/roomLifecycleBridge.js").then((bridge) => {
      if (!cancelled) unsubscribe = bridge.subscribeRoomLifecycle(namespace, setRoomState);
    }).catch((error) => console.warn("Room lifecycle bridge unavailable", error));
    return () => { cancelled = true; unsubscribe?.(); };
  }, [namespace, enabled]);
  return roomState;
}
