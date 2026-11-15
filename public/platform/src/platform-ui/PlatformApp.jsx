import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_THEME_ICONS } from "../data/themes/icons.js";
import BottomNav from "./components/platform-screen/BottomNav.jsx";
import ConfigPanel, { SettingsBackdrop } from "./components/platform-screen/ConfigPanel.jsx";
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
import useGameOrientation from "./hooks/useGameOrientation.js";
import usePlatformRoute from "./hooks/usePlatformRoute.js";
import useTouchProfile from "./hooks/useTouchProfile.js";
import useRoomLifecycle from "./hooks/useRoomLifecycle.js";
import usePlatformTheme from "./hooks/usePlatformTheme.js";
import useMediaQuery from "./hooks/useMediaQuery.js";
import { PORTRAIT_LIBRARY_QUERY, readLibraryLayoutChoice, resolveLibraryLayout, saveLibraryLayoutChoice } from "./services/libraryLayout.js";
import { clampLibraryDiscIndex } from "./services/libraryDisc.js";
import { createRoomInvitePolicy } from "./services/roomInvitePolicy.js";
import { getGameRuntimeSpec } from "./services/gameRuntime.js";
import { readSpatialCatalogIndex } from "./services/catalogNavigation.js";
import { readGameLibraryDetails } from "./services/gamePresentation.js";
import LibraryBackdrop from "./components/platform-screen/LibraryBackdrop.jsx";
import LaunchOverlay from "./components/platform-screen/LaunchOverlay.jsx";
import BootReveal from "./components/platform-screen/BootReveal.jsx";
import { uiSounds } from "./services/uiSounds.js";
import { readGameOrientations } from "../../shared/gamePresentation.js";
import { LIBRARY_ZOOM, clampLibraryZoom, readLibraryZoom, saveLibraryZoom, stepLibraryZoom } from "./services/libraryZoom.js";

