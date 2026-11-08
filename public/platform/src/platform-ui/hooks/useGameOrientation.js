import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMediaQuery from "./useMediaQuery.js";
import { createGameOrientationController } from "../services/gameOrientation.js";

const PORTRAIT_TOUCH_QUERY = "(orientation: portrait) and (any-pointer: coarse)";

/**
 * Start every game in landscape on touch devices, independent of its renderer.
 * Gate only initial loading: later viewport changes retain the active runtime.
 * @param {{gameId:string|null,requestFullscreen:()=>Promise<void>}} options
 */
export default function useGameOrientation({ gameId, requestFullscreen }) {
  const portraitTouch = useMediaQuery(PORTRAIT_TOUCH_QUERY);
  const touchDevice = useMediaQuery("(any-pointer: coarse)");
  const [startedGameId, setStartedGameId] = useState(null);
  const [requestState, setRequestState] = useState({ gameId: null, status: "idle", manual: false });
  const requestVersion = useRef(0);
  const orientationController = useMemo(() => createGameOrientationController({
    orientation: window.screen?.orientation,
    requestFullscreen,
  }), [requestFullscreen]);

  useEffect(() => {
    if (!gameId) {
      setStartedGameId(null);
      return undefined;
    }
    if (!touchDevice) return undefined;
    const version = ++requestVersion.current;
    orientationController.startSession();
    void orientationController.requestLandscape().then(({ status }) => {
      if (version === requestVersion.current) setRequestState({ gameId, status, manual: false });
    });
    return () => {
      requestVersion.current += 1;
      orientationController.stopSession();
    };
  }, [gameId, orientationController, touchDevice]);

  useEffect(() => {
    if (gameId && !portraitTouch) setStartedGameId(gameId);
  }, [gameId, portraitTouch]);

  const requestLandscapeFullscreen = useCallback(async () => {
    const version = ++requestVersion.current;
    setRequestState({ gameId, status: "requesting", manual: true });
    const { status } = await orientationController.requestLandscape({ enterFullscreen: true });
    if (version === requestVersion.current) setRequestState({ gameId, status, manual: true });
  }, [gameId, orientationController]);

  const needsLandscape = Boolean(gameId && portraitTouch && startedGameId !== gameId);
  return {
    needsLandscape,
    canLoadRuntime: Boolean(gameId && !needsLandscape),
    canLockOrientation: orientationController.canLockOrientation(),
    requesting: requestState.gameId === gameId && requestState.status === "requesting",
    requestFailed: requestState.gameId === gameId && requestState.manual && requestState.status === "denied",
    requestLandscapeFullscreen,
  };
}
