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
  const cardRefs = useRef([]);
  const shareModalManagedRef = useRef(false);
  const setShareModal = useCallback((nextOpen) => {
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const isGameView = Boolean(route?.gameId);

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
    const handleShareModal = (event) => {
      const detail = event?.detail || {};
      if (typeof detail.managed === "boolean") {
        shareModalManagedRef.current = detail.managed;
      }
      if (typeof detail.open === "boolean") {
        setShareModal(detail.open);
      } else if (detail.toggle) {
        setShareModal();
      }
    };
    window.addEventListener("kaboom:share-modal", handleShareModal);
    return () => window.removeEventListener("kaboom:share-modal", handleShareModal);
  }, [setShareModal]);

  useEffect(() => {
    shareModalManagedRef.current = false;
  }, [route?.gameId]);

  useEffect(() => {
    if (!isGameView) {
      setTheme(getPreferredTheme());
    }
  }, [isGameView]);

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
      window.location.href = game.path;
    }
  }, [games, selectedIndex]);

  const handleActionInput = useCallback(
    (action) => {
      if (isGameView) {
        if (action === "back") {
          window.location.assign("/");
          return;
        }
        if (action === "select") {
          if (shareModalManagedRef.current) {
            return;
          }
          setShareModal();
        }
        return;
      }
      switch (action) {
        case "confirm":
        case "start":
          activateSelected();
          break;
        case "back":
          handleDirectionalInput("left");
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
    const onKeyDown = (evt) => {
      const key = evt.key;
      if (key === "ArrowUp" || key === "w" || key === "W") {
        evt.preventDefault();
        handleDirectionalInput("up");
      } else if (key === "ArrowDown" || key === "s" || key === "S") {
        evt.preventDefault();
        handleDirectionalInput("down");
      } else if (key === "ArrowLeft" || key === "a" || key === "A") {
        evt.preventDefault();
        handleDirectionalInput("left");
      } else if (key === "ArrowRight" || key === "d" || key === "D") {
        evt.preventDefault();
        handleDirectionalInput("right");
      } else if (key === "Enter" || key === " ") {
        evt.preventDefault();
        activateSelected();
      } else if (key === "Escape" || key === "Backspace") {
        evt.preventDefault();
        handleDirectionalInput("left");
      } else if (key.toLowerCase?.() === "t") {
        evt.preventDefault();
        setTheme((prev) => (prev === "dark" ? "light" : "dark"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateSelected, handleDirectionalInput, isGameView]);

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

  const headerLeft = isGameView ? (
    <a id="back-to-lobby" className={styles.backLink} href="/">
      &larr; Lobby
    </a>
  ) : (
    <div id="lobby-badge" className={styles.badge}>
      Lobby OS v1.0
    </div>
  );

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";

  return (
    <div className={styles.app}>
      <div className={styles.console}>
        <div className={styles.screen}>
          <div className={styles.scanlines} aria-hidden="true" />
          <div className={styles.screenOverlay} aria-hidden="true" />
          <div className={styles.screenBody}>
            <div className={classNames(styles.screenScroll, isGameView && styles.screenScrollGame)}>
              {!isGameView && (
                <LobbyHeader
                  headerLeft={headerLeft}
                  title={headerTitle}
                  onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                />
              )}

              {!isGameView && (
                <LobbyList
                  loading={loadingGames}
                  games={games}
                  selectedIndex={selectedIndex}
                  onSelectIndex={setSelectedIndex}
                  onActivate={(path) => window.location.assign(path)}
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
                />
              )}
            </div>
          </div>
          <BottomNav />
        </div>

        <Controller onDirectional={handleDirectionalInput} onAction={handleActionInput} disabled={false} />
      </div>
    </div>
  );
}
