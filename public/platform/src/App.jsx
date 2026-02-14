import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "./components/BottomNav.jsx";
import Controller from "./components/Controller.jsx";
import GameView from "./components/GameView.jsx";
import LobbyHeader from "./components/LobbyHeader.jsx";
import LobbyList from "./components/LobbyList.jsx";
import { fallbackGames, gameTitles } from "./data/games.js";
import classNames from "./utils/classNames.js";
import { loadScript } from "./utils/loadScript.js";
import styles from "./App.module.scss";

const THEME_KEY = "kaboom-preferred-theme";

function getGameRoute() {
  const match = window.location.pathname.match(/^\/games\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  return { gameId: match[1], roomId: match[2] || null };
}

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

async function loadGameClient(gameId) {
  const gameView = document.getElementById("game-view");
  if (!gameView) return;
  if (!window.io) {
    await loadScript("/socket.io/socket.io.js", { id: "socket-io" });
  }
  if (!window.kaboom) {
    await loadScript("https://unpkg.com/kaboom/dist/kaboom.js", { id: "kaboom-lib" });
  }
  await loadScript(`/games/${gameId}/main.js`, { id: `game-${gameId}`, type: "module" });
}

export default function App() {
  const [theme, setTheme] = useState(() => getPreferredTheme());
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [route, setRoute] = useState(getGameRoute());
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [gameLoadError, setGameLoadError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [endGameState, setEndGameState] = useState({
    open: false,
    title: "",
    subtitle: "",
    status: "",
    actionLabel: "",
    phase: "idle",
  });
  const [connectionState, setConnectionState] = useState({
    status: "connecting",
    ping: null,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const cardRefs = useRef([]);
  const endGameBridgeRef = useRef(null);
  const setShareModal = useCallback((nextOpen) => {
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const isGameView = Boolean(route?.gameId);
  const routeViewKey = route?.gameId ? `game:${route.gameId}` : "lobby";

  const navigateTo = useCallback((path, { replace = false } = {}) => {
    if (typeof window === "undefined" || !path) return;
    const nextPath = path.startsWith("/") ? path : `/${path}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextPath === currentPath) return;

    const commit = () => {
      if (replace) {
        window.history.replaceState({}, "", nextPath);
      } else {
        window.history.pushState({}, "", nextPath);
      }
      setRoute(getGameRoute());
    };

    commit();
  }, []);

  const headerTitle = useMemo(() => {
    if (isGameView) {
      return gameTitles[route?.gameId] || route?.gameId?.replace(/-/g, " ")?.toUpperCase() || "GAME VIEW";
    }
    return "SELECT GAME CARTRIDGE";
  }, [isGameView, route?.gameId]);

  const shareUrl = useMemo(() => {
    if (!route?.gameId || !route?.roomId) return "";
    return `${window.location.origin}/games/${route.gameId}/${route.roomId}`;
  }, [route?.gameId, route?.roomId]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    let bridgeModule = null;
    // Load at runtime so the platform and game share the same module instance.
    import(/* @vite-ignore */ "/platform/shared/shareModalBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        bridgeModule = bridge;
        bridge.registerShareModalController(setShareModal);
      })
      .catch((err) => {
        console.warn("Share modal bridge unavailable", err);
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
    import(/* @vite-ignore */ "/platform/shared/connectionBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        unsubscribe = bridge.subscribeConnectionState((nextState) => {
          setConnectionState(nextState);
        });
      })
      .catch((err) => {
        console.warn("Connection bridge unavailable", err);
      });
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;
    import(/* @vite-ignore */ "/platform/shared/endGameBridge.js")
      .then((bridge) => {
        if (cancelled) return;
        endGameBridgeRef.current = bridge;
        unsubscribe = bridge.subscribeEndGame((nextState) => {
          setEndGameState(nextState);
        });
      })
      .catch((err) => {
        console.warn("End game bridge unavailable", err);
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

  useEffect(() => {
    if (!isGameView) {
      setTheme(getPreferredTheme());
    }
  }, [isGameView]);

  useEffect(() => {
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
  }, [isGameView, route?.gameId, route?.roomId]);

  useEffect(() => {
    setRouteTransitioning(true);
    const timer = setTimeout(() => {
      setRouteTransitioning(false);
    }, 260);
    return () => clearTimeout(timer);
  }, [routeViewKey]);

  useEffect(() => {
    if (!isGameView) {
      setExitConfirmOpen(false);
    }
  }, [isGameView]);

  useEffect(() => {
    if (!isGameView) {
      endGameBridgeRef.current?.hideEndGameModal?.();
    }
  }, [isGameView]);

  useEffect(() => {
    if (typeof document === "undefined") return () => {};
    const handleChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
    };
  }, []);


  const applyPseudoFullscreen = useCallback((next) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const body = document.body;
    if (next) {
      root?.setAttribute("data-pseudo-fullscreen", "true");
      body?.setAttribute("data-pseudo-fullscreen", "true");
    } else {
      root?.removeAttribute("data-pseudo-fullscreen");
      body?.removeAttribute("data-pseudo-fullscreen");
    }
    setPseudoFullscreen(next);
  }, []);

  const requestFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    const target = document.getElementById("root") || document.documentElement;
    if (!document.fullscreenEnabled || !target?.requestFullscreen) {
      applyPseudoFullscreen(true);
      return;
    }
    target.requestFullscreen().catch(() => {});
  }, [applyPseudoFullscreen]);

  const exitFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    applyPseudoFullscreen(false);
  }, [applyPseudoFullscreen]);

  const handleFullscreenToggle = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = Boolean(document.fullscreenElement) || pseudoFullscreen;
    if (active) {
      exitFullscreen();
    } else {
      requestFullscreen();
    }
  }, [exitFullscreen, pseudoFullscreen, requestFullscreen]);


  useEffect(() => {
    let cancelled = false;
    async function loadGames() {
      try {
        const res = await fetch("/api/games");
        if (!res.ok) throw new Error("Bad response");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.games) && data.games.length) {
          setGames(data.games);
          setLoadingGames(false);
          setSelectedIndex(0);
          return;
        }
      } catch (err) {
        console.warn("Falling back to default games list", err);
      }
      if (!cancelled) {
        setGames(fallbackGames);
        setLoadingGames(false);
        setSelectedIndex(0);
      }
    }
    loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const update = () => {
      setRoute(getGameRoute());
    };
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function (...args) {
      const result = originalPush.apply(this, args);
      update();
      return result;
    };
    history.replaceState = function (...args) {
      const result = originalReplace.apply(this, args);
      update();
      return result;
    };
    window.addEventListener("popstate", update);
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener("popstate", update);
    };
  }, []);

  useEffect(() => {
    if (!isGameView) {
      setShareModal(false);
      return;
    }
    const joined = window.__kaboomOpponentJoined;
    if (joined && joined.gameId === route?.gameId && joined.roomId === route?.roomId) {
      setShareModal(false);
      return;
    }
    setShareModal(true);
  }, [isGameView, route?.gameId, route?.roomId, setShareModal]);

  useEffect(() => {
    const handleOpponentJoined = () => {
      setShareModal(false);
    };
    window.addEventListener("kaboom:opponent-joined", handleOpponentJoined);
    return () => window.removeEventListener("kaboom:opponent-joined", handleOpponentJoined);
  }, [setShareModal]);

  useEffect(() => {
    const handleRoomReady = () => {
      setRoute(getGameRoute());
    };
    window.addEventListener("kaboom:room-ready", handleRoomReady);
    return () => window.removeEventListener("kaboom:room-ready", handleRoomReady);
  }, []);

  useEffect(() => {
    if (!route?.gameId) {
      setGameLoadError(null);
      return;
    }
    let cancelled = false;
    async function start() {
      try {
        await loadGameClient(route.gameId);
      } catch (err) {
        console.error(err);
        if (!cancelled) setGameLoadError("Failed to load game.");
      }
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [route?.gameId]);

  const handleDirectionalInput = useCallback(
    (direction) => {
      if (isGameView || !games.length) return;
      setSelectedIndex((current) => {
        const delta = direction === "up" || direction === "left" ? -1 : 1;
        const nextIndex = (current + delta + games.length) % games.length;
        return nextIndex;
      });
    },
    [games.length, isGameView],
  );

  const activateSelected = useCallback(() => {
    if (!games.length) return;
    const game = games[selectedIndex];
    if (game?.path) {
      navigateTo(game.path);
    }
  }, [games, navigateTo, selectedIndex]);

  const handleActionInput = useCallback(
    (action) => {
      const isHomeAction = action === "home" || action === "select";
      if (isGameView) {
        if (isHomeAction) {
          setShareModal(false);
          setExitConfirmOpen(true);
        }
        return;
      }
      switch (action) {
        case "a":
        case "x":
        case "y":
        case "start":
          activateSelected();
          break;
        case "b":
          handleDirectionalInput("left");
          break;
        case "home":
          // Already in lobby view.
          break;
        case "select":
          setTheme((prev) => (prev === "dark" ? "light" : "dark"));
          break;
        default:
          break;
      }
    },
    [activateSelected, handleDirectionalInput, isGameView, setShareModal],
  );

  useEffect(() => {
    if (isGameView) return;
    const card = cardRefs.current[selectedIndex];
    if (card) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, isGameView]);

  const handleCopyShare = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch (err) {
      console.warn("Clipboard copy failed", err);
      setCopyLabel("Select & copy");
      setTimeout(() => setCopyLabel("Copy"), 1400);
    }
  }, [shareUrl]);

  const handleRematch = useCallback(() => {
    endGameBridgeRef.current?.requestRematch?.();
  }, []);

  const handleBackHome = useCallback(() => {
    navigateTo("/");
  }, [navigateTo]);

  const handleConfirmExit = useCallback(() => {
    setExitConfirmOpen(false);
    navigateTo("/");
  }, [navigateTo]);

  const handleCancelExit = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  const headerLeft = isGameView ? (
    <a
      id="back-to-lobby"
      className={styles.backLink}
      href="/"
      onClick={(event) => {
        event.preventDefault();
        navigateTo("/");
      }}
    >
      &larr; Lobby
    </a>
  ) : (
    <div id="lobby-badge" className={styles.badge}>
      Lobby OS v1.0
    </div>
  );

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";
  const rematchDisabled = endGameState.phase === "waiting";

  const fullscreenActive = isFullscreen || pseudoFullscreen;

  return (
    <div className={classNames(styles.app, fullscreenActive && styles.appFullscreen)}>
      <div className={styles.console}>
        <div className={styles.screen}>
          <div className={styles.scanlines} aria-hidden="true" />
          <div className={styles.screenOverlay} aria-hidden="true" />
          <div className={styles.screenBody}>
            <div
              className={classNames(
                styles.screenScroll,
                isGameView && styles.screenScrollGame,
                routeTransitioning && styles.routeTransition,
              )}
            >
              {!isGameView && (
                <LobbyHeader
                  headerLeft={headerLeft}
                  title={headerTitle}
                  onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                  onToggleFullscreen={handleFullscreenToggle}
                  isFullscreen={fullscreenActive}
                />
              )}

              {!isGameView && (
                <LobbyList
                  loading={loadingGames}
                  games={games}
                  selectedIndex={selectedIndex}
                  onSelectIndex={setSelectedIndex}
                  onActivate={(path) => navigateTo(path)}
                  registerCardRef={(index, node) => {
                    cardRefs.current[index] = node;
                  }}
                />
              )}

              {isGameView && (
                <GameView
                  shareOpen={shareOpen}
                  onCloseShare={() => setShareModal(false)}
                  roomLabel={roomLabel}
                  shareUrl={shareUrl}
                  copyLabel={copyLabel}
                  onCopyShare={handleCopyShare}
                  gameLoadError={gameLoadError}
                  endGameOpen={endGameState.open}
                  endGameTitle={endGameState.title}
                  endGameSubtitle={endGameState.subtitle}
                  endGameStatus={endGameState.status}
                  endGameActionLabel={endGameState.actionLabel}
                  onRematch={handleRematch}
                  onBackHome={handleBackHome}
                  rematchDisabled={rematchDisabled}
                  exitConfirmOpen={exitConfirmOpen}
                  onConfirmExit={handleConfirmExit}
                  onCancelExit={handleCancelExit}
                  isFullscreen={fullscreenActive}
                  onToggleFullscreen={handleFullscreenToggle}
                  connectionStatus={connectionState.status}
                  connectionPing={connectionState.ping}
                />
              )}
            </div>
          </div>
          {!isGameView && <BottomNav />}
        </div>

        <Controller onDirectional={handleDirectionalInput} onAction={handleActionInput} disabled={false} />
      </div>
    </div>
  );
}
