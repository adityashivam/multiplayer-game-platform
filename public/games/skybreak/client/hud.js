import { SKYBREAK_ARENA, SKYBREAK_COMBAT_SETTINGS, SKYBREAK_TEAM_COLORS, SKYBREAK_TIME_TRIAL_SETTINGS } from "../shared/config.js";
import { SKYBREAK_COURSE_GATES } from "../shared/terrain.js";

/** @typedef {import("../shared/match.js").SkybreakMatch} SkybreakMatch */
/** @typedef {import("./snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */
/** @typedef {import("./matchEvents.js").SkybreakEvent} SkybreakEvent */
/** @typedef {(x:number,y:number,z:number)=>{x:number,y:number,visible:boolean}} SkybreakProjector Returns a reused object in CSS pixels. */

const TEXT_REFRESH_MS = 100;
const RADAR_SIZE = 150;
const RADAR_RANGE_M = 2200;
const ANNOUNCEMENT_MS = 1600;
const MAX_MARKERS = 8;
const STYLESHEET_URL = "/games/skybreak/hud.css";
const MEDALS = Object.freeze([["platinum", "PLATINUM"], ["gold", "GOLD"], ["silver", "SILVER"], ["bronze", "BRONZE"]]);
const CAUSE_TEXT = Object.freeze({ cannon: "cannon", missile: "missile", terrain: "terrain", boundary: "left the arena" });

