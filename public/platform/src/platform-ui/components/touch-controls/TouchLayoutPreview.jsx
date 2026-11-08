import React, { useEffect, useMemo, useRef } from "react";
import { resolveTouchLayout } from "../../../../shared/touchControls.js";
import GameArtwork from "../platform-screen/GameArtwork.jsx";
import TouchControlVisual, { TOUCH_PRESET_LABELS, TouchLookZone } from "./TouchControlVisual.jsx";
import { createTouchControlStyle } from "./touchLayoutGeometry.js";
import styles from "./TouchControls.module.scss";

const PREVIEW_REFERENCE_DIMENSIONS = Object.freeze({
  landscape: Object.freeze({ width: 844, height: 390 }),
  portrait: Object.freeze({ width: 390, height: 700 }),
});

/**
 * Show a passive, proportionally scaled layout using game-owned artwork.
 * This component never binds input or changes the runtime host's geometry.
 * @param {{game:{id:string,name:string,presentation?:{coverUrl?:string},touchControls?:import("../../../../shared/touchControls.js").TouchControlsDescriptor},profile:import("../../../../shared/touchControls.js").TouchProfile,orientation:import("../../../../shared/touchControls.js").TouchOrientation}} props
 * @returns {React.ReactElement|null}
 */
export default function TouchLayoutPreview({ game, profile, orientation }) {
  const canvasRef = useRef(null);
  const referenceDimensions = PREVIEW_REFERENCE_DIMENSIONS[orientation];
  const descriptor = game?.touchControls;
  const layout = useMemo(
    () => descriptor ? resolveTouchLayout(descriptor, profile, orientation) : [],
    [descriptor, profile, orientation],
  );

  useEffect(() => {
    const previewCanvas = canvasRef.current;
    if (!previewCanvas) {
      return undefined;
    }

    const resizePreviewControls = () => {
      const previewScale = Math.min(1, previewCanvas.clientWidth / referenceDimensions.width);
      previewCanvas.style.setProperty("--touch-layout-scale", String(previewScale));
    };
    resizePreviewControls();

    const resizeObserver = new ResizeObserver(resizePreviewControls);
    resizeObserver.observe(previewCanvas);

    return () => resizeObserver.disconnect();
  }, [referenceDimensions, game?.id]);

  if (!descriptor) {
    return null;
  }

  return (
    <figure className={styles.preview} data-orientation={orientation}>
      <div
        className={styles.previewCanvas}
        data-orientation={orientation}
        style={{ aspectRatio: `${referenceDimensions.width} / ${referenceDimensions.height}` }}
        ref={canvasRef}
        role="img"
        aria-label={`${game.name}, ${TOUCH_PRESET_LABELS[profile.presetId]} touch layout, ${orientation}`}
      >
        <GameArtwork coverUrl={game.presentation?.coverUrl || null} className={styles.previewArtwork} eager />
        <span className={styles.previewScrim} aria-hidden="true" />
        <span className={styles.canvasGrid} aria-hidden="true" />
        <span className={styles.previewCaption} aria-hidden="true">Layout preview</span>
        {layout.map((control) => control.type === "look" ? (
          <TouchLookZone key={control.id} control={control} editing />
        ) : (
          <span
            key={control.id}
            className={`${styles.controlButton} ${styles.previewControl}`}
            style={createTouchControlStyle(control)}
            data-control-role={control.role}
            data-control-type={control.type}
            aria-hidden="true"
          >
            <TouchControlVisual control={control} />
          </span>
        ))}
      </div>
      <figcaption className={styles.previewLegend}>
        <span>{TOUCH_PRESET_LABELS[profile.presetId]}</span>
        <span>{orientation === "portrait" ? "Portrait" : "Landscape"} · This device</span>
      </figcaption>
    </figure>
  );
}
