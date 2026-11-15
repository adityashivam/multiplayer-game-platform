import React, { useEffect, useRef, useState } from "react";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import { pushLibraryBackdropLayer } from "../../services/libraryBackdrop.js";
import styles from "./GameLibrary.module.scss";

/** @typedef {import("../../services/platformThemes.js").PlatformThemeBackground} PlatformThemeBackground */

const GAME_ART_BACKGROUND = Object.freeze({ style: "game-art", pattern: "grid", dim: 0, blur: 0 });

/**
 * The theme's own background layers: an ambient glow, a pattern or an
 * embedded image (already validated as a raster data URL).
 * @param {{background: PlatformThemeBackground}} props
 * @returns {React.ReactElement}
 */
export function ThemeBackdropLayers({ background }) {
  return (
    <>
      <div className={styles.themeAmbient} />
      {background.style === "pattern" && <div className={styles.themePattern} data-pattern={background.pattern} />}
      {background.style === "image" && background.image && (
        <div className={styles.themeImage} style={{ backgroundImage: `url("${background.image}")` }} />
      )}
    </>
  );
}

/**
 * Full-screen background behind the library. With the game-art style it
 * follows the focused game, crossfading as focus moves; other theme styles
 * show an ambient glow, a pattern or the theme's image. Dim and blur come
 * from the theme. Decorative: hidden from assistive technology.
 * @param {{game: object|null, background?: PlatformThemeBackground}} props
 * @returns {React.ReactElement}
 */
export default function LibraryBackdrop({ game, background = GAME_ART_BACKGROUND }) {
  const details = game ? readGameLibraryDetails(game) : null;
  const showGameArt = background.style === "game-art";
  const backdropUrl = showGameArt ? details?.backdropUrl ?? null : null;
  const [layers, setLayers] = useState(() => pushLibraryBackdropLayer([], backdropUrl));

  useEffect(() => {
    setLayers((current) => pushLibraryBackdropLayer(current, backdropUrl));
  }, [backdropUrl]);

  // Pointer parallax for mouse users; touch and reduced motion stay still.
  const backdropRef = useRef(null);
  useEffect(() => {
    const backdrop = backdropRef.current;
    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!backdrop || !finePointer || reducedMotion) return undefined;
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const handlePointerMove = (event) => {
      pointer = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        backdrop.style.setProperty("--parallax-x", pointer.x.toFixed(3));
        backdrop.style.setProperty("--parallax-y", pointer.y.toFixed(3));
      });
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  return (
    <div
      className={styles.libraryBackdrop}
      ref={backdropRef}
      style={{ "--game-accent": details?.accentColor, "--backdrop-dim": background.dim, "--backdrop-blur": `${background.blur}px` }}
      aria-hidden="true"
      data-library-backdrop={game?.id}
      data-backdrop-style={background.style}
    >
      <div className={styles.libraryBackdropStage}>
        {showGameArt
          ? layers.map((layer) => (
            <img key={layer.id} src={layer.url} alt="" className={styles.libraryBackdropImage} decoding="async" draggable={false} />
          ))
          : <ThemeBackdropLayers background={background} />}
      </div>
      <div className={styles.libraryBackdropDim} />
      <div className={styles.libraryBackdropShade} />
    </div>
  );
}
