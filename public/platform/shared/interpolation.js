function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Creates a state interpolation controller that buffers server snapshots
 * and lerps positional data between them for smooth rendering.
 *
 * @param {Object} [config]
 * @param {number} [config.interpDelayMs=50] Render delay behind latest state in ms.
 * @param {number} [config.maxBufferSize=10] Max snapshots to retain.
 */
export function createInterpolator(config = {}) {
  const interpDelayMs = config.interpDelayMs ?? 50;
  const maxBufferSize = config.maxBufferSize ?? 10;
  let buffer = [];

  /**
   * Buffer a new server state snapshot.
   * @param {Object} state Raw server state.
   */
  function pushState(state) {
    buffer.push({ timestamp: performance.now(), data: state });
    if (buffer.length > maxBufferSize) {
      buffer.shift();
    }
  }

  /**
   * Sample the buffer and return interpolated positional values.
   *
   * @param {(state: Object) => Record<string, number>} extractPositions
   *   Game-specific function that pulls numeric fields to interpolate.
   * @returns {Record<string, number> | null} Interpolated positions, or null if buffer is empty.
   */
  function getInterpolatedPositions(extractPositions) {
    if (buffer.length === 0) return null;

    const renderTime = performance.now() - interpDelayMs;

    // Find stateA: last snapshot with timestamp <= renderTime
    let aIdx = -1;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].timestamp <= renderTime) {
        aIdx = i;
        break;
      }
    }

    // renderTime is before all snapshots — use earliest
    if (aIdx === -1) {
      return extractPositions(buffer[0].data);
    }

    const bIdx = aIdx + 1;

    // renderTime is past all snapshots — use latest (no extrapolation)
    if (bIdx >= buffer.length) {
      return extractPositions(buffer[buffer.length - 1].data);
    }

    const stateA = buffer[aIdx];
    const stateB = buffer[bIdx];
    const range = stateB.timestamp - stateA.timestamp;
    const t = range > 0 ? clamp((renderTime - stateA.timestamp) / range, 0, 1) : 1;

    const posA = extractPositions(stateA.data);
    const posB = extractPositions(stateB.data);

    const result = {};
    for (const key of Object.keys(posA)) {
      result[key] = lerp(posA[key], posB[key], t);
    }

    // Prune: discard snapshots older than stateA
    if (aIdx > 0) {
      buffer = buffer.slice(aIdx);
    }

    return result;
  }

  /**
   * Return the most recently received raw server state.
   * @returns {Object | null}
   */
  function getLatestState() {
    return buffer.length > 0 ? buffer[buffer.length - 1].data : null;
  }

  /** Clear the buffer (call on scene re-entry, rematch, etc). */
  function reset() {
    buffer = [];
  }

  return { pushState, getInterpolatedPositions, getLatestState, reset };
}
