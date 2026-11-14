/** @typedef {import("./raceEvents.js").DriftlineRaceEvent} DriftlineRaceEvent */
/** @typedef {import("./snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */

const MASTER_VOLUME = 0.28;
const GEAR_TOP_SPEEDS = Object.freeze([9, 17, 25, 33, 41, 60]);
const IDLE_HZ = 55;
const REDLINE_HZ = 190;
const RAMP_SEC = 0.05;

/**
 * Synthesized engine, tyre squeal and one-shot effects; no audio files.
 * The context starts only after a user gesture. Continuous voices are
 * retuned at render cadence with short ramps; failures stay silent.
 * @returns {{unlock():void,toggleMute():boolean,update(car:DriftlinePresentedCar|null,events:readonly DriftlineRaceEvent[]):void,dispose():void}}
 */
export function createDriftlineAudio() {
  /** @type {AudioContext|null} */
  let context = null;
  let master = null;
  let engineGain = null;
  let engineLow = null;
  let engineHigh = null;
  let squealGain = null;
  let squealFilter = null;
  let noiseBuffer = null;
  let muted = false;

  function unlock() {
    if (context) {
      if (context.state === "suspended") context.resume().catch(() => {});
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

      engineGain = context.createGain();
      engineGain.gain.value = 0;
      const engineFilter = context.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 900;
      engineLow = context.createOscillator();
      engineLow.type = "sawtooth";
      engineHigh = context.createOscillator();
      engineHigh.type = "square";
      const highMix = context.createGain();
      highMix.gain.value = 0.35;
      engineLow.connect(engineFilter);
      engineHigh.connect(highMix).connect(engineFilter);
      engineFilter.connect(engineGain).connect(master);
      engineLow.start();
      engineHigh.start();

      const squealSource = context.createBufferSource();
      squealSource.buffer = noiseBuffer;
      squealSource.loop = true;
      squealFilter = context.createBiquadFilter();
      squealFilter.type = "bandpass";
      squealFilter.frequency.value = 1400;
      squealFilter.Q.value = 6;
      squealGain = context.createGain();
      squealGain.gain.value = 0;
      squealSource.connect(squealFilter).connect(squealGain).connect(master);
      squealSource.start();
    } catch {
      context = null;
    }
  }

  /** Simulated gearbox: pitch climbs through each gear and drops on upshift. */
  function getEngineFrequency(speed, throttle) {
    let gearFloor = 0;
    for (const gearTop of GEAR_TOP_SPEEDS) {
      if (speed <= gearTop) {
        const ratio = (speed - gearFloor) / (gearTop - gearFloor);
        return IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * (0.25 + 0.75 * ratio) * (0.85 + 0.15 * throttle);
      }
      gearFloor = gearTop;
    }
    return REDLINE_HZ;
  }

  /** @param {number} durationSec @param {number} filterHz @param {number} volume */
  function playNoise(durationSec, filterHz, volume) {
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + durationSec + 0.05);
  }

  /** @param {number} fromHz @param {number} toHz @param {number} durationSec @param {number} volume */
  function playTone(fromHz, toHz, durationSec, volume) {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, now + durationSec);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + durationSec + 0.05);
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
      return muted;
    },
    update(car, events) {
      if (!context || context.state !== "running" || muted) return;
      try {
        const now = context.currentTime;
        const speed = car ? Math.hypot(car.vx, car.vz) : 0;
        const frequency = car ? getEngineFrequency(speed, car.throttle) : IDLE_HZ;
        engineLow.frequency.setTargetAtTime(frequency, now, RAMP_SEC);
        engineHigh.frequency.setTargetAtTime(frequency * 2.01, now, RAMP_SEC);
        engineGain.gain.setTargetAtTime(car ? 0.16 + 0.22 * car.throttle + (car.boostSec > 0 ? 0.1 : 0) : 0, now, RAMP_SEC);
        const slide = car && speed > 6 ? Math.min(1, Math.max(0, Math.abs(car.driftAngle) - 0.12) * 2.2) : 0;
        const skid = car && car.handbrake && speed > 4 ? 0.6 : 0;
        squealGain.gain.setTargetAtTime(Math.max(slide, skid) * 0.32, now, RAMP_SEC);
        squealFilter.frequency.setTargetAtTime(1100 + speed * 14, now, RAMP_SEC);
        for (const event of events) {
          if (event.carId !== car?.id && event.kind !== "contact") continue;
          if (event.kind === "boost") playNoise(0.5 + event.value * 0.15, 2600, 0.35);
          else if (event.kind === "wallHit") playNoise(0.25, 500, Math.min(0.6, event.value / 12));
          else if (event.kind === "contact") playNoise(0.15, 800, 0.25);
          else if (event.kind === "lap") playTone(660, 990, 0.35, 0.25);
          else if (event.kind === "finish") playTone(523, 1046, 0.7, 0.3);
          else if (event.kind === "launch" && event.value === 3) playTone(880, 1760, 0.25, 0.25);
        }
      } catch {
        // Audio is decoration; a failed node must never interrupt the frame.
      }
    },
    dispose() {
      context?.close().catch(() => {});
      context = null;
    },
  };
}
