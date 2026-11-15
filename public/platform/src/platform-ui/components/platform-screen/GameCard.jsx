import React from "react";
import classNames from "../../../utils/classNames.js";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import GameArtwork from "./GameArtwork.jsx";
import styles from "./GameLibrary.module.scss";

/**
 * A portrait capsule (or the older landscape cover) that selects a preview;
 * Enter or double-click starts the selected game. The focused card lifts and
 * glows in the game's accent colour.
 */
const GameCard = React.forwardRef(function GameCard(
  { game, selected, onSelect, onPreview, onActivate, disabled = false, cardIndex = 0 },
  ref,
) {
  const gameDetails = readGameLibraryDetails(game);

  return (
    <button
      type="button"
      className={classNames(styles.card, selected && styles.selected)}
      style={{ "--game-accent": gameDetails.accentColor, "--card-index": cardIndex }}
      data-library-card-id={game.id}
      aria-label={`Select ${game.name}`}
      aria-description="Preview this game. Press Enter to play."
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPreview || onSelect}
      onDoubleClick={onActivate}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onSelect();
      }}
      onFocus={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate();
        }
      }}
      ref={ref}
    >
      <div className={styles.cardMedia} data-card-media>
        <GameArtwork
          coverUrl={gameDetails.capsuleUrl || gameDetails.coverUrl}
          contain={!gameDetails.capsuleUrl}
          className={gameDetails.capsuleUrl ? styles.artworkCapsule : undefined}
        />
        <span className={styles.cardShade} aria-hidden="true" />
        <span className={styles.cardCaption}>
          <span className={styles.cardTitle}>{game.name}</span>
          <span className={styles.cardSubtitle}>{gameDetails.genreLabel} · {gameDetails.playerLabel}</span>
        </span>
        <span className={`material-symbols-outlined ${styles.cardPlayIcon}`} aria-hidden="true">play_arrow</span>
      </div>
    </button>
  );
});

export default GameCard;