/** Tab order decides which way content slides when switching tabs. */
const TAB_ORDER = Object.freeze(["solo", "multi", "friends", "profile", "config"]);

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [shareOpen, setShareOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState("multi");
  const [tabSwap, setTabSwap] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [cardScale, setCardScale] = useState(() => readLibraryZoom());
  // Applied at startup so the chosen theme shows before Settings is opened.
  const platformTheme = usePlatformTheme();
  // Grid or disc: portrait screens default to the disc unless the player chose.
  const portraitLibrary = useMediaQuery(PORTRAIT_LIBRARY_QUERY);
  const [libraryLayoutChoice, setLibraryLayoutChoice] = useState(() => readLibraryLayoutChoice());
  const libraryLayout = resolveLibraryLayout(libraryLayoutChoice, portraitLibrary);
  const [catalogQuery, setCatalogQuery] = useState({ page: 1, q: "", genre: "all", sort: "name-asc" });
  const [touchEditorOpen, setTouchEditorOpen] = useState(false);
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [roomCreatorEntry, setRoomCreatorEntry] = useState(false);
  const roomInvitePolicyRef = useRef(createRoomInvitePolicy());
  const countdownActiveRef = useRef(false);

  const cardRefs = useRef([]);
  const prevSelectedRef = useRef(0);
  const focusSelectedCardRef = useRef(false);

  const setShareModal = useCallback((nextOpen) => {
    if (nextOpen !== false && countdownActiveRef.current) return;
    setShareOpen((prev) => (typeof nextOpen === "boolean" ? nextOpen : !prev));
  }, []);

  const { route, navigateTo, isGameView, routeViewKey } = usePlatformRoute();
  const { games: visibleGames, catalogPage, filterOptions, loadingGames, catalogUnavailable } = useGameCatalog(catalogQuery);
  const { activeGame, gameLookupError } = useCatalogGame(route?.gameId, visibleGames);
  const touchSettings = useTouchProfile(activeGame);
  const {
    muted,
    setMuted,
    musicVolume,
    updateMusicVolume,
    startLobbyMusic,
    playNavSound,
    triggerHaptic,
  } = useLobbyAudio({ isGameView });
  const { fullscreenActive, toggleFullscreen, requestFullscreen, beginGameLaunch, endGamePresentation } = usePlatformPresentation({ isGameView });
  const gameOrientation = useGameOrientation({
    gameId: isGameView ? activeGame?.id || null : null,
    supportsPortrait: readGameOrientations(activeGame?.presentation).includes("portrait"),
    requestFullscreen,
  });
  const { connectionState, endGameState, endGameBridgeRef } = usePlatformGameUiState(setShareModal);
  const { disposeGameSession, gameLoadError } = usePlatformGameLoader({
    game: activeGame,
    setShareModal,
    canStart: gameOrientation.canLoadRuntime,
  });
  const activeGameRuntime = useMemo(() => getGameRuntimeSpec(activeGame), [activeGame]);
  const showPlatformControlButtons = !isGameView || activeGame?.platformControlButtons !== false;
  const showShareInvite = !isGameView || Boolean(activeGame && activeGame.shareRoom !== false);
  const showNetworkUi = !isGameView || Boolean(activeGame && activeGame.networked !== false);
  const roomLifecycleEnabled = Boolean(isGameView && activeGame && gameOrientation.canLoadRuntime && activeGameRuntime.kind === "module" && activeGameRuntime.runtime?.socketIo === true && activeGame.networked !== false);
  const roomLifecycle = useRoomLifecycle(activeGame, roomLifecycleEnabled);
  countdownActiveRef.current = roomLifecycleEnabled && roomLifecycle.phase === "countdown";
  const roomStartBlocking = roomLifecycleEnabled && !["playing", "finished"].includes(roomLifecycle.phase);
  const controllerMode = useMemo(() => {
    if (isGameView && showPlatformControlButtons) return "split";
    if (showPlatformControlButtons) return "full";
    return "home-bar";
  }, [isGameView, showPlatformControlButtons]);

  const shareUrl = useMemo(() => {
    if (!route?.gameId || !route?.roomId) return "";
    return `${window.location.origin}/games/${route.gameId}/${route.roomId}`;
  }, [route?.gameId, route?.roomId]);

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";
  const rematchDisabled = endGameState.phase === "waiting";
  const canZoomOut = cardScale > LIBRARY_ZOOM.min;
  const canZoomIn = cardScale < LIBRARY_ZOOM.max;
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
    // Keys from the retired theme engine; platform themes use their own store.
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
    const decision = roomInvitePolicyRef.current.update({
      ...roomLifecycle,
      gameId: isGameView ? route?.gameId : null,
      roomId: route?.roomId || null,
      joined: Boolean(roomLifecycle.joined && roomLifecycle.roomId === route?.roomId),
    });
    setRoomCreatorEntry(decision.isCreatorEntry);
    if (!isGameView || !showShareInvite || decision.closeInvite) setShareModal(false);
    else if (decision.autoInvite) setShareModal(true);
  }, [isGameView, route?.gameId, route?.roomId, roomLifecycle.phase, roomLifecycle.joined, roomLifecycle.roomId, roomLifecycle.connectedPlayers, roomLifecycle.requiredPlayers, setShareModal, showShareInvite]);

  const ensureLobbyMusicPlayback = useCallback(() => {
    if (!isGameView && !muted && musicVolume > 0) {
      void startLobbyMusic(false);
    }
  }, [isGameView, musicVolume, muted, startLobbyMusic]);

  const openGamePath = useCallback(
    (path) => {
      if (!path) return;

      triggerHaptic();
      uiSounds.play("select");
      const launchedGame = visibleGames.find((game) => game.path === path);
      beginGameLaunch({ allowPortrait: readGameOrientations(launchedGame?.presentation).includes("portrait") });
      setLaunch(describeLaunchFromCard(visibleGames, path, cardRefs.current[selectedIndex]));
      navigateTo(path);
    },
    [beginGameLaunch, navigateTo, selectedIndex, triggerHaptic, visibleGames],
  );
  const finishLaunch = useCallback(() => setLaunch(null), []);

  const returnToLobby = useCallback(() => {
    setExitConfirmOpen(false);
    setTouchEditorOpen(false);
    setVoiceDialogOpen(false);
    endGamePresentation();
    if (route?.gameId) {
      disposeGameSession(route.gameId);
    }
    uiSounds.play("back");
    setLaunch(null);
    navigateTo("/");
  }, [disposeGameSession, endGamePresentation, navigateTo, route?.gameId]);

  const handleDirectionalInput = useCallback(
    (direction) => {
      ensureLobbyMusicPlayback();
      if (isGameView || activeTab === "config" || loadingGames || !visibleGames.length) return;

      const cardBoxes = visibleGames.map((_game, index) => cardRefs.current[index]?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 });
      // On the disc every direction steps along the rim, one game at a time.
      const discStep = { up: -1, left: -1, down: 1, right: 1 }[direction] ?? 0;

      setSelectedIndex((current) => {
        const nextIndex = libraryLayout === "disc"
          ? clampLibraryDiscIndex(direction === "home" ? 0 : direction === "end" ? visibleGames.length - 1 : current + discStep, visibleGames.length)
          : readSpatialCatalogIndex(cardBoxes, current, direction);

        focusSelectedCardRef.current = nextIndex !== current;
        if (nextIndex !== current) {
          triggerHaptic();
        }

        return nextIndex;
      });
    },
    [activeTab, ensureLobbyMusicPlayback, isGameView, libraryLayout, loadingGames, triggerHaptic, visibleGames.length],
  );

  const changeLibraryLayout = useCallback((layout) => {
    uiSounds.play("tab");
    setLibraryLayoutChoice(layout);
    saveLibraryLayoutChoice(layout);
  }, []);

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
      if (activeTab === "config") return;

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
    [activeTab, activateSelectedGame, ensureLobbyMusicPlayback, handleDirectionalInput, isGameView, setShareModal],
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
      if (tabId !== activeTab) {
        uiSounds.play("tab");
        const direction = TAB_ORDER.indexOf(tabId) > TAB_ORDER.indexOf(activeTab) ? 1 : -1;
        setTabSwap((previous) => ({ direction, serial: (previous?.serial ?? 0) + 1 }));
      }
      setActiveTab(tabId);
    },
    [activeTab, ensureLobbyMusicPlayback],
  );

  // Remember the card size a moment after the last change, not every frame of a pinch.
  useEffect(() => {
    const saveTimer = window.setTimeout(() => saveLibraryZoom(cardScale), 300);
    return () => window.clearTimeout(saveTimer);
  }, [cardScale]);

  const handleZoomStep = useCallback((direction) => {
    ensureLobbyMusicPlayback();
    triggerHaptic();
    setCardScale((current) => stepLibraryZoom(current, direction));
  }, [ensureLobbyMusicPlayback, triggerHaptic]);

  const handleZoomOut = useCallback(() => handleZoomStep(-1), [handleZoomStep]);
  const handleZoomIn = useCallback(() => handleZoomStep(1), [handleZoomStep]);
  const handleZoomChange = useCallback((nextScale) => {
    setCardScale((current) => {
      const next = clampLibraryZoom(typeof nextScale === "function" ? nextScale(current) : nextScale);
      return Math.abs(next - current) < 0.0005 ? current : next;
    });
  }, []);

  const footer = !isGameView ? (
    <BottomNav activeTab={activeTab} onTabChange={handleTabChange} icons={platformTheme.selectedTheme.icons.nav} disabled={configDialogOpen} />
  ) : null;

  return (
    <PlatformShell
      footer={footer}
      accentColor={readGameLibraryDetails((isGameView ? activeGame : visibleGames[selectedIndex]) || {}).accentColor}
      backdrop={isGameView ? null : activeTab === "config"
        ? <SettingsBackdrop background={platformTheme.selectedTheme.background} />
        : <LibraryBackdrop game={visibleGames[selectedIndex] || visibleGames[0] || null} background={platformTheme.selectedTheme.background} />}
      overlay={launch && isGameView ? <LaunchOverlay launch={launch} onDone={finishLaunch} /> : null}
      contentSwap={isGameView ? null : tabSwap}
      fullscreenActive={fullscreenActive}
      isGameScreen={isGameView}
      transitioning={routeTransitioning}
      controllerMode={controllerMode}
      onDirectional={handleDirectionalInput}
      onAction={handleActionInput}
      immersive={isGameView && touchSettings.expanded}
      controllerDisabled={Boolean(gameOrientation.needsLandscape || roomStartBlocking || touchEditorOpen || voiceDialogOpen || configDialogOpen || shareOpen || exitConfirmOpen || endGameState.open)}
    >
      {!isGameView && <BootReveal />}
      {!isGameView && activeTab !== "config" && (
        <LobbyHeader
          libraryLayout={libraryLayout}
          onLibraryLayoutChange={changeLibraryLayout}
          showLayoutToggle={portraitLibrary}
          showZoomControls={activeTab !== "config" && libraryLayout === "grid"}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          zoomScale={cardScale}
          onZoomChange={handleZoomChange}
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
          layout={libraryLayout}
          discStyle={platformTheme.selectedTheme.disc.style}
          cardScale={cardScale}
          onCardScaleChange={handleZoomChange}
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
          onDialogChange={setConfigDialogOpen}
          theme={platformTheme}
        />
      )}

      {isGameView && (
        <GameView
          gameOrientation={gameOrientation}
          roomLifecycle={roomLifecycleEnabled ? roomLifecycle : null}
          roomCreatorEntry={roomCreatorEntry}
          runtimeSpec={activeGameRuntime}
          game={activeGame}
          touchProfile={touchSettings.profile}
          touchOrientation={touchSettings.orientation}
          touchControlsEnabled={touchSettings.enabled}
          expandedPlayArea={touchSettings.expanded}
          onSaveTouchProfile={touchSettings.saveProfile}
          touchProfileStatus={touchSettings.status}
          touchEditorOpen={touchEditorOpen}
          onTouchEditorChange={setTouchEditorOpen}
          onVoiceDialogChange={setVoiceDialogOpen}
          onOpenInvite={showShareInvite ? () => setShareModal(true) : undefined}
          onRequestHome={() => handleActionInput("home")}
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

/**
 * Where a launch zoom starts: the activated card's box inside the console
 * screen, as clip insets. Null zooms from the middle.
 * @param {readonly object[]} games @param {string} path @param {HTMLElement|undefined} card
 */
function describeLaunchFromCard(games, path, card) {
  const game = games.find((candidate) => candidate.path === path);
  if (!game) return null;
  const screen = card?.closest("[data-platform-screen]");
  let from = null;
  if (card && screen && card.dataset.libraryCardId === game.id) {
    // A layout may mark where its art is (the disc's spotlight); else the card's media.
    const origin = screen.querySelector(`[data-launch-origin="${CSS.escape(game.id)}"]`) || card.querySelector("[data-card-media]") || card;
    const cardBounds = origin.getBoundingClientRect();
    const screenBounds = screen.getBoundingClientRect();
    from = {
      top: Math.max(0, cardBounds.top - screenBounds.top),
      right: Math.max(0, screenBounds.right - cardBounds.right),
      bottom: Math.max(0, screenBounds.bottom - cardBounds.bottom),
      left: Math.max(0, cardBounds.left - screenBounds.left),
    };
  }
  return { game, from, serial: Date.now() };
}
