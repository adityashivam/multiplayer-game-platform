import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./GameChrome.module.scss";

const CONNECTION_ICONS = {
  connected: "wifi",
  reconnecting: "wifi_find",
  disconnected: "wifi_off",
  connecting: "wifi_find",
};

/**
 * Display connection state and measured round-trip time without shifting the toolbar.
 * @param {{status?: "connected"|"connecting"|"reconnecting"|"disconnected", ping?: number, icons?: Partial<typeof CONNECTION_ICONS>}} props
 * @returns {React.ReactElement}
 */
export default function ConnectionIndicator({ status = "connecting", ping, icons }) {
  const icon = icons?.[status] || CONNECTION_ICONS[status] || CONNECTION_ICONS.connecting;
  const isConnected = status === "connected";
  const isReconnecting = status === "reconnecting" || status === "connecting";

  const label = isConnected
    ? Number.isFinite(ping)
      ? `${ping} ms`
      : "Connected"
    : status === "connecting"
    ? "Connecting…"
    : isReconnecting
    ? "Reconnecting…"
    : "Offline";

  return (
    <div
      className={classNames(
        styles.connectionIndicator,
        isConnected && styles.connectionConnected,
        isReconnecting && styles.connectionReconnecting,
        !isConnected && !isReconnecting && styles.connectionDisconnected,
      )}
      title={isConnected ? "Connected · round-trip latency" : label}
    >
      <span
        className={classNames("material-symbols-outlined", styles.connectionIcon)}
        aria-hidden="true"
      >
        {icon}
      </span>
      {label && <span className={styles.connectionLabel}>{label}</span>}
    </div>
  );
}
