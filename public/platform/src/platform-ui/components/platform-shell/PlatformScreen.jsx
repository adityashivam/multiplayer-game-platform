import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./PlatformShell.module.scss";

/**
 * The console's screen: an optional full-bleed backdrop, the routed content
 * and the footer dock.
 */
export default function PlatformScreen({
  children,
  footer,
  backdrop = null,
  overlay = null,
  contentSwap = null,
  isGameScreen,
  splitScreen,
  transitioning,
}) {
  return (
    <div
      data-platform-screen
      className={classNames(
        styles.platformScreen,
        !isGameScreen && styles.platformScreenLibrary,
        isGameScreen && styles.platformScreenGame,
        splitScreen && styles.platformScreenSplit,
      )}
    >
      {backdrop}
      <div className={styles.screenScanlines} aria-hidden="true" />
      <div className={styles.screenOverlay} aria-hidden="true" />

      <div className={styles.screenBody}>
        <div
          className={classNames(
            styles.screenContent,
            isGameScreen && styles.screenContentGame,
            transitioning && styles.screenContentTransition,
            contentSwap && (contentSwap.serial % 2 ? styles.screenContentSlideA : styles.screenContentSlideB),
          )}
          style={contentSwap ? { "--tab-slide-from": `${contentSwap.direction * 28}px` } : undefined}
        >
          {children}
        </div>
      </div>

      {overlay}
      {footer}
    </div>
  );
}
