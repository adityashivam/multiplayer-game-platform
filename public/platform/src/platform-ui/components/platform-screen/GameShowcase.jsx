import React from "react";
import GameArtwork from "./GameArtwork.jsx";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import styles from "./GameLibrary.module.scss";

/** Show the selected game's advertised capabilities and launch its existing catalog path. */
export default function GameShowcase({ game, onActivate, disabled = false }) {
  const gameDetails = readGameLibraryDetails(game);
  // Scene art carries no baked-in title, so it can bleed edge to edge under the
  // name. The portrait capsule suits the tall preview best; only the legacy
  // cover (title painted in) is fitted whole.
  const sceneUrl = gameDetails.capsuleUrl || gameDetails.backdropUrl;
  const artworkUrl = sceneUrl || gameDetails.coverUrl;

  return (
    <section
      className={styles.showcase}
      style={{ "--game-accent": gameDetails.accentColor }}
      aria-labelledby="selected-game-title"
      data-selected-game={game.id}
      data-showcase-art={sceneUrl ? "scene" : "cover"}
    >
      <GameArtwork
        key={game.id}
        coverUrl={artworkUrl}
        className={sceneUrl ? `${styles.showcaseArtwork} ${styles.showcaseArtworkScene}` : styles.showcaseArtwork}
        eager
        contain={!sceneUrl}
        ambient={!sceneUrl}
      />
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
        </button>
      </div>
      <span className={styles.showcaseCaption} aria-hidden="true">SELECTED GAME / READY TO PLAY</span>
    </section>
  );
}
