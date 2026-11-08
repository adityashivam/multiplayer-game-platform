const MAX_ACTIVE_VOICES = 18;

/** Original bounded Web Audio cues, unlocked only by an explicit player gesture. */
export function createRiftballAudio() {
  let context = null;
  let masterGain = null;
  let muted = false;
  let disposed = false;
  let lastHitSerial = null;
  let lastBounceSerial = null;
  let lastGoalSerial = null;
  let lastActionId = null;
  const voices = new Set();

  /**
   * Schedule a short, enveloped sports cue; a fixed voice limit bounds allocation.
   * @param {{frequency:number,endFrequency:number,durationSec:number,type?:OscillatorType,volume?:number,pan?:number,delaySec?:number}} cue
   */
  function playCue(cue) {
    if (disposed || muted || context?.state !== "running" || voices.size >= MAX_ACTIVE_VOICES) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const panner = context.createStereoPanner();
    const startSec = context.currentTime + (cue.delaySec || 0);
    oscillator.type = cue.type || "sine";
    oscillator.frequency.setValueAtTime(cue.frequency, startSec);
    oscillator.frequency.exponentialRampToValueAtTime(cue.endFrequency, startSec + cue.durationSec);
    envelope.gain.setValueAtTime(0.001, startSec);
    envelope.gain.exponentialRampToValueAtTime(cue.volume || 0.04, startSec + 0.009);
    envelope.gain.exponentialRampToValueAtTime(0.001, startSec + cue.durationSec);
    panner.pan.value = Math.max(-1, Math.min(1, cue.pan || 0));
    oscillator.connect(envelope).connect(panner).connect(masterGain);
    voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
      panner.disconnect();
    };
    oscillator.start(startSec);
    oscillator.stop(startSec + cue.durationSec + 0.02);
  }

  function reset() {
    lastHitSerial = null;
    lastBounceSerial = null;
    lastGoalSerial = null;
    lastActionId = null;
    for (const oscillator of voices) {
      try { oscillator.stop(); } catch { /* An ended cue has already released its voice. */ }
    }
    voices.clear();
  }

  function unlock() {
    if (disposed) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!context) {
      context = new AudioContextClass();
      masterGain = context.createGain();
      masterGain.gain.value = muted ? 0 : 0.8;
      masterGain.connect(context.destination);
    }
    if (context.state === "suspended") context.resume().catch(() => {});
  }

  return {
    unlock, reset,
    toggleMute() {
      unlock();
      muted = !muted;
      if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : 0.8, context.currentTime, 0.02);
      return muted;
    },
    update({ snapshot, player, ball }) {
      if (!snapshot || !player || !ball) return;
      const pan = Math.max(-0.8, Math.min(0.8, (ball.x - player.x) / 10));
      if (lastHitSerial !== null && snapshot.ball.hitSerial > lastHitSerial) {
        const power = Math.min(1, Math.hypot(ball.vx, ball.vz) / 24);
        playCue({ frequency: 240 + power * 130, endFrequency: 70, durationSec: 0.14, type: "triangle", volume: 0.05 + power * 0.025, pan });
        playCue({ frequency: 920, endFrequency: 180, durationSec: 0.1, volume: 0.018, pan });
      }
      if (lastBounceSerial !== null && snapshot.ball.bounceSerial > lastBounceSerial) {
        playCue({ frequency: 125, endFrequency: 56, durationSec: 0.09, type: "triangle", volume: 0.025, pan });
      }
      if (lastGoalSerial !== null && snapshot.goalSerial > lastGoalSerial) {
        for (const [index, frequency] of [392, 494, 587, 784].entries()) {
          playCue({ frequency, endFrequency: frequency * 1.008, durationSec: 0.42, volume: 0.035, delaySec: index * 0.075 });
        }
      }
      if (lastActionId !== null && player.actionId !== lastActionId) {
        if (player.action === "dash") playCue({ frequency: 150, endFrequency: 440, durationSec: 0.15, type: "triangle", volume: 0.035 });
        if (player.action === "jump") playCue({ frequency: 185, endFrequency: 320, durationSec: 0.11, volume: 0.018 });
        if (player.action === "feint") playCue({ frequency: 480, endFrequency: 190, durationSec: 0.1, volume: 0.018 });
      }
      lastHitSerial = snapshot.ball.hitSerial;
      lastBounceSerial = snapshot.ball.bounceSerial;
      lastGoalSerial = snapshot.goalSerial;
      lastActionId = player.actionId;
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      masterGain?.disconnect();
      context?.close().catch(() => {});
    },
  };
}
