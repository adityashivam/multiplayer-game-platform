import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./PlatformController.module.scss";

export default function ControllerUtilityButtons({
  buttons,
  onAction,
  disabled,
  split = false,
  alignment = "center",
}) {
  return (
    <div
      className={classNames(
        split ? styles.utilityButtonGroupSplit : styles.utilityButtonGroup,
        split && alignment === "start" && styles.utilityButtonGroupSplitStart,
        split && alignment === "end" && styles.utilityButtonGroupSplitEnd,
      )}
    >
      {buttons.map((button) => (
        <div key={button.action} className={styles.utilityButtonItem}>
          <button
            type="button"
            className={styles.utilityButton}
            data-action={button.action}
            disabled={disabled}
            onClick={() => onAction?.(button.action)}
            aria-label={button.ariaLabel || button.label}
          />
          <span className={styles.utilityButtonLabel}>{button.label}</span>
        </div>
      ))}
    </div>
  );
}
