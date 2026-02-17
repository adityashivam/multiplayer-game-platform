import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BottomNav from "./components/BottomNav.jsx";
import ConfigPanel from "./components/ConfigPanel.jsx";
import Controller from "./components/Controller.jsx";
import GameView from "./components/GameView.jsx";
import LobbyHeader from "./components/LobbyHeader.jsx";
import LobbyList from "./components/LobbyList.jsx";
import { fallbackGames, gameTitles } from "./data/games.js";
import { resolveThemeIcons } from "./data/themes/icons.js";
import { builtInThemes, getThemeById } from "./data/themes/index.js";
import { TOGGLE_NETWORK_PANEL_EVENT } from "./constants/events.js";
import classNames from "./utils/classNames.js";
import { loadScript } from "./utils/loadScript.js";
import { applyTheme, getSelectedThemeId, removeTheme, saveSelectedTheme } from "./utils/themeEngine.js";
import styles from "./App.module.scss";

const THEME_KEY = "kaboom-preferred-theme";
const SOUND_MUTED_KEY = "kaboom-sound-muted";
const MUSIC_VOLUME_KEY = "kaboom-music-volume";
const DEFAULT_THEME_ID = "glass-ui";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const GAME_SCRIPT_PREFIX = "game-runtime-";
const TEMP_DUMMY_GAMES_ENABLED = true;
const TEMP_DUMMY_GAME_COUNT = 50;
const DEFAULT_MUSIC_VOLUME = 0.25;
const MUSIC_VOLUME_CURVE_EXPONENT = 2.2;
const AUTOPLAY_RETRY_EVENTS = ["pointerdown", "keydown", "touchstart"];

const TEMP_DUMMY_GAMES = Array.from({ length: TEMP_DUMMY_GAME_COUNT }, (_, index) => {
  const num = String(index + 1).padStart(2, "0");
  return {
    id: `dummy-${num}`,
    name: `Dummy Game ${num}`,
    description: "Temporary preview card for testing long-list scrolling behavior.",
    path: "",
    tags: ["Preview", "2 players", "Demo"],
  };
});

function withTemporaryDummyGames(games) {
  if (!TEMP_DUMMY_GAMES_ENABLED) return games;
  const source = Array.isArray(games) ? games : [];
  const ids = new Set(source.map((game) => game.id));
  const extras = TEMP_DUMMY_GAMES.filter((game) => !ids.has(game.id));
  return [...source, ...extras];
}

