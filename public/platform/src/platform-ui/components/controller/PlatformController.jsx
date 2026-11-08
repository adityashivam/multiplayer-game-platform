import React, { useEffect, useRef } from "react";
import { bindAnalogStick } from "../../../../frontend-engine/analogStick.js";
import classNames from "../../../utils/classNames.js";
import ControllerActionPad from "./ControllerActionPad.jsx";
import ControllerDirectionalPad from "./ControllerDirectionalPad.jsx";
import ControllerFrame from "./ControllerFrame.jsx";
import ControllerUtilityButtons from "./ControllerUtilityButtons.jsx";
import { getControllerLayout } from "./controllerLayouts.js";
import styles from "./PlatformController.module.scss";

function renderPrimaryCluster(primaryCluster, sharedProps) {
  if (primaryCluster === "actions") {
    return <ControllerActionPad {...sharedProps} />;
  }

  return <ControllerDirectionalPad onDirectional={sharedProps.onDirectional} disabled={sharedProps.disabled} />;
}

function AnalogStick({ side, disabled }) {
  const stickElement = useRef(null);
  useEffect(() => {
    const stickBinding = bindAnalogStick(stickElement.current, { disabled });
    return () => stickBinding.dispose();
  }, [disabled]);

  const stickLabel = `${side === "left" ? "Left" : "Right"} analog stick`;
  return (
    <button
      ref={stickElement}
      type="button"
      className={styles.analogStickHousing}
      data-stick={side}
      disabled={disabled}
      aria-label={stickLabel}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      title={`${stickLabel}. Focus and use arrow keys, or drag to move.`}
    >
      <span className={styles.analogStickCap} aria-hidden="true">
        <span className={styles.analogStickCore}>{side === "left" ? "L" : "R"}</span>
      </span>
    </button>
  );
}

export default function PlatformController({
  onDirectional,
  onAction,
  disabled = false,
  variant = "full",
}) {
  const layout = getControllerLayout(variant);
  const sharedProps = { onDirectional, onAction, disabled };

  if (layout.kind === "split") {
    const isActionSide = layout.primaryCluster === "actions";

    return (
      <ControllerFrame split side={isActionSide ? "right" : "left"}>
        <div className={styles.controllerBodySplit}>
          <ControllerUtilityButtons
            buttons={layout.utilityButtons}
            onAction={onAction}
            disabled={disabled}
            split
            alignment={layout.utilityAlignment}
          />

          {!isActionSide && <AnalogStick side="left" disabled={disabled} />}

          <div
            className={classNames(
              styles.controllerSplitMain,
              layout.primaryCluster === "dpad" ? styles.controllerSplitMainDpad : styles.controllerSplitMainAction,
            )}
          >
            {renderPrimaryCluster(layout.primaryCluster, sharedProps)}
          </div>

          {isActionSide && <AnalogStick side="right" disabled={disabled} />}
        </div>
      </ControllerFrame>
    );
  }

  return (
    <ControllerFrame>
      <div className={styles.controllerBody}>
        <div className={styles.controllerFullCluster}>
          <ControllerDirectionalPad onDirectional={onDirectional} disabled={disabled} />
          <AnalogStick side="left" disabled={disabled} />
        </div>
        <ControllerUtilityButtons buttons={layout.utilityButtons} onAction={onAction} disabled={disabled} />
        <div className={styles.controllerFullCluster}>
          <ControllerActionPad onAction={onAction} disabled={disabled} />
          <AnalogStick side="right" disabled={disabled} />
        </div>
      </div>
    </ControllerFrame>
  );
}
