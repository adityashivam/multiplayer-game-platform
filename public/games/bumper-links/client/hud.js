import { BUMPER_LINKS_BALL_COLORS, BUMPER_LINKS_MATCH_SETTINGS } from "../shared/config.js";
import { rankBumperLinksBalls } from "../shared/match.js";
import { nameBumperLinksBall } from "./ballNames.js";
import { createBumperLinksMinimap } from "./minimap.js";

/** @typedef {import("./snapshotPose.js").BumperLinksSnapshot} BumperLinksSnapshot */
/** @typedef {import("./snapshotPose.js").BumperLinksPresentedBall} BumperLinksPresentedBall */
/** @typedef {import("./matchEvents.js").BumperLinksClientEvent} BumperLinksClientEvent */
/** @typedef {import("../shared/course.js").BumperLinksCourse} BumperLinksCourse */

const HUD_REFRESH_MS = 100;
const ANNOUNCEMENT_MS = 1600;
const HUD_STYLESHEET_URL = "/games/bumper-links/hud.css";

/**
 * Game-only hole status, power meter, scores and announcements. Platform
 * dialogs, readiness and results keep their own chrome. Text refreshes at
 * most ten times a second; the power meter follows the render frame.
 * @param {{host:HTMLElement,practice:boolean,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createBumperLinksHud({ host, practice, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "bl-hud";
  hud.setAttribute("aria-label", "Bumper Links match status");
  hud.innerHTML = `
    <header class="bl-top">
      <small data-bl="hole">HOLE 1 / ${BUMPER_LINKS_MATCH_SETTINGS.holes} · PAR 3</small>
      <strong data-bl="clock">—</strong>
      <span data-bl="holeStatus">Waiting for golfers…</span>
    </header>
    <ol class="bl-scores" data-bl="scores" aria-label="Scores"></ol>
    <canvas class="bl-minimap" data-bl="minimap" aria-label="Course map: greens, cup and balls" role="img"></canvas>
    <button type="button" class="bl-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="bl-announcement" aria-hidden="true"></div>
    <div class="bl-intro">
      <div>
        <p class="bl-eyebrow">${practice ? "PRACTICE · 3 BOT GOLFERS" : "2 PLAYERS · 2 BOT GOLFERS"}</p>
        <h1>EVERYONE PUTTS.<br><em>NOBODY WAITS.</em></h1>
        <p>Same hole, same moment. Sink first for the most points,<br>and knock rivals into the water for a bonus.</p>
        <button type="button" class="bl-enter">${practice ? "Start practice" : "Tee off"} <span aria-hidden="true">⛳</span></button>
        <small>6 holes · 5 · 3 · 2 · 1 points by finish order · +1 for every knockout</small>
      </div>
    </div>
    <footer class="bl-footer">
      <div class="bl-power">
        <span data-bl="strokeLabel">STROKE 1</span>
        <div class="bl-power-track"><i data-bl="powerBar"></i></div>
        <small data-bl="status">Connecting…</small>
      </div>
      <div class="bl-hints">
        <span><kbd>A / D</kbd> Aim</span>
        <span><kbd>SHIFT</kbd> Fine aim</span>
        <span><kbd>SPACE</kbd> Hold, release to putt</span>
        <span><kbd>DRAG</kbd> Pull back from the ball</span>
      </div>
    </footer>
    <div class="bl-error" hidden role="alert"><strong>Couldn’t join the course</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const field = (name) => hud.querySelector(`[data-bl="${name}"]`);
  const fields = {
    hole: field("hole"),
    clock: field("clock"),
    holeStatus: field("holeStatus"),
    scores: field("scores"),
    strokeLabel: field("strokeLabel"),
    powerBar: field("powerBar"),
    status: field("status"),
  };
  const minimap = createBumperLinksMinimap(field("minimap"));
  const intro = hud.querySelector(".bl-intro");
  const announcement = hud.querySelector(".bl-announcement");
  const error = hud.querySelector(".bl-error");
  const enterButton = hud.querySelector(".bl-enter");
  const soundButton = hud.querySelector(".bl-sound");
  const retryButton = error.querySelector("button");
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let announcementUntilMs = 0;
  let renderedScores = "";

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

  /** @param {string} text @param {"good"|"bad"|"warn"} tone @param {number} nowMs */
  function announce(text, tone, nowMs) {
    announcement.textContent = text;
    announcement.dataset.tone = tone;
    announcement.classList.remove("bl-pop");
    void announcement.offsetWidth;
    announcement.classList.add("bl-pop");
    announcementUntilMs = nowMs + ANNOUNCEMENT_MS;
  }

  /**
   * @param {readonly BumperLinksClientEvent[]} events
   * @param {Readonly<BumperLinksSnapshot>} snapshot
   * @param {string} playerId
   * @param {number} nowMs
   */
  function announceEvents(events, snapshot, playerId, nowMs) {
    const nameOf = (ballId) => (ballId ? nameBumperLinksBall({ id: ballId }, playerId) : "");
    for (const event of events) {
      if (event.type === "sink") {
        if (event.ballId === playerId) announce(`IN THE CUP! +${event.points}`, "good", nowMs);
        else announce(`${nameOf(event.ballId).toUpperCase()} SINKS +${event.points}`, "warn", nowMs);
      } else if (event.type === "knockout") {
        if (event.byId === playerId) announce(`${nameOf(event.ballId).toUpperCase()} IN THE WATER +1`, "good", nowMs);
        else if (event.ballId === playerId) announce(`${nameOf(event.byId).toUpperCase()} SENT YOU SWIMMING`, "bad", nowMs);
      } else if (event.type === "splash" && event.ballId === playerId) {
        announce("SPLASH · +1 STROKE", "bad", nowMs);
      } else if (event.type === "holeStart") {
        announce(`HOLE ${snapshot.holeIndex + 1} · PAR ${snapshot.par}`, "warn", nowMs);
      } else if (event.type === "holeOver" && !snapshot.gameOver) {
        announce("HOLE COMPLETE", "warn", nowMs);
      }
    }
  }

  /**
   * Points include this hole's while it is in play; they are banked when it ends.
   * @param {readonly BumperLinksPresentedBall[]} balls @param {string} playerId @param {boolean} holeLive
   */
  function renderScores(balls, playerId, holeLive) {
    const ranked = rankBumperLinksBalls(balls.map((ball) => ({ ...ball, points: ball.points + (holeLive ? ball.holePoints : 0) })));
    const key = ranked.map((ball) => `${ball.id}:${ball.points}:${ball.strokes}:${ball.sunk}:${ball.connected}`).join("|");
    if (key === renderedScores) return;
    renderedScores = key;
    fields.scores.replaceChildren(...ranked.map((ball) => {
      const row = document.createElement("li");
      row.className = "bl-row";
      if (ball.id === playerId) row.classList.add("bl-you");
      if (!ball.connected) row.classList.add("bl-away");
      row.style.setProperty("--bl-ball", BUMPER_LINKS_BALL_COLORS[ball.slotIndex % BUMPER_LINKS_BALL_COLORS.length]);
      const name = document.createElement("span");
      name.textContent = nameBumperLinksBall(ball, playerId);
      const state = document.createElement("small");
      state.textContent = ball.sunk ? `IN #${ball.sinkOrder}` : !ball.connected ? "AWAY" : `${ball.strokes} ${ball.strokes === 1 ? "STROKE" : "STROKES"}`;
      const points = document.createElement("b");
      points.textContent = String(ball.points);
      row.append(name, state, points);
      return row;
    }));
  }

  /** @param {Readonly<BumperLinksSnapshot>} snapshot @param {BumperLinksPresentedBall} you @param {boolean} ready */
  function describeBumperLinksStatus(snapshot, you, ready) {
    const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
    if (!humansConnected && !snapshot.started) return "Waiting for your rival · START to invite";
    if (snapshot.gameOver) return "Match complete";
    if (snapshot.phase === "countdown") return "Get ready…";
    if (snapshot.phase === "holeOver") return "Next hole coming up…";
    if (snapshot.phase !== "playing") return "Waiting for golfers…";
    if (you.sunk) return "In the cup — watch the others";
    if (you.strokes >= BUMPER_LINKS_MATCH_SETTINGS.maxStrokes) return "Out of strokes this hole";
    if (!ready) return "Rolling…";
    return "Line it up and putt";
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
     * @param {{snapshot:Readonly<BumperLinksSnapshot>|null,course:Readonly<BumperLinksCourse>,playerId:string,balls:readonly BumperLinksPresentedBall[],events:readonly BumperLinksClientEvent[],power:number,ready:boolean,engaged:boolean,nowMs:number,touchActive:boolean}} frame
     */
    update({ snapshot, course, playerId, balls, events, power, ready, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("bl-touch-active", touchActive);
      hud.classList.toggle("bl-ready", ready);
      if (snapshot) announceEvents(events, snapshot, playerId, nowMs);
      if (nowMs > announcementUntilMs && announcement.textContent) announcement.textContent = "";
      fields.powerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, power))})`;
      minimap.draw({ course, balls, playerId }, nowMs);

      if (nowMs - previousUpdateMs < HUD_REFRESH_MS) return;
      previousUpdateMs = nowMs;
      const you = balls.find((ball) => ball.id === playerId);
      if (!snapshot || !you) {
        fields.status.textContent = "Connecting to the course…";
        return;
      }
      fields.hole.textContent = snapshot.gameOver ? "MATCH OVER" : `HOLE ${snapshot.holeIndex + 1} / ${snapshot.holes} · PAR ${snapshot.par}`;
      const secondsLeft = Math.max(0, BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec - snapshot.holeTimeSec);
      fields.clock.textContent = snapshot.phase === "playing" ? secondsLeft.toFixed(0) : snapshot.phase === "holeOver" ? Math.ceil(snapshot.holeResetRemainingSec).toString() : "—";
      hud.classList.toggle("bl-hurry", snapshot.phase === "playing" && secondsLeft < 10);
      const sunk = balls.filter((ball) => ball.sunk).length;
      fields.holeStatus.textContent = snapshot.phase === "playing" ? `${sunk} of ${balls.length} in the cup` : snapshot.phase === "holeOver" ? "Next hole in" : "";
      renderScores(balls, playerId, snapshot.phase === "playing");
      fields.strokeLabel.textContent = you.sunk ? `SUNK IN ${you.strokes}` : `STROKE ${you.strokes + 1}`;
      fields.status.textContent = describeBumperLinksStatus(snapshot, you, ready);
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