function getGameRoute() {
  const match = window.location.pathname.match(/^\/games\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return null;
  return { gameId: match[1], roomId: match[2] || null };
}

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "dark";
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function getStoredMusicVolume() {
  const stored = localStorage.getItem(MUSIC_VOLUME_KEY);
  if (stored == null || stored.trim() === "") return DEFAULT_MUSIC_VOLUME;
  const raw = Number(stored);
  if (!Number.isFinite(raw)) return DEFAULT_MUSIC_VOLUME;
  return clamp01(raw);
}

function toMusicGain(volumeSetting) {
  const normalized = clamp01(volumeSetting);
  return Math.pow(normalized, MUSIC_VOLUME_CURVE_EXPONENT);
}

function resolveMusicTrackUrl(trackPath) {
  if (typeof trackPath !== "string") return null;
  const trimmed = trackPath.trim();
  if (!trimmed) return null;
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;

  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = trimmed.replace(/^\.\//, "");
  const prefixedPath = normalizedPath.startsWith("musics/") ? normalizedPath : `musics/${normalizedPath}`;
  return `${normalizedBase}${encodeURI(prefixedPath)}`;
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
  const sessionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptId = `${GAME_SCRIPT_PREFIX}${gameId}-${sessionKey}`;
  await loadScript(`/games/${gameId}/main.js?session=${sessionKey}`, { id: scriptId, type: "module" });
  return scriptId;
}

function removeGameClientScripts(gameId) {
  if (!gameId || typeof document === "undefined") return;
  const selector = `script[id^="${GAME_SCRIPT_PREFIX}${gameId}-"], script[id="game-${gameId}"]`;
  document.querySelectorAll(selector).forEach((node) => node.remove());
}

function disposeGameRuntime(gameId) {
  if (!gameId || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DISPOSE_GAME_EVENT, { detail: { gameId } }));
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
  const [muted, setMuted] = useState(() => localStorage.getItem(SOUND_MUTED_KEY) === "true");
  const [musicVolume, setMusicVolume] = useState(() => getStoredMusicVolume());
  const [musicTracks, setMusicTracks] = useState([]);
  const [selectedThemeId, setSelectedThemeId] = useState(() => getSelectedThemeId() || DEFAULT_THEME_ID);
  const [activeTab, setActiveTab] = useState("multi");
  const cardRefs = useRef([]);
  const endGameBridgeRef = useRef(null);
  const activeGameRef = useRef({ gameId: null, scriptId: null });
  const audioCtxRef = useRef(null);
  const lobbyMusicRef = useRef(null);
  const musicFadeFrameRef = useRef(null);
  const wasGameViewRef = useRef(Boolean(getGameRoute()?.gameId));
  const previousTrackIndexRef = useRef(-1);
  const mutedRef = useRef(muted);
  const prevSelectedRef = useRef(0);
  const setShareModal = useCallback((nextOpen) => {
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const isGameView = Boolean(route?.gameId);
  const routeViewKey = route?.gameId ? `game:${route.gameId}` : "lobby";

  // Sync muted ref and persist
  useEffect(() => {
    mutedRef.current = muted;
    localStorage.setItem(SOUND_MUTED_KEY, String(muted));
  }, [muted]);

  useEffect(() => {
    localStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
    const audio = lobbyMusicRef.current;
    if (audio) audio.volume = toMusicGain(musicVolume);
  }, [musicVolume]);

  useEffect(() => {
    if (typeof Audio === "undefined") return () => {};
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = toMusicGain(musicVolume);
    lobbyMusicRef.current = audio;
    return () => {
      if (musicFadeFrameRef.current) {
        cancelAnimationFrame(musicFadeFrameRef.current);
        musicFadeFrameRef.current = null;
      }
      audio.pause();
      audio.src = "";
      lobbyMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMusicPlaylist() {
      try {
        const baseUrl = import.meta.env.BASE_URL || "/";
        const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
        const response = await fetch(`${normalizedBase}musics/playlist.json`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to fetch playlist");
        const payload = await response.json();
        const entries = Array.isArray(payload) ? payload : payload?.tracks;
        const tracks = (Array.isArray(entries) ? entries : [])
          .map((entry) => resolveMusicTrackUrl(entry))
          .filter(Boolean);
        if (!cancelled) {
          setMusicTracks(tracks);
        }
      } catch (error) {
        console.warn("Unable to load lobby music playlist", error);
        if (!cancelled) {
          setMusicTracks([]);
        }
      }
    }

    loadMusicPlaylist();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopLobbyMusicFade = useCallback(() => {
    if (musicFadeFrameRef.current) {
      cancelAnimationFrame(musicFadeFrameRef.current);
      musicFadeFrameRef.current = null;
    }
  }, []);

  const fadeLobbyMusicIn = useCallback(
    (audio, targetVolume) => {
      const endVolume = clamp01(targetVolume);
      if (!audio || endVolume <= 0) {
        if (audio) audio.volume = 0;
        return;
      }
      stopLobbyMusicFade();
      const targetGain = toMusicGain(endVolume);
      const startTime = performance.now();
      const startVolume = 0.00001;
      const durationMs = 1400;
      audio.volume = startVolume;

      const tick = (now) => {
        const progress = Math.min((now - startTime) / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        audio.volume = startVolume + (targetGain - startVolume) * eased;
        if (progress < 1 && !audio.paused) {
          musicFadeFrameRef.current = requestAnimationFrame(tick);
        } else {
          musicFadeFrameRef.current = null;
        }
      };

      musicFadeFrameRef.current = requestAnimationFrame(tick);
    },
    [stopLobbyMusicFade],
  );

  const pickRandomTrack = useCallback((tracks) => {
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    let nextIndex = Math.floor(Math.random() * tracks.length);
    if (tracks.length > 1 && nextIndex === previousTrackIndexRef.current) {
      nextIndex = (nextIndex + 1) % tracks.length;
    }
    previousTrackIndexRef.current = nextIndex;
    return tracks[nextIndex];
  }, []);

  const startLobbyMusic = useCallback(
    async (forceRandomTrack = false) => {
      const audio = lobbyMusicRef.current;
      if (!audio || musicTracks.length === 0) return false;

      if (!forceRandomTrack && audio.src && !audio.paused) {
        return true;
      }

      if (forceRandomTrack || !audio.src) {
        const nextTrack = pickRandomTrack(musicTracks);
        if (!nextTrack) return false;
        audio.src = nextTrack;
        audio.currentTime = 0;
      }

      try {
        await audio.play();
        fadeLobbyMusicIn(audio, musicVolume);
        return true;
      } catch {
        return false;
      }
    },
    [fadeLobbyMusicIn, musicTracks, musicVolume, pickRandomTrack],
  );

  useEffect(() => {
    const audio = lobbyMusicRef.current;
    if (!audio) return () => {};

    const onTrackEnd = () => {
      if (isGameView || muted || musicVolume <= 0) return;
      void startLobbyMusic(true);
    };

    audio.addEventListener("ended", onTrackEnd);
    return () => {
      audio.removeEventListener("ended", onTrackEnd);
    };
  }, [isGameView, muted, musicVolume, startLobbyMusic]);

  useEffect(() => {
    const audio = lobbyMusicRef.current;
    if (!audio) return () => {};

    const returnedFromGame = wasGameViewRef.current && !isGameView;
    wasGameViewRef.current = isGameView;
    const shouldPlayLobbyMusic = !isGameView && !muted && musicVolume > 0 && musicTracks.length > 0;
    if (!shouldPlayLobbyMusic) {
      stopLobbyMusicFade();
      audio.pause();
      return () => {};
    }

    let disposed = false;
    let listenersBound = false;
    let forceRandomOnAttempt = returnedFromGame;

    const attemptPlayback = async () => {
      const started = await startLobbyMusic(forceRandomOnAttempt);
      if (started) {
        forceRandomOnAttempt = false;
      }
      return started;
    };

    const retryAfterGesture = () => {
      if (disposed) return;
      void attemptPlayback();
    };

    const ensurePlayback = async () => {
      const started = await attemptPlayback();
      if (started || disposed) return;
      listenersBound = true;
      AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
        window.addEventListener(eventName, retryAfterGesture, { once: true });
      });
    };

    void ensurePlayback();

    return () => {
      disposed = true;
      if (listenersBound) {
        AUTOPLAY_RETRY_EVENTS.forEach((eventName) => {
          window.removeEventListener(eventName, retryAfterGesture);
        });
      }
    };
  }, [isGameView, muted, musicVolume, musicTracks.length, startLobbyMusic, stopLobbyMusicFade]);

  const playNavSound = useCallback(() => {
    if (mutedRef.current) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.07);
    } catch {
      // Audio not available
    }
  }, []);

  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(6);
  }, []);

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

  const disposeGameSession = useCallback(
    (gameId) => {
      if (!gameId) return;
      disposeGameRuntime(gameId);
      removeGameClientScripts(gameId);
      if (activeGameRef.current.gameId === gameId) {
        activeGameRef.current = { gameId: null, scriptId: null };
      }
      setShareModal(false);
    },
    [setShareModal],
  );

  const headerTitle = useMemo(() => {
    if (isGameView) {
      return gameTitles[route?.gameId] || route?.gameId?.replace(/-/g, " ")?.toUpperCase() || "GAME VIEW";
    }
    if (activeTab === "config") return "CONFIG";
    return "SELECT GAME CARTRIDGE";
  }, [isGameView, route?.gameId, activeTab]);

  const shareUrl = useMemo(() => {
    if (!route?.gameId || !route?.roomId) return "";
    return `${window.location.origin}/games/${route.gameId}/${route.roomId}`;
  }, [route?.gameId, route?.roomId]);
  const activeGame = useMemo(() => {
    if (!route?.gameId) return null;
    return (
      games.find((game) => game.id === route.gameId) ||
      fallbackGames.find((game) => game.id === route.gameId) ||
      null
    );
  }, [games, route?.gameId]);
  const showPlatformControlButtons = !isGameView || activeGame?.platformControlButtons !== false;

  const selectedThemeData = useMemo(
    () => getThemeById(selectedThemeId) || builtInThemes[0] || null,
    [selectedThemeId],
  );
  const themeIcons = useMemo(() => resolveThemeIcons(selectedThemeData), [selectedThemeData]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Apply custom theme from JSON (or remove to fall back to global.scss)
  useEffect(() => {
    if (!selectedThemeId || selectedThemeId === "default") {
      removeTheme();
    } else {
      const themeData = getThemeById(selectedThemeId);
      if (themeData) {
        applyTheme(themeData);
      } else {
        removeTheme();
      }
    }
  }, [selectedThemeId]);

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
    } else {
      setActiveTab("multi");
    }
  }, [isGameView]);

  useEffect(() => {
    const prevGameId = activeGameRef.current.gameId;
    const nextGameId = route?.gameId || null;
    if (prevGameId && prevGameId !== nextGameId) {
      disposeGameSession(prevGameId);
    }
  }, [disposeGameSession, route?.gameId]);

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
          setGames(withTemporaryDummyGames(data.games));
          setLoadingGames(false);
          setSelectedIndex(0);
          return;
        }
      } catch (err) {
        console.warn("Falling back to default games list", err);
      }
      if (!cancelled) {
        setGames(withTemporaryDummyGames(fallbackGames));
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
        disposeGameRuntime(route.gameId);
        removeGameClientScripts(route.gameId);
        const scriptId = await loadGameClient(route.gameId);
        if (cancelled) {
          removeGameClientScripts(route.gameId);
          return;
        }
        activeGameRef.current = { gameId: route.gameId, scriptId };
        setGameLoadError(null);
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

  useEffect(() => {
    return () => {
      const activeGameId = activeGameRef.current.gameId;
      if (activeGameId) {
        disposeGameSession(activeGameId);
      }
    };
  }, [disposeGameSession]);

  const handleDirectionalInput = useCallback(
    (direction) => {
      if (!isGameView && !muted && musicVolume > 0) {
        void startLobbyMusic(false);
      }
      if (isGameView || !games.length) return;
      setSelectedIndex((current) => {
        let nextIndex = current;
        if (direction === "up" || direction === "left") {
          nextIndex = Math.max(0, current - 1);
        } else {
          nextIndex = Math.min(games.length - 1, current + 1);
        }
        if (nextIndex !== current) {
          triggerHaptic();
        }
        return nextIndex;
      });
    },
    [games.length, isGameView, musicVolume, muted, startLobbyMusic, triggerHaptic],
  );

  const activateSelected = useCallback(() => {
    if (!games.length) return;
    const game = games[selectedIndex];
    if (game?.path) {
      triggerHaptic();
      navigateTo(game.path);
    }
  }, [games, navigateTo, selectedIndex, triggerHaptic]);

  const handleLobbyActivate = useCallback(
    (path) => {
      if (!path) return;
      triggerHaptic();
      navigateTo(path);
    },
    [navigateTo, triggerHaptic],
  );

  const handleActionInput = useCallback(
    (action) => {
      if (!isGameView && !muted && musicVolume > 0) {
        void startLobbyMusic(false);
      }
      const isHomeAction = action === "home" || action === "select";
      if (isGameView) {
        if (isHomeAction) {
          setShareModal(false);
          setExitConfirmOpen(true);
        }
        if (action === "b") {
          window.dispatchEvent(new CustomEvent(TOGGLE_NETWORK_PANEL_EVENT));
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
    [activateSelected, handleDirectionalInput, isGameView, musicVolume, muted, setShareModal, startLobbyMusic],
  );

  const scrollAnimRef = useRef(null);

  useEffect(() => {
    if (isGameView) return;
    const card = cardRefs.current[selectedIndex];
    if (!card) return;

    // Play sound when selection actually changed
    if (prevSelectedRef.current !== selectedIndex) {
      playNavSound();
      prevSelectedRef.current = selectedIndex;
    }

    card.focus({ preventScroll: true });

    const scrollParent = card.closest(`.${styles.lobbyList}`);
    if (!scrollParent) return;

    const parentRect = scrollParent.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const scrollPaddingTop = parseFloat(getComputedStyle(scrollParent).scrollPaddingTop) || 0;
    const scrollPaddingBottom = parseFloat(getComputedStyle(scrollParent).scrollPaddingBottom) || 0;

    let delta = 0;
    if (cardRect.top < parentRect.top + scrollPaddingTop) {
      delta = cardRect.top - parentRect.top - scrollPaddingTop;
    } else if (cardRect.bottom > parentRect.bottom - scrollPaddingBottom) {
      delta = cardRect.bottom - parentRect.bottom + scrollPaddingBottom;
    }

    if (Math.abs(delta) < 1) return;

    // Cancel any in-flight scroll animation
    if (scrollAnimRef.current) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }

    const startScroll = scrollParent.scrollTop;
    const targetScroll = startScroll + delta;
    const duration = Math.min(260, 120 + Math.abs(delta) * 0.35);
    const startTime = performance.now();

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      scrollParent.scrollTop = startScroll + (targetScroll - startScroll) * eased;

      if (progress < 1) {
        scrollAnimRef.current = requestAnimationFrame(animate);
      } else {
        scrollAnimRef.current = null;
      }
    };

    scrollAnimRef.current = requestAnimationFrame(animate);
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
    if (route?.gameId) {
      disposeGameSession(route.gameId);
    }
    navigateTo("/");
  }, [disposeGameSession, navigateTo, route?.gameId]);

  const handleConfirmExit = useCallback(() => {
    setExitConfirmOpen(false);
    if (route?.gameId) {
      disposeGameSession(route.gameId);
    }
    navigateTo("/");
  }, [disposeGameSession, navigateTo, route?.gameId]);

  const handleCancelExit = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  const handleThemeSelect = useCallback((themeId) => {
    setSelectedThemeId(themeId);
    saveSelectedTheme(themeId);
  }, []);

  const handleTabChange = useCallback((tabId) => {
    if (!isGameView && !muted && musicVolume > 0) {
      void startLobbyMusic(false);
    }
    setActiveTab(tabId);
  }, [isGameView, musicVolume, muted, startLobbyMusic]);

  const handleMusicVolumeChange = useCallback((nextVolume) => {
    const normalized = clamp01(Number(nextVolume));
    if (!Number.isFinite(normalized)) return;
    setMusicVolume(normalized);
  }, []);

  const headerLeft = isGameView ? (
    <a
      id="back-to-lobby"
      className={styles.backLink}
      href="/"
      onClick={(event) => {
        event.preventDefault();
        if (route?.gameId) {
          disposeGameSession(route.gameId);
        }
        navigateTo("/");
      }}
    >
      &larr; Lobby
    </a>
  ) : (
    <div id="lobby-badge" className={styles.badge}>
      KABOOM CONSOLE
    </div>
  );

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";
  const rematchDisabled = endGameState.phase === "waiting";

  const fullscreenActive = isFullscreen || pseudoFullscreen;

  return (
    <div
      className={classNames(
        styles.app,
        fullscreenActive && styles.appFullscreen,
      )}
    >
      <div className={styles.console}>
        <div className={classNames(styles.screen, isGameView && styles.screenInGame)}>
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
                  icons={themeIcons.header}
                  themeMode={theme}
                  onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                  onToggleFullscreen={handleFullscreenToggle}
                  isFullscreen={fullscreenActive}
                  muted={muted}
                  onToggleMute={() => setMuted((prev) => !prev)}
                />
              )}

              {!isGameView && activeTab !== "config" && (
                <LobbyList
                  loading={loadingGames}
                  games={games}
                  selectedIndex={selectedIndex}
                  onSelectIndex={setSelectedIndex}
                  onActivate={handleLobbyActivate}
                  registerCardRef={(index, node) => {
                    cardRefs.current[index] = node;
                  }}
                />
              )}

              {!isGameView && activeTab === "config" && (
                <ConfigPanel
                  themes={builtInThemes}
                  selectedThemeId={selectedThemeId}
                  icons={themeIcons.config}
                  onSelectTheme={handleThemeSelect}
                  musicVolume={musicVolume}
                  muted={muted}
                  onToggleMute={() => setMuted((prev) => !prev)}
                  onMusicVolumeChange={handleMusicVolumeChange}
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
                  connection={connectionState}
                  icons={themeIcons}
                />
              )}
            </div>
          </div>
          {!isGameView && (
            <BottomNav activeTab={activeTab} onTabChange={handleTabChange} icons={themeIcons.nav} />
          )}
        </div>

        {showPlatformControlButtons ? (
          <Controller onDirectional={handleDirectionalInput} onAction={handleActionInput} disabled={false} />
        ) : (
          <div className={styles.controllerSlimBar}>
            <button
              type="button"
              className={styles.controllerSlimHomeButton}
              onClick={() => handleActionInput("home")}
              aria-label="Home"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                home
              </span>
              <span className={styles.controllerSlimHomeLabel}>Home</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
