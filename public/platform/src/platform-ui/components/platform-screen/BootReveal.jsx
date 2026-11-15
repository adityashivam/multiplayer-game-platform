import React, { useEffect, useState } from "react";
import styles from "./GameLibrary.module.scss";

const BOOT_SEEN_KEY = "kaboom-boot-seen";
const BOOT_MS = 1400;

/** @returns {boolean} Whether this session should show the reveal. */
function shouldShowBootReveal() {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    if (sessionStorage.getItem(BOOT_SEEN_KEY)) return false;
    sessionStorage.setItem(BOOT_SEEN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Decided once per page load, so a double render can't consume the flag. */
const BOOT_REVEAL_THIS_LOAD = typeof window !== "undefined" && shouldShowBootReveal();

/**
 * A short logo reveal the first time the library opens in a session.
 * Click-through, so it never delays a player who is already pressing.
 * @returns {React.ReactElement|null}
 */
export default function BootReveal() {
  const [visible, setVisible] = useState(BOOT_REVEAL_THIS_LOAD);

  useEffect(() => {
    if (!visible) return undefined;
    const doneTimer = window.setTimeout(() => setVisible(false), BOOT_MS);
    return () => window.clearTimeout(doneTimer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className={styles.bootReveal} aria-hidden="true" data-boot-reveal>
      <div className={styles.bootMark}>
        <svg viewBox="0 0 28 28" fill="none">
          <path d="M3 3h9v9H3zM16 3h9v9h-9zM3 16h9v9H3z" fill="currentColor" />
          <path d="m17 16 9 5-9 5z" fill="currentColor" />
        </svg>
        <span>KABOOM</span>
      </div>
    </div>
  );
}
