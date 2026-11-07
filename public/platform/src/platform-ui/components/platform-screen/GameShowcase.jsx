import React from "react";
import GameArtwork from "./GameArtwork.jsx";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import styles from "./GameLibrary.module.scss";

/** Show the selected game's advertised capabilities and launch its existing catalog path. */
export default function GameShowcase({ game, onActivate, disabled = false }) {
  const gameDetails = readGameLibraryDetails(game);

  return (
    <section
      className={styles.showcase}
      style={{ "--game-accent": gameDetails.accentColor }}
      aria-labelledby="selected-game-title"
      data-selected-game={game.id}
    >
      <GameArtwork key={game.id} coverUrl={gameDetails.coverUrl} className={styles.showcaseArtwork} eager contain ambient />
      <div className={styles.showcaseShade} />
      <div className={styles.showcaseContent}>
        <p className={styles.showcaseEyebrow}>
          <span className={styles.eyebrowLine} />{gameDetails.genreLabel}
        </p>
        <h2 id="selected-game-title" className={styles.showcaseTitle}>{game.name}</h2>
        {game.description && <p className={styles.showcaseDescription}>{game.description}</p>}
        <div className={styles.capabilities}>
          <span>
            <span className="material-symbols-outlined" aria-hidden="true">sports_esports</span>
            {gameDetails.playerLabel}
          </span>
          {gameDetails.controlLabels.length > 0 && (
            <span className={styles.controlCapability}>{gameDetails.controlLabels.join(" · ")}</span>
          )}
        </div>
        <button
          type="button"
          className={styles.playButton}
          onClick={() => onActivate(game.path)}
          disabled={disabled || !game.path}
          aria-label={`Play ${game.name}`}
        >
          <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>
          Play now
          <span className={styles.playButtonArrow} aria-hidden="true">↗</span>
        </button>
      </div>
      <span className={styles.showcaseCaption} aria-hidden="true">SELECTED GAME / READY TO PLAY</span>
    </section>
  );
}
