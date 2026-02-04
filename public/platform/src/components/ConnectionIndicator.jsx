import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

const iconMap = {
  connected: "wifi",
  reconnecting: "wifi_find",
  disconnected: "wifi_off",
  connecting: "wifi_find",
};

export default function ConnectionIndicator({ status, ping }) {
  const icon = iconMap[status] || "wifi_find";
  const isConnected = status === "connected";
  const isReconnecting = status === "reconnecting" || status === "connecting";

  const label = isConnected
    ? ping != null
      ? `${ping}ms`
      : "Connected"
    : isReconnecting
    ? "Reconnecting..."
    : "Offline";

  return (
    <div
      className={classNames(
        styles.connectionIndicator,
        isConnected && styles.connectionConnected,
        isReconnecting && styles.connectionReconnecting,
        !isConnected && !isReconnecting && styles.connectionDisconnected,
      )}
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
