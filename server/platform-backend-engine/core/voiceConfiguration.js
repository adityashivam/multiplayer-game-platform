import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";
const DEFAULT_TURN_TTL_SECONDS = 600;
const MAX_TURN_TTL_SECONDS = 3600;
const MAX_ICE_URLS = 8;
const MAX_ICE_URL_LENGTH = 512;
const MAX_TURN_SECRET_LENGTH = 1024;

/**
 * @typedef {object} VoiceEnvironment
 * @property {string} [VOICE_STUN_URLS]
 * @property {string} [VOICE_TURN_URLS]
 * @property {string} [VOICE_TURN_SECRET]
 * @property {string} [VOICE_TURN_TTL_SECONDS]
 *
 * @typedef {{urls:string[],username?:string,credential?:string}} VoiceIceServer
 * @typedef {{createIceServers:(participantId:string) => VoiceIceServer[]}} VoiceConfiguration
 */

/**
 * Validate WebRTC ICE URLs without accepting embedded long-lived credentials.
 * @param {string} environmentKey
 * @param {string} configuredUrls
 * @param {readonly string[]} supportedSchemes
 * @returns {string[]}
 * @throws {TypeError} If any URL has an unsupported scheme, host, port or transport.
 */
function parseVoiceIceUrls(environmentKey, configuredUrls, supportedSchemes) {
  if (typeof configuredUrls !== "string") {
    throw new TypeError(`${environmentKey} must be a comma-separated string.`);
  }

  if (configuredUrls.trim() === "") {
    return [];
  }

  const iceUrls = configuredUrls.split(",").map((iceUrl) => iceUrl.trim());
  if (iceUrls.length > MAX_ICE_URLS) {
    throw new TypeError(`${environmentKey} contains too many ICE URLs.`);
  }

  for (const iceUrl of iceUrls) {
    const urlParts = iceUrl.match(/^(stun|stuns|turn|turns):(\[[\da-fA-F:.]+\]|[A-Za-z\d][A-Za-z\d.-]*)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/);
    if (iceUrl.length > MAX_ICE_URL_LENGTH || !urlParts || !supportedSchemes.includes(urlParts[1])) {
      throw new TypeError(`${environmentKey} contains an invalid ICE URL.`);
    }

    const [, scheme, hostname, port, transport] = urlParts;
    const isValidHostname = hostname.startsWith("[")
      ? isIP(hostname.slice(1, -1)) === 6
      : hostname.replace(/\.$/, "").split(".").every((label) =>
        label.length <= 63 && /^[A-Za-z\d](?:[A-Za-z\d-]*[A-Za-z\d])?$/.test(label));
    if (!isValidHostname || (port !== undefined && (Number(port) === 0 || Number(port) > 65535)) ||
        (transport !== undefined && !scheme.startsWith("turn"))) {
      throw new TypeError(`${environmentKey} contains an invalid ICE host, port or transport.`);
    }
  }

  return [...new Set(iceUrls)];
}

/**
 * Parse server-only voice settings once; each authorized join receives a fresh,
 * independently owned ICE list with participant-scoped short-lived TURN access.
 * @param {{env?:VoiceEnvironment,nowFn?:() => number}} [options]
 * @returns {VoiceConfiguration}
 * @throws {TypeError} If ICE URLs, relay credentials or lifetime settings are invalid.
 */
export function createVoiceConfiguration({ env = process.env, nowFn = Date.now } = {}) {
  const stunUrls = parseVoiceIceUrls("VOICE_STUN_URLS", env.VOICE_STUN_URLS ?? DEFAULT_STUN_URL, ["stun", "stuns"]);
  const turnUrls = parseVoiceIceUrls("VOICE_TURN_URLS", env.VOICE_TURN_URLS ?? "", ["turn", "turns"]);
  const turnSecret = env.VOICE_TURN_SECRET;
  const ttlSetting = env.VOICE_TURN_TTL_SECONDS;
  const configuredTtlSeconds = ttlSetting === undefined ? DEFAULT_TURN_TTL_SECONDS : Number(ttlSetting);

  if (ttlSetting !== undefined && (typeof ttlSetting !== "string" || !/^\d+$/.test(ttlSetting)) ||
      !Number.isSafeInteger(configuredTtlSeconds) || configuredTtlSeconds <= 0) {
    throw new TypeError("VOICE_TURN_TTL_SECONDS must be a positive integer.");
  }
  if ((turnUrls.length > 0) !== (turnSecret !== undefined && turnSecret !== "") ||
      turnSecret !== undefined && (typeof turnSecret !== "string" ||
        turnSecret.length > MAX_TURN_SECRET_LENGTH || /[\x00-\x1f\x7f]/.test(turnSecret))) {
    throw new TypeError("VOICE_TURN_URLS and a valid VOICE_TURN_SECRET must be configured together.");
  }

  const ttlSeconds = Math.min(configuredTtlSeconds, MAX_TURN_TTL_SECONDS);

  return {
    createIceServers(participantId) {
      const iceServers = [];
      if (stunUrls.length > 0) {
        iceServers.push({ urls: [...stunUrls] });
      }
      if (turnUrls.length > 0) {
        if (typeof participantId !== "string" || !/^[A-Za-z\d_-]{1,128}$/.test(participantId)) {
          throw new TypeError("TURN credentials require a valid participant identifier.");
        }

        const expiresAtSeconds = Math.floor(nowFn() / 1000) + ttlSeconds;
        const username = `${expiresAtSeconds}:${participantId}`;
        iceServers.push({
          urls: [...turnUrls],
          username,
          credential: createHmac("sha1", turnSecret).update(username).digest("base64"),
        });
      }
      return iceServers;
    },
  };
}

/** @type {VoiceConfiguration | undefined} */
let defaultVoiceConfiguration;

/** Parse process configuration once, shared by all trusted game namespaces. */
export function getDefaultVoiceConfiguration() {
  defaultVoiceConfiguration ??= createVoiceConfiguration();
  return defaultVoiceConfiguration;
}
