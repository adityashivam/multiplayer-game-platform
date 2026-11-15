import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMediaQuery from "./useMediaQuery.js";
import { createGameOrientationController } from "../services/gameOrientation.js";

const PORTRAIT_TOUCH_QUERY = "(orientation: portrait) and (any-pointer: coarse)";

/**
 * Start landscape-only games in landscape on touch devices, independent of
 * their renderer. Games that declare portrait support start in whichever way
 * the player holds the device, with no rotation request.
 * Gate only initial loading: later viewport changes retain the active runtime.
 * @param {{gameId:string|null,supportsPortrait?:boolean,requestFullscreen:()=>Promise<void>}} options
 */
export default function useGameOrientation({ gameId, supportsPortrait = false, requestFullscreen }) {
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
    if (!touchDevice || supportsPortrait) return undefined;
    const version = ++requestVersion.current;
    orientationController.startSession();
    void orientationController.requestLandscape().then(({ status }) => {
      if (version === requestVersion.current) setRequestState({ gameId, status, manual: false });
    });
    return () => {
      requestVersion.current += 1;
      orientationController.stopSession();
    };
  }, [gameId, orientationController, supportsPortrait, touchDevice]);

  useEffect(() => {
    if (gameId && !portraitTouch) setStartedGameId(gameId);
  }, [gameId, portraitTouch]);

  const requestLandscapeFullscreen = useCallback(async () => {
    const version = ++requestVersion.current;
    setRequestState({ gameId, status: "requesting", manual: true });
    const { status } = await orientationController.requestLandscape({ enterFullscreen: true });
    if (version === requestVersion.current) setRequestState({ gameId, status, manual: true });
  }, [gameId, orientationController]);

  const needsLandscape = Boolean(gameId && !supportsPortrait && portraitTouch && startedGameId !== gameId);
  return {
    needsLandscape,
    canLoadRuntime: Boolean(gameId && !needsLandscape),
    canLockOrientation: orientationController.canLockOrientation(),
    requesting: requestState.gameId === gameId && requestState.status === "requesting",
    requestFailed: requestState.gameId === gameId && requestState.manual && requestState.status === "denied",
    requestLandscapeFullscreen,
  };
}
