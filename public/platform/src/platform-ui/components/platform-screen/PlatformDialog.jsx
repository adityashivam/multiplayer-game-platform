import React, { useId, useRef } from "react";
import useDialogFocus from "../../hooks/useDialogFocus.js";
import styles from "./PlatformDialog.module.scss";

/**
 * @typedef {object} PlatformDialogProps
 * @property {string} label Accessible dialog name, independent of changing result titles.
 * @property {string} title
 * @property {string} description
 * @property {string} [eyebrow]
 * @property {string} [icon]
 * @property {() => void} [onClose] Omit for results that require an explicit action.
 * @property {string} [closeLabel]
 * @property {string} [closeIcon]
 * @property {React.RefObject<HTMLElement|null>} [initialFocusRef]
 * @property {React.ReactNode} children
 * @property {React.ReactNode} [footer]
 */

/**
 * Render platform-owned dialog chrome within the current screen without resizing it.
 * @param {PlatformDialogProps} props
 * @returns {React.ReactElement}
 */
export default function PlatformDialog({
  label, title, description, eyebrow, icon, onClose, closeLabel = "Close dialog",
  closeIcon = "close", initialFocusRef, children, footer,
}) {
  const descriptionId = useId();
  const panelRef = useRef(null);
  const dialogKeysRef = useRef(new Set());
  useDialogFocus(panelRef, onClose, initialFocusRef);

  const containDialogKeyDown = (event) => {
    if (!event.repeat) dialogKeysRef.current.add(event.code || event.key);
    event.stopPropagation();
  };
  const containDialogKeyUp = (event) => {
    // Let the game release keys held before the dialog opened.
    if (dialogKeysRef.current.delete(event.code || event.key)) event.stopPropagation();
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-describedby={descriptionId}
      onKeyDown={containDialogKeyDown}
      onKeyPress={(event) => event.stopPropagation()}
      onKeyUp={containDialogKeyUp}
    >
      <div className={styles.panel} ref={panelRef} tabIndex={-1}>
        {onClose && (
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={closeLabel}>
            <span className="material-symbols-outlined" aria-hidden="true">{closeIcon}</span>
          </button>
        )}
        <header className={styles.header}>
          <div className={styles.headingRow}>
            {icon && (
              <span className={styles.headingIcon} aria-hidden="true">
                <span className="material-symbols-outlined">{icon}</span>
              </span>
            )}
            <div className={styles.headingText}>
              {eyebrow && <p className={styles.eyebrow} title={eyebrow}>{eyebrow}</p>}
              <h2>{title}</h2>
            </div>
          </div>
          <p className={styles.description} id={descriptionId}>{description}</p>
        </header>
        {children}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
