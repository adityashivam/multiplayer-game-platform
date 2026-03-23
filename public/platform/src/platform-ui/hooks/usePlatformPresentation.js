import { useCallback, useEffect, useState } from "react";

export default function usePlatformPresentation() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return () => {};

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const applyPseudoFullscreen = useCallback((nextValue) => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const body = document.body;

    if (nextValue) {
      root?.setAttribute("data-pseudo-fullscreen", "true");
      body?.setAttribute("data-pseudo-fullscreen", "true");
    } else {
      root?.removeAttribute("data-pseudo-fullscreen");
      body?.removeAttribute("data-pseudo-fullscreen");
    }

    setPseudoFullscreen(nextValue);
  }, []);

  const requestFullscreen = useCallback(() => {
    if (typeof document === "undefined") return Promise.resolve();

    const target = document.getElementById("root") || document.documentElement;
    if (!document.fullscreenEnabled || !target?.requestFullscreen) {
      applyPseudoFullscreen(true);
      return Promise.resolve();
    }

    return target.requestFullscreen().catch(() => {});
  }, [applyPseudoFullscreen]);

  const exitFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
      return;
    }

    applyPseudoFullscreen(false);
  }, [applyPseudoFullscreen]);

  const toggleFullscreen = useCallback(() => {
    const fullscreenActive = Boolean(document.fullscreenElement) || pseudoFullscreen;
    if (fullscreenActive) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  }, [exitFullscreen, pseudoFullscreen, requestFullscreen]);

  const lockLandscapeOrientation = useCallback(() => {
    const orientation = globalThis.screen?.orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    orientation.lock("landscape").catch(() => {});
  }, []);

  const unlockOrientation = useCallback(() => {
    const orientation = globalThis.screen?.orientation;
    if (!orientation || typeof orientation.unlock !== "function") return;
    orientation.unlock();
  }, []);

  const presentLandscapeMode = useCallback(() => {
    Promise.resolve(requestFullscreen()).finally(() => {
      lockLandscapeOrientation();
    });
  }, [lockLandscapeOrientation, requestFullscreen]);

  return {
    isFullscreen,
    pseudoFullscreen,
    fullscreenActive: isFullscreen || pseudoFullscreen,
    toggleFullscreen,
    presentLandscapeMode,
    unlockOrientation,
  };
}
