import React from "react";
import styles from "./PlatformShell.module.scss";

export default function PlatformHomeBar({ onHome }) {
  return (
    <div className={styles.homeBar}>
      <button type="button" className={styles.homeBarButton} onClick={onHome} aria-label="Home">
        <span className="material-symbols-outlined" aria-hidden="true">
          home
        </span>
        <span className={styles.homeBarLabel}>Home</span>
      </button>
    </div>
  );
}

