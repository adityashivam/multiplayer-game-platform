import { useCallback, useEffect, useRef, useState } from "react";
import { createFullscreenPresentationController } from "../services/fullscreenPresentation.js";

/**
 * Keep fullscreen ownership at the platform root while game routes change.
 * Call beginGameLaunch synchronously from Play; route effects only clean up.
 * @param {{isGameView?:boolean}} [options]
 */
export default function usePlatformPresentation({ isGameView = false } = {}) {
  const [presentationState, setPresentationState] = useState({
    isFullscreen: false,
    pseudoFullscreen: false,
    fullscreenActive: false,
  });
  /** @type {import("react").RefObject<ReturnType<typeof createFullscreenPresentationController>|null>} */
  const controllerRef = useRef(null);
  const previousGameView = useRef(isGameView);

  const getPresentationController = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = createFullscreenPresentationController({
        document: typeof document === "undefined" ? undefined : document,
        window: typeof window === "undefined" ? undefined : window,
      });
    }

    return controllerRef.current;
  }, []);

  useEffect(() => {
    const controller = getPresentationController();
    const unsubscribe = controller.subscribe(setPresentationState);
    setPresentationState(controller.getState());

    return () => {
      unsubscribe();
      if (controllerRef.current === controller) controllerRef.current = null;
      void controller.dispose();
    };
  }, [getPresentationController]);

  const beginGameLaunch = useCallback(() => getPresentationController().beginGameLaunch(), [getPresentationController]);

  /** Keep the existing Promise<void> contract used by landscape orientation. */
  const requestFullscreen = useCallback(() => {
    return getPresentationController().requestFullscreen().then(() => {});
  }, [getPresentationController]);

  const endGamePresentation = useCallback(() => getPresentationController().endGamePresentation(), [getPresentationController]);
  const toggleFullscreen = useCallback(() => {
    return getPresentationController().toggleFullscreen().then(() => {});
  }, [getPresentationController]);

  useEffect(() => {
    if (previousGameView.current && !isGameView) void endGamePresentation();
    previousGameView.current = isGameView;
  }, [endGamePresentation, isGameView]);

  return {
    ...presentationState,
    beginGameLaunch,
    requestFullscreen,
    toggleFullscreen,
    endGamePresentation,
    exitFullscreen: endGamePresentation,
  };
}
