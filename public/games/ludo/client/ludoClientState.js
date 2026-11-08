import { LUDO_ACTION, LUDO_COLORS, LUDO_LIMITS, LUDO_SUPPORTED_PLAYER_IDS } from "../shared/config.js";
import { getLegalLudoTokenIndices } from "../shared/rules.js";

const PENDING_ACTION_TIMEOUT_MS = 5000;
const LUDO_PHASES = new Set(["roll", "rolling", "choose", "moving", "pass", "finished"]);

/**
 * @typedef {import("../shared/config.js").LudoPlayerId} LudoPlayerId
 * @typedef {import("../shared/config.js").LudoCommand} LudoCommand
 * @typedef {import("../shared/rules.js").LudoRoundState & {net?:import("../../../platform/shared/networkProtocol.js").SnapshotNetworkMetadata}} LudoClientSnapshot
 * @typedef {Omit<LudoClientSnapshot,"legalTokenIndices"> & {legalTokenIndices?:number[]}} LudoWireSnapshot
 * @typedef {{command:LudoCommand,startedAtMs:number}} PendingLudoAction
 * @typedef {object} LudoClientView
 * @property {LudoClientSnapshot|null} snapshot The last complete authoritative board; never predicted or mutated.
 * @property {LudoPlayerId|null} playerId
 * @property {boolean} joined
 * @property {boolean} ready A complete snapshot has arrived since the latest seat acquisition.
 * @property {boolean} allPlayersConnected
 * @property {boolean} isMyTurn
 * @property {boolean} canRoll
 * @property {boolean} canChoose
 * @property {number[]} legalTokenIndices
 * @property {number|null} selectedTokenIndex
 * @property {PendingLudoAction|null} pendingAction
 * @property {boolean} pendingRoll
 * @property {number} serverNowMs Server-stamped time plus elapsed monotonic local time.
 */

/**
 * Keep discrete action submission, selection and snapshot readiness separate
 * from rendering. Repeated snapshots cannot release an in-flight command; a
 * newer revision, new round, pause, disconnect or bounded timeout can. The SDK
 * retains transport ordering and room/seat recovery ownership.
 * @param {{pendingTimeoutMs?:number}} [options]
 */