/** @param {number} seconds */
function formatSkybreakTime(seconds) {
  if (!(seconds > 0)) return "--.--";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${rest.toFixed(2).padStart(5, "0")}` : rest.toFixed(2);
}

/** @param {number} seconds */
export function getSkybreakMedal(seconds) {
  if (!(seconds > 0)) return null;
  for (const [key, label] of MEDALS) if (seconds <= SKYBREAK_TIME_TRIAL_SETTINGS.medals[key]) return { key, label };
  return null;
}

/** @param {string} id @param {readonly SkybreakPresentedJet[]} jets */
function nameSkybreakPilot(id, jets) {
  const jet = jets.find((candidate) => candidate.id === id);
  if (!jet) return id;
  return jet.isBot ? `Bot ${jet.slotIndex + 1}` : id.toUpperCase();
}

/**
 * Cockpit HUD drawn in the DOM above the canvas. Markers use transforms at
 * render cadence; text and the radar refresh ten times a second.
 * @param {{host:HTMLElement,mode:"dogfight"|"timeTrial",practice:boolean,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createSkybreakHud({ host, mode, practice, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = `sb-hud sb-${mode}`;
  hud.setAttribute("aria-label", "Skybreak flight status");
  const timeTrial = mode === "timeTrial";
  hud.innerHTML = `
    <div class="sb-markers" aria-hidden="true"></div>
    <div class="sb-reticle" aria-hidden="true"><i></i></div>
    <div class="sb-lead" aria-hidden="true" hidden></div>
    <div class="sb-vignette" aria-hidden="true"></div>
    <header class="sb-top">
      <div class="sb-score"><small data-sb="scoreLabel">${timeTrial ? "RUN" : "KILLS"}</small><strong data-sb="score">0</strong></div>
      <div class="sb-clock"><small data-sb="clockLabel">${timeTrial ? "GATE" : "TIME"}</small><strong data-sb="clock">4:00</strong></div>
      <div class="sb-score"><small data-sb="rankLabel">${timeTrial ? "BEST" : "RANK"}</small><strong data-sb="rank">-</strong></div>
    </header>
    <ol class="sb-feed" aria-label="Recent kills"></ol>
    <canvas class="sb-radar" width="${RADAR_SIZE}" height="${RADAR_SIZE}" aria-hidden="true"></canvas>
    <button type="button" class="sb-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="sb-warning" data-sb="warning" role="status"></div>
    <div class="sb-announcement" aria-hidden="true"></div>
    <div class="sb-flight">
      <div><small>SPD</small><strong data-sb="speed">0</strong><em>km/h</em></div>
      <div><small>ALT</small><strong data-sb="altitude">0</strong><em>m</em></div>
      <div><small>G</small><strong data-sb="g">1.0</strong></div>
      <span class="sb-bar sb-fuel"><i data-sb="fuel"></i></span>
    </div>
    <div class="sb-systems">
      <div class="sb-health"><small>HULL</small><span class="sb-bar"><i data-sb="health"></i></span></div>
      <div class="sb-weapons"><span data-sb="missiles"></span><span data-sb="flares"></span></div>
      <div class="sb-heat"><small data-sb="heatLabel">GUN</small><span class="sb-bar"><i data-sb="heat"></i></span></div>
    </div>
    <div class="sb-trial" ${timeTrial ? "" : "hidden"}>
      <div data-sb="split" class="sb-split"></div>
      <div class="sb-medals">${MEDALS.map(([key, label]) => `<span data-medal="${key}">${label[0]}${label.slice(1).toLowerCase()} ${SKYBREAK_TIME_TRIAL_SETTINGS.medals[key].toFixed(1)}s</span>`).join("")}</div>
    </div>
    <div class="sb-hints"><span><kbd>W S</kbd> Pitch</span><span><kbd>A D</kbd> Roll</span><span><kbd>Q E</kbd> Rudder</span><span><kbd>SHIFT</kbd> Boost</span><span><kbd>X</kbd> Airbrake</span>${timeTrial ? "<span><kbd>R</kbd> Restart run</span>" : "<span><kbd>SPACE</kbd> Cannon</span><span><kbd>F</kbd> Missile</span><span><kbd>C</kbd> Flares</span>"}</div>
    <div class="sb-dead" hidden><strong data-sb="deadTitle">SHOT DOWN</strong><span data-sb="deadDetail"></span></div>
    <div class="sb-intro">
      <div>
        <p class="sb-eyebrow">${timeTrial ? "TIME TRIAL · CANYON RUN" : practice ? "PRACTICE · 5 BOT PILOTS" : "DOGFIGHT · 6 JETS"}</p>
        <h1>${timeTrial ? "THREAD THE<br><em>CANYON.</em>" : "OWN THE<br><em>SKY.</em>"}</h1>
        <p>${timeTrial ? "Twelve gates, two ridge hops. Boost on the straights, cut the turns, beat your ghost.<br>Press R any time for an instant restart." : "Keep your speed near the corner, lead your shots, and break missile locks with flares.<br>First to ten kills wins."}</p>
        <button type="button" class="sb-enter">${timeTrial ? "Start the run" : "Take off"} <span aria-hidden="true">↗</span></button>
      </div>
    </div>
    <div class="sb-error" hidden role="alert"><strong>Couldn’t join</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const field = (name) => hud.querySelector(`[data-sb="${name}"]`);
  const fields = Object.fromEntries(["score", "clock", "rank", "warning", "speed", "altitude", "g", "fuel", "health", "missiles", "flares", "heat", "heatLabel", "split", "deadTitle", "deadDetail"].map((name) => [name, field(name)]));
  const markerLayer = hud.querySelector(".sb-markers");
  const reticle = hud.querySelector(".sb-reticle");
  const lead = /** @type {HTMLElement} */ (hud.querySelector(".sb-lead"));
  const vignette = /** @type {HTMLElement} */ (hud.querySelector(".sb-vignette"));
  const feed = hud.querySelector(".sb-feed");
  const announcement = hud.querySelector(".sb-announcement");
  const dead = /** @type {HTMLElement} */ (hud.querySelector(".sb-dead"));
  const intro = /** @type {HTMLElement} */ (hud.querySelector(".sb-intro"));
  const error = /** @type {HTMLElement} */ (hud.querySelector(".sb-error"));
  const enterButton = hud.querySelector(".sb-enter");
  const soundButton = hud.querySelector(".sb-sound");
  const retryButton = error.querySelector("button");
  const radar = /** @type {HTMLCanvasElement} */ (hud.querySelector(".sb-radar"));
  const radarContext = radar.getContext("2d");
  const markers = Array.from({ length: MAX_MARKERS }, () => {
    const marker = document.createElement("div");
    marker.className = "sb-marker";
    marker.innerHTML = "<i></i><span></span>";
    marker.hidden = true;
    markerLayer.append(marker);
    return { element: marker, label: marker.querySelector("span"), text: "" };
  });
  let retryJoin = null;
  let previousTextMs = -Infinity;
  let announcementUntilMs = 0;
  let feedSerial = 0;
  const gateSplits = [];

  const toggleSound = () => {
    const nowMuted = onMute();
    soundButton.textContent = nowMuted ? "Sound off" : "Sound on";
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
    announcement.classList.remove("sb-pop");
    void announcement.offsetWidth;
    announcement.classList.add("sb-pop");
    announcementUntilMs = nowMs + ANNOUNCEMENT_MS;
  }

  /** @param {readonly SkybreakEvent[]} events @param {string} playerId @param {readonly SkybreakPresentedJet[]} jets @param {number} nowMs @param {{bestSec:number,newBest:boolean}} trial */
  function handleEvents(events, playerId, jets, nowMs, trial) {
    for (const event of events) {
      if (event.kind === "kill") {
        if (event.otherId === playerId) announce(event.jetId === playerId ? "" : `SPLASH ONE · ${nameSkybreakPilot(event.jetId, jets)}`, "good", nowMs);
        if (event.value > feedSerial) {
          feedSerial = event.value;
          const item = document.createElement("li");
          const killer = event.otherId ? nameSkybreakPilot(event.otherId, jets) : null;
          item.textContent = killer ? `${killer} ▸ ${nameSkybreakPilot(event.jetId, jets)} (${CAUSE_TEXT[event.cause] ?? event.cause})` : `${nameSkybreakPilot(event.jetId, jets)} · ${CAUSE_TEXT[event.cause] ?? event.cause}`;
          if (event.otherId === playerId || event.jetId === playerId) item.className = event.otherId === playerId ? "sb-mine" : "sb-lost";
          feed.append(item);
          while (feed.children.length > 4) feed.firstElementChild.remove();
        }
      } else if (event.jetId === playerId && event.kind === "gate") {
        const jet = jets.find((candidate) => candidate.id === playerId);
        if (jet) gateSplits[event.value] = jet.runTimeSec;
      } else if (event.jetId === playerId && event.kind === "runFinish") {
        const medal = getSkybreakMedal(event.value);
        announce(`${formatSkybreakTime(event.value)}s${medal ? ` · ${medal.label}` : ""}${trial.newBest ? " · NEW BEST" : ""}`, medal ? medal.key : "plain", nowMs);
      }
    }
  }

  /** @param {SkybreakPresentedJet} jet @param {readonly SkybreakPresentedJet[]} jets */
  function drawRadar(jet, jets) {
    const center = RADAR_SIZE / 2;
    const scale = (RADAR_SIZE / 2 - 8) / RADAR_RANGE_M;
    const heading = Math.atan2(jet.forwardX, jet.forwardZ);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    radarContext.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE);
    radarContext.strokeStyle = "rgba(160,255,220,0.25)";
    radarContext.lineWidth = 1;
    for (const radius of [0.33, 0.66, 1]) {
      radarContext.beginPath();
      radarContext.arc(center, center, (RADAR_SIZE / 2 - 8) * radius, 0, Math.PI * 2);
      radarContext.stroke();
    }
    /** Heading-up: forward is up on the radar. */
    const plot = (x, z) => {
      const dx = x - jet.x;
      const dz = z - jet.z;
      const forward = dx * sin + dz * cos;
      const right = -(dx * cos - dz * sin);
      return [center + right * scale, center - forward * scale];
    };
    radarContext.strokeStyle = "rgba(255,120,90,0.5)";
    radarContext.beginPath();
    for (let step = 0; step <= 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      const [px, py] = plot(Math.sin(angle) * SKYBREAK_ARENA.radiusM, Math.cos(angle) * SKYBREAK_ARENA.radiusM);
      if (step === 0) radarContext.moveTo(px, py);
      else radarContext.lineTo(px, py);
    }
    radarContext.stroke();
    if (timeTrial) {
      SKYBREAK_COURSE_GATES.forEach((gate, index) => {
        if (index < jet.gateIndex) return;
        const [px, py] = plot(gate.x, gate.z);
        radarContext.fillStyle = index === jet.gateIndex ? "#ffd23f" : "rgba(255,210,63,0.4)";
        radarContext.fillRect(px - 2.5, py - 2.5, 5, 5);
      });
    }
    for (const other of jets) {
      if (other.id === jet.id || !other.alive) continue;
      const [px, py] = plot(other.x, other.z);
      radarContext.fillStyle = SKYBREAK_TEAM_COLORS[other.colorIndex % SKYBREAK_TEAM_COLORS.length];
      radarContext.beginPath();
      radarContext.arc(Math.max(4, Math.min(RADAR_SIZE - 4, px)), Math.max(4, Math.min(RADAR_SIZE - 4, py)), 3.5, 0, Math.PI * 2);
      radarContext.fill();
    }
    radarContext.fillStyle = "#ffffff";
    radarContext.beginPath();
    radarContext.moveTo(center, center - 6);
    radarContext.lineTo(center - 4, center + 4);
    radarContext.lineTo(center + 4, center + 4);
    radarContext.fill();
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
     * @param {object} frame
     * @param {Readonly<SkybreakMatch>|null} frame.snapshot
     * @param {string} frame.playerId
     * @param {readonly SkybreakPresentedJet[]} frame.jets
     * @param {readonly SkybreakEvent[]} frame.events
     * @param {SkybreakProjector} frame.project
     * @param {"none"|"lock"|"incoming"} frame.threat
     * @param {boolean} frame.engaged
     * @param {boolean} frame.touchActive
     * @param {number} frame.nowMs
     * @param {{bestSec:number,newBest:boolean}} frame.trial
     */
    update({ snapshot, playerId, jets, events, project, threat, engaged, touchActive, nowMs, trial }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("sb-touch-active", touchActive);
      const jet = jets.find((candidate) => candidate.id === playerId);
      if (snapshot) handleEvents(events, playerId, jets, nowMs, trial);
      if (nowMs > announcementUntilMs && announcement.textContent) announcement.textContent = "";
      if (!jet) return;

      let markerIndex = 0;
      lead.hidden = true;
      if (!timeTrial && jet.alive) {
        for (const other of jets) {
          if (other.id === playerId || !other.alive || markerIndex >= MAX_MARKERS) continue;
          const screen = project(other.x, other.y, other.z);
          const marker = markers[markerIndex];
          markerIndex += 1;
          marker.element.hidden = !screen.visible;
          if (!screen.visible) continue;
          const distance = Math.hypot(other.x - jet.x, other.y - jet.y, other.z - jet.z);
          const locked = jet.lockTargetId === other.id;
          marker.element.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
          marker.element.style.setProperty("--sb-marker-color", SKYBREAK_TEAM_COLORS[other.colorIndex % SKYBREAK_TEAM_COLORS.length]);
          marker.element.classList.toggle("sb-locking", locked && jet.lockProgress < 1);
          marker.element.classList.toggle("sb-locked", locked && jet.lockProgress >= 1);
          marker.element.style.setProperty("--sb-lock", String(locked ? jet.lockProgress : 0));
          const text = `${nameSkybreakPilot(other.id, jets)} ${distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`}`;
          if (text !== marker.text) {
            marker.text = text;
            marker.label.textContent = text;
          }
          if (locked || (!jet.lockTargetId && markerIndex === 1)) {
            const flightSec = distance / (SKYBREAK_COMBAT_SETTINGS.bulletSpeed + jet.speed);
            const leadScreen = project(other.x + other.forwardX * other.speed * flightSec, other.y + other.forwardY * other.speed * flightSec, other.z + other.forwardZ * other.speed * flightSec);
            if (leadScreen.visible && distance < 1300) {
              lead.hidden = false;
              lead.style.transform = `translate(${leadScreen.x}px, ${leadScreen.y}px)`;
            }
          }
        }
      } else if (timeTrial && jet.alive) {
        const gate = SKYBREAK_COURSE_GATES[jet.gateIndex];
        if (gate) {
          const screen = project(gate.x, gate.y, gate.z);
          const marker = markers[0];
          markerIndex = 1;
          marker.element.hidden = !screen.visible;
          marker.element.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
          marker.element.style.setProperty("--sb-marker-color", "#ffd23f");
          const text = `GATE ${jet.gateIndex + 1} · ${Math.round(Math.hypot(gate.x - jet.x, gate.y - jet.y, gate.z - jet.z))}m`;
          if (text !== marker.text) {
            marker.text = text;
            marker.label.textContent = text;
          }
        }
      }
      for (let index = markerIndex; index < MAX_MARKERS; index += 1) markers[index].element.hidden = true;
      const center = project(jet.x + jet.forwardX * 400, jet.y + jet.forwardY * 400, jet.z + jet.forwardZ * 400);
      reticle.style.transform = `translate(${center.x}px, ${center.y}px)`;
      reticle.hidden = !jet.alive || !center.visible;
      vignette.style.opacity = String(Math.min(0.92, jet.blackoutSec > 0 ? 0.85 : Math.max(0, (jet.strain - 0.35) * 1.2)));
      hud.classList.toggle("sb-hit-flash", events.some((event) => event.kind === "hit" && event.jetId === playerId));

      if (nowMs - previousTextMs < TEXT_REFRESH_MS || !snapshot) return;
      previousTextMs = nowMs;
      if (timeTrial) {
        fields.score.textContent = jet.runActive ? formatSkybreakTime(jet.runTimeSec) : jet.lastRunSec > 0 ? formatSkybreakTime(jet.lastRunSec) : "0.00";
        fields.clock.textContent = `${Math.min(jet.gateIndex + (jet.runActive ? 1 : 0), SKYBREAK_COURSE_GATES.length)} / ${SKYBREAK_COURSE_GATES.length}`;
        const best = trial.bestSec > 0 ? trial.bestSec : jet.bestRunSec;
        fields.rank.textContent = best > 0 ? formatSkybreakTime(best) : "-";
        const medal = getSkybreakMedal(best);
        hud.querySelectorAll("[data-medal]").forEach((element) => element.classList.toggle("sb-earned", Boolean(medal) && SKYBREAK_TIME_TRIAL_SETTINGS.medals[element.dataset.medal] >= best));
        const lastSplit = gateSplits[jet.gateIndex];
        fields.split.textContent = jet.runActive && jet.gateIndex > 0 && lastSplit ? `Gate ${jet.gateIndex} · ${formatSkybreakTime(lastSplit)}` : jet.runActive ? "Fly through the glowing gates" : "Press R to fly again";
      } else {
        const ranked = [...jets].sort((jetA, jetB) => jetB.kills - jetA.kills || jetA.deaths - jetB.deaths);
        fields.score.textContent = `${jet.kills}`;
        const remaining = Math.max(0, Math.ceil(snapshot.durationSec - snapshot.matchTimeSec));
        fields.clock.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
        fields.rank.textContent = `${ranked.findIndex((candidate) => candidate.id === playerId) + 1}/${jets.length}`;
      }
      fields.speed.textContent = String(Math.round(jet.speed * 3.6));
      fields.altitude.textContent = String(Math.round(jet.y));
      fields.g.textContent = jet.gForce.toFixed(1);
      fields.fuel.style.transform = `scaleX(${jet.fuel})`;
      fields.health.style.transform = `scaleX(${jet.health / SKYBREAK_COMBAT_SETTINGS.maxHealth})`;
      fields.heat.style.transform = `scaleX(${jet.heat})`;
      fields.heatLabel.textContent = jet.overheatSec > 0 ? "OVERHEAT" : "GUN";
      fields.missiles.textContent = `MSL ${"▮".repeat(jet.missiles)}${"▯".repeat(SKYBREAK_COMBAT_SETTINGS.maxMissiles - jet.missiles)}`;
      fields.flares.textContent = `FLR ${"●".repeat(jet.flares)}${"○".repeat(SKYBREAK_COMBAT_SETTINGS.maxFlares - jet.flares)}`;
      const outside = !timeTrial && (Math.hypot(jet.x, jet.z) > SKYBREAK_ARENA.radiusM || jet.y > SKYBREAK_ARENA.ceilingM);
      fields.warning.textContent = !jet.alive ? "" : threat === "incoming" ? "MISSILE INCOMING · FLARES / BREAK" : threat === "lock" ? "MISSILE LOCK" : outside ? "RETURN TO THE COMBAT AREA" : jet.blackoutSec > 0 ? "BLACKOUT" : jet.shieldSec > 0 ? "SPAWN SHIELD" : "";
      hud.dataset.threat = threat;
      dead.hidden = jet.alive;
      if (!jet.alive) {
        fields.deadTitle.textContent = timeTrial ? "CRASHED" : jet.lastDeathCause === "terrain" ? "CRASHED" : "SHOT DOWN";
        fields.deadDetail.textContent = timeTrial ? "Restarting the run…" : `${jet.lastKillerId ? `by ${nameSkybreakPilot(jet.lastKillerId, jets)} · ` : ""}respawning in ${Math.max(0, jet.respawnSec).toFixed(0)}`;
      }
      drawRadar(jet, jets);
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
