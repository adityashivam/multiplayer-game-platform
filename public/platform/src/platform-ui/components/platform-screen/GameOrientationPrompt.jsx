import React from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import styles from "./PlatformDialog.module.scss";

/**
 * A platform-wide startup prompt; games never implement browser orientation.
 * @param {{gameName?:string,canLockOrientation:boolean,requesting:boolean,requestFailed:boolean,onLandscapeFullscreen:()=>void,onBack:()=>void}} props
 */
export default function GameOrientationPrompt({ gameName, canLockOrientation, requesting, requestFailed, onLandscapeFullscreen, onBack }) {
  return (
    <PlatformDialog
      label="Landscape game startup"
      title="Turn your device sideways"
      description={`${gameName || "This game"} starts in landscape. Rotate your device to play.`}
      eyebrow="Ready to play"
      onClose={onBack}
      closeLabel="Back to library"
      closeIcon="×"
      footer={<span role="status">{requestFailed ? "Automatic rotation isn’t available here. Turn your device sideways to continue." : "The game starts after your screen is in landscape."}</span>}
    >
      <div className={styles.actions}>
        {canLockOrientation && <button type="button" className={styles.primaryAction} onClick={onLandscapeFullscreen} disabled={requesting}>
          {requesting ? "Opening landscape…" : "Use landscape fullscreen"}
        </button>}
        <button type="button" className={styles.secondaryAction} onClick={onBack}>Back to library</button>
      </div>
    </PlatformDialog>
  );
}