export function createLudoClientState({ pendingTimeoutMs = PENDING_ACTION_TIMEOUT_MS } = {}) {
  const actionTimeoutMs = Number.isFinite(pendingTimeoutMs) && pendingTimeoutMs > 0
    ? pendingTimeoutMs : PENDING_ACTION_TIMEOUT_MS;
  /** @type {LudoClientSnapshot|null} */
  let snapshot = null;
  /** @type {LudoPlayerId|null} */
  let playerId = null;
  /** @type {PendingLudoAction|null} */
  let pendingAction = null;
  /** @type {number|null} */
  let selectedTokenIndex = null;
  let joined = false;
  let ready = false;
  let acceptsJoinedBaseline = false;
  let serverAnchorMs = 0;
  let localAnchorMs = 0;

  /** @returns {boolean} */
  function areAllLudoPlayersConnected() {
    return Boolean(snapshot?.playerIds.every((seatId) => snapshot.players[seatId].connected));
  }

  /** @returns {boolean} */
  function canActOnLudoTurn() {
    return Boolean(joined && ready && playerId && snapshot?.started && !snapshot.gameOver &&
      snapshot.currentPlayerId === playerId && areAllLudoPlayersConnected());
  }

  /** @returns {number[]} */
  function getCurrentLegalTokenIndices() {
    return canActOnLudoTurn() && snapshot.phase === "choose" ? snapshot.legalTokenIndices : [];
  }

  /** @param {number} nowMs */
  function expirePendingLudoAction(nowMs) {
    if (pendingAction && nowMs - pendingAction.startedAtMs >= actionTimeoutMs) pendingAction = null;
  }

  /** Reset only game-owned local interaction state; the board stays authoritative. */
  function resetLocalLudoActions() {
    pendingAction = null;
    selectedTokenIndex = null;
  }

  return {
    /** @param {LudoPlayerId} joinedPlayerId */
    recordJoined(joinedPlayerId) {
      if (!LUDO_SUPPORTED_PLAYER_IDS.includes(joinedPlayerId)) return;
      playerId = joinedPlayerId;
      joined = true;
      ready = false;
      acceptsJoinedBaseline = true;
      resetLocalLudoActions();
    },
    recordDisconnected() {
      joined = false;
      ready = false;
      acceptsJoinedBaseline = false;
      resetLocalLudoActions();
    },
    /** Require fresh authority after rematch while retaining the displayed board. */
    resetRoundReadiness() {
      ready = false;
      resetLocalLudoActions();
    },
    /**
     * Accept a bounded complete state; older rounds/revisions never replace it.
     * Snapshot objects belong to the transport and are retained read-only. A
     * shallow game copy replaces the variable wire choice list with shared-rule
     * choices, recovering sparse/truncated lists between packed schema refreshes.
     * A newly acquired seat accepts its first complete baseline even when an
     * abandoned room was recreated with lower round/revision counters. Further
     * snapshots retain monotonic checks; transport baselines belong to the SDK.
     * @param {LudoWireSnapshot} nextSnapshot
     * @param {number} nowMs Monotonic local receive time.
     * @returns {boolean} Whether this is a usable authoritative state.
     */
    recordSnapshot(nextSnapshot, nowMs) {
      if (!joined || !isCompleteLudoSnapshot(nextSnapshot) || !nextSnapshot.players[playerId]) return false;
      if (!acceptsJoinedBaseline && snapshot && (nextSnapshot.roundId < snapshot.roundId ||
          (nextSnapshot.roundId === snapshot.roundId && nextSnapshot.revision < snapshot.revision))) return false;

      const roundChanged = snapshot?.roundId !== nextSnapshot.roundId;
      snapshot = {
        ...nextSnapshot,
        legalTokenIndices: nextSnapshot.phase === "choose"
          ? getLegalLudoTokenIndices(nextSnapshot, nextSnapshot.currentPlayerId) : [],
      };
      ready = Boolean(playerId && snapshot.players[playerId]);
      acceptsJoinedBaseline = false;
      if (Number.isFinite(snapshot.net?.serverTime)) {
        serverAnchorMs = snapshot.net.serverTime;
        localAnchorMs = nowMs;
      }
      if (roundChanged || !snapshot.started || !areAllLudoPlayersConnected() ||
          (pendingAction && snapshot.revision > pendingAction.command.revision)) resetLocalLudoActions();
      expirePendingLudoAction(nowMs);

      const legalTokenIndices = getCurrentLegalTokenIndices();
      if (!legalTokenIndices.includes(selectedTokenIndex)) selectedTokenIndex = legalTokenIndices[0] ?? null;
      return true;
    },
    /** @param {number} tokenIndex @param {number} nowMs @returns {boolean} */
    selectToken(tokenIndex, nowMs) {
      expirePendingLudoAction(nowMs);
      if (pendingAction || !getCurrentLegalTokenIndices().includes(tokenIndex)) return false;
      selectedTokenIndex = tokenIndex;
      return true;
    },
    /** @param {-1|1} direction @param {number} nowMs @returns {number|null} */
    cycleSelection(direction, nowMs) {
      expirePendingLudoAction(nowMs);
      const legalTokenIndices = getCurrentLegalTokenIndices();
      if (pendingAction || !legalTokenIndices.length) return null;
      const currentIndex = legalTokenIndices.indexOf(selectedTokenIndex);
      const nextIndex = (currentIndex + direction + legalTokenIndices.length) % legalTokenIndices.length;
      selectedTokenIndex = legalTokenIndices[nextIndex];
      return selectedTokenIndex;
    },
    /**
     * Build one command against the currently displayed authority. Callers send
     * only a non-null command and never enqueue or automatically resend it.
     * @param {"roll"|"move"} type
     * @param {number|undefined} tokenIndex
     * @param {number} nowMs
     * @returns {LudoCommand|null}
     */
    beginCommand(type, tokenIndex, nowMs) {
      expirePendingLudoAction(nowMs);
      if (pendingAction || !canActOnLudoTurn()) return null;
      const canRoll = type === LUDO_ACTION.ROLL && snapshot.phase === "roll";
      const canMove = type === LUDO_ACTION.MOVE && getCurrentLegalTokenIndices().includes(tokenIndex);
      if (!canRoll && !canMove) return null;

      /** @type {LudoCommand} */
      const command = canRoll
        ? { type: LUDO_ACTION.ROLL, roundId: snapshot.roundId, revision: snapshot.revision }
        : { type: LUDO_ACTION.MOVE, roundId: snapshot.roundId, revision: snapshot.revision, tokenIndex };
      if (canMove) selectedTokenIndex = tokenIndex;
      pendingAction = { command, startedAtMs: nowMs };
      return command;
    },
    /** @param {number} nowMs @returns {LudoClientView} */
    getView(nowMs) {
      expirePendingLudoAction(nowMs);
      const canAct = canActOnLudoTurn() && !pendingAction;
      return {
        snapshot,
        playerId,
        joined,
        ready,
        allPlayersConnected: areAllLudoPlayersConnected(),
        isMyTurn: Boolean(playerId && snapshot?.currentPlayerId === playerId),
        canRoll: canAct && snapshot.phase === "roll",
        canChoose: canAct && snapshot.phase === "choose" && snapshot.legalTokenIndices.length > 0,
        legalTokenIndices: getCurrentLegalTokenIndices(),
        selectedTokenIndex,
        pendingAction,
        pendingRoll: pendingAction?.command.type === LUDO_ACTION.ROLL,
        serverNowMs: serverAnchorMs + Math.max(0, nowMs - localAnchorMs),
      };
    },
  };
}

