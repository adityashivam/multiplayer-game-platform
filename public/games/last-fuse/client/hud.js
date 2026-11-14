import { LAST_FUSE_BOMB_SETTINGS, LAST_FUSE_RUNNER_COLORS } from "../shared/config.js";
import { rankLastFuseRunners } from "../shared/match.js";
import { nameLastFuseRunner } from "./runnerNames.js";
import { createLastFuseMinimap } from "./minimap.js";

/** @typedef {import("../shared/match.js").LastFuseMatch} LastFuseMatch */
/** @typedef {import("./snapshotPose.js").LastFusePresentedRunner} LastFusePresentedRunner */
/** @typedef {import("./matchEvents.js").LastFuseMatchEvent} LastFuseMatchEvent */
/** @typedef {(x:number,y:number,z:number)=>{x:number,y:number,visible:boolean}} LastFuseProjector */

const HUD_REFRESH_MS = 100;
const ANNOUNCEMENT_MS = 1500;
const HUD_STYLESHEET_URL = "/games/last-fuse/hud.css";
const DANGER_RANGE_M = 6;
const MARKER_HEIGHT_M = 2.5;
const EDGE_MARGIN = 0.07;

/**
 * Game-only round status, fuse, standings and bomb markers. Platform dialogs,
 * readiness and results keep their own chrome. Text refreshes at most ten
 * times a second; markers follow the render frame.
 * @param {{host:HTMLElement,practice:boolean,onEnter:()=>void,onMute:()=>boolean}} options
 */
