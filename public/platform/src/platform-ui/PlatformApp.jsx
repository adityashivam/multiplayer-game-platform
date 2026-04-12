import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_THEME_ICONS } from "../data/themes/icons.js";
import { removeTheme } from "../utils/themeEngine.js";
import BottomNav from "./components/platform-screen/BottomNav.jsx";
import ConfigPanel from "./components/platform-screen/ConfigPanel.jsx";
import GameView from "./components/platform-screen/GameView.jsx";
import LobbyHeader from "./components/platform-screen/LobbyHeader.jsx";
import LobbyList from "./components/platform-screen/LobbyList.jsx";
import PlatformShell from "./components/platform-shell/PlatformShell.jsx";
import { TOGGLE_NETWORK_PANEL_EVENT } from "./constants/events.js";
import useGameCatalog from "./hooks/useGameCatalog.js";
import useLobbyAudio from "./hooks/useLobbyAudio.js";
import usePlatformGameLoader from "./hooks/usePlatformGameLoader.js";
import usePlatformGameUiState from "./hooks/usePlatformGameUiState.js";
import usePlatformPresentation from "./hooks/usePlatformPresentation.js";
import usePlatformRoute from "./hooks/usePlatformRoute.js";
import { getGameRuntimeSpec } from "./services/gameRuntime.js";
import styles from "./PlatformApp.module.scss";

const CARD_ZOOM_STEPS = [0.85, 1, 1.075, 1.15];
const NON_FILTER_TAG_PATTERN = /^(?:\d+\s*players?|fast|demo|preview)$/i;

function normalizeFilterTag(tag) {
  const normalized = tag.trim().toLowerCase().replace(/[-\s]+/g, " ");
  return normalized === "real time" ? "realtime" : normalized;
}