/**
 * Reject malformed/unbounded game state before controls or picking use it.
 * Transport packet framing, sequence validation and decoding remain in the SDK.
 * @param {unknown} candidate
 * @returns {candidate is LudoWireSnapshot}
 */
function isCompleteLudoSnapshot(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  const snapshot = /** @type {LudoWireSnapshot} */ (candidate);
  if (!Number.isSafeInteger(snapshot.roundId) || snapshot.roundId < 1 ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      !Array.isArray(snapshot.playerIds) || snapshot.playerIds.length < 2 || snapshot.playerIds.length > 4 ||
      new Set(snapshot.playerIds).size !== snapshot.playerIds.length || !snapshot.players ||
      !snapshot.playerIds.includes(snapshot.currentPlayerId) || !LUDO_PHASES.has(snapshot.phase) ||
      typeof snapshot.started !== "boolean" || typeof snapshot.gameOver !== "boolean" ||
      !Number.isInteger(snapshot.diceValue) || snapshot.diceValue < 0 || snapshot.diceValue > 6 ||
      (snapshot.legalTokenIndices !== undefined && (!Array.isArray(snapshot.legalTokenIndices) ||
        snapshot.legalTokenIndices.length > LUDO_LIMITS.TOKENS_PER_PLAYER))) return false;

  return snapshot.playerIds.every((seatId) => {
    const playerState = snapshot.players[seatId];
    return LUDO_SUPPORTED_PLAYER_IDS.includes(seatId) && playerState?.id === seatId &&
      LUDO_COLORS.includes(playerState.color) && typeof playerState.connected === "boolean" &&
      (playerState.entryMisses === undefined || (Number.isInteger(playerState.entryMisses) &&
        playerState.entryMisses >= 0 && playerState.entryMisses < LUDO_LIMITS.ENTRY_ROLL_LIMIT)) &&
      Array.isArray(playerState.tokens) && playerState.tokens.length === LUDO_LIMITS.TOKENS_PER_PLAYER &&
      playerState.tokens.every((progress) => Number.isInteger(progress) && progress >= LUDO_LIMITS.YARD && progress <= LUDO_LIMITS.HOME_FINISH);
  });
}
