import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

function ShareBar({ shareUrl, label, copyLabel, onCopy, onOpen }) {
  return (
    <div id="share-bar" className={styles.shareBar}>
      <div id="share-label" className={styles.shareLabel}>
        {label}
      </div>
      <div className={styles.shareControls}>
        <input id="share-url" className={styles.shareInput} value={shareUrl} readOnly />
        <div className={styles.shareButtons}>
          <button id="copy-share" type="button" className={styles.shareButton} onClick={onCopy}>
            {copyLabel}
          </button>
          <button
            id="open-share"
            type="button"
            className={classNames(styles.shareButton, styles.shareButtonSecondary)}
            onClick={onOpen}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShareBar;
