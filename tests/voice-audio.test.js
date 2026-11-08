import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVoiceOpusPreferences,
  configureVoiceTrack,
  getVoiceMediaConstraints,
  limitVoiceSenderBitrate,
  preferVoiceAudioCodecs,
} from "../public/platform/frontend-engine/voiceAudio.js";

test("microphone requests mono speech processing without mandatory device constraints", () => {
  assert.deepEqual(getVoiceMediaConstraints(), {
    audio: {
      noiseSuppression: { ideal: true },
      echoCancellation: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    },
    video: false,
  });
});

test("track processing feedback reports actual browser settings and a speech hint", () => {
  const microphoneTrack = {
    contentHint: "",
    getSettings: () => ({ noiseSuppression: true, echoCancellation: false }),
  };

  assert.deepEqual(configureVoiceTrack(microphoneTrack), {
    noiseSuppression: true,
    echoCancellation: false,
    autoGainControl: null,
  });
  assert.equal(microphoneTrack.contentHint, "speech");
});

test("Opus is preferred while retaining browser fallback codecs", () => {
  const pcmu = { mimeType: "audio/PCMU", clockRate: 8000 };
  const opus = { mimeType: "audio/opus", clockRate: 48000, channels: 2 };
  let selectedCodecs;

  preferVoiceAudioCodecs({ setCodecPreferences: (codecs) => { selectedCodecs = codecs; } }, {
    getCapabilities: () => ({ codecs: [pcmu, opus] }),
  });

  assert.deepEqual(selectedCodecs, [opus, pcmu]);
});

test("Opus preferences amend only audio Opus fmtp and preserve unrelated parameters", () => {
  const sourceSdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 0 111",
    "a=rtpmap:0 PCMU/8000",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;stereo=1;maxaveragebitrate=64000",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=rtpmap:96 VP8/90000",
    "",
  ].join("\r\n");
  const configuredSdp = applyVoiceOpusPreferences(sourceSdp);

  assert.match(configuredSdp, /a=fmtp:111 minptime=10;maxaveragebitrate=24000;stereo=0;useinbandfec=1;usedtx=1;cbr=0\r\n/);
  assert.match(configuredSdp, /m=audio 9 UDP\/TLS\/RTP\/SAVPF 111 0\r\n/);
  assert.match(configuredSdp, /a=rtpmap:96 VP8\/90000\r\n$/);
  assert.equal(applyVoiceOpusPreferences(configuredSdp), configuredSdp);
});

test("missing Opus fmtp is inserted and bitrate caps use sender parameters", async () => {
  const configuredSdp = applyVoiceOpusPreferences("v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\n");
  assert.match(configuredSdp, /a=fmtp:111 maxaveragebitrate=24000;stereo=0;useinbandfec=1;usedtx=1;cbr=0\n/);

  let submittedParameters;
  const sender = {
    getParameters: () => ({ transactionId: "unchanged", encodings: [{ active: true }] }),
    setParameters: async (parameters) => { submittedParameters = parameters; },
  };
  await limitVoiceSenderBitrate(sender);
  assert.deepEqual(submittedParameters, {
    transactionId: "unchanged",
    encodings: [{ active: true, maxBitrate: 24000 }],
  });
});

test("unsupported browser codec and bitrate knobs remain nonfatal", async () => {
  assert.doesNotThrow(() => preferVoiceAudioCodecs({}, undefined));
  assert.deepEqual(configureVoiceTrack({}), {
    noiseSuppression: null,
    echoCancellation: null,
    autoGainControl: null,
  });
  await assert.doesNotReject(limitVoiceSenderBitrate({
    getParameters: () => ({ encodings: [] }),
    setParameters: async () => { throw new Error("Unsupported parameters"); },
  }));
});
