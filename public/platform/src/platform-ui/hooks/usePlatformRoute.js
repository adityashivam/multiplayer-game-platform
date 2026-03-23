import { useCallback, useEffect, useState } from "react";
import { getGameRoute } from "../services/gameRuntime.js";

export default function usePlatformRoute() {
  const [route, setRoute] = useState(() => getGameRoute());

  const navigateTo = useCallback((path, { replace = false } = {}) => {
    if (typeof window === "undefined" || !path) return;

    const nextPath = path.startsWith("/") ? path : `/${path}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath === currentPath) return;

    if (replace) {
      window.history.replaceState({}, "", nextPath);
    } else {
      window.history.pushState({}, "", nextPath);
    }

    setRoute(getGameRoute());
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(getGameRoute());
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      syncRoute();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      syncRoute();
      return result;
    };

    window.addEventListener("popstate", syncRoute);
    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect(() => {
    const handleRoomReady = () => {
      setRoute(getGameRoute());
    };

    window.addEventListener("kaboom:room-ready", handleRoomReady);
    return () => {
      window.removeEventListener("kaboom:room-ready", handleRoomReady);
    };
  }, []);

  useEffect(() => {
    const isGameView = Boolean(route?.gameId);
    if (!isGameView || route?.roomId) return () => {};

    const syncRouteFromPath = () => {
      const nextRoute = getGameRoute();
      if (nextRoute?.gameId === route?.gameId && nextRoute?.roomId) {
        setRoute(nextRoute);
        return true;
      }
      return false;
    };

    if (syncRouteFromPath()) return () => {};

    const timer = setInterval(() => {
      if (syncRouteFromPath()) {
        clearInterval(timer);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [route?.gameId, route?.roomId]);

  return {
    route,
    setRoute,
    navigateTo,
    isGameView: Boolean(route?.gameId),
    routeViewKey: route?.gameId ? `game:${route.gameId}` : "lobby",
  };
}
