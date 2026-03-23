import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./PlatformController.module.scss";

export default function ControllerFrame({ split = false, side = "left", children }) {
  if (split) {
    return (
      <div
        className={classNames(
          styles.controllerFrame,
          styles.controllerFrameSplit,
          side === "left" ? styles.controllerFrameSplitLeft : styles.controllerFrameSplitRight,
        )}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={styles.controllerFrame}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className={styles.controllerTopBar} aria-hidden="true">
        <span className={styles.controllerTopSegment} />
        <span className={classNames(styles.controllerTopSegment, styles.controllerTopSegmentActive)} />
        <span className={styles.controllerTopSegment} />
      </div>

      {children}

      <div className={styles.controllerDecoration} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
