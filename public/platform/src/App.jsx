import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Controller from "./components/Controller.jsx";
import GameCard from "./components/GameCard.jsx";
import ShareBar from "./components/ShareBar.jsx";
import { fallbackGames, gameTitles, visualsByGame } from "./data/games.js";
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
  await loadScript(`/games/${gameId}/main.js`, { id: `game-${gameId}` });
}

export default function App() {
  const [theme, setTheme] = useState(() => getPreferredTheme());
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [route, setRoute] = useState(getGameRoute());
  const [shareUrl, setShareUrl] = useState(window.location.href);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [gameLoadError, setGameLoadError] = useState(null);
  const cardRefs = useRef([]);

  const isGameView = Boolean(route?.gameId);

  const headerStatus = useMemo(() => {
    if (isGameView) {
      return gameTitles[route?.gameId] || route?.gameId?.toUpperCase() || "--";
    }
    if (loadingGames) return "--";
    return `${games.length} cartridge${games.length === 1 ? "" : "s"}`;
  }, [games.length, isGameView, loadingGames, route?.gameId]);

  const shareLabel = isGameView ? "Share this room" : "Share this lobby";

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
      setShareUrl(window.location.href);
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
      if (isGameView) return;
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
    [activateSelected, handleDirectionalInput, isGameView],
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

  return (
    <div className={styles.app}>
      <div className={styles.frame}>
        <div className={styles.screen}>
          <div className={styles.scanlines} aria-hidden="true" />
          <div className={styles.screenInner}>
            <header className={styles.header}>
              <div className={styles.badgeRow}>{headerLeft}</div>
              <div className={styles.statusRow}>
                <span id="header-status" className={styles.statusText}>
                  {headerStatus}
                </span>
                <button
                  id="theme-toggle"
                  type="button"
                  className={styles.themeToggle}
                  onClick={isGameView ? undefined : () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                  aria-label="Toggle theme"
                >
                  <span className={classNames("material-symbols-outlined", styles.themeIcon)}>contrast</span>
                </button>
              </div>
            </header>

            {!isGameView && (
              <div id="lobby-title" className={styles.titleBlock}>
                <h1 className={styles.title}>SELECT GAME CARTRIDGE</h1>
                <p className={styles.subtitle}>
                  Pick a title, spin up a room, and drop the link to a friend.
                </p>
              </div>
            )}

            {isGameView && (
              <ShareBar
                shareUrl={shareUrl}
                label={shareLabel}
                copyLabel={copyLabel}
                onCopy={handleCopyShare}
                onOpen={() => window.location.assign(shareUrl)}
              />
            )}

            <div id="lobby-view" className={classNames(styles.view, isGameView && styles.hidden)}>
              <div id="game-list" className={styles.lobbyList}>
                {loadingGames ? (
                  <div className={styles.emptyState}>Loading cartridges...</div>
                ) : games.length === 0 ? (
                  <div className={styles.emptyState}>No games available right now.</div>
                ) : (
                  games.map((game, index) => {
                    const visuals = visualsByGame[game.id] || {};
                    const featured = visuals.featured ?? index === 0;
                    return (
                      <GameCard
                        key={game.id}
                        game={game}
                        visuals={visuals}
                        featured={featured}
                        selected={selectedIndex === index}
                        onSelect={() => setSelectedIndex(index)}
                        onActivate={() => window.location.assign(game.path)}
                        ref={(node) => {
                          cardRefs.current[index] = node;
                        }}
                      />
                    );
                  })
                )}
              </div>
            </div>

            <div id="game-view" className={classNames(styles.gameView, !isGameView && styles.hidden)}>
              <div className={styles.canvasFrame}>
                <canvas id="game-canvas" className={styles.gameCanvas} />
                <div className={styles.canvasOverlay} />
                {gameLoadError && <div className={styles.emptyState}>{gameLoadError}</div>}
              </div>
            </div>
          </div>
          <div className={styles.footerBar}>
            <span className={styles.footerLabel}>KABOOM VISION</span>
          </div>
        </div>

        <Controller onDirectional={handleDirectionalInput} onAction={handleActionInput} disabled={isGameView} />
      </div>
    </div>
  );
}
