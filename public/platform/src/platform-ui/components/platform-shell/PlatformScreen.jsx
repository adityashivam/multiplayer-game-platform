import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./PlatformShell.module.scss";

export default function PlatformScreen({
  children,
  footer,
  isGameScreen,
  splitScreen,
  transitioning,
}) {
  return (
    <div
      className={classNames(
        styles.platformScreen,
        isGameScreen && styles.platformScreenGame,
        splitScreen && styles.platformScreenSplit,
      )}
    >
      <div className={styles.screenScanlines} aria-hidden="true" />
      <div className={styles.screenOverlay} aria-hidden="true" />

      <div className={styles.screenBody}>
        <div
          className={classNames(
            styles.screenContent,
            isGameScreen && styles.screenContentGame,
            transitioning && styles.screenContentTransition,
          )}
        >
          {children}
        </div>
      </div>

      {footer}
    </div>
  );
}
