import { RIFTBALL_ACTION_SETTINGS } from "../shared/config.js";

const HUD_REFRESH_MS = 100;
const HUD_STYLESHEET_URL = "/games/riftball/hud.css";

/** Game-only score and ability presentation; platform dialogs keep their chrome. */
export function createRiftballHud({ host, onEnter, onMute, onSkipReplay }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "rb-hud";
  hud.dataset.riftballHud = "true";
  hud.setAttribute("aria-label", "Riftball match status");
  hud.innerHTML = `
    <div class="rb-wordmark">RIFTBALL<span>DUEL / COURT 01</span></div>
    <header class="rb-scoreboard" aria-label="Match score">
      <div class="rb-team rb-teal"><span data-rb="firstLabel">YOU</span><strong data-rb="firstScore">0</strong></div>
      <div class="rb-clock"><small data-rb="clockLabel">FIRST TO 5</small><strong data-rb="clock">2:00</strong></div>
      <div class="rb-team rb-coral"><strong data-rb="secondScore">0</strong><span data-rb="secondLabel">RIVAL</span></div>
    </header>
    <button type="button" class="rb-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="rb-announcement" role="status"></div>
    <div class="rb-intro">
      <div><p class="rb-eyebrow">ONE BALL. EVERY ANGLE IS YOURS.</p><h1>OWN THE<br><em>NEXT POINT.</em></h1><p>Bank it. Charge it. Sell the feint.<br>Five goals. One rival. Your court.</p><button type="button" class="rb-enter">Take the court <span aria-hidden="true">↗</span></button><small>2 players · 2 minutes · Equal abilities</small></div>
    </div>
    <div class="rb-replay" hidden><span><i aria-hidden="true"></i> MATCH POINT REPLAY</span><button type="button">Skip replay</button></div>
    <footer class="rb-abilities">
      <div class="rb-meters"><div class="rb-meter-label"><span data-rb="chargeLabel">HOLD TO CHARGE</span><span data-rb="dashLabel">DASH READY</span></div><div class="rb-charge-track"><i data-rb="charge"></i></div><div class="rb-energy-track"><i data-rb="stamina"></i></div><small data-rb="status">Invite a rival with START</small></div>
      <div class="rb-control-hints"><span><kbd>E / A</kbd> Hold & release</span><span><kbd>SHIFT / B</kbd> Dash</span><span><kbd>SPACE / X</kbd> Jump</span><span><kbd>Q / Y</kbd> Feint</span><small>Right drag / right stick: aim · R: center</small></div>
    </footer>
    <div class="rb-error" hidden role="alert"><strong>Couldn’t join the court</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const fields = {
    firstLabel: hud.querySelector('[data-rb="firstLabel"]'),
    firstScore: hud.querySelector('[data-rb="firstScore"]'),
    secondLabel: hud.querySelector('[data-rb="secondLabel"]'),
    secondScore: hud.querySelector('[data-rb="secondScore"]'),
    clock: hud.querySelector('[data-rb="clock"]'),
    clockLabel: hud.querySelector('[data-rb="clockLabel"]'),
    chargeLabel: hud.querySelector('[data-rb="chargeLabel"]'),
    dashLabel: hud.querySelector('[data-rb="dashLabel"]'),
    charge: hud.querySelector('[data-rb="charge"]'),
    stamina: hud.querySelector('[data-rb="stamina"]'),
    status: hud.querySelector('[data-rb="status"]'),
  };
  const intro = hud.querySelector(".rb-intro");
  const announcement = hud.querySelector(".rb-announcement");
  const replay = hud.querySelector(".rb-replay");
  const error = hud.querySelector(".rb-error");
  const enterButton = hud.querySelector(".rb-enter");
  const soundButton = hud.querySelector(".rb-sound");
  const skipButton = replay.querySelector("button");
  const retryButton = error.querySelector("button");
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let previousGoalSerial = 0;
  let roundId = null;
  let announcementUntilMs = 0;

  enterButton.addEventListener("click", onEnter);
  skipButton.addEventListener("click", onSkipReplay);
  const toggleSound = () => {
    const muted = onMute();
    soundButton.textContent = muted ? "Sound off" : "Sound on";
    soundButton.setAttribute("aria-label", muted ? "Unmute game sound" : "Mute game sound");
    soundButton.setAttribute("aria-pressed", String(muted));
  };
  const retryRoom = () => retryJoin?.();
  soundButton.addEventListener("click", toggleSound);
  retryButton.addEventListener("click", retryRoom);

  return {
    clearError() { error.hidden = true; retryJoin = null; },
    showError(message, retry) {
      error.querySelector("p").textContent = message;
      retryJoin = retry;
      error.hidden = false;
    },
    setReplay(active) {
      const wasHidden = replay.hidden;
      replay.hidden = !active;
      hud.classList.toggle("rb-replaying", active);
      if (active && wasHidden) skipButton.focus({ preventScroll: true });
    },
    update({ snapshot, playerId, players, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("rb-touch-active", touchActive);
      if (nowMs - previousUpdateMs < HUD_REFRESH_MS) return;
      previousUpdateMs = nowMs;
      if (!snapshot) { fields.status.textContent = "Connecting to the court…"; return; }
      const player = players?.find((athlete) => athlete.id === playerId) || snapshot.players[playerId];
      if (!player) return;
      if (roundId !== snapshot.roundId) {
        roundId = snapshot.roundId;
        previousGoalSerial = snapshot.goalSerial;
        announcement.textContent = "";
        announcementUntilMs = 0;
      }
      fields.firstScore.textContent = String(snapshot.players.p1.score);
      fields.secondScore.textContent = String(snapshot.players.p2.score);
      fields.firstLabel.textContent = playerId === "p1" ? "YOU" : "RIVAL";
      fields.secondLabel.textContent = playerId === "p2" ? "YOU" : "RIVAL";
      const remainingSec = Math.max(0, Math.ceil(snapshot.timer));
      fields.clock.textContent = snapshot.suddenDeath ? "OT" : `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`;
      fields.clockLabel.textContent = snapshot.suddenDeath ? "GOLDEN GOAL" : "FIRST TO 5";
      hud.classList.toggle("rb-final-seconds", remainingSec <= 15 || snapshot.suddenDeath);
      const charge = Math.max(0, Math.min(1, player.chargeSec / RIFTBALL_ACTION_SETTINGS.maxChargeSec));
      fields.charge.style.transform = `scaleX(${charge})`;
      fields.stamina.style.transform = `scaleX(${Math.max(0, Math.min(1, player.stamina / 100))})`;
      fields.chargeLabel.textContent = charge > 0.95 ? "FULL POWER · RELEASE" : charge > 0.02 ? "CHARGING · RELEASE TO STRIKE" : "HOLD TO CHARGE";
      fields.dashLabel.textContent = player.dashCooldownSec > 0 ? `DASH ${player.dashCooldownSec.toFixed(1)}s` : player.stamina < RIFTBALL_ACTION_SETTINGS.dashStaminaCost ? "RECOVERING ENERGY" : "DASH READY";
      const connected = Object.values(snapshot.players).every((athlete) => athlete.connected);
      fields.status.textContent = !connected ? "Waiting for your rival · START to invite" : snapshot.gameOver ? "Match complete" : snapshot.phase === "goal" ? "Resetting the court…" : snapshot.suddenDeath ? "Next goal wins" : "Bank shots. Aerial strikes. Make your angle.";
      if (snapshot.goalSerial > previousGoalSerial) {
        announcement.textContent = snapshot.lastScorer === playerId ? "YOUR POINT." : "RIVAL SCORES.";
        announcementUntilMs = nowMs + 1550;
      }
      previousGoalSerial = snapshot.goalSerial;
      if (nowMs > announcementUntilMs) announcement.textContent = "";
    },
    dispose() {
      enterButton.removeEventListener("click", onEnter);
      skipButton.removeEventListener("click", onSkipReplay);
      soundButton.removeEventListener("click", toggleSound);
      retryButton.removeEventListener("click", retryRoom);
      hud.remove();
      stylesheet.remove();
    },
  };
}
