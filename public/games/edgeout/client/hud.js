import { EDGEOUT_COMBAT_SETTINGS } from "../shared/config.js";
import { getEdgeoutCollapseTimeSec } from "../shared/arena.js";

/** @typedef {import("../shared/simulation.js").EdgeoutMatch} EdgeoutMatch */
/** @typedef {import("./snapshotPose.js").EdgeoutPresentedFighter} EdgeoutPresentedFighter */
/** @typedef {import("./matchEvents.js").EdgeoutMatchEvent} EdgeoutMatchEvent */

const HUD_REFRESH_MS = 100;
const ANNOUNCEMENT_MS = 1400;
const HUD_STYLESHEET_URL = "/games/edgeout/hud.css";

/**
 * Game-only match status, damage and ability presentation. Platform dialogs,
 * readiness and results keep their own chrome. Text refreshes at most ten
 * times a second; announcements react to discrete events.
 * @param {{host:HTMLElement,practice:boolean,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createEdgeoutHud({ host, practice, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "eo-hud";
  hud.dataset.edgeoutHud = "true";
  hud.setAttribute("aria-label", "Edgeout match status");
  hud.innerHTML = `
    <div class="eo-wordmark">EDGEOUT<span>${practice ? "PRACTICE · VS CPU" : "SKY ARENA DUEL"}</span></div>
    <header class="eo-scoreboard" aria-label="Match score">
      <div class="eo-card eo-you"><span data-eo="youLabel">YOU</span><strong data-eo="youDamage">0%</strong><i data-eo="youPips"></i></div>
      <div class="eo-round"><small data-eo="roundLabel">ROUND 1</small><strong data-eo="arenaStatus">FIRST TO 3</strong></div>
      <div class="eo-card eo-rival"><span data-eo="rivalLabel">${practice ? "CPU" : "RIVAL"}</span><strong data-eo="rivalDamage">0%</strong><i data-eo="rivalPips"></i></div>
    </header>
    <button type="button" class="eo-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="eo-announcement" aria-hidden="true"></div>
    <div class="eo-intro">
      <div>
        <p class="eo-eyebrow">${practice ? "PRACTICE ARENA" : "ONE ARENA. ONE RIVAL."}</p>
        <h1>SHOVE THEM OFF.<br><em>STAY ON.</em></h1>
        <p>Charge a shove, dash through their guard, parry at the last instant.<br>The edges crumble. Last one standing takes the round.</p>
        <button type="button" class="eo-enter">${practice ? "Start practice" : "Enter the arena"} <span aria-hidden="true">↗</span></button>
        <small>${practice ? "1 player vs CPU" : "2 players"} · First to 3 rounds · Equal abilities</small>
      </div>
    </div>
    <footer class="eo-abilities">
      <div class="eo-meters">
        <div class="eo-meter-label"><span data-eo="chargeLabel">HOLD TO CHARGE</span><span data-eo="dashLabel">DASH READY</span></div>
        <div class="eo-charge-track"><i data-eo="charge"></i></div>
        <small data-eo="status">Connecting…</small>
      </div>
      <div class="eo-control-hints">
        <span><kbd>SPACE / J / LMB</kbd> Hold, release to shove</span>
        <span><kbd>SHIFT / L</kbd> Dash</span>
        <span><kbd>E / K / RMB</kbd> Block · parry on time</span>
        <small>Mouse aims · WASD moves</small>
      </div>
    </footer>
    <div class="eo-error" hidden role="alert"><strong>Couldn’t join the arena</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const field = (name) => hud.querySelector(`[data-eo="${name}"]`);
  const fields = {
    youLabel: field("youLabel"),
    youDamage: field("youDamage"),
    youPips: field("youPips"),
    rivalLabel: field("rivalLabel"),
    rivalDamage: field("rivalDamage"),
    rivalPips: field("rivalPips"),
    roundLabel: field("roundLabel"),
    arenaStatus: field("arenaStatus"),
    chargeLabel: field("chargeLabel"),
    dashLabel: field("dashLabel"),
    charge: field("charge"),
    status: field("status"),
  };
  const intro = hud.querySelector(".eo-intro");
  const announcement = hud.querySelector(".eo-announcement");
  const error = hud.querySelector(".eo-error");
  const enterButton = hud.querySelector(".eo-enter");
  const soundButton = hud.querySelector(".eo-sound");
  const retryButton = error.querySelector("button");
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let announcementUntilMs = 0;
  let renderedPips = "";

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
    announcement.classList.remove("eo-pop");
    void announcement.offsetWidth;
    announcement.classList.add("eo-pop");
    announcementUntilMs = nowMs + ANNOUNCEMENT_MS;
  }

  /**
   * @param {readonly EdgeoutMatchEvent[]} events
   * @param {Readonly<EdgeoutMatch>} snapshot
   * @param {string} playerId
   * @param {number} nowMs
   */
  function announceEvents(events, snapshot, playerId, nowMs) {
    for (const event of events) {
      if (event.kind === "parry") announce(event.fighterId === playerId ? "PARRY!" : "PARRIED!", event.fighterId === playerId ? "good" : "bad", nowMs);
      else if (event.kind === "guardBreak") announce("GUARD BREAK!", event.fighterId === playerId ? "bad" : "good", nowMs);
      else if (event.kind === "ringOut") announce(event.fighterId === playerId ? "RING OUT…" : "RING OUT!", event.fighterId === playerId ? "bad" : "good", nowMs);
      else if (event.kind === "collapse") announce(snapshot.arena.intactRings > 0 ? "THE EDGE FALLS" : "NO FLOOR LEFT", "warn", nowMs);
      else if (event.kind === "round" && !snapshot.gameOver) {
        const won = snapshot.roundWinnerId === playerId;
        announce(snapshot.roundWinnerId === null ? "DRAW ROUND" : won ? "ROUND WON" : "ROUND LOST", won ? "good" : "bad", nowMs);
      }
    }
  }

  /** @param {HTMLElement} element @param {number} wins @param {number} needed */
  function renderPips(element, wins, needed) {
    element.replaceChildren(...Array.from({ length: needed }, (_unused, index) => {
      const pip = document.createElement("b");
      if (index < wins) pip.className = "eo-won";
      return pip;
    }));
  }

  /** @param {Readonly<EdgeoutMatch>} snapshot */
  function describeArena(snapshot) {
    if (snapshot.phase === "roundOver") return "NEXT ROUND";
    if (snapshot.arena.warningRing >= 0) return `EDGE FALLS ${snapshot.arena.warningRemainingSec.toFixed(1)}s`;
    if (snapshot.arena.intactRings <= 1) return "FINAL TILE";
    if (snapshot.phase !== "playing") return `FIRST TO ${snapshot.roundsToWin}`;
    const nextCollapseSec = getEdgeoutCollapseTimeSec(snapshot.arena.collapseSerial + 1) - snapshot.roundTimeSec;
    return `EDGE SAFE ${Math.max(0, Math.ceil(nextCollapseSec))}s`;
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
     * @param {{snapshot:Readonly<EdgeoutMatch>|null,playerId:string,fighters:readonly EdgeoutPresentedFighter[],events:readonly EdgeoutMatchEvent[],engaged:boolean,nowMs:number,touchActive:boolean}} frame
     */
    update({ snapshot, playerId, fighters, events, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("eo-touch-active", touchActive);
      if (snapshot) announceEvents(events, snapshot, playerId, nowMs);
      if (nowMs > announcementUntilMs && announcement.textContent) announcement.textContent = "";
      if (nowMs - previousUpdateMs < HUD_REFRESH_MS) return;
      previousUpdateMs = nowMs;
      if (!snapshot) {
        fields.status.textContent = "Connecting to the arena…";
        return;
      }

      const you = fighters.find((fighter) => fighter.id === playerId);
      const rival = fighters.find((fighter) => fighter.id !== playerId && !fighter.eliminated) ?? fighters.find((fighter) => fighter.id !== playerId);
      if (!you || !rival) return;
      fields.youDamage.textContent = `${Math.round(you.damage)}%`;
      fields.rivalDamage.textContent = `${Math.round(rival.damage)}%`;
      fields.youDamage.dataset.heat = String(Math.min(3, Math.floor(you.damage / 50)));
      fields.rivalDamage.dataset.heat = String(Math.min(3, Math.floor(rival.damage / 50)));
      const pipKey = `${you.roundWins}:${rival.roundWins}:${snapshot.roundsToWin}`;
      if (pipKey !== renderedPips) {
        renderPips(fields.youPips, you.roundWins, snapshot.roundsToWin);
        renderPips(fields.rivalPips, rival.roundWins, snapshot.roundsToWin);
        renderedPips = pipKey;
      }
      fields.roundLabel.textContent = snapshot.gameOver ? "MATCH OVER" : `ROUND ${snapshot.roundNumber}`;
      fields.arenaStatus.textContent = describeArena(snapshot);
      hud.classList.toggle("eo-warning", snapshot.arena.warningRing >= 0 && snapshot.phase === "playing");

      const charge = you.action === "charge" ? Math.min(1, you.chargeSec / EDGEOUT_COMBAT_SETTINGS.maxChargeSec) : 0;
      fields.charge.style.transform = `scaleX(${charge})`;
      fields.chargeLabel.textContent = charge > 0.97 ? "FULL POWER · RELEASE" : charge > 0.02 ? "CHARGING…" : you.action === "block" ? "BLOCKING" : "HOLD TO CHARGE";
      fields.dashLabel.textContent = you.dashCooldownSec > 0 ? `DASH ${you.dashCooldownSec.toFixed(1)}s` : "DASH READY";
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      fields.status.textContent = !humansConnected ? "Waiting for your rival · START to invite"
        : snapshot.gameOver ? "Match complete"
        : you.eliminated ? "Out this round"
        : you.action === "stunned" ? "Stunned!"
        : "Higher damage means bigger knockback.";
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
