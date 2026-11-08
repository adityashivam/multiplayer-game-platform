import { DEAD_SHIFT_WEAPONS } from "../shared/config.js";

const HUD_STYLESHEET_URL = "/games/dead-shift/hud.css";
const HUD_REFRESH_MS = 100;
const HIT_FLASH_MS = 170;

/**
 * Create the game-owned FPS HUD without changing the platform's host geometry.
 * Telemetry updates stay local and are intentionally not live-region announcements.
 * @param {{host: HTMLElement, onEnter: () => void, onSelectWeapon: (index:number) => void, onMute: () => boolean}} options
 */
export function createDeadShiftHud({ host, onEnter, onSelectWeapon, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);

  const hud = document.createElement("section");
  hud.className = "ds-hud";
  hud.dataset.deadShiftHud = "true";
  hud.setAttribute("aria-label", "Dead Shift game status");
  hud.innerHTML = `
    <div class="ds-grain" aria-hidden="true"></div>
    <div class="ds-damage" aria-hidden="true"></div>
    <header class="ds-match-strip">
      <div class="ds-brand"><span class="ds-brand-mark">D<span>/</span>S</span><span>DEAD SHIFT<small>CONTAINMENT // 04</small></span></div>
      <div class="ds-scoreboard"><div class="ds-score ds-score-self"><small>YOU</small><strong data-ds="selfScore">00</strong></div><div class="ds-clock"><small>EXTRACTION IN</small><strong data-ds="clock">1:30</strong></div><div class="ds-score"><small>RIVAL</small><strong data-ds="rivalScore">00</strong></div></div>
      <button class="ds-mute" type="button" aria-label="Mute game audio" aria-pressed="false">SOUND ON</button>
    </header>
    <div class="ds-feed" data-ds="feed"></div>
    <div class="ds-crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><span></span></div>
    <div class="ds-hitmarker" aria-hidden="true">×</div>
    <div class="ds-center-status" data-ds="centerStatus"></div>
    <div class="ds-intro">
      <div class="ds-intro-copy"><p class="ds-eyebrow">CONTAINMENT BREACH</p><h1>DEAD<span>SHIFT</span></h1><p class="ds-intro-description">Two survivors. Ninety seconds.<br>Hunt the most infected to win.</p><button class="ds-enter" type="button">Enter arena <span aria-hidden="true">↗</span></button><p class="ds-intro-controls">WASD move · Mouse aim · Click fire<br>or use the platform’s twin analog sticks</p></div>
    </div>
    <footer class="ds-player-strip">
      <div class="ds-vitals"><div><span class="ds-health-icon" aria-hidden="true">+</span><strong data-ds="health">100</strong><small>VITALS</small></div><div class="ds-health-track"><i data-ds="healthBar"></i></div><span class="ds-room-status" data-ds="roomStatus">Connecting to containment…</span></div>
      <div class="ds-weapon-status"><span class="ds-weapon-name" data-ds="weaponName">ASSAULT RIFLE</span><div><strong data-ds="ammo">30</strong><span>/ <span data-ds="magazine">30</span> <small>∞ RESERVE</small></span></div><small class="ds-reload-label" data-ds="reload">R RELOAD</small></div>
    </footer>
    <nav class="ds-weapons" aria-label="Select weapon"></nav>
    <div class="ds-control-hint">A FIRE <span>·</span> X RELOAD <span>·</span> B WEAPON <span>·</span> Y JUMP</div>
    <div class="ds-error" hidden role="alert"><strong>Connection interrupted</strong><p data-ds="errorText"></p><button type="button">Try again</button></div>
  `;
  host.append(hud);

  const fields = {
    selfScore: hud.querySelector('[data-ds="selfScore"]'),
    rivalScore: hud.querySelector('[data-ds="rivalScore"]'),
    clock: hud.querySelector('[data-ds="clock"]'),
    health: hud.querySelector('[data-ds="health"]'),
    healthBar: hud.querySelector('[data-ds="healthBar"]'),
    roomStatus: hud.querySelector('[data-ds="roomStatus"]'),
    weaponName: hud.querySelector('[data-ds="weaponName"]'),
    ammo: hud.querySelector('[data-ds="ammo"]'),
    magazine: hud.querySelector('[data-ds="magazine"]'),
    reload: hud.querySelector('[data-ds="reload"]'),
    centerStatus: hud.querySelector('[data-ds="centerStatus"]'),
    feed: hud.querySelector('[data-ds="feed"]'),
    errorText: hud.querySelector('[data-ds="errorText"]'),
  };
  const weaponNavigation = hud.querySelector(".ds-weapons");
  const weaponButtons = DEAD_SHIFT_WEAPONS.map((weaponSettings, index) => {
    const weaponButton = document.createElement("button");
    weaponButton.type = "button";
    weaponButton.innerHTML = `<span>${index + 1}</span><i aria-hidden="true"></i><small></small>`;
    weaponButton.querySelector("small").textContent = ["RIFLE", "SMG", "SHOTGUN", "GRENADE", "ROCKET"][index];
    weaponButton.setAttribute("aria-label", `Select ${weaponSettings.name}`);
    weaponButton.dataset.weapon = String(index);
    weaponButton.addEventListener("click", () => onSelectWeapon(index));
    weaponNavigation.append(weaponButton);
    return weaponButton;
  });
  const enterButton = hud.querySelector(".ds-enter");
  const introControls = hud.querySelector(".ds-intro-controls");
  const muteButton = hud.querySelector(".ds-mute");
  const errorPanel = hud.querySelector(".ds-error");
  let retryCallback = null;
  let lastUpdateAtMs = -Infinity;
  let lastSeenEventId = 0;
  let lastHealth = 100;
  let hitUntilMs = 0;
  let damageUntilMs = 0;
  let feedUntilMs = 0;
  let previousPlatformTouchActive = null;

  enterButton.addEventListener("click", onEnter);
  muteButton.addEventListener("click", () => {
    const muted = onMute();
    muteButton.textContent = muted ? "SOUND OFF" : "SOUND ON";
    muteButton.setAttribute("aria-pressed", String(muted));
    muteButton.setAttribute("aria-label", muted ? "Unmute game audio" : "Mute game audio");
  });
  errorPanel.querySelector("button").addEventListener("click", () => retryCallback?.());

  return {
    /** @param {string} message @param {() => void} [onRetry] */
    showError(message, onRetry) {
      fields.errorText.textContent = message;
      retryCallback = onRetry || null;
      errorPanel.querySelector("button").hidden = !retryCallback;
      errorPanel.hidden = false;
    },
    clearError() { errorPanel.hidden = true; },
    reset() {
      lastSeenEventId = 0;
      lastHealth = 100;
      lastUpdateAtMs = -Infinity;
      fields.feed.textContent = "";
    },
    /** Update authoritative readouts at ten Hz; crosshair feedback remains render-smooth. */
    update({ snapshot, playerId, weapon, engaged, nowMs, pointerLocked, blocked, platformTouchActive = false }) {
      hud.classList.toggle("ds-entered", engaged);
      hud.classList.toggle("ds-blocked", blocked);
      hud.classList.toggle("ds-captured", pointerLocked);
      hud.classList.toggle("ds-hit", nowMs < hitUntilMs);
      hud.classList.toggle("ds-hurt", nowMs < damageUntilMs);
      if (platformTouchActive !== previousPlatformTouchActive) {
        previousPlatformTouchActive = platformTouchActive;
        hud.classList.toggle("ds-touch-active", platformTouchActive);
        introControls.textContent = platformTouchActive
          ? "Left stick moves · Drag right to look · Hold and drag Fire to shoot and aim"
          : "WASD move · Mouse aim · Click fire · Right click to aim, or use the platform’s twin analog sticks";
      }
      if (nowMs - lastUpdateAtMs < HUD_REFRESH_MS) return;
      lastUpdateAtMs = nowMs;

      const playerState = snapshot?.players?.[playerId];
      const opponentId = playerId === "p1" ? "p2" : "p1";
      const opponentState = snapshot?.players?.[opponentId];
      const remainingSec = Math.max(0, Math.ceil(snapshot?.timer ?? 90));
      fields.clock.textContent = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, "0")}`;
      fields.selfScore.textContent = String(playerState?.kills ?? 0).padStart(2, "0");
      fields.rivalScore.textContent = String(opponentState?.kills ?? 0).padStart(2, "0");
      hud.classList.toggle("ds-final-seconds", remainingSec <= 15);
      const health = Math.max(0, Math.ceil(playerState?.health ?? 100));
      if (playerState) {
        if (health < lastHealth) damageUntilMs = nowMs + 420;
        lastHealth = health;
      }
      fields.health.textContent = String(health);
      fields.healthBar.style.transform = `scaleX(${health / 100})`;
      hud.classList.toggle("ds-low-health", health <= 30);
      const weaponSettings = DEAD_SHIFT_WEAPONS[weapon] || DEAD_SHIFT_WEAPONS[0];
      fields.weaponName.textContent = weaponSettings.name.toUpperCase();
      fields.ammo.textContent = String(playerState?.ammo ?? weaponSettings.magazineSize);
      fields.magazine.textContent = String(weaponSettings.magazineSize);
      fields.reload.textContent = playerState?.reloadRemaining > 0
        ? `RELOADING ${playerState.reloadRemaining.toFixed(1)}s`
        : platformTouchActive ? "TAP RELOAD" : "R / X RELOAD";
      weaponButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === weapon)));

      let centerStatus = "";
      const roundInProgress = Boolean(snapshot?.started || snapshot?.timer < (snapshot?.durationSec ?? 90));
      if (!snapshot) {
        fields.roomStatus.textContent = "Connecting to containment…";
      } else if (snapshot.gameOver) {
        fields.roomStatus.textContent = "Extraction complete";
      } else if (!snapshot.players.p1.connected || !snapshot.players.p2.connected) {
        fields.roomStatus.textContent = roundInProgress ? "Rival disconnected · Round paused" : "Waiting for rival · START to invite";
        centerStatus = roundInProgress ? "ROUND PAUSED\nWaiting for your rival" : "WAITING FOR RIVAL\nSTART to share this room";
      } else if (!snapshot.started) {
        const seconds = snapshot.startAt ? Math.max(1, Math.ceil((snapshot.startAt - Date.now()) / 1000)) : 3;
        fields.roomStatus.textContent = "Containment doors opening";
        centerStatus = `GET READY\n${seconds}`;
      } else if (playerState?.health <= 0) {
        fields.roomStatus.textContent = "Operator down · Score preserved";
        centerStatus = `RESPAWNING\n${Math.max(1, Math.ceil(playerState.respawnRemaining))}`;
      } else {
        fields.roomStatus.textContent = "Kill race active · No friendly fire";
      }
      fields.centerStatus.textContent = centerStatus;

      for (const gameEvent of snapshot?.events || []) {
        if (!gameEvent.id || gameEvent.id <= lastSeenEventId) continue;
        if (gameEvent.actorId === playerId && ["hit", "headshot", "kill"].includes(gameEvent.kind)) hitUntilMs = nowMs + HIT_FLASH_MS;
        if (gameEvent.kind === "kill") {
          fields.feed.textContent = gameEvent.actorId === playerId ? "+1 INFECTED ELIMINATED" : "RIVAL ELIMINATED AN INFECTED";
          feedUntilMs = nowMs + 1800;
        }
      }
      lastSeenEventId = Math.max(lastSeenEventId, ...(snapshot?.events || []).map((gameEvent) => gameEvent.id));
      if (nowMs > feedUntilMs) fields.feed.textContent = "";
    },
    dispose() {
      hud.remove();
      stylesheet.remove();
    },
  };
}
