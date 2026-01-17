import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function BottomNav() {
  return (
    <nav className={styles.navBar} aria-label="Primary">
      <button type="button" className={styles.navButton}>
        <span className={classNames("material-symbols-outlined", styles.navIcon)}>videogame_asset</span>
        <span className={styles.navLabel}>Solo</span>
      </button>
      <button type="button" className={classNames(styles.navButton, styles.navButtonActive)} aria-current="page">
        <span className={classNames("material-symbols-outlined", styles.navIcon)}>hub</span>
        <span className={styles.navLabel}>Multi</span>
      </button>
      <button type="button" className={styles.navButton}>
        <span className={classNames("material-symbols-outlined", styles.navIcon)}>id_card</span>
        <span className={styles.navLabel}>Profile</span>
      </button>
      <button type="button" className={styles.navButton}>
        <span className={classNames("material-symbols-outlined", styles.navIcon)}>group</span>
        <span className={styles.navLabel}>Friends</span>
      </button>
      <button type="button" className={styles.navButton}>
        <span className={classNames("material-symbols-outlined", styles.navIcon)}>settings</span>
        <span className={styles.navLabel}>Config</span>
      </button>
    </nav>
  );
}
