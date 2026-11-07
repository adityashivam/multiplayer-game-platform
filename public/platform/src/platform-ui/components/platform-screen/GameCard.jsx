import React from "react";
import classNames from "../../../utils/classNames.js";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import GameArtwork from "./GameArtwork.jsx";
import styles from "./GameLibrary.module.scss";

/** A game cover selects a preview; Enter or double-click starts the selected game. */
const GameCard = React.forwardRef(function GameCard(
  { game, selected, onSelect, onPreview, onActivate, disabled = false },
  ref,
) {
  const gameDetails = readGameLibraryDetails(game);

  return (
    <button
      type="button"
      className={classNames(styles.card, selected && styles.selected)}
      style={{ "--game-accent": gameDetails.accentColor }}
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
      <div className={styles.cardMedia}>
        <GameArtwork coverUrl={gameDetails.coverUrl} contain />
        <span className={styles.cardPlayIcon} aria-hidden="true">↗</span>
      </div>
      <span className={styles.cardTitle}>{game.name}</span>
      <span className={styles.cardSubtitle}>{gameDetails.genreLabel} · {gameDetails.playerLabel}</span>
    </button>
  );
});

export default GameCard;
