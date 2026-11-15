import React, { useEffect, useState } from "react";
import { readGameLibraryDetails } from "../../services/gamePresentation.js";
import { pushLibraryBackdropLayer } from "../../services/libraryBackdrop.js";
import styles from "./GameLibrary.module.scss";

/**
 * Full-screen art behind the library that follows the focused game,
 * crossfading as focus moves. Decorative: hidden from assistive technology.
 * @param {{game: object|null}} props
 * @returns {React.ReactElement}
 */
export default function LibraryBackdrop({ game }) {
  const details = game ? readGameLibraryDetails(game) : null;
  const backdropUrl = details?.backdropUrl ?? null;
  const [layers, setLayers] = useState(() => pushLibraryBackdropLayer([], backdropUrl));

  useEffect(() => {
    setLayers((current) => pushLibraryBackdropLayer(current, backdropUrl));
  }, [backdropUrl]);

  return (
    <div className={styles.libraryBackdrop} style={{ "--game-accent": details?.accentColor }} aria-hidden="true" data-library-backdrop={game?.id}>
      {layers.map((layer) => (
        <img key={layer.id} src={layer.url} alt="" className={styles.libraryBackdropImage} decoding="async" draggable={false} />
      ))}
      <div className={styles.libraryBackdropShade} />
    </div>
  );
}
