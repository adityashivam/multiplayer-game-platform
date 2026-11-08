import { RIFTBALL_CHARACTER_SETTINGS, RIFTBALL_COURT, RIFTBALL_PLAYER_IDS } from "./config.js";
import { stepRiftballContacts } from "./contacts.js";
import { createRiftballPlayer, getRiftballStepDuration, stepRiftballPlayer } from "./simulation.js";

/** @typedef {import("./simulation.js").RiftballPlayer} RiftballPlayer */
/** @typedef {import("./simulation.js").RiftballBall} RiftballBall */
/** @typedef {import("./simulation.js").RiftballRound} RiftballRound */
/** @typedef {import("./simulation.js").RiftballPhase} RiftballPhase */
/** @typedef {import("./config.js").RiftballInputState} RiftballInputState */
/** @typedef {import("./config.js").RiftballPlayerId} RiftballPlayerId */
/**
 * One SDK-owned local state, including two small independent contact previews.
 * The SDK retains its command history and rebuilds this state on reconciliation.
 * @typedef {RiftballPlayer & {
 *   previewBall:RiftballBall,previewOpponent:RiftballPlayer,
 *   predictionTimeSec:number,predictionPhase:RiftballPhase,predictionRoundId:number,
 *   predictionElapsedSec:number
 * }} RiftballPredictionState
 */

const MAX_OPPONENT_LOOKAHEAD_SEC = 0.15;
const MAX_BALL_LOOKAHEAD_SEC = 0.25;
const PLAYER_FIELDS = Object.freeze(/** @type {(keyof RiftballPlayer)[]} */ (Object.keys(createRiftballPlayer("p1", 0))));

/** @param {Readonly<RiftballPlayer>} player @returns {RiftballPlayer} */
function cloneRiftballPredictionPlayer(player) {
  const playerCopy = /** @type {RiftballPlayer} */ ({});
  for (const field of PLAYER_FIELDS) playerCopy[field] = player[field];
  return playerCopy;
}

/**
 * Create an owned local player and bounded ball/opponent preview from authority.
 * Only declared primitive game fields are copied; input queues, rejoin tokens
 * and snapshot metadata never become prediction-owned gameplay state.
 * @param {Readonly<RiftballRound>} snapshot
 * @param {string} playerId
 * @returns {RiftballPredictionState|null}
 */
export function createRiftballPredictionState(snapshot, playerId) {
  if (!snapshot?.players || !RIFTBALL_PLAYER_IDS.includes(/** @type {RiftballPlayerId} */ (playerId))) return null;
  const localPlayer = snapshot.players[playerId];
  const opponentId = playerId === "p1" ? "p2" : "p1";
  const opponent = snapshot.players[opponentId];
  if (!localPlayer || !opponent || !snapshot.ball) return null;
  return {
    ...cloneRiftballPredictionPlayer(localPlayer),
    previewBall: { ...snapshot.ball },
    previewOpponent: cloneRiftballPredictionPlayer(opponent),
    predictionTimeSec: snapshot.timeSec,
    predictionPhase: snapshot.phase,
    predictionRoundId: snapshot.roundId,
    predictionElapsedSec: 0,
  };
}

/**
 * Remote input is unknown. Project its latest body velocity for a short fixed
 * horizon, then freeze that preview instead of extrapolating indefinitely.
 * @param {RiftballPlayer} opponent
 * @param {number} dtSec
 */
function projectRiftballOpponent(opponent, dtSec) {
  if (dtSec <= 0) return;
  opponent.x += opponent.vx * dtSec;
  opponent.z += opponent.vz * dtSec;
  if (!opponent.grounded) {
    opponent.vy -= RIFTBALL_CHARACTER_SETTINGS.gravity * dtSec;
    opponent.y = Math.max(0, opponent.y + opponent.vy * dtSec);
    if (opponent.y === 0) {
      opponent.vy = 0;
      opponent.grounded = true;
    }
  }
  const limitX = RIFTBALL_COURT.halfWidth - RIFTBALL_CHARACTER_SETTINGS.radius;
  const limitZ = RIFTBALL_COURT.halfLength - RIFTBALL_CHARACTER_SETTINGS.radius;
  opponent.x = Math.max(-limitX, Math.min(limitX, opponent.x));
  opponent.z = Math.max(-limitZ, Math.min(limitZ, opponent.z));
  opponent.actionTimeSec += dtSec;
  opponent.ballContactCooldownSec = Math.max(0, opponent.ballContactCooldownSec - dtSec);
}

/**
 * Replay movement/actions plus a coherent nearby ball preview. Scores, winners,
 * regulation time and goal events remain authoritative. The preview stops after
 * .25s without a new baseline while local controls continue to respond.
 * @param {RiftballPredictionState} player
 * @param {Readonly<RiftballInputState>} input
 * @param {number} dtSec
 * @param {{active?:boolean,timeSec?:number}} [context] Read-only SDK context.
 */
export function stepRiftballPrediction(player, input, dtSec, context = {}) {
  const active = context.active ?? (player.predictionPhase === "playing" || player.predictionPhase === "overtime");
  const stepSec = getRiftballStepDuration(dtSec);
  if (!active || stepSec <= 0) return;
  const timeSec = player.predictionTimeSec ?? context.timeSec ?? 0;
  stepRiftballPlayer(player, input, stepSec, { active: true, timeSec });
  const previousElapsedSec = player.predictionElapsedSec;
  projectRiftballOpponent(player.previewOpponent, Math.max(0, Math.min(stepSec, MAX_OPPONENT_LOOKAHEAD_SEC - previousElapsedSec)));
  const previewStepSec = Math.max(0, Math.min(stepSec, MAX_BALL_LOOKAHEAD_SEC - previousElapsedSec));
  if (previewStepSec > 0) {
    const players = player.id === "p1" ? [player, player.previewOpponent] : [player.previewOpponent, player];
    stepRiftballContacts(players, player.previewBall, previewStepSec);
  }
  player.predictionTimeSec = timeSec + stepSec;
  player.predictionElapsedSec = Math.min(MAX_BALL_LOOKAHEAD_SEC, previousElapsedSec + stepSec);
}
