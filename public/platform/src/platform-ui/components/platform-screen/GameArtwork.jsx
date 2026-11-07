import React, { useState } from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./GameLibrary.module.scss";

/**
 * Render game-owned art with optional whole-image fitting and a decorative ambient fill.
 * Missing or failed foreground art keeps the generic platform fallback visible.
 * @param {{coverUrl: string|null, className?: string, eager?: boolean, contain?: boolean, ambient?: boolean}} props
 * @returns {React.ReactElement}
 */
export default function GameArtwork({ coverUrl, className, eager = false, contain = false, ambient = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const showCover = Boolean(coverUrl && failedUrl !== coverUrl);

  return (
    <div
      className={classNames(styles.artwork, contain && styles.artworkContained, showCover && styles.artworkHasCover, className)}
      aria-hidden="true"
    >
      <svg className={styles.artworkFallback} viewBox="0 0 1280 640" fill="none" focusable="false">
        <path fill="#1c3037" d="M0 0h1280v640H0z" />
        <circle cx="950" cy="260" r="180" fill="currentColor" opacity=".15" />
        <path d="m800 385 150-260 150 260H800Z" stroke="currentColor" strokeWidth="12" opacity=".5" />
        <circle cx="950" cy="315" r="85" stroke="currentColor" strokeWidth="12" opacity=".7" />
        <path d="M550 475h730M650 515h630M750 555h530" stroke="currentColor" opacity=".2" />
      </svg>
      {ambient && showCover && <img src={coverUrl} alt="" className={styles.artworkAmbient} draggable={false} />}
      {showCover && (
        <img
          key={coverUrl}
          src={coverUrl}
          alt=""
          className={styles.coverImage}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(coverUrl)}
        />
      )}
    </div>
  );
}
