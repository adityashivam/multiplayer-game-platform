import { randomInt } from "node:crypto";
import { LUDO_DICE_WEIGHTS } from "../../../public/games/ludo/shared/config.js";

const TOTAL_DICE_WEIGHTS = Object.freeze({
  classic: LUDO_DICE_WEIGHTS.classic.reduce((total, weight) => total + weight, 0),
  entry: LUDO_DICE_WEIGHTS.entry.reduce((total, weight) => total + weight, 0),
});

/**
 * Draw fresh server entropy on every roll. Entry boosts six to 1/3; ordinary
 * dice retain six equally likely faces. Previous rolls and player identity have
 * no effect, and every face remains possible on every entry roll.
 * @param {object} [options]
 * @param {boolean} [options.entryBoosted=false] Derived from authoritative board state.
 * @param {(minimum:number,maximum:number)=>number} [options.drawRandomInt] Trusted test dependency; maximum is exclusive.
 * @returns {number} A face in 1..6.
 * @throws {RangeError} If an injected entropy source returns an out-of-range ticket.
 */
export function rollLudoDie({ entryBoosted = false, drawRandomInt = randomInt } = {}) {
  const profile = entryBoosted ? "entry" : "classic";
  const totalWeight = TOTAL_DICE_WEIGHTS[profile];
  const ticket = drawRandomInt(0, totalWeight);
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= totalWeight) {
    throw new RangeError("Ludo entropy must be an integer within the requested range.");
  }

  const faceWeights = LUDO_DICE_WEIGHTS[profile];
  let remainingWeight = ticket;
  for (let faceIndex = 0; faceIndex < faceWeights.length; faceIndex += 1) {
    if (remainingWeight < faceWeights[faceIndex]) return faceIndex + 1;
    remainingWeight -= faceWeights[faceIndex];
  }
  throw new RangeError("Ludo dice weights must resolve a valid face.");
}
