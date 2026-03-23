import { useCallback, useEffect, useState } from "react";
import { fallbackGames } from "../../data/games.js";

const TEMP_DUMMY_GAMES_ENABLED = true;
const TEMP_DUMMY_GAME_COUNT = 50;

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

export default function useGameCatalog() {
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      try {
        const response = await fetch("/api/games");
        if (!response.ok) throw new Error("Bad response");

        const payload = await response.json();
        if (!cancelled && Array.isArray(payload.games) && payload.games.length) {
          setGames(withTemporaryDummyGames(payload.games));
          setLoadingGames(false);
          return;
        }
      } catch (error) {
        console.warn("Falling back to default games list", error);
      }

      if (!cancelled) {
        setGames(withTemporaryDummyGames(fallbackGames));
        setLoadingGames(false);
      }
    }

    loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolveGameById = useCallback(
    (gameId) => {
      if (!gameId) return null;
      return games.find((game) => game.id === gameId) || fallbackGames.find((game) => game.id === gameId) || null;
    },
    [games],
  );

  const resolveGameByPath = useCallback(
    (path) => {
      if (!path) return null;
      return games.find((game) => game.path === path) || fallbackGames.find((game) => game.path === path) || null;
    },
    [games],
  );

  return {
    games,
    loadingGames,
    resolveGameById,
    resolveGameByPath,
  };
}
