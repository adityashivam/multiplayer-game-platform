import React from "react";
import styles from "./GameChrome.module.scss";

/**
 * @typedef {object} DiagnosticRow
 * @property {string} label
 * @property {string} value
 * @property {"Connection"|"Synchronization"|"Browser"|"Server"} [section]
 */

/**
 * Present existing telemetry in a bounded inspector without announcing every update.
 * @param {{rows: DiagnosticRow[], onClose: () => void}} props
 * @returns {React.ReactElement}
 */
export default function NetworkPanel({ rows, onClose }) {
  return (
    <section id="network-diagnostics" className={styles.networkPanel} aria-label="Network diagnostics" tabIndex={0}>
      <header className={styles.networkHeader}>
        <div>
          <h2>Network & performance</h2>
          <p>Live session diagnostics</p>
        </div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close network diagnostics">
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div className={styles.networkReadings} tabIndex={0} aria-label="Diagnostic readings">
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            {row.section && <h3 className={styles.networkSection}>{row.section}</h3>}
            <dl className={styles.networkRow}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </dl>
          </React.Fragment>
        ))}
      </div>
      <p className={styles.networkHint}>Press N to toggle · Esc to close</p>
    </section>
  );
}
