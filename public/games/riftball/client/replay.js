const DEFAULT_DURATION_SEC = 2.2;
const DEFAULT_SAMPLE_RATE_HZ = 30;
const PLAYBACK_SPEED = 0.8;

/**
 * Own a small presentation-only final-point history. No authoritative state,
 * inputs or networking queues are retained, and renderers receive owned copies.
 * @param {{durationSec?:number,sampleRateHz?:number}} [options]
 */
export function createRiftballReplayBuffer(options = {}) {
  const durationSec = Math.max(0.5, Math.min(4, options.durationSec || DEFAULT_DURATION_SEC));
  const sampleRateHz = Math.max(10, Math.min(60, options.sampleRateHz || DEFAULT_SAMPLE_RATE_HZ));
  const capacity = Math.ceil(durationSec * sampleRateHz) + 2;
  const samples = [];
  let roundId = null;
  let playbackStartSec = null;

  function clear() {
    samples.length = 0;
    playbackStartSec = null;
    roundId = null;
  }

  return {
    /** @param {object} frame @param {{forceSample?:boolean}} [recordOptions] */
    record(frame, { forceSample = false } = {}) {
      if (roundId !== frame.roundId) {
        clear();
        roundId = frame.roundId;
      }
      if (playbackStartSec !== null || !Number.isFinite(frame.timeSec)) return;
      const previous = samples.at(-1);
      if (previous && !forceSample && frame.timeSec - previous.timeSec < 1 / sampleRateHz - 1e-7) return;
      samples.push(cloneReplayFrame(frame));
      while (samples.length > capacity || (samples.length > 1 && samples.at(-1).timeSec - samples[0].timeSec > durationSec + 1 / sampleRateHz)) {
        samples.shift();
      }
    },
    start(nowSec) {
      if (samples.length < 2 || !Number.isFinite(nowSec)) return false;
      playbackStartSec = nowSec;
      return true;
    },
    sample(nowSec) {
      if (playbackStartSec === null) return null;
      const elapsedSec = Math.max(0, nowSec - playbackStartSec) * PLAYBACK_SPEED;
      const sourceSec = samples[0].timeSec + elapsedSec;
      if (sourceSec > samples.at(-1).timeSec + 1e-7) {
        playbackStartSec = null;
        // A render frame can pass the endpoint without landing on its exact
        // timestamp. Present the confirmed winning frame once before results.
        return { ...cloneReplayFrame(samples.at(-1)), replay: true };
      }
      let nextIndex = samples.findIndex((frame) => frame.timeSec >= sourceSec);
      if (nextIndex < 0) nextIndex = samples.length - 1;
      const first = samples[Math.max(0, nextIndex - 1)];
      const second = samples[nextIndex];
      const alpha = first === second ? 0 : Math.max(0, Math.min(1, (sourceSec - first.timeSec) / (second.timeSec - first.timeSec)));
      return interpolateReplayFrames(first, second, alpha);
    },
    clear,
    skip: () => { playbackStartSec = null; },
    isPlaying: () => playbackStartSec !== null,
    getStats: () => ({ samples: samples.length, durationSec: samples.length < 2 ? 0 : samples.at(-1).timeSec - samples[0].timeSec }),
  };
}

/** Keep only render-owned values; never retain nested network snapshot objects. */
function cloneReplayFrame(frame) {
  return {
    timeSec: frame.timeSec, gameTimeSec: frame.gameTimeSec, roundId: frame.roundId,
    playerId: frame.playerId, phase: frame.phase, goalSerial: frame.goalSerial,
    lastScorer: frame.lastScorer, reducedMotion: frame.reducedMotion,
    cameraOrbit: { ...(frame.cameraOrbit || { yaw: 0, pitch: 0 }) },
    players: frame.players.map((player) => ({ ...player })),
    ball: { ...frame.ball },
  };
}

function interpolateReplayFrames(first, second, alpha) {
  const presented = cloneReplayFrame(alpha >= 1 - 1e-7 ? second : first);
  const mix = (start, end) => start + (end - start) * alpha;
  presented.replay = true;
  presented.timeSec = mix(first.timeSec, second.timeSec);
  presented.gameTimeSec = mix(first.gameTimeSec, second.gameTimeSec);
  for (const player of presented.players) {
    const next = second.players.find((candidate) => candidate.id === player.id);
    if (!next) continue;
    for (const coordinate of ["x", "y", "z"]) player[coordinate] = mix(player[coordinate], next[coordinate]);
    const angleDelta = Math.atan2(Math.sin(next.facing - player.facing), Math.cos(next.facing - player.facing));
    player.facing += angleDelta * alpha;
    if (player.actionId === next.actionId) player.actionTimeSec = mix(player.actionTimeSec, next.actionTimeSec);
  }
  if (first.ball.serveId === second.ball.serveId) {
    for (const coordinate of ["x", "y", "z"]) presented.ball[coordinate] = mix(first.ball[coordinate], second.ball[coordinate]);
  } else if (alpha >= 0.5) {
    presented.ball = { ...second.ball };
  }
  return presented;
}