export function createLastFuseHud({ host, practice, onEnter, onMute }) {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = HUD_STYLESHEET_URL;
  document.head.append(stylesheet);
  const hud = document.createElement("section");
  hud.className = "lf-hud";
  hud.setAttribute("aria-label", "Last Fuse match status");
  hud.innerHTML = `
    <div class="lf-vignette" aria-hidden="true"></div>
    <div class="lf-marker" data-lf="holderMarker" aria-hidden="true"><b></b><span>BOMB</span></div>
    <div class="lf-arrow" data-lf="arrow" aria-hidden="true"></div>
    <header class="lf-top">
      <small data-lf="round">ROUND 1 / 3</small>
      <strong data-lf="fuse">—</strong>
      <div class="lf-fuse-track"><i data-lf="fuseBar"></i></div>
      <span data-lf="bombStatus">Waiting for runners…</span>
    </header>
    <ol class="lf-standings" data-lf="standings" aria-label="Standings"></ol>
    <canvas class="lf-minimap" data-lf="minimap" aria-label="Rooftop map: runners and the bomb" role="img"></canvas>
    <button type="button" class="lf-sound" aria-label="Mute game sound" aria-pressed="false">Sound on</button>
    <div class="lf-announcement" aria-hidden="true"></div>
    <div class="lf-intro">
      <div>
        <p class="lf-eyebrow">${practice ? "PRACTICE · 5 BOT RUNNERS" : "2 PLAYERS · 4 BOT RUNNERS"}</p>
        <h1>DON'T HOLD IT<br><em>WHEN IT BLOWS.</em></h1>
        <p>One lit bomb. Six runners. Touch someone to pass it on.<br>Every pass burns the fuse faster. Every blast drops a building.</p>
        <button type="button" class="lf-enter">${practice ? "Start practice" : "Hit the rooftops"} <span aria-hidden="true">↗</span></button>
        <small>3 rounds · Survive blasts for points · Last runner standing scores big</small>
      </div>
    </div>
    <footer class="lf-footer">
      <div class="lf-dash"><span data-lf="dashLabel">DASH READY</span><div class="lf-dash-track"><i data-lf="dashBar"></i></div><small data-lf="status">Connecting…</small></div>
      <div class="lf-hints">
        <span><kbd>WASD</kbd> Run</span>
        <span><kbd>SPACE</kbd> Jump</span>
        <span><kbd>SHIFT</kbd> Dash</span>
        <span><kbd>Q / E</kbd> Turn camera</span>
      </div>
    </footer>
    <div class="lf-error" hidden role="alert"><strong>Couldn’t join the rooftops</strong><p></p><button type="button">Try again</button></div>
  `;
  host.append(hud);
  const field = (name) => hud.querySelector(`[data-lf="${name}"]`);
  const fields = {
    round: field("round"),
    fuse: field("fuse"),
    fuseBar: field("fuseBar"),
    bombStatus: field("bombStatus"),
    standings: field("standings"),
    dashLabel: field("dashLabel"),
    dashBar: field("dashBar"),
    status: field("status"),
    holderMarker: field("holderMarker"),
    arrow: field("arrow"),
  };
  const minimap = createLastFuseMinimap(field("minimap"));
  const intro = hud.querySelector(".lf-intro");
  const announcement = hud.querySelector(".lf-announcement");
  const error = hud.querySelector(".lf-error");
  const enterButton = hud.querySelector(".lf-enter");
  const soundButton = hud.querySelector(".lf-sound");
  const retryButton = error.querySelector("button");
  let retryJoin = null;
  let previousUpdateMs = -Infinity;
  let announcementUntilMs = 0;
  let renderedStandings = "";

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
    announcement.classList.remove("lf-pop");
    void announcement.offsetWidth;
    announcement.classList.add("lf-pop");
    announcementUntilMs = nowMs + ANNOUNCEMENT_MS;
  }

  /**
   * @param {readonly LastFuseMatchEvent[]} events
   * @param {Readonly<LastFuseMatch>} snapshot
   * @param {readonly LastFusePresentedRunner[]} runners
   * @param {string} playerId
   * @param {number} nowMs
   */
  function announceEvents(events, snapshot, runners, playerId, nowMs) {
    const nameOf = (runnerId) => {
      const runner = runners.find((candidate) => candidate.id === runnerId);
      return runner ? nameLastFuseRunner(runner, playerId) : "";
    };
    for (const event of events) {
      if (event.kind === "armed") {
        announce(event.runnerId === playerId ? "YOU HAVE THE BOMB" : `${nameOf(event.runnerId)} HAS THE BOMB`, event.runnerId === playerId ? "bad" : "warn", nowMs);
      } else if (event.kind === "pass") {
        if (event.runnerId === playerId) announce("TAGGED — PASS IT ON", "bad", nowMs);
        else if (event.fromId === playerId) announce("PASSED!", "good", nowMs);
      } else if (event.kind === "blast") {
        announce(event.runnerId === playerId ? "BOOM — YOU'RE OUT" : `BOOM — ${nameOf(event.runnerId)} IS OUT`, event.runnerId === playerId ? "bad" : "good", nowMs);
      } else if (event.kind === "fall" && event.runnerId === playerId) {
        announce("YOU FELL", "bad", nowMs);
      } else if (event.kind === "crumbleWarning") {
        announce("ROOF COLLAPSING", "warn", nowMs);
      } else if (event.kind === "round") {
        const won = snapshot.roundWinnerId === playerId;
        announce(won ? "LAST ONE STANDING" : `${nameOf(snapshot.roundWinnerId) || "NOBODY"} SURVIVED`, won ? "good" : "warn", nowMs);
      }
    }
  }

  /**
   * Place the bomb marker over the holder, or an edge arrow when off-screen.
   * @param {Readonly<LastFuseMatch>|null} snapshot
   * @param {readonly LastFusePresentedRunner[]} runners
   * @param {string} playerId
   * @param {LastFuseProjector} project
   */
  function placeMarkers(snapshot, runners, playerId, project) {
    const holder = snapshot?.bomb?.holderId ? runners.find((runner) => runner.id === snapshot.bomb.holderId) : null;
    const showMarker = Boolean(holder && holder.id !== playerId && snapshot.phase === "playing");
    fields.holderMarker.hidden = true;
    fields.arrow.hidden = true;
    if (!showMarker) return;
    const projected = project(holder.x, holder.y + MARKER_HEIGHT_M, holder.z);
    const onScreen = projected.visible && projected.x > EDGE_MARGIN && projected.x < 1 - EDGE_MARGIN && projected.y > EDGE_MARGIN && projected.y < 1 - EDGE_MARGIN;
    if (onScreen) {
      fields.holderMarker.hidden = false;
      fields.holderMarker.style.transform = `translate(${projected.x * 100}cqw, ${projected.y * 100}cqh)`;
      return;
    }
    let directionX = projected.x - 0.5;
    let directionY = projected.y - 0.5;
    if (!projected.visible) {
      directionX = -directionX;
      directionY = -directionY;
    }
    const angle = Math.atan2(directionY, directionX);
    const scale = 0.42 / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
    fields.arrow.hidden = false;
    fields.arrow.style.transform = `translate(${(0.5 + Math.cos(angle) * scale) * 100}cqw, ${(0.5 + Math.sin(angle) * scale) * 100}cqh) rotate(${angle}rad)`;
  }

  /**
   * @param {readonly LastFusePresentedRunner[]} runners
   * @param {Readonly<LastFuseMatch>} snapshot
   * @param {string} playerId
   */
  function renderStandings(runners, snapshot, playerId) {
    const ranked = rankLastFuseRunners(runners);
    const key = ranked.map((runner) => `${runner.id}:${runner.points}:${runner.eliminated}:${runner.fallen}:${snapshot.bomb.holderId === runner.id}`).join("|");
    if (key === renderedStandings) return;
    renderedStandings = key;
    fields.standings.replaceChildren(...ranked.map((runner) => {
      const row = document.createElement("li");
      row.className = "lf-row";
      if (runner.id === playerId) row.classList.add("lf-you");
      if (runner.eliminated) row.classList.add("lf-out");
      if (snapshot.bomb.holderId === runner.id) row.classList.add("lf-holder");
      row.style.setProperty("--lf-runner", LAST_FUSE_RUNNER_COLORS[runner.colorIndex % LAST_FUSE_RUNNER_COLORS.length]);
      const name = document.createElement("span");
      name.textContent = nameLastFuseRunner(runner, playerId);
      const state = document.createElement("small");
      state.textContent = snapshot.bomb.holderId === runner.id ? "BOMB" : runner.eliminated ? "OUT" : runner.fallen ? "FELL" : "";
      const points = document.createElement("b");
      points.textContent = String(runner.points);
      row.append(name, state, points);
      return row;
    }));
  }

  /** @param {Readonly<LastFuseMatch>} snapshot @param {string} playerId @param {readonly LastFusePresentedRunner[]} runners */
  function describeBomb(snapshot, playerId, runners) {
    const bomb = snapshot.bomb;
    if (snapshot.phase === "roundOver") return { fuse: "—", fraction: 0, status: "Next round…" };
    if (snapshot.phase !== "playing") return { fuse: "—", fraction: 0, status: snapshot.phase === "countdown" ? "Get ready…" : "Waiting for runners…" };
    if (!bomb.holderId) return { fuse: bomb.armSec.toFixed(1), fraction: 0, status: "Next bomb lighting…" };
    const holder = runners.find((runner) => runner.id === bomb.holderId);
    return {
      fuse: bomb.fuseSec.toFixed(1),
      fraction: bomb.fuseTotalSec > 0 ? bomb.fuseSec / bomb.fuseTotalSec : 0,
      status: holder ? (holder.id === playerId ? "You hold the bomb — touch a runner" : `${nameLastFuseRunner(holder, playerId)} holds the bomb`) : "",
    };
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
     * @param {{snapshot:Readonly<LastFuseMatch>|null,playerId:string,runners:readonly LastFusePresentedRunner[],events:readonly LastFuseMatchEvent[],project:LastFuseProjector,heading:number,engaged:boolean,nowMs:number,touchActive:boolean}} frame
     */
    update({ snapshot, playerId, runners, events, project, heading, engaged, nowMs, touchActive }) {
      intro.hidden = engaged || Boolean(snapshot?.startAt || snapshot?.started);
      hud.classList.toggle("lf-touch-active", touchActive);
      if (snapshot) announceEvents(events, snapshot, runners, playerId, nowMs);
      if (nowMs > announcementUntilMs && announcement.textContent) announcement.textContent = "";
      placeMarkers(snapshot, runners, playerId, project);
      if (snapshot) {
        minimap.draw({
          city: snapshot.city,
          runners,
          playerId,
          holderId: snapshot.phase === "playing" ? snapshot.bomb.holderId : null,
          heading,
          timeSec: nowMs / 1000,
        }, nowMs);
      }

      const you = runners.find((runner) => runner.id === playerId);
      const holder = snapshot?.bomb?.holderId ? runners.find((runner) => runner.id === snapshot.bomb.holderId) : null;
      const holding = Boolean(snapshot?.phase === "playing" && holder && holder.id === playerId);
      const danger = Boolean(snapshot?.phase === "playing" && you && holder && !holding && !you.eliminated &&
        Math.hypot(holder.x - you.x, holder.z - you.z) < DANGER_RANGE_M);
      hud.classList.toggle("lf-holding", holding);
      hud.classList.toggle("lf-danger", danger);
      hud.classList.toggle("lf-critical", holding && snapshot.bomb.fuseSec < 3);

      if (nowMs - previousUpdateMs < HUD_REFRESH_MS) return;
      previousUpdateMs = nowMs;
      if (!snapshot || !you) {
        fields.status.textContent = "Connecting to the rooftops…";
        return;
      }
      const bombView = describeBomb(snapshot, playerId, runners);
      fields.round.textContent = snapshot.gameOver ? "MATCH OVER" : `ROUND ${snapshot.roundNumber} / ${snapshot.rounds}`;
      fields.fuse.textContent = bombView.fuse;
      fields.fuseBar.style.transform = `scaleX(${Math.max(0, Math.min(1, bombView.fraction))})`;
      fields.bombStatus.textContent = bombView.status;
      renderStandings(runners, snapshot, playerId);

      const dashFraction = 1 - Math.min(1, you.dashCooldownSec / LAST_FUSE_BOMB_SETTINGS.dashCooldownSec);
      fields.dashBar.style.transform = `scaleX(${dashFraction})`;
      fields.dashLabel.textContent = you.dashCooldownSec > 0 ? `DASH ${you.dashCooldownSec.toFixed(1)}s` : "DASH READY";
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      fields.status.textContent = !humansConnected ? "Waiting for your rival · START to invite"
        : snapshot.gameOver ? "Match complete"
        : you.eliminated ? "Out this round — watch the rest"
        : you.fallen ? "Respawning on a far roof…"
        : holding ? "The holder runs 8% faster. Chase!"
        : "Keep roofs between you and the bomb.";
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
