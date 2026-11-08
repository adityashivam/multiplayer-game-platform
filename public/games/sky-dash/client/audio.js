const MAX_ACTIVE_TONES = 12;

/**
 * Lightweight original arcade cues, unlocked only by a player gesture. No remote
 * audio assets or per-frame allocation while idle; voices have a fixed ceiling.
 */
export function createSkyDashAudio() {
  let context = null;
  let muted = false;
  let previousAction = "idle";
  let previousCheckpoint = 0;
  let previousRespawn = 0;
  let previousFinished = false;
  let disposed = false;
  const voices = new Set();

  function playTone(frequency, endFrequency, durationSec, type = "sine", volume = 0.045) {
    if (disposed || muted || context?.state !== "running" || voices.size >= MAX_ACTIVE_TONES) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const nowSec = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, nowSec);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, nowSec + durationSec);
    envelope.gain.setValueAtTime(0.001, nowSec);
    envelope.gain.exponentialRampToValueAtTime(volume, nowSec + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, nowSec + durationSec);
    oscillator.connect(envelope).connect(context.destination);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(nowSec);
    oscillator.stop(nowSec + durationSec + 0.015);
  }

  function reset() {
    previousAction = "idle";
    previousCheckpoint = 0;
    previousRespawn = 0;
    previousFinished = false;
    for (const voice of voices) { try { voice.stop(); } catch { /* A voice may have just finished. */ } }
    voices.clear();
  }

  return {
    unlock() {
      if (disposed) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      context ||= new AudioContextClass();
      if (context.state === "suspended") context.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (muted) reset();
      return muted;
    },
    reset,
    update(runner) {
      if (!runner) return;
      if (runner.action !== previousAction) {
        if (runner.action === "jump") playTone(280, 650, 0.17, "sine");
        if (runner.action === "dash") playTone(170, 420, 0.15, "triangle");
        if (runner.action === "dive") playTone(390, 130, 0.22, "triangle");
        if (runner.action === "hit") playTone(130, 55, 0.22, "triangle", 0.065);
      }
      if (runner.checkpoint > previousCheckpoint) { playTone(520, 950, 0.25); playTone(780, 1300, 0.3); }
      if (runner.respawnId > previousRespawn) playTone(150, 430, 0.25);
      if (runner.finished && !previousFinished) { playTone(523, 1046, 0.5); playTone(659, 1318, 0.55); }
      previousAction = runner.action;
      previousCheckpoint = runner.checkpoint;
      previousRespawn = runner.respawnId;
      previousFinished = runner.finished;
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      context?.close().catch(() => {});
    },
  };
}
