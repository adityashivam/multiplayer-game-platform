import { buildDriftlineTrack } from "../track.js";
import { SUNSET_CLIFFS_TRACK } from "./sunsetCliffs.js";

/** Default location until track selection exists. */
export const DRIFTLINE_DEFAULT_TRACK_ID = SUNSET_CLIFFS_TRACK.id;

/** Built once per process and shared read-only by every room and client. */
const tracksById = new Map([[SUNSET_CLIFFS_TRACK.id, buildDriftlineTrack(SUNSET_CLIFFS_TRACK)]]);

/**
 * @param {string} trackId
 * @returns {Readonly<import("../track.js").DriftlineTrack>}
 * @throws {TypeError} For an unknown track.
 */
export function getDriftlineTrack(trackId) {
  const track = tracksById.get(trackId);
  if (!track) throw new TypeError(`Unknown Driftline track: ${trackId}`);
  return track;
}
