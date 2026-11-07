import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_THEME_ICONS } from "../data/themes/icons.js";
import { removeTheme } from "../utils/themeEngine.js";
import BottomNav from "./components/platform-screen/BottomNav.jsx";
import ConfigPanel from "./components/platform-screen/ConfigPanel.jsx";
import GameView from "./components/platform-screen/GameView.jsx";
import LobbyHeader from "./components/platform-screen/LobbyHeader.jsx";
import LobbyList from "./components/platform-screen/LobbyList.jsx";
import PlatformShell from "./components/platform-shell/PlatformShell.jsx";
import useGameCatalog from "./hooks/useGameCatalog.js";
import useCatalogGame from "./hooks/useCatalogGame.js";
import useLobbyAudio from "./hooks/useLobbyAudio.js";
import usePlatformGameLoader from "./hooks/usePlatformGameLoader.js";
import usePlatformGameUiState from "./hooks/usePlatformGameUiState.js";
import usePlatformPresentation from "./hooks/usePlatformPresentation.js";
import usePlatformRoute from "./hooks/usePlatformRoute.js";
import { getGameRuntimeSpec } from "./services/gameRuntime.js";
import { readCatalogColumnCount, readNextCatalogIndex } from "./services/catalogNavigation.js";

const CARD_ZOOM_STEPS = [0.85, 1, 1.075, 1.15];

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [shareOpen, setShareOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState("multi");
  const [cardZoomIndex, setCardZoomIndex] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState({ page: 1, q: "", genre: "all", sort: "name-asc" });

  const cardRefs = useRef([]);
  const prevSelectedRef = useRef(0);
  const focusSelectedCardRef = useRef(false);

  const setShareModal = useCallback((nextOpen) => {
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const { route, navigateTo, isGameView, routeViewKey } = usePlatformRoute();
  const { games: visibleGames, catalogPage, filterOptions, loadingGames, catalogUnavailable } = useGameCatalog(catalogQuery);
  const { activeGame, gameLookupError } = useCatalogGame(route?.gameId, visibleGames);
  const {
    muted,
    setMuted,
    musicVolume,
    updateMusicVolume,
    startLobbyMusic,
    playNavSound,
    triggerHaptic,
  } = useLobbyAudio({ isGameView });
  const { fullscreenActive, toggleFullscreen } = usePlatformPresentation();
  const { connectionState, endGameState, endGameBridgeRef } = usePlatformGameUiState(setShareModal);
  const { disposeGameSession, gameLoadError } = usePlatformGameLoader({
    game: activeGame,
    setShareModal,
  });
  const activeGameRuntime = useMemo(() => getGameRuntimeSpec(activeGame), [activeGame]);
  const startInLandscape = Boolean(activeGame?.startInLandscape);
  const showPlatformControlButtons = !isGameView || activeGame?.platformControlButtons !== false;
  const showShareInvite = !isGameView || Boolean(activeGame && activeGame.shareRoom !== false);
  const showNetworkUi = !isGameView || Boolean(activeGame && activeGame.networked !== false);
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
  const emptyLobbyMessage = catalogQuery.q.trim() || catalogQuery.genre !== "all"
    ? "Try a different search or genre."
    : "No games available right now.";

  const updateCatalogQuery = useCallback((changes) => {
    focusSelectedCardRef.current = false;
    setSelectedIndex(0);
    setCatalogQuery((current) => ({ ...current, ...changes, page: changes.page ?? 1 }));
  }, []);

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

  const ensureLobbyMusicPlayback = useCallback(() => {
    if (!isGameView && !muted && musicVolume > 0) {
      void startLobbyMusic(false);
    }
  }, [isGameView, musicVolume, muted, startLobbyMusic]);

  const openGamePath = useCallback(
    (path) => {
      if (!path) return;

      triggerHaptic();
      navigateTo(path);
    },
    [navigateTo, triggerHaptic],
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
      if (isGameView || loadingGames || !visibleGames.length) return;

      const gridColumns = readCatalogColumnCount(cardRefs.current[0]?.closest("[data-game-grid]"));

      setSelectedIndex((current) => {
        const nextIndex = readNextCatalogIndex(current, direction, gridColumns, visibleGames.length);

        focusSelectedCardRef.current = nextIndex !== current;
        if (nextIndex !== current) {
          triggerHaptic();
        }

        return nextIndex;
      });
    },
    [ensureLobbyMusicPlayback, isGameView, loadingGames, triggerHaptic, visibleGames.length],
  );

  const selectLibraryGame = useCallback((index, shouldFocus = false) => {
    if (loadingGames) return;
    focusSelectedCardRef.current = shouldFocus && index !== selectedIndex;
    if (shouldFocus && index === selectedIndex) {
      cardRefs.current[index]?.focus({ preventScroll: true });
    }
    setSelectedIndex(index);
  }, [loadingGames, selectedIndex]);

  const activateSelectedGame = useCallback(() => {
    if (loadingGames || !visibleGames.length) return;
    const game = visibleGames[selectedIndex];
    if (game?.path) {
      openGamePath(game.path);
    }
  }, [loadingGames, openGamePath, selectedIndex, visibleGames]);

  const handleActionInput = useCallback(
    (action) => {
      ensureLobbyMusicPlayback();

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
    if (isGameView || loadingGames) return;

    const card = cardRefs.current[selectedIndex];
    if (!card) return;

    if (prevSelectedRef.current !== selectedIndex) {
      playNavSound();
      prevSelectedRef.current = selectedIndex;
    }

    if (!focusSelectedCardRef.current) return;
    focusSelectedCardRef.current = false;
    card.focus({ preventScroll: true });

    const cardGrid = card.closest("[data-game-grid]");
    if (!cardGrid) return;

    const gridRect = cardGrid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const scrollPadding = 3;
    const scrollDelta = cardRect.top < gridRect.top + scrollPadding
      ? cardRect.top - gridRect.top - scrollPadding
      : Math.max(0, cardRect.bottom - gridRect.bottom + scrollPadding);

    if (Math.abs(scrollDelta) > 1) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      cardGrid.scrollBy({ top: scrollDelta, behavior: reducedMotion ? "auto" : "smooth" });
    }
  }, [activeTab, cardScale, isGameView, loadingGames, playNavSound, selectedIndex, visibleGames]);

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
          searchQuery={catalogQuery.q}
          onSearchChange={(q) => updateCatalogQuery({ q })}
          filterOptions={filterOptions}
          activeFilter={catalogQuery.genre}
          onFilterChange={(genre) => updateCatalogQuery({ genre })}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      )}

      {!isGameView && activeTab !== "config" && (
        <LobbyList
          loading={loadingGames}
          games={visibleGames}
          catalogPage={catalogPage}
          catalogUnavailable={catalogUnavailable}
          sort={catalogQuery.sort}
          onSortChange={(sort) => updateCatalogQuery({ sort })}
          onPageChange={(page) => updateCatalogQuery({ page })}
          emptyMessage={emptyLobbyMessage}
          selectedIndex={selectedIndex}
          onSelectIndex={selectLibraryGame}
          onActivate={openGamePath}
          cardScale={cardScale}
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
          gameLoadError={gameLoadError || gameLookupError}
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
