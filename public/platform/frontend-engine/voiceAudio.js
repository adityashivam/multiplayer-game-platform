import { VOICE_LIMITS } from "../shared/voiceProtocol.js";

const OPUS_VOICE_PARAMETERS = Object.freeze({
  maxaveragebitrate: String(VOICE_LIMITS.AUDIO_BITRATE_BPS),
  stereo: "0",
  useinbandfec: "1",
  usedtx: "1",
  cbr: "0",
});

/** Request browser speech processing as preferences, allowing unsupported devices. */
export function getVoiceMediaConstraints() {
  return {
    audio: {
      noiseSuppression: { ideal: true },
      echoCancellation: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    },
    video: false,
  };
}

/**
 * Configure a captured track without custom audio processing. Report actual
 * browser settings rather than promising requested processing was enabled.
 * @param {MediaStreamTrack} microphoneTrack
 * @returns {{noiseSuppression:boolean|null,echoCancellation:boolean|null,autoGainControl:boolean|null}}
 */
export function configureVoiceTrack(microphoneTrack) {
  try {
    if ("contentHint" in microphoneTrack) {
      microphoneTrack.contentHint = "speech";
    }
  } catch {
    // A browser may expose the property without accepting the speech hint.
  }

  const trackSettings = microphoneTrack.getSettings?.() || {};
  return {
    noiseSuppression: typeof trackSettings.noiseSuppression === "boolean" ? trackSettings.noiseSuppression : null,
    echoCancellation: typeof trackSettings.echoCancellation === "boolean" ? trackSettings.echoCancellation : null,
    autoGainControl: typeof trackSettings.autoGainControl === "boolean" ? trackSettings.autoGainControl : null,
  };
}

/**
 * Prefer Opus while retaining native fallback codecs. Older browsers may lack
 * either capability API; SDP preferences remain available in that case.
 * @param {RTCRtpTransceiver} audioTransceiver
 * @param {typeof RTCRtpSender | undefined} Sender
 */
export function preferVoiceAudioCodecs(audioTransceiver, Sender) {
  if (!audioTransceiver.setCodecPreferences || !Sender?.getCapabilities) {
    return;
  }

  try {
    const audioCodecs = Sender.getCapabilities("audio")?.codecs || [];
    const opusCodecs = audioCodecs.filter((codec) => codec.mimeType.toLowerCase() === "audio/opus");
    if (opusCodecs.length > 0) {
      audioTransceiver.setCodecPreferences([
        ...opusCodecs,
        ...audioCodecs.filter((codec) => codec.mimeType.toLowerCase() !== "audio/opus"),
      ]);
    }
  } catch {
    // Codec preferences are advisory; native negotiation still works without it.
  }
}

/**
 * Keep the native sender's negotiated encodings and transaction identity intact.
 * Packet overhead is outside this codec bitrate cap. Some browsers reject this
 * optional setting even after negotiation; that must not interrupt room voice.
 * @param {RTCRtpSender} audioSender
 * @returns {Promise<void>}
 */
export async function limitVoiceSenderBitrate(audioSender) {
  if (!audioSender?.getParameters || !audioSender.setParameters) {
    return;
  }

  try {
    const senderParameters = audioSender.getParameters();
    const senderEncodings = senderParameters.encodings?.length ? senderParameters.encodings : [{}];
    senderParameters.encodings = senderEncodings.map((encoding) => ({
      ...encoding,
      maxBitrate: VOICE_LIMITS.AUDIO_BITRATE_BPS,
    }));
    await audioSender.setParameters(senderParameters);
  } catch {
    // The SDP cap is retained when the sender API does not support bitrate caps.
  }
}

/**
 * Apply narrowly scoped RFC 7587 Opus speech preferences to audio sections only.
 * DTX, FEC and processing remain browser-dependent preferences, not guarantees.
 * Preserve line endings, unrelated codecs and unrelated Opus parameters.
 * @param {string} sessionDescription
 * @returns {string}
 */
export function applyVoiceOpusPreferences(sessionDescription) {
  const lineEnding = sessionDescription.includes("\r\n") ? "\r\n" : "\n";
  const descriptionLines = sessionDescription.split(lineEnding);
  let sectionStart = 0;

  while (sectionStart < descriptionLines.length) {
    if (!descriptionLines[sectionStart].startsWith("m=audio ")) {
      sectionStart += 1;
      continue;
    }

    let sectionEnd = sectionStart + 1;
    while (sectionEnd < descriptionLines.length && !descriptionLines[sectionEnd].startsWith("m=")) {
      sectionEnd += 1;
    }

    const opusPayloads = descriptionLines.slice(sectionStart + 1, sectionEnd)
      .map((line) => /^a=rtpmap:(\d+) opus\/48000(?:\/\d+)?$/i.exec(line)?.[1])
      .filter(Boolean);
    if (opusPayloads.length > 0) {
      const audioMediaFields = descriptionLines[sectionStart].split(" ");
      const payloads = audioMediaFields.slice(3);
      descriptionLines[sectionStart] = [
        ...audioMediaFields.slice(0, 3),
        ...opusPayloads.filter((payload) => payloads.includes(payload)),
        ...payloads.filter((payload) => !opusPayloads.includes(payload)),
      ].join(" ");
    }

    for (const opusPayload of opusPayloads) {
      const formatPrefix = `a=fmtp:${opusPayload} `;
      let formatIndex = descriptionLines.findIndex((line, index) => (
        index > sectionStart && index < sectionEnd && line.startsWith(formatPrefix)
      ));
      const existingParameters = formatIndex < 0 ? [] : descriptionLines[formatIndex].slice(formatPrefix.length).split(";");
      const retainedParameters = existingParameters.map((parameter) => parameter.trim()).filter((parameter) => (
        parameter && !Object.hasOwn(OPUS_VOICE_PARAMETERS, parameter.split("=")[0].toLowerCase())
      ));
      const opusParameters = Object.entries(OPUS_VOICE_PARAMETERS).map(([key, value]) => `${key}=${value}`);
      const formatLine = `${formatPrefix}${[...retainedParameters, ...opusParameters].join(";")}`;

      if (formatIndex < 0) {
        formatIndex = descriptionLines.findIndex((line, index) => (
          index > sectionStart && index < sectionEnd && line.startsWith(`a=rtpmap:${opusPayload} `)
        )) + 1;
        descriptionLines.splice(formatIndex, 0, formatLine);
        sectionEnd += 1;
      } else {
        descriptionLines[formatIndex] = formatLine;
      }
    }

    sectionStart = sectionEnd;
  }

  return descriptionLines.join(lineEnding);
}
