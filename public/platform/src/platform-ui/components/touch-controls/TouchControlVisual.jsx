import React from "react";
import styles from "./TouchControls.module.scss";

const TOUCH_ROLE_ICONS = Object.freeze({
  move: "joystick",
  look: "drag_pan",
  primary: "my_location",
  secondary: "swap_horiz",
  reload: "refresh",
  jump: "arrow_upward",
  utility: "bolt",
});

export const TOUCH_PRESET_LABELS = Object.freeze({
  "two-thumb": "2 fingers · thumbs",
  "three-finger": "3 fingers",
  "four-finger": "4 fingers",
});

/**
 * Render the same game-declared control appearance in play and in the editor.
 * Movement feedback is owned by the pointer SDK through CSS custom properties.
 * @param {{control:import("../../../../shared/touchControls.js").ResolvedTouchControl,locked?:boolean}} props
 * @returns {React.ReactElement}
 */
export default function TouchControlVisual({ control, locked = false }) {
  const controlIcon = control.icon || TOUCH_ROLE_ICONS[control.role];

  if (control.type === "stick") {
    return (
      <span className={`${styles.controlFace} ${styles.stickFace}`} aria-hidden="true">
        <span className={styles.stickTrack} />
        <span className={styles.stickKnob} data-touch-stick-thumb="">
          <span className="material-symbols-outlined">{locked ? "lock" : controlIcon}</span>
        </span>
        <span className={styles.stickLabel}>{control.label}</span>
      </span>
    );
  }

  return (
    <span className={styles.controlFace} aria-hidden="true">
      <span className={`material-symbols-outlined ${styles.controlIcon}`}>{locked ? "lock" : controlIcon}</span>
      <span className={styles.controlLabel}>{control.label}</span>
    </span>
  );
}

/**
 * Show the fixed look gesture without creating an input-blocking overlay.
 * @param {{control:import("../../../../shared/touchControls.js").ResolvedTouchControl,editing?:boolean}} props
 * @returns {React.ReactElement}
 */
export function TouchLookZone({ control, editing = false }) {
  return (
    <div className={`${styles.lookZone} ${editing ? styles.lookZoneEditing : ""}`} aria-hidden="true">
      <span className="material-symbols-outlined">{control.icon || TOUCH_ROLE_ICONS.look}</span>
      <span>{control.label}</span>
      {editing && <small>Swipe area · fixed</small>}
    </div>
  );
}
