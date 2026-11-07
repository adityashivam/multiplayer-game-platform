import { useEffect, useRef, useState } from "react";
import { fallbackGames } from "../../data/games.js";
import { requestCatalogGame } from "../services/gameCatalogClient.js";

/** Resolve one active runtime independently of catalog pages and preserve its metadata identity while playing. */
export default function useCatalogGame(gameId, visibleGames) {
  const catalogGamesRef = useRef(visibleGames);
  const [gameLookup, setGameLookup] = useState({ gameId: null, game: null, error: null });
  catalogGamesRef.current = visibleGames;

  useEffect(() => {
    if (!gameId) {
      setGameLookup({ gameId: null, game: null, error: null });
      return undefined;
    }

    const visibleGame = catalogGamesRef.current.find((game) => game.id === gameId);
    if (visibleGame) {
      setGameLookup({ gameId, game: visibleGame, error: null });
      return undefined;
    }

    const abortController = new AbortController();
    requestCatalogGame(gameId, { signal: abortController.signal }).then((game) => {
      if (!abortController.signal.aborted) {
        setGameLookup({ gameId, game, error: game ? null : "This game is no longer available." });
      }
    }).catch(() => {
      if (abortController.signal.aborted) return;
      const fallbackGame = fallbackGames.find((game) => game.id === gameId) || null;
      setGameLookup({ gameId, game: fallbackGame, error: fallbackGame ? null : "Could not load this game's details. Please try again." });
    });

    return () => abortController.abort();
  }, [gameId]);

  const lookupMatchesRoute = gameLookup.gameId === gameId;
  return {
    activeGame: lookupMatchesRoute ? gameLookup.game : null,
    gameLookupError: lookupMatchesRoute ? gameLookup.error : null,
  };
}
