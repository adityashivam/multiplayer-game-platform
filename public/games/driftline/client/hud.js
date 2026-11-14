import { DRIFTLINE_SKILL_SETTINGS } from "../shared/config.js";

/** @typedef {import("../shared/race.js").DriftlineRace} DriftlineRace */
/** @typedef {import("../shared/track.js").DriftlineTrack} DriftlineTrack */
/** @typedef {import("./snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */
/** @typedef {import("./raceEvents.js").DriftlineRaceEvent} DriftlineRaceEvent */

const HUD_REFRESH_MS = 100;
const ANNOUNCEMENT_MS = 1500;
const MINIMAP_SIZE = 150;
const HUD_STYLESHEET_URL = "/games/driftline/hud.css";
const ORDINALS = Object.freeze(["TH", "ST", "ND", "RD"]);
const LAUNCH_TEXT = Object.freeze({ 3: "PERFECT START!", 2: "GOOD START", 1: "BOGGED DOWN" });

/** @param {number} seconds */
function formatDriftlineTime(seconds) {
  if (!(seconds > 0)) return "--:--.--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** @param {number} position */
function formatDriftlinePosition(position) {
  const teen = position % 100 >= 11 && position % 100 <= 13;
  return `${position}${teen ? "TH" : ORDINALS[position % 10] ?? "TH"}`;
}

/**
 * Race HUD: position, lap, timing, speed, drift charge, boost, draft, and a
 * minimap. Text refreshes ten times a second; the speedometer and drift
 * meter use transforms only. Platform dialogs keep their own chrome.
 * @param {{host:HTMLElement,practice:boolean,track:Readonly<DriftlineTrack>,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createDriftlineHud({ host, practice, track, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "dl-hud";
  hud.setAttribute("aria-label", "Driftline race status");
  hud.innerHTML = `
    <div class="dl-position"><strong data-dl="position">1ST</strong><span data-dl="carCount">/ 6</span></div>
    <div class="dl-timing">
      <div><small>LAP</small><strong data-dl="lap">1 / 3</strong></div>
      <div><small>TIME</small><strong data-dl="time">0:00.00</strong></div>
      <div><small>BEST</small><strong data-dl="best">--:--.--</strong></div>
    </div>
    <canvas class="dl-minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}" aria-hidden="true"></canvas>
    <button type="button" class="dl-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="dl-announcement" aria-hidden="true"></div>
    <div class="dl-gauges">
      <div class="dl-speed"><strong data-dl="speed">0</strong><small>KM/H</small></div>
      <div class="dl-drift">
        <div class="dl-drift-label"><span data-dl="driftLabel">DRIFT TO CHARGE</span><span data-dl="draft"></span></div>
        <div class="dl-drift-track"><i data-dl="charge"></i><b style="left:${(DRIFTLINE_SKILL_SETTINGS.boostTierCharge[0] / DRIFTLINE_SKILL_SETTINGS.boostTierCharge[2]) * 100}%"></b><b style="left:${(DRIFTLINE_SKILL_SETTINGS.boostTierCharge[1] / DRIFTLINE_SKILL_SETTINGS.boostTierCharge[2]) * 100}%"></b></div>
      </div>
    </div>
    <div class="dl-hints"><span><kbd>W / ↑</kbd> Throttle</span><span><kbd>S / ↓</kbd> Brake</span><span><kbd>A D / ← →</kbd> Steer</span><span><kbd>SPACE</kbd> Handbrake</span><span><kbd>R</kbd> Reset car</span></div>
    <div class="dl-intro">
      <div>
        <p class="dl-eyebrow">${practice ? "PRACTICE · 5 BOTS" : "SUNSET CLIFFS · 6 CARS"}</p>
        <h1>DRIFT THE LINE.<br><em>OWN THE CLIFFS.</em></h1>
        <p>Flick the handbrake into a bend, hold the slide and release for boost.<br>Rev late in the countdown for a perfect start. Three laps.</p>
        <button type="button" class="dl-enter">${practice ? "Start practice" : "Enter the race"} <span aria-hidden="true">↗</span></button>
        <small class="dl-credit">Car model: “Car Concept” © 2024 Darmstadt Graphics Group, by Eric Chadwick, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, modified.</small>
      </div>
    </div>
    <div class="dl-error" hidden role="alert"><strong>Couldn’t join the race</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const field = (name) => hud.querySelector(`[data-dl="${name}"]`);
  const fields = {
    position: field("position"), carCount: field("carCount"), lap: field("lap"), time: field("time"), best: field("best"),
    speed: field("speed"), driftLabel: field("driftLabel"), draft: field("draft"), charge: field("charge"),
  };
  const intro = hud.querySelector(".dl-intro");
  const announcement = hud.querySelector(".dl-announcement");
  const error = hud.querySelector(".dl-error");
  const enterButton = hud.querySelector(".dl-enter");
  const soundButton = hud.querySelector(".dl-sound");
  const retryButton = error.querySelector("button");
  const minimap = /** @type {HTMLCanvasElement} */ (hud.querySelector(".dl-minimap"));
  const minimapContext = minimap.getContext("2d");
  const minimapBackground = document.createElement("canvas");
  minimapBackground.width = MINIMAP_SIZE;
  minimapBackground.height = MINIMAP_SIZE;
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let announcementUntilMs = 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < track.sampleCount; index += 1) {
    minX = Math.min(minX, track.x[index]);
    maxX = Math.max(maxX, track.x[index]);
    minZ = Math.min(minZ, track.z[index]);
    maxZ = Math.max(maxZ, track.z[index]);
  }
  const mapScale = (MINIMAP_SIZE - 20) / Math.max(maxX - minX, maxZ - minZ);
  const mapX = (x) => 10 + (x - minX) * mapScale + ((MINIMAP_SIZE - 20) - (maxX - minX) * mapScale) / 2;
  const mapY = (z) => 10 + (z - minZ) * mapScale + ((MINIMAP_SIZE - 20) - (maxZ - minZ) * mapScale) / 2;
  const background = minimapBackground.getContext("2d");
  background.lineJoin = "round";
  background.strokeStyle = "rgba(255,255,255,0.18)";
  background.lineWidth = 7;
  background.beginPath();
  for (let index = 0; index <= track.sampleCount; index += 1) {
    const sample = index % track.sampleCount;
    if (index === 0) background.moveTo(mapX(track.x[sample]), mapY(track.z[sample]));
    else background.lineTo(mapX(track.x[sample]), mapY(track.z[sample]));
  }
  background.stroke();
  background.strokeStyle = "rgba(255,255,255,0.75)";
  background.lineWidth = 2;
  background.stroke();
  background.fillStyle = "#ffffff";
  background.fillRect(mapX(track.x[0]) - 3, mapY(track.z[0]) - 3, 6, 6);

  const toggleSound = () => {
    const nowMuted = onMute();
    soundButton.textContent = nowMuted ? "Sound off" : "Sound on";
    soundButton.setAttribute("aria-label", nowMuted ? "Unmute game sound" : "Mute game sound");
    soundButton.setAttribute("aria-pressed", String(nowMuted));
  };
  const retryRoom = () => retryJoin?.();
  enterButton.addEventListener("click", onEnter);
  soundButton.addEventListener("click", toggleSound);
  retryButton.addEventListener("click", retryRoom);

  /** @param {string} text @param {string} tone @param {number} nowMs */
  function announce(text, tone, nowMs) {
    announcement.textContent = text;
    announcement.dataset.tone = tone;
    announcement.classList.remove("dl-pop");
    void announcement.offsetWidth;
    announcement.classList.add("dl-pop");
    announcementUntilMs = nowMs + ANNOUNCEMENT_MS;
  }

  /**
   * @param {readonly DriftlineRaceEvent[]} events
   * @param {string} playerId
   * @param {readonly DriftlinePresentedCar[]} cars
   * @param {Readonly<DriftlineRace>} snapshot
   * @param {number} nowMs
   */
  function announceEvents(events, playerId, cars, snapshot, nowMs) {
    for (const event of events) {
      if (event.carId !== playerId) continue;
      if (event.kind === "launch") announce(LAUNCH_TEXT[event.value] ?? "", event.value === 1 ? "bad" : "good", nowMs);
      else if (event.kind === "boost") announce(`BOOST ${"I".repeat(event.value)}`, "boost", nowMs);
      else if (event.kind === "lap") {
        const car = cars.find((candidate) => candidate.id === playerId);
        announce(event.value === snapshot.laps - 1 ? "FINAL LAP" : `LAP ${formatDriftlineTime(car?.lastLapSec ?? 0)}`, "good", nowMs);
      } else if (event.kind === "finish") announce(`FINISHED ${formatDriftlinePosition(event.value)}`, event.value === 1 ? "good" : "plain", nowMs);
    }
  }

  return {
    clearError() {
      error.hidden = true;
      retryJoin = null;
    },
    showError(message, retry) {
      error.querySelector("p").textContent = message;
      retryJoin = retry;
      error.hidden = false;
    },
    /**
     * @param {{snapshot:Readonly<DriftlineRace>|null,playerId:string,cars:readonly DriftlinePresentedCar[],events:readonly DriftlineRaceEvent[],engaged:boolean,nowMs:number,touchActive:boolean}} frame
     */
    update({ snapshot, playerId, cars, events, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("dl-touch-active", touchActive);
      const car = cars.find((candidate) => candidate.id === playerId);
      if (snapshot) announceEvents(events, playerId, cars, snapshot, nowMs);
      if (nowMs > announcementUntilMs && announcement.textContent) announcement.textContent = "";
      if (car) {
        const charge = Math.min(1, car.driftCharge / DRIFTLINE_SKILL_SETTINGS.boostTierCharge[2]);
        fields.charge.style.transform = `scaleX(${charge})`;
        hud.classList.toggle("dl-boosting", car.boostSec > 0);
        hud.classList.toggle("dl-drifting", car.drifting);
      }
      if (nowMs - previousUpdateMs < HUD_REFRESH_MS || !snapshot || !car) return;
      previousUpdateMs = nowMs;

      fields.position.textContent = formatDriftlinePosition(car.position);
      fields.carCount.textContent = `/ ${cars.length}`;
      fields.lap.textContent = car.finished ? "DONE" : `${Math.min(snapshot.laps, car.lap + 1)} / ${snapshot.laps}`;
      fields.time.textContent = formatDriftlineTime(car.finished ? car.finishTimeSec : snapshot.raceTimeSec);
      fields.best.textContent = formatDriftlineTime(car.bestLapSec);
      fields.speed.textContent = String(Math.round(Math.hypot(car.vx, car.vz) * 3.6));
      let tier = 0;
      DRIFTLINE_SKILL_SETTINGS.boostTierCharge.forEach((threshold, index) => { if (car.driftCharge >= threshold) tier = index + 1; });
      fields.driftLabel.textContent = car.spinSec > 0 ? "SPUN OUT" : car.drifting ? (tier > 0 ? `BOOST ${"I".repeat(tier)} READY` : "DRIFTING…") : car.boostSec > 0 ? "BOOSTING" : "DRIFT TO CHARGE";
      fields.draft.textContent = car.slipstream > 0.5 ? "SLIPSTREAM" : "";

      minimapContext.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      minimapContext.drawImage(minimapBackground, 0, 0);
      for (const other of cars) {
        const local = other.id === playerId;
        minimapContext.fillStyle = local ? "#ffffff" : other.isBot ? "rgba(255,180,120,0.9)" : "#2ec5ff";
        minimapContext.beginPath();
        minimapContext.arc(mapX(other.x), mapY(other.z), local ? 4.5 : 3.2, 0, Math.PI * 2);
        minimapContext.fill();
      }
    },
    dispose() {
      enterButton.removeEventListener("click", onEnter);
      soundButton.removeEventListener("click", toggleSound);
      retryButton.removeEventListener("click", retryRoom);
      hud.remove();
      stylesheet.remove();
    },
  };
}
