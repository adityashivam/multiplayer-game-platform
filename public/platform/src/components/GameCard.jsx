import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

function badgeFromTags(game) {
  const tag = (game.tags || []).find((t) => /player/i.test(t));
  if (!tag) return "PLAY";
  const match = tag.match(/\d+/);
  return match ? `${match[0]}P` : tag.toUpperCase();
}

const GameCard = React.forwardRef(function GameCard(
  { game, visuals, selected, featured, onSelect, onActivate },
  ref,
) {
  const statusLabel = visuals.status || (featured ? "ACTIVE" : "ARCADE");
  const playersLabel = visuals.players || badgeFromTags(game);
  const icon = visuals.icon || "stadia_controller";
  const hasArt = Boolean(visuals.art);

  return (
    <article
      className={classNames(styles.card, featured && styles.featured, selected && styles.selected)}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onPointerEnter={onSelect}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      ref={ref}
    >
      {featured && <div className={styles.arrow} aria-hidden="true" />}
      {featured && <div className={styles.corner} aria-hidden="true" />}
      <div className={styles.cardMedia}>
        {hasArt ? (
          <img src={visuals.art} alt={`${game.name} artwork`} className={styles.cardImage} />
        ) : (
          <div className={styles.cardFallback}>{game.name?.charAt(0) || "?"}</div>
        )}
        <div className={styles.mediaOverlay} />
      </div>

      <div className={styles.cardBody}>
        <div className={styles.tagRow}>
          <span className={classNames(styles.tag, styles.status)}>{statusLabel}</span>
          <span className={classNames(styles.tag, styles.players)}>{playersLabel}</span>
        </div>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{game.name}</h2>
          <span className={classNames("material-symbols-outlined", styles.cardIcon)} aria-hidden="true">
            {icon}
          </span>
        </div>
        <p className={styles.cardDescription}>{game.description}</p>
        {featured && (
          <div className={styles.featuredFooter}>
            <span className={styles.cta}>&gt; PRESS A TO START</span>
          </div>
        )}
      </div>
    </article>
  );
});

export default GameCard;
