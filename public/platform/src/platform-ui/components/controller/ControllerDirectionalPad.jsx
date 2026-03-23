import React from "react";
import classNames from "../../../utils/classNames.js";
import useDirectionalHold from "./useDirectionalHold.js";
import styles from "./PlatformController.module.scss";

const DIRECTION_HINTS = [
  { direction: "up", icon: "arrow_drop_up", hintClassName: styles.directionHintUp },
  { direction: "down", icon: "arrow_drop_down", hintClassName: styles.directionHintDown },
  { direction: "left", icon: "arrow_left", hintClassName: styles.directionHintLeft },
  { direction: "right", icon: "arrow_right", hintClassName: styles.directionHintRight },
];

const DIRECTION_BUTTON_CLASS_NAMES = {
  up: styles.directionButtonUp,
  down: styles.directionButtonDown,
  left: styles.directionButtonLeft,
  right: styles.directionButtonRight,
};

export default function ControllerDirectionalPad({ onDirectional, disabled }) {
  const { startDirectionalHold, stopDirectionalHold, handleDirectionalClick } = useDirectionalHold(
    onDirectional,
    disabled,
  );

  return (
    <div className={styles.directionPadShell}>
      <div className={styles.directionPadHalo} aria-hidden="true" />
      <div className={styles.directionPadCross}>
        <div className={styles.directionPadVertical} aria-hidden="true" />
        <div className={styles.directionPadHorizontal} aria-hidden="true" />
        <div className={styles.directionPadCenter} aria-hidden="true" />

        {Object.entries(DIRECTION_BUTTON_CLASS_NAMES).map(([direction, className]) => (
          <button
            key={direction}
            type="button"
            className={classNames(styles.directionButton, className)}
            data-dir={direction}
            disabled={disabled}
            onPointerDown={(event) => startDirectionalHold(direction, event)}
            onPointerUp={stopDirectionalHold}
            onPointerLeave={stopDirectionalHold}
            onPointerCancel={stopDirectionalHold}
            onClick={() => handleDirectionalClick(direction)}
          />
        ))}

        {DIRECTION_HINTS.map((hint) => (
          <span
            key={hint.direction}
            className={classNames("material-symbols-outlined", styles.directionHint, hint.hintClassName)}
            aria-hidden="true"
          >
            {hint.icon}
          </span>
        ))}
      </div>
    </div>
  );
}
