const REJOIN_RETRY_INTERVAL_MS = 500;
const REJOIN_RECOVERY_TIMEOUT_MS = 20000;
const MAX_REJOIN_RETRIES = Math.ceil(REJOIN_RECOVERY_TIMEOUT_MS / REJOIN_RETRY_INTERVAL_MS) - 1;

/**
 * @typedef {object} RoomJoinRecoveryOptions
 * @property {(joinRequest: import("../shared/networkProtocol.js").JoinGameRequest) => void} sendJoinRequest
 * @property {() => boolean} isConnected
 * @property {(roomFullPayload: import("../shared/networkProtocol.js").RoomFullPayload) => void} onRoomFull
 */

/**
 * Retry only server-confirmed reconnect overlap, retaining the requested room and
 * token. A live owner is never displaced; the caller receives one final failure
 * after the bounded recovery window. Reset on every new join, success or teardown.
 * @param {RoomJoinRecoveryOptions} options
 */
export function createRoomJoinRecovery({ sendJoinRequest, isConnected, onRoomFull }) {
  /** @type {import("../shared/networkProtocol.js").JoinGameRequest | null} */
  let joinRequest = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let recoveryTimer = null;
  let retryCount = 0;
  let reportedRoomFull = false;

  function clearRecoveryTimers() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
    }
    retryTimer = null;
    recoveryTimer = null;
  }

  /** Cancel pending work and forget the previous join intent. */
  function reset() {
    clearRecoveryTimers();
    joinRequest = null;
    retryCount = 0;
    reportedRoomFull = false;
  }

  function reportFinalRoomFull() {
    clearRecoveryTimers();
    if (!joinRequest || reportedRoomFull) {
      return;
    }

    reportedRoomFull = true;
    onRoomFull({ gameId: joinRequest.gameId });
  }

  /**
   * Keep an owned copy so game code cannot mutate a scheduled retry's identity.
   * @param {unknown} payload
   */
  function recordJoinRequest(payload) {
    reset();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }

    const submittedJoinRequest = /** @type {Partial<import("../shared/networkProtocol.js").JoinGameRequest>} */ (payload);
    if (typeof submittedJoinRequest.gameId !== "string" || !submittedJoinRequest.gameId) {
      return;
    }

    joinRequest = {
      gameId: submittedJoinRequest.gameId,
      ...(typeof submittedJoinRequest.rejoinToken === "string" && submittedJoinRequest.rejoinToken
        ? { rejoinToken: submittedJoinRequest.rejoinToken }
        : {}),
    };
  }

  function retryPendingJoin() {
    retryTimer = null;
    if (!joinRequest || !isConnected()) {
      reset();
      return;
    }
    if (retryCount >= MAX_REJOIN_RETRIES) {
      reportFinalRoomFull();
      return;
    }

    retryCount += 1;
    sendJoinRequest({ ...joinRequest });
  }

  /**
   * Consume only matching retryable failures. Duplicated failure packets share
   * one timer and cannot extend the deadline or multiply outgoing join requests.
   * @param {unknown} roomFullPayload
   * @returns {boolean} Whether presentation should suppress this failure packet.
   */
  function receiveRoomFull(roomFullPayload) {
    const roomFullResponse = roomFullPayload && typeof roomFullPayload === "object" && !Array.isArray(roomFullPayload)
      ? /** @type {Partial<import("../shared/networkProtocol.js").RoomFullPayload>} */ (roomFullPayload)
      : null;
    if (!joinRequest || roomFullResponse?.rejoinPending !== true || typeof roomFullResponse.gameId !== "string") {
      clearRecoveryTimers();
      reportedRoomFull = true;
      return false;
    }
    if (roomFullResponse.gameId !== joinRequest.gameId) {
      return true;
    }
    if (!joinRequest.rejoinToken) {
      return false;
    }
    if (reportedRoomFull) {
      return true;
    }
    if (!isConnected()) {
      reset();
      return true;
    }

    if (recoveryTimer === null) {
      recoveryTimer = setTimeout(reportFinalRoomFull, REJOIN_RECOVERY_TIMEOUT_MS);
    }
    if (retryTimer === null) {
      retryTimer = setTimeout(retryPendingJoin, REJOIN_RETRY_INTERVAL_MS);
    }
    return true;
  }

  return { recordJoinRequest, receiveRoomFull, reset };
}
