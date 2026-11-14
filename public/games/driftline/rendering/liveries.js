/**
 * Cosmetic car styles. Every style shares one body, one physics model and one
 * set of handling numbers: these entries change looks only, so races stay
 * fair. Body colour still comes from the car's slot so HUD and minimap match.
 *
 * @typedef {"gloss"|"matte"|"pearl"|"candy"} DriftlinePaintFinish
 * @typedef {"none"|"twin"|"single"|"side"} DriftlineStripeStyle
 * @typedef {"chrome"|"black"|"bronze"|"gold"|"gunmetal"} DriftlineRimFinish
 * @typedef {"hoodScoop"|"ducktail"|"gtWing"|"lowWing"} DriftlineBodyAddon
 * @typedef {object} DriftlineLivery
 * @property {string} id
 * @property {string} name
 * @property {DriftlinePaintFinish} finish
 * @property {DriftlineStripeStyle} stripes
 * @property {string} stripeColor Hex colour of stripes.
 * @property {string|null} accentColor Hex colour for the accent panels (roof and sills); null keeps them black.
 * @property {DriftlineRimFinish} rims
 * @property {readonly DriftlineBodyAddon[]} addons
 */

/** @type {ReadonlyArray<Readonly<DriftlineLivery>>} */
export const DRIFTLINE_LIVERIES = Object.freeze([
  Object.freeze({ id: "muscle", name: "Muscle", finish: "gloss", stripes: "twin", stripeColor: "#f3efe6", accentColor: null, rims: "black", addons: Object.freeze(["hoodScoop", "ducktail"]) }),
  Object.freeze({ id: "tuner", name: "Tuner", finish: "pearl", stripes: "side", stripeColor: "#111318", accentColor: null, rims: "bronze", addons: Object.freeze(["gtWing"]) }),
  Object.freeze({ id: "gt", name: "GT", finish: "gloss", stripes: "none", stripeColor: "#ffffff", accentColor: null, rims: "chrome", addons: Object.freeze([]) }),
  Object.freeze({ id: "stealth", name: "Stealth", finish: "matte", stripes: "none", stripeColor: "#ffffff", accentColor: "#0b0c0e", rims: "gunmetal", addons: Object.freeze(["lowWing"]) }),
  Object.freeze({ id: "classic", name: "Classic", finish: "candy", stripes: "single", stripeColor: "#f3efe6", accentColor: null, rims: "chrome", addons: Object.freeze(["ducktail"]) }),
  Object.freeze({ id: "two-tone", name: "Two-Tone", finish: "gloss", stripes: "none", stripeColor: "#ffffff", accentColor: "#f2eee7", rims: "gold", addons: Object.freeze(["hoodScoop"]) }),
]);

/**
 * Style for a grid slot. Distinct for the first six slots, so every car on a
 * full grid looks different; deterministic, so every client agrees.
 * @param {number} slotIndex
 * @returns {Readonly<DriftlineLivery>}
 */
export function getDriftlineLivery(slotIndex) {
  const index = Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex % DRIFTLINE_LIVERIES.length : 0;
  return DRIFTLINE_LIVERIES[index];
}
