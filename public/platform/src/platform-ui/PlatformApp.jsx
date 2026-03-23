import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_THEME_ICONS } from "../data/themes/icons.js";
import { gameTitles } from "../data/games.js";
import { removeTheme } from "../utils/themeEngine.js";
import BottomNav from "./components/platform-screen/BottomNav.jsx";
import ConfigPanel from "./components/platform-screen/ConfigPanel.jsx";
import GameView from "./components/platform-screen/GameView.jsx";
import LobbyHeader from "./components/platform-screen/LobbyHeader.jsx";
import LobbyList from "./components/platform-screen/LobbyList.jsx";
import PlatformBackLink from "./components/platform-shell/PlatformBackLink.jsx";
import PlatformBadge from "./components/platform-shell/PlatformBadge.jsx";
import PlatformShell from "./components/platform-shell/PlatformShell.jsx";
import { TOGGLE_NETWORK_PANEL_EVENT } from "./constants/events.js";
import useGameCatalog from "./hooks/useGameCatalog.js";
import useLobbyAudio from "./hooks/useLobbyAudio.js";
import usePlatformGameLoader from "./hooks/usePlatformGameLoader.js";
import usePlatformGameUiState from "./hooks/usePlatformGameUiState.js";
import usePlatformPresentation from "./hooks/usePlatformPresentation.js";
import usePlatformRoute from "./hooks/usePlatformRoute.js";
import styles from "./PlatformApp.module.scss";

export default function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [shareOpen, setShareOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState("multi");

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
  const { disposeGameSession, gameLoadError } = usePlatformGameLoader({
    gameId: route?.gameId || null,
    setShareModal,
  });

  const activeGame = useMemo(() => resolveGameById(route?.gameId), [resolveGameById, route?.gameId]);
  const startInLandscape = Boolean(activeGame?.startInLandscape);
  const showPlatformControlButtons = !isGameView || activeGame?.platformControlButtons !== false;
  const controllerMode = useMemo(() => {
    if (isGameView && startInLandscape && showPlatformControlButtons) return "split";
    if (showPlatformControlButtons) return "full";
    return "home-bar";
  }, [isGameView, showPlatformControlButtons, startInLandscape]);

  const headerTitle = useMemo(() => {
    if (isGameView) {
      return gameTitles[route?.gameId] || route?.gameId?.replace(/-/g, " ")?.toUpperCase() || "GAME VIEW";
    }

    if (activeTab === "config") return "CONFIG";
    return "SELECT GAME CARTRIDGE";
  }, [activeTab, isGameView, route?.gameId]);

  const shareUrl = useMemo(() => {
    if (!route?.gameId || !route?.roomId) return "";
    return `${window.location.origin}/games/${route.gameId}/${route.roomId}`;
  }, [route?.gameId, route?.roomId]);

  const roomLabel = route?.roomId ? `Room #${route.roomId}` : "Room #----";
  const rematchDisabled = endGameState.phase === "waiting";

  useEffect(() => {
    document.documentElement.classList.add("dark");
    removeTheme();
    localStorage.removeItem("kaboom-preferred-theme");
    localStorage.removeItem("kaboom-selected-theme");
  }, []);

  useEffect(() => {
    if (!loadingGames) {
      setSelectedIndex((current) => Math.min(current, Math.max(0, games.length - 1)));
    }
  }, [games.length, loadingGames]);

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
      if (isGameView || !games.length) return;

      setSelectedIndex((current) => {
        const nextIndex =
          direction === "up" || direction === "left"
            ? Math.max(0, current - 1)
            : Math.min(games.length - 1, current + 1);

        if (nextIndex !== current) {
          triggerHaptic();
        }

        return nextIndex;
      });
    },
    [ensureLobbyMusicPlayback, games.length, isGameView, triggerHaptic],
  );

  const activateSelectedGame = useCallback(() => {
    if (!games.length) return;
    const game = games[selectedIndex];
    if (game?.path) {
      openGamePath(game.path);
    }
  }, [games, openGamePath, selectedIndex]);

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

  const headerLeft = isGameView ? (
    <PlatformBackLink onNavigate={returnToLobby}>Lobby</PlatformBackLink>
  ) : (
    <PlatformBadge>KABOOM CONSOLE</PlatformBadge>
  );

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
          headerLeft={headerLeft}
          title={headerTitle}
          icons={DEFAULT_THEME_ICONS.header}
          onToggleFullscreen={toggleFullscreen}
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
          onActivate={openGamePath}
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
