import React, { useState } from "react";
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
  const [portraitShellCollapsed, setPortraitShellCollapsed] = useState(false);

  return (
    <div className={classNames(styles.platformRoot, fullscreenActive && styles.platformRootFullscreen)}>
      <div
        className={classNames(
          styles.platformConsole,
          portraitShellCollapsed && styles.platformConsolePortraitExpanded,
        )}
      >
        <div className={classNames(styles.platformControllerPane, styles.platformControllerPaneLeft)}>
          <PlatformController
            onDirectional={onDirectional}
            onAction={onAction}
            disabled={controllerDisabled}
            variant="split-left"
          />
        </div>

        <PlatformScreen
          footer={footer}
          isGameScreen={isGameScreen}
          splitScreen={controllerMode === "split"}
          transitioning={transitioning}
        >
          {children}
        </PlatformScreen>

        <button
          type="button"
          className={styles.platformPortraitToggle}
          onClick={() => setPortraitShellCollapsed((current) => !current)}
          aria-label={portraitShellCollapsed ? "Show bottom shell controls" : "Hide bottom shell controls"}
          aria-pressed={portraitShellCollapsed}
        >
          <span className={classNames("material-symbols-outlined", styles.platformPortraitToggleIcon)}>
            {portraitShellCollapsed ? "keyboard_arrow_up" : "keyboard_arrow_down"}
          </span>
        </button>

        <div className={classNames(styles.platformControllerPane, styles.platformControllerPaneRight)}>
          <PlatformController
            onDirectional={onDirectional}
            onAction={onAction}
            disabled={controllerDisabled}
            variant="split-right"
          />
        </div>

        <div className={styles.platformPortraitDeck}>
          <div className={styles.platformPortraitDeckInner}>
            <div className={classNames(styles.platformPortraitController, styles.platformPortraitControllerLeft)}>
              <PlatformController
                onDirectional={onDirectional}
                onAction={onAction}
                disabled={controllerDisabled}
                variant="split-left"
              />
            </div>

            <div className={styles.platformPortraitCenter} aria-hidden="true">
              <div className={styles.platformPortraitBrand}>KABOOM</div>
              <div className={styles.platformPortraitSpeaker}>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className={classNames(styles.platformPortraitController, styles.platformPortraitControllerRight)}>
              <PlatformController
                onDirectional={onDirectional}
                onAction={onAction}
                disabled={controllerDisabled}
                variant="split-right"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