function formatFilterLabel(tag) {
  if (tag === "realtime") return "Real-time";
  return tag.replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [shareOpen, setShareOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState("multi");
  const [cardZoomIndex, setCardZoomIndex] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const cardRefs = useRef([]);
  const prevSelectedRef = useRef(0);

  const setShareModal = useCallback((nextOpen) => {
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const { route, navigateTo, isGameView, routeViewKey } = usePlatformRoute();
  const { games, loadingGames, resolveGameById, resolveGameByPath } = useGameCatalog();
  const {
    muted,
    setMuted,
    musicVolume,
    updateMusicVolume,
    startLobbyMusic,
    playNavSound,
    triggerHaptic,
  } = useLobbyAudio({ isGameView });
  const { fullscreenActive, toggleFullscreen, presentLandscapeMode, unlockOrientation } =
    usePlatformPresentation();
  const { connectionState, endGameState, endGameBridgeRef } = usePlatformGameUiState(setShareModal);
  const activeGame = useMemo(() => resolveGameById(route?.gameId), [resolveGameById, route?.gameId]);
  const { disposeGameSession, gameLoadError } = usePlatformGameLoader({
    game: activeGame,
    setShareModal,
  });
  const activeGameRuntime = useMemo(() => getGameRuntimeSpec(activeGame), [activeGame]);
  const startInLandscape = Boolean(activeGame?.startInLandscape);
  const showPlatformControlButtons = !isGameView || activeGame?.platformControlButtons !== false;
  const showShareInvite = !isGameView || activeGame?.shareRoom !== false;
  const showNetworkUi = !isGameView || activeGame?.networked !== false;
  const controllerMode = useMemo(() => {
    if (isGameView && startInLandscape && showPlatformControlButtons) return "split";
    if (showPlatformControlButtons) return "full";
    return "home-bar";
  }, [isGameView, showPlatformControlButtons, startInLandscape]);

  const shareUrl = useMemo(() => {
    if (!route?.gameId || !route?.roomId) return "";
    return `${window.location.origin}/games/${route.gameId}/${route.roomId}`;
  }, [route?.gameId, route?.roomId]);

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";
  const rematchDisabled = endGameState.phase === "waiting";
  const cardScale = CARD_ZOOM_STEPS[cardZoomIndex] || 1;
  const canZoomOut = cardZoomIndex > 0;
  const canZoomIn = cardZoomIndex < CARD_ZOOM_STEPS.length - 1;
  const filterOptions = useMemo(() => {
    const uniqueTags = new Set();

    games.forEach((game) => {
      (game.tags || []).forEach((tag) => {
        if (!tag || NON_FILTER_TAG_PATTERN.test(tag)) return;
        uniqueTags.add(normalizeFilterTag(tag));
      });
    });

    return [
      { value: "all", label: "All Genres" },
      ...Array.from(uniqueTags)
        .sort((left, right) => left.localeCompare(right))
        .map((tag) => ({
          value: tag,
          label: formatFilterLabel(tag),
        })),
    ];
  }, [games]);
  const visibleGames = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return games.filter((game) => {
      const matchesFilter =
        activeFilter === "all" ||
        (game.tags || []).some((tag) => normalizeFilterTag(tag) === activeFilter);

      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        game.name,
        game.description,
        ...(Array.isArray(game.tags) ? game.tags : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [activeFilter, games, searchQuery]);
  const emptyLobbyMessage =
    searchQuery.trim() || activeFilter !== "all"
      ? "No games match the current search or filter."
      : "No games available right now.";

  useEffect(() => {
    document.documentElement.classList.add("dark");
    removeTheme();
    localStorage.removeItem("kaboom-preferred-theme");
    localStorage.removeItem("kaboom-selected-theme");
  }, []);

  useEffect(() => {
    if (!loadingGames) {
      setSelectedIndex((current) => Math.min(current, Math.max(0, visibleGames.length - 1)));
    }
  }, [loadingGames, visibleGames.length]);

  useEffect(() => {
    cardRefs.current.length = visibleGames.length;
  }, [visibleGames.length]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeFilter, searchQuery]);

  useEffect(() => {
    if (filterOptions.some((option) => option.value === activeFilter)) return;
    setActiveFilter("all");
  }, [activeFilter, filterOptions]);

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
    if (!isGameView) {
      endGameBridgeRef.current?.hideEndGameModal?.();
    }
  }, [isGameView, endGameBridgeRef]);

  useEffect(() => {
    if (!isGameView || !showShareInvite) {
      setShareModal(false);
      return;
    }

    const joined = window.__kaboomOpponentJoined;
    if (joined && joined.gameId === route?.gameId && joined.roomId === route?.roomId) {
      setShareModal(false);
      return;
    }

    setShareModal(true);
  }, [isGameView, route?.gameId, route?.roomId, setShareModal, showShareInvite]);

  useEffect(() => {
    const handleOpponentJoined = () => {
      setShareModal(false);
    };

    window.addEventListener("kaboom:opponent-joined", handleOpponentJoined);
    return () => {
      window.removeEventListener("kaboom:opponent-joined", handleOpponentJoined);
    };
  }, [setShareModal]);

  useEffect(() => {
    if (!isGameView || !startInLandscape) return () => {};

    presentLandscapeMode();
    return () => {
      unlockOrientation();
    };
  }, [isGameView, presentLandscapeMode, startInLandscape, unlockOrientation]);

  const ensureLobbyMusicPlayback = useCallback(() => {
    if (!isGameView && !muted && musicVolume > 0) {
      void startLobbyMusic(false);
    }
  }, [isGameView, musicVolume, muted, startLobbyMusic]);

  const openGamePath = useCallback(
    (path) => {
      if (!path) return;

      const nextGame = resolveGameByPath(path);
      triggerHaptic();

      if (nextGame?.startInLandscape) {
        presentLandscapeMode();
      }

      navigateTo(path);
    },
    [navigateTo, presentLandscapeMode, resolveGameByPath, triggerHaptic],
  );

  const returnToLobby = useCallback(() => {
    setExitConfirmOpen(false);
    if (route?.gameId) {
      disposeGameSession(route.gameId);
    }
    navigateTo("/");
  }, [disposeGameSession, navigateTo, route?.gameId]);

  const handleDirectionalInput = useCallback(
    (direction) => {
      ensureLobbyMusicPlayback();
      if (isGameView || !visibleGames.length) return;

      setSelectedIndex((current) => {
        const nextIndex =
          direction === "up" || direction === "left"
            ? Math.max(0, current - 1)
            : Math.min(visibleGames.length - 1, current + 1);

        if (nextIndex !== current) {
          triggerHaptic();
        }

        return nextIndex;
      });
    },
    [ensureLobbyMusicPlayback, isGameView, triggerHaptic, visibleGames.length],
  );

  const activateSelectedGame = useCallback(() => {
    if (!visibleGames.length) return;
    const game = visibleGames[selectedIndex];
    if (game?.path) {
      openGamePath(game.path);
    }
  }, [openGamePath, selectedIndex, visibleGames]);

  const handleActionInput = useCallback(
    (action) => {
      ensureLobbyMusicPlayback();

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
          activateSelectedGame();
          break;
        case "b":
          handleDirectionalInput("left");
          break;
        default:
          break;
      }
    },
    [activateSelectedGame, ensureLobbyMusicPlayback, handleDirectionalInput, isGameView, setShareModal],
  );

  useEffect(() => {
    if (isGameView) return;

    const card = cardRefs.current[selectedIndex];
    if (!card) return;

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

    let animationFrameId = 0;
    const startScroll = scrollParent.scrollTop;
    const targetScroll = startScroll + delta;
    const duration = Math.min(260, 120 + Math.abs(delta) * 0.35);
    const startTime = performance.now();

    const easeOutCubic = (timeValue) => 1 - Math.pow(1 - timeValue, 3);

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      scrollParent.scrollTop = startScroll + (targetScroll - startScroll) * eased;

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isGameView, playNavSound, selectedIndex]);

  const handleCopyShare = useCallback(async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch (error) {
      console.warn("Clipboard copy failed", error);
      setCopyLabel("Select & copy");
      setTimeout(() => setCopyLabel("Copy"), 1400);
    }
  }, [shareUrl]);

  const handleRematch = useCallback(() => {
    endGameBridgeRef.current?.requestRematch?.();
  }, [endGameBridgeRef]);

  const handleTabChange = useCallback(
    (tabId) => {
      ensureLobbyMusicPlayback();
      setActiveTab(tabId);
    },
    [ensureLobbyMusicPlayback],
  );

  const handleZoomOut = useCallback(() => {
    if (!canZoomOut) return;
    ensureLobbyMusicPlayback();
    triggerHaptic();
    setCardZoomIndex((current) => Math.max(0, current - 1));
  }, [canZoomOut, ensureLobbyMusicPlayback, triggerHaptic]);

  const handleZoomIn = useCallback(() => {
    if (!canZoomIn) return;
    ensureLobbyMusicPlayback();
    triggerHaptic();
    setCardZoomIndex((current) => Math.min(CARD_ZOOM_STEPS.length - 1, current + 1));
  }, [canZoomIn, ensureLobbyMusicPlayback, triggerHaptic]);

  const footer = !isGameView ? (
    <BottomNav activeTab={activeTab} onTabChange={handleTabChange} icons={DEFAULT_THEME_ICONS.nav} />
  ) : null;

  return (
    <PlatformShell
      footer={footer}
      fullscreenActive={fullscreenActive}
      isGameScreen={isGameView}
      transitioning={routeTransitioning}
      controllerMode={controllerMode}
      onDirectional={handleDirectionalInput}
      onAction={handleActionInput}
    >
      {!isGameView && (
        <LobbyHeader
          showZoomControls={activeTab !== "config"}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterOptions={filterOptions}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      )}

      {!isGameView && activeTab !== "config" && (
        <LobbyList
          loading={loadingGames}
          games={visibleGames}
          emptyMessage={emptyLobbyMessage}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          onActivate={openGamePath}
          cardScale={cardScale}
          cardZoomIndex={cardZoomIndex}
          registerCardRef={(index, node) => {
            cardRefs.current[index] = node;
          }}
        />
      )}

      {!isGameView && activeTab === "config" && (
        <ConfigPanel
          musicVolume={musicVolume}
          muted={muted}
          onToggleMute={() => setMuted((prev) => !prev)}
          onMusicVolumeChange={updateMusicVolume}
        />
      )}

      {isGameView && (
        <GameView
          runtimeSpec={activeGameRuntime}
          shareOpen={showShareInvite && shareOpen}
          showNetworkUi={showNetworkUi}
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
          onBackHome={returnToLobby}
          rematchDisabled={rematchDisabled}
          exitConfirmOpen={exitConfirmOpen}
          onConfirmExit={returnToLobby}
          onCancelExit={() => setExitConfirmOpen(false)}
          isFullscreen={fullscreenActive}
          onToggleFullscreen={toggleFullscreen}
          connection={connectionState}
          icons={DEFAULT_THEME_ICONS}
        />
      )}
    </PlatformShell>
  );
}
