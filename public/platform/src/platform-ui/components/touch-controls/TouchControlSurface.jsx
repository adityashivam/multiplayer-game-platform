import React, { useEffect, useMemo, useRef } from "react";
import { resolveTouchLayout } from "../../../../shared/touchControls.js";
import { bindTouchControlSurface } from "../../../../frontend-engine/touchControlSurface.js";
import TouchControlVisual, { TouchLookZone } from "./TouchControlVisual.jsx";
import { createTouchControlStyle } from "./touchLayoutGeometry.js";
import styles from "./TouchControls.module.scss";

/**
 * @typedef {object} TouchControlSurfaceProps
 * @property {{id:string,name:string,touchControls?:import("../../../../shared/touchControls.js").TouchControlsDescriptor}} game
 * @property {import("../../../../shared/touchControls.js").TouchProfile} profile
 * @property {import("../../../../shared/touchControls.js").TouchOrientation} orientation
 * @property {boolean} enabled
 * @property {boolean} [disabled]
 */

/**
 * Bind generic pointer controls over the existing game host without resizing it.
 * Input and stick feedback update imperatively; React owns layout changes only.
 * The active marker stays present while a modal temporarily disables input.
 * @param {TouchControlSurfaceProps} props
 * @returns {React.ReactElement|null}
 */
export default function TouchControlSurface({ game, profile, orientation, enabled, disabled = false }) {
  const surfaceRef = useRef(null);
  const descriptor = game?.touchControls;
  const layout = useMemo(
    () => descriptor ? resolveTouchLayout(descriptor, profile, orientation) : [],
    [descriptor, profile, orientation],
  );

  useEffect(() => {
    if (!enabled || !descriptor || !surfaceRef.current) {
      return undefined;
    }

    const touchSurface = bindTouchControlSurface({
      element: surfaceRef.current,
      gameId: game.id,
      descriptor,
      layout,
      disabled,
    });

    return () => touchSurface.dispose();
  }, [game?.id, descriptor, layout, enabled, disabled]);

  if (!enabled || !descriptor) {
    return null;
  }

  return (
    <div
      ref={surfaceRef}
      className={styles.runtimeSurface}
      data-platform-touch-game={game.id}
      data-active="true"
      data-disabled={disabled ? "true" : "false"}
      aria-label={`${game.name} touch controls`}
      aria-hidden={disabled ? "true" : undefined}
      role="group"
    >
      {layout.map((control) => control.type === "look" ? (
        <TouchLookZone key={control.id} control={control} />
      ) : (
        <button
          key={control.id}
          type="button"
          className={`${styles.controlButton} ${styles.runtimeControl}`}
          style={createTouchControlStyle(control)}
          data-touch-control-id={control.id}
          data-control-role={control.role}
          data-control-type={control.type}
          aria-label={control.label}
          disabled={disabled}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
        >
          <TouchControlVisual control={control} />
        </button>
      ))}
    </div>
  );
}
