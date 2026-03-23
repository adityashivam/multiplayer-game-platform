import React from "react";
import classNames from "../../../utils/classNames.js";
import PlatformController from "../controller/PlatformController.jsx";
import PlatformScreen from "./PlatformScreen.jsx";
import styles from "./PlatformShell.module.scss";

export default function PlatformShell({
  children,
  footer,
  fullscreenActive,
  isGameScreen,
  transitioning,
  controllerMode = "full",
  onDirectional,
  onAction,
  controllerDisabled = false,
}) {
  return (
    <div className={classNames(styles.platformRoot, fullscreenActive && styles.platformRootFullscreen)}>
      <div className={styles.platformConsole}>
        <div className={classNames(styles.platformVent, styles.platformVentRight)} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <PlatformController
          onDirectional={onDirectional}
          onAction={onAction}
          disabled={controllerDisabled}
          variant="split-left"
        />

        <PlatformScreen
          footer={footer}
          isGameScreen={isGameScreen}
          splitScreen={controllerMode === "split"}
          transitioning={transitioning}
        >
          {children}
        </PlatformScreen>

        <PlatformController
          onDirectional={onDirectional}
          onAction={onAction}
          disabled={controllerDisabled}
          variant="split-right"
        />

        <div className={classNames(styles.platformVent, styles.platformVentLeft)} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
