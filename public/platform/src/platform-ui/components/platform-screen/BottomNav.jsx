import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./GameLibrary.module.scss";

const tabs = [
  { id: "solo", label: "Solo" },
  { id: "multi", label: "Multi" },
  { id: "friends", label: "Friends" },
  { id: "profile", label: "Profile" },
  { id: "config", label: "Config" },
];

const fallbackIcons = {
  solo: "home",
  multi: "videogame_asset",
  friends: "groups",
  profile: "person",
  config: "settings",
};

export default function BottomNav({ activeTab = "multi", onTabChange, icons }) {
  return (
    <nav className={styles.navBar} aria-label="Primary">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const icon = fallbackIcons[tab.id] || icons?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            className={classNames(styles.navButton, isActive && styles.navButtonActive)}
            onClick={() => onTabChange?.(tab.id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={tab.label}
          >
            <span className={classNames("material-symbols-outlined", styles.navIcon)}>
              {icon}
            </span>
            <span className={styles.navLabel}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
