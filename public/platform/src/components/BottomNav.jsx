import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

const tabs = [
  { id: "solo", label: "Solo" },
  { id: "multi", label: "Multi" },
  { id: "profile", label: "Profile" },
  { id: "friends", label: "Friends" },
  { id: "config", label: "Config" },
];

const fallbackIcons = {
  solo: "videogame_asset",
  multi: "hub",
  profile: "id_card",
  friends: "group",
  config: "settings",
};

export default function BottomNav({ activeTab = "multi", onTabChange, icons }) {
  return (
    <nav className={styles.navBar} aria-label="Primary">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const icon = icons?.[tab.id] || fallbackIcons[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            className={classNames(styles.navButton, isActive && styles.navButtonActive)}
            onClick={() => onTabChange?.(tab.id)}
            aria-current={isActive ? "page" : undefined}
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
