import { createRoomLifecycleClient } from "./roomLifecycleClient.js";

/** @typedef {import("./roomLifecycleClient.js").RoomLifecyclePresentation} RoomLifecyclePresentation */
/** @typedef {(state:Readonly<RoomLifecyclePresentation>)=>void} RoomLifecycleSubscriber */

const CLOCK_REFRESH_MS = 100;
const lifecycleEntries = new Map();

function normalizeRoomNamespace(namespace) {
  return namespace.startsWith("/") ? namespace : `/${namespace}`;
}

/** One publisher per active transport; UI subscriptions never create a socket. */
function getLifecycleEntry(namespace) {
  const key = normalizeRoomNamespace(namespace);
  if (!lifecycleEntries.has(key)) {
    const entry = { listeners: new Set(), refreshTimer: null, transportDisposed: false, client: null };
    entry.client = createRoomLifecycleClient({ onChange: (state) => entry.listeners.forEach((listener) => listener(state)) });
    lifecycleEntries.set(key, entry);
  }
  return lifecycleEntries.get(key);
}

/**
 * Subscribe to semantic room changes without owning the underlying transport.
 * @param {string} namespace Registered game namespace, with or without a slash.
 * @param {RoomLifecycleSubscriber} listener Treat received values as read-only.
 * @returns {()=>void} Remove the subscription and its unused refresh timer.
 */
export function subscribeRoomLifecycle(namespace, listener) {
  const key = normalizeRoomNamespace(namespace);
  const entry = getLifecycleEntry(key);
  entry.listeners.add(listener);
  listener(entry.client.getSnapshot());
  if (!entry.refreshTimer) entry.refreshTimer = setInterval(() => entry.client.refresh(), CLOCK_REFRESH_MS);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      clearInterval(entry.refreshTimer);
      entry.refreshTimer = null;
      if (entry.transportDisposed) lifecycleEntries.delete(key);
    }
  };
}

/** @param {string} namespace @param {{gameId:string,playerId:string}} joinedRoom */
export function publishRoomJoined(namespace, joinedRoom) {
  const entry = getLifecycleEntry(namespace);
  entry.transportDisposed = false;
  entry.client.recordJoined(joinedRoom);
}

/**
 * Read decoded metadata once per accepted snapshot, independent of gameplay.
 * @param {string} namespace
 * @param {{net?:import("../shared/networkProtocol.js").SnapshotNetworkMetadata}} snapshot
 * @param {{pingMs?:number|null}} [connectionMetrics]
 */
export function publishRoomSnapshot(namespace, snapshot, connectionMetrics) {
  getLifecycleEntry(namespace).client.recordSnapshot(snapshot, connectionMetrics);
}

/** @param {string} namespace Pause presentation while the existing seat reconnects. */
export function publishRoomDisconnected(namespace) {
  getLifecycleEntry(namespace).client.recordDisconnected();
}

/** @param {string} namespace Reset start cues while retaining player ownership. */
export function publishRoomRematch(namespace) {
  getLifecycleEntry(namespace).client.restartRound();
}

/** @param {string} namespace @param {"roomFull"} errorCode Terminal failure after SDK recovery. */
export function publishRoomJoinFailure(namespace, errorCode) {
  getLifecycleEntry(namespace).client.recordJoinFailure(errorCode);
}

/**
 * Drop transport ownership, retaining an empty state only while UI subscribes.
 * @param {string} namespace
 */
export function resetRoomLifecycle(namespace) {
  const key = normalizeRoomNamespace(namespace);
  const entry = lifecycleEntries.get(key);
  if (!entry) return;
  entry.transportDisposed = true;
  entry.client.reset();
  if (entry.listeners.size === 0) {
    clearInterval(entry.refreshTimer);
    lifecycleEntries.delete(key);
  }
}
