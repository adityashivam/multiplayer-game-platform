import React from "react";
import styles from "./PlatformShell.module.scss";

export default function PlatformBackLink({ children, href = "/", onNavigate }) {
  return (
    <a
      id="back-to-lobby"
      className={styles.platformBackLink}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    >
      &larr; {children}
    </a>
  );
}

