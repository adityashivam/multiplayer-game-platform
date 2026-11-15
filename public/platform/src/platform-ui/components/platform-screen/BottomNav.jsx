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

/**
 * The library's floating glass dock; a pill glides behind the active tab.
 * @param {{activeTab?:string,onTabChange?:(tabId:string)=>void,icons?:Record<string,string>,disabled?:boolean}} props
 */
export default function BottomNav({ activeTab = "multi", onTabChange, icons, disabled = false }) {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));
  return (
    <nav className={styles.navBar} aria-label="Primary" style={{ "--nav-index": activeIndex, "--nav-count": tabs.length }}>
      <span className={styles.navIndicator} aria-hidden="true" />
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        // A theme's icon pack may choose dock icons; otherwise the defaults apply.
        const icon = icons?.[tab.id] || fallbackIcons[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            className={classNames(styles.navButton, isActive && styles.navButtonActive)}
            onClick={() => onTabChange?.(tab.id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={tab.label}
            disabled={disabled}
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
