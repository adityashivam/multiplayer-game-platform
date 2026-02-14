import React from "react";
import GameCard from "./GameCard.jsx";
import { visualsByGame } from "../data/games.js";
import styles from "../App.module.scss";

export default function LobbyList({
  loading,
  games,
  selectedIndex,
  onSelectIndex,
  onActivate,
  registerCardRef,
}) {
  return (
    <div className={styles.lobbyHome}>
      <div className={styles.lobbyBackdrop} aria-hidden="true" />
      <div id="game-list" className={styles.lobbyList}>
        {loading ? (
          <div className={styles.emptyState}>Loading cartridges...</div>
        ) : games.length === 0 ? (
          <div className={styles.emptyState}>No games available right now.</div>
        ) : (
          games.map((game, index) => {
            const visuals = visualsByGame[game.id] || {};
            const selected = selectedIndex === index;
            const featured = selected && Boolean(visuals.featured ?? index === 0);
            return (
              <GameCard
                key={game.id}
                game={game}
                visuals={visuals}
                featured={featured}
                selected={selected}
                onSelect={() => onSelectIndex(index)}
                onActivate={() => onActivate(game.path)}
                ref={(node) => {
                  registerCardRef?.(index, node);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
