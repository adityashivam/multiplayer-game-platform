import React from "react";
import classNames from "../../../utils/classNames.js";
import { ACTION_BUTTONS } from "./controllerLayouts.js";
import styles from "./PlatformController.module.scss";

const ACTION_TONE_CLASS_NAMES = {
  y: styles.actionButtonY,
  a: styles.actionButtonA,
  x: styles.actionButtonX,
  b: styles.actionButtonB,
};

export default function ControllerActionPad({ onAction, disabled }) {
  return (
    <div className={styles.actionPadShell}>
      <div className={styles.actionPadHalo} aria-hidden="true" />
      <div className={styles.actionPad}>
        {ACTION_BUTTONS.map((button) => (
          <button
            key={button.action}
            type="button"
            className={classNames(styles.actionButton, ACTION_TONE_CLASS_NAMES[button.action])}
            data-action={button.action}
            disabled={disabled}
            onClick={() => onAction?.(button.action)}
          >
            <span className={styles.actionButtonLabel}>{button.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
