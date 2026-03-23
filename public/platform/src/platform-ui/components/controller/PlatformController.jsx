import React from "react";
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

function AnalogStick() {
  return (
    <div className={styles.analogStickHousing} aria-hidden="true">
      <div className={styles.analogStickCap}>
        <div className={styles.analogStickCore} />
      </div>
    </div>
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

          {!isActionSide && <AnalogStick />}

          <div
            className={classNames(
              styles.controllerSplitMain,
              layout.primaryCluster === "dpad" ? styles.controllerSplitMainDpad : styles.controllerSplitMainAction,
            )}
          >
            {renderPrimaryCluster(layout.primaryCluster, sharedProps)}
          </div>

          {isActionSide && <AnalogStick />}
        </div>
      </ControllerFrame>
    );
  }

  return (
    <ControllerFrame>
      <div className={styles.controllerBody}>
        <ControllerDirectionalPad onDirectional={onDirectional} disabled={disabled} />
        <ControllerUtilityButtons buttons={layout.utilityButtons} onAction={onAction} disabled={disabled} />
        <ControllerActionPad onAction={onAction} disabled={disabled} />
      </div>
    </ControllerFrame>
  );
}
