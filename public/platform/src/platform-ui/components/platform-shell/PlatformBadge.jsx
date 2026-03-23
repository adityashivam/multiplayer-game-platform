import React from "react";
import styles from "./PlatformShell.module.scss";

export default function PlatformBadge({ children }) {
  return <div className={styles.platformBadge}>{children}</div>;
}

