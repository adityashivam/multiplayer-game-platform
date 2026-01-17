import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function LobbyHeader({ headerLeft, title, onToggleTheme }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        {headerLeft}
        <button
          id="theme-toggle"
          type="button"
          className={styles.themeToggle}
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          <span className={classNames("material-symbols-outlined", styles.themeIcon)}>contrast</span>
        </button>
      </div>
      <h1 className={styles.title}>{title}</h1>
    </header>
  );
}
