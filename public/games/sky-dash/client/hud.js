import { SKY_DASH_ACTION_SETTINGS, SKY_DASH_FINISH_Z, SKY_DASH_RUNNER_COLORS } from "../shared/config.js";
import { SKY_DASH_CHECKPOINTS } from "../shared/course.js";

const HUD_REFRESH_MS = 100;
const HUD_STYLESHEET_URL = "/games/sky-dash/hud.css";

/**
 * Race-only presentation. Platform dialogs, ping and fullscreen retain their
 * shared chrome. The host and its canvas keep their existing geometry/ownership.
 * @param {{host:HTMLElement,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createSkyDashHud({ host, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "sd-hud";
  hud.dataset.skyDashHud = "true";
  hud.setAttribute("aria-label", "Sky Dash race status");
  hud.innerHTML = `
    <header class="sd-race-header">
      <div class="sd-brand"><span class="sd-brand-symbol" aria-hidden="true">↗</span><span>SKY DASH<small>CLOUD NINE CIRCUIT</small></span></div>
      <div class="sd-clock"><small>TIME LEFT</small><strong data-sd="clock">1:30</strong></div>
      <button type="button" class="sd-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    </header>
    <div class="sd-race-position"><strong data-sd="position">—</strong><span data-sd="fieldSize">/ 5</span><small>POSITION</small></div>
    <ol class="sd-standings" aria-label="Race standings"></ol>
    <div class="sd-countdown" data-sd="countdown"></div>
    <div class="sd-toast" role="status"></div>
    <div class="sd-intro">
      <div class="sd-intro-copy"><p class="sd-eyebrow">A LITTLE CHAOS. A LOT OF AIR.</p><h1>SKY<br><span>DASH.</span></h1><p>Jump the sweepers. Ride the clouds.<br>Try to stick the landing.</p><button type="button" class="sd-enter">Let’s race <span aria-hidden="true">↗</span></button><small>2 players + 3 bots · 90 seconds</small></div>
      <p class="sd-intro-hint">Move with WASD or the left stick<br>Space / A jump · Shift / B dash · E / X dive</p>
    </div>
    <footer class="sd-race-footer">
      <div class="sd-course-status"><small data-sd="checkpoint">LAUNCH PAD</small><strong data-sd="status">Getting the grid ready…</strong><div class="sd-progress-track"><i data-sd="progress"></i></div></div>
      <div class="sd-abilities" aria-label="Ability cooldowns"><span><kbd>A</kbd> Jump</span><span data-sd="dash"><kbd>B</kbd> Dash <i></i></span><span data-sd="dive"><kbd>X</kbd> Dive <i></i></span></div>
    </footer>
    <div class="sd-error" hidden role="alert"><strong>Couldn’t join the race</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const fields = {
    clock: hud.querySelector('[data-sd="clock"]'),
    position: hud.querySelector('[data-sd="position"]'),
    fieldSize: hud.querySelector('[data-sd="fieldSize"]'),
    countdown: hud.querySelector('[data-sd="countdown"]'),
    checkpoint: hud.querySelector('[data-sd="checkpoint"]'),
    status: hud.querySelector('[data-sd="status"]'),
    progress: hud.querySelector('[data-sd="progress"]'),
    dash: hud.querySelector('[data-sd="dash"]'),
    dive: hud.querySelector('[data-sd="dive"]'),
  };
  const intro = hud.querySelector(".sd-intro");
  const standings = hud.querySelector(".sd-standings");
  const toast = hud.querySelector(".sd-toast");
  const error = hud.querySelector(".sd-error");
  const enterButton = hud.querySelector(".sd-enter");
  const soundButton = hud.querySelector(".sd-sound");
  const retryButton = error.querySelector("button");
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let previousCheckpoint = 0;
  let toastUntilMs = 0;
  let roundId = null;
  const rows = new Map();
  enterButton.addEventListener("click", onEnter);
  soundButton.addEventListener("click", () => {
    const muted = onMute();
    soundButton.textContent = muted ? "Sound off" : "Sound on";
    soundButton.setAttribute("aria-label", muted ? "Unmute game sound" : "Mute game sound");
    soundButton.setAttribute("aria-pressed", String(muted));
  });
  retryButton.addEventListener("click", () => retryJoin?.());

  function showToast(message, nowMs) {
    toast.textContent = message;
    toastUntilMs = nowMs + 1800;
  }

  return {
    clearError() { error.hidden = true; retryJoin = null; },
    showError(message, retry) {
      error.querySelector("p").textContent = message;
      retryJoin = retry;
      error.hidden = false;
    },
    update({ snapshot, playerId, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("sd-touch-active", touchActive);
      if (nowMs - previousUpdateMs < HUD_REFRESH_MS) return;
      previousUpdateMs = nowMs;
      if (!snapshot) {
        fields.status.textContent = "Connecting to the race…";
        fields.countdown.textContent = "";
        return;
      }
      const runner = snapshot.players[playerId];
      if (!runner) return;
      if (roundId !== snapshot.roundId) {
        roundId = snapshot.roundId;
        previousCheckpoint = runner.checkpoint;
        toast.textContent = "";
      }
      const remainingSec = Math.max(0, Math.ceil(snapshot.timer));
      fields.clock.textContent = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`;
      hud.classList.toggle("sd-final-seconds", remainingSec <= 10);
      const runners = [...Object.values(snapshot.players), ...snapshot.bots].filter((actor) => actor.isBot || actor.connected);
      runners.sort((first, second) => first.rank - second.rank);
      fields.position.textContent = String(runner.rank || "—");
      fields.fieldSize.textContent = `/ ${runners.length}`;
      const visibleIds = new Set();
      runners.forEach((actor, index) => {
        visibleIds.add(actor.id);
        let row = rows.get(actor.id);
        if (!row) {
          row = document.createElement("li");
          row.innerHTML = "<b></b><i></i><span></span><small></small>";
          rows.set(actor.id, row);
        }
        row.classList.toggle("sd-you", actor.id === playerId);
        row.querySelector("b").textContent = String(index + 1);
        row.querySelector("i").style.backgroundColor = SKY_DASH_RUNNER_COLORS[actor.colorIndex % SKY_DASH_RUNNER_COLORS.length];
        row.querySelector("span").textContent = actor.id === playerId ? "You" : actor.name;
        row.querySelector("small").textContent = actor.finished ? "✓" : actor.isBot ? "BOT" : "P";
        standings.append(row);
      });
      for (const [id, row] of rows) if (!visibleIds.has(id)) row.remove();
      const checkpoint = SKY_DASH_CHECKPOINTS[runner.checkpoint] || SKY_DASH_CHECKPOINTS[0];
      fields.checkpoint.textContent = checkpoint.label.toUpperCase();
      fields.progress.style.width = `${Math.max(0, Math.min(100, -runner.z / -SKY_DASH_FINISH_Z * 100))}%`;
      const allConnected = Object.values(snapshot.players).every((player) => player.connected);
      fields.status.textContent = runner.finished ? "Finished! Watch the other racers." : runner.respawnSec > 0 ? "Back on your feet in a moment…" : !allConnected ? "Waiting for your rival. Invite them with START." : snapshot.started ? "Race to the finish. Checkpoints save your place." : "On your marks…";
      fields.countdown.textContent = !engaged || snapshot.gameOver || runner.finished || snapshot.startAt ? "" : runner.respawnSec > 0 ? "Nice flight. Try again!" : "";
      /** @type {Array<["dash"|"dive",number]>} */
      const abilityTimers = [["dash", SKY_DASH_ACTION_SETTINGS.dashCooldownSec], ["dive", SKY_DASH_ACTION_SETTINGS.diveCooldownSec]];
      for (const [ability, duration] of abilityTimers) {
        const remaining = runner[`${ability}CooldownSec`] || 0;
        fields[ability].classList.toggle("sd-cooling", remaining > 0);
        fields[ability].querySelector("i").style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - remaining / duration))})`;
      }
      if (runner.checkpoint > previousCheckpoint) showToast("Checkpoint saved ✓", nowMs);
      previousCheckpoint = runner.checkpoint;
      if (nowMs > toastUntilMs) toast.textContent = "";
    },
    dispose() {
      enterButton.removeEventListener("click", onEnter);
      hud.remove();
      stylesheet.remove();
    },
  };
}
