import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "../../PlatformApp.module.scss";

const LIBRARY_META = {
  fight: {
    banner: "New Content",
    genre: "Arena Blade Fighter",
    playtime: "42H 15M",
    progress: "88%",
    lastPlayed: "2H AGO",
  },
  pong: {
    genre: "Competitive Arcade Sim",
    playtime: "18H 32M",
    progress: "64%",
    lastPlayed: "TODAY",
  },
  roadrash: {
    genre: "Highway Combat Racer",
    playtime: "31H 08M",
    progress: "53%",
    lastPlayed: "YESTERDAY",
  },
  mario: {
    banner: "New Content",
    genre: "Head-To-Head Platform Race",
    playtime: "27H 41M",
    progress: "74%",
    lastPlayed: "5H AGO",
  },
  "mario-touch": {
    genre: "Touch Platform Sprint",
    playtime: "11H 05M",
    progress: "41%",
    lastPlayed: "3D AGO",
  },
  draw: {
    genre: "Creative Realtime Duel",
    playtime: "8H 45M",
    progress: "12%",
    lastPlayed: "YESTERDAY",
  },
};

function fallbackGenre(game) {
  const genreTags = (game.tags || []).filter((tag) => !/\d+\s*players?/i.test(tag) && !/realtime/i.test(tag));
  if (!genreTags.length) return "Arcade Experience";
  return genreTags.join(" ").toUpperCase();
}

const GameCard = React.forwardRef(function GameCard(
  { game, visuals, selected, onSelect, onActivate },
  ref,
) {
  const meta = LIBRARY_META[game.id] || {};
  const hasArt = Boolean(visuals.art);

  return (
    <article
      className={classNames(styles.card, selected && styles.selected)}
      data-library-card-id={game.id}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onPointerEnter={onSelect}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate?.();
        }
      }}
      ref={ref}
    >
      <div className={styles.cardMedia}>
        {hasArt ? (
          <img src={visuals.art} alt={`${game.name} artwork`} className={styles.cardImage} />
        ) : (
          <div className={styles.cardFallback}>{game.name?.charAt(0) || "?"}</div>
        )}

        <div className={styles.mediaOverlay} />

        {meta.banner ? <span className={styles.cardBanner}>{meta.banner}</span> : null}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardTitleGroup}>
          <h2 className={styles.cardTitle}>{game.name.toUpperCase()}</h2>
          <p className={styles.cardSubtitle}>{(meta.genre || fallbackGenre(game)).toUpperCase()}</p>
        </div>

        <div className={styles.cardStats}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Playtime</span>
            <span className={styles.statValue}>{meta.playtime || "00H 00M"}</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Progress</span>
            <span className={classNames(styles.statValue, styles.statValueAccent)}>
              {meta.progress || "00%"}
            </span>
          </div>
          <div className={classNames(styles.statBlock, styles.statBlockEnd)}>
            <span className={styles.statLabel}>Last Played</span>
            <span className={styles.statValue}>{meta.lastPlayed || "TODAY"}</span>
          </div>
        </div>
      </div>

      <div className={classNames(styles.cardActiveRail, selected && styles.cardActiveRailVisible)} />
    </article>
  );
});

export default GameCard;
