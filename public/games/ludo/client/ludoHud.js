import { LUDO_LIMITS, LUDO_PALETTE } from "../shared/config.js";
import { getLudoEntryRollsRemaining } from "../shared/rules.js";

const HUD_SIDE_INSET_PX = 14;
const COMPACT_SIDE_INSET_PX = 10;
const DIE_PIP_POSITIONS = Object.freeze({
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
});

/**
 * @typedef {import("./ludoClientState.js").LudoClientView} LudoClientView
 * @typedef {import("../shared/config.js").LudoPlayerId} LudoPlayerId
 * @typedef {LudoClientView & {connectionStatus:string,errorMessage:string|null,retryAvailable:boolean,rematchStarting:boolean}} LudoHudView
 */

/**
 * Mount one game-owned panel without replacing the canvas or platform toolbar.
 * All snapshot strings are assigned as text, and only static markup is parsed.
 * The help remains inline, so platform dialogs retain modal focus ownership.
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {()=>void} options.onRoll
 * @param {(tokenIndex:number)=>void} options.onTokenPick
 * @param {()=>void} options.onInvite
 * @param {()=>void} options.onRetry
 * @returns {{update:(view:LudoHudView)=>void,resize:(width:number,height:number)=>number,dispose:()=>void}}
 */
export function createLudoHud({ host, onRoll, onTokenPick, onInvite, onRetry }) {
  const styleNode = document.createElement("style");
  styleNode.textContent = LUDO_HUD_STYLES;
  const panel = document.createElement("aside");
  panel.className = "ludo-hud";
  panel.dataset.ludoHud = "";
  panel.setAttribute("aria-label", "Ludo game controls");
  panel.innerHTML = `
    <header class="ludo-hud__header">
      <div class="ludo-hud__brand">LUDO <span>TABLE</span></div>
      <span class="ludo-hud__round">ROUND 1</span>
    </header>
    <div class="ludo-hud__players" aria-label="Players and pieces home"></div>
    <section class="ludo-hud__turn">
      <div class="ludo-hud__turn-line">
        <span class="ludo-hud__eyebrow">YOUR TABLE</span>
        <output class="ludo-hud__timer" aria-label="Decision time remaining" aria-live="off"></output>
      </div>
      <div class="ludo-hud__headline" aria-live="polite" aria-atomic="true">
        <h2>Joining your table</h2>
        <p>Getting the board ready.</p>
      </div>
      <div class="ludo-hud__time-track" aria-hidden="true"><i></i></div>
    </section>
    <button class="ludo-hud__roll" type="button" aria-label="Roll dice" disabled>
      <span class="ludo-hud__die" role="img" aria-label="No roll yet">
        ${Array.from({ length: 9 }, () => "<i hidden></i>").join("")}
        <b>—</b>
      </span>
      <span class="ludo-hud__roll-label">Joining…</span>
      <span class="ludo-hud__key" aria-hidden="true">A</span>
    </button>
    <section class="ludo-hud__pieces" aria-label="Your pieces">
      <div class="ludo-hud__pieces-label"><span>YOUR PIECES</span><span>1–4</span></div>
      <div class="ludo-hud__piece-grid">
        ${Array.from({ length: 4 }, (_, tokenIndex) => `
          <button type="button" class="ludo-hud__piece" aria-label="Move piece ${tokenIndex + 1}"
            aria-pressed="false" data-ludo-token-index="${tokenIndex}" disabled>
            <span class="ludo-hud__pawn" aria-hidden="true"></span><span>${tokenIndex + 1}</span>
          </button>`).join("")}
      </div>
    </section>
    <footer class="ludo-hud__footer">
      <div class="ludo-hud__legend" role="img" aria-label="Board homes: Coral, Emerald, Gold and Blue">
        ${Object.entries(LUDO_PALETTE).map(([color, palette]) => `<i style="background:${palette.color}" title="${palette.label} home" data-color="${color}"></i>`).join("")}
      </div>
      <button type="button" class="ludo-hud__invite">Invite player</button>
      <details class="ludo-hud__help">
        <summary>How to play <span aria-hidden="true">?</span></summary>
        <div class="ludo-hud__rules">
          <p>Bring all four pieces home. Roll a six to leave your yard; land exactly to finish.</p>
          <p><strong>Quick entry</strong> · No pieces out? A six is guaranteed within ${LUDO_LIMITS.ENTRY_ROLL_LIMIT} rolls, for every player.</p>
          <p>A six, capture or finish earns another roll. Three sixes pass the turn.</p>
          <p>★ tiles are safe. A pair blocks rivals; a lone rival on other tiles is sent home.</p>
          <p><strong>Controls</strong> · Tap a glowing piece. Arrows or 1–4 select; A, Space or Enter confirms. Each decision has 30 seconds.</p>
        </div>
      </details>
    </footer>
    <div class="ludo-hud__error" hidden><p></p><button type="button">Try again</button></div>
  `;
  host.append(styleNode, panel);

  const playerList = panel.querySelector(".ludo-hud__players");
  const headline = panel.querySelector("h2");
  const description = panel.querySelector(".ludo-hud__headline p");
  const eyebrow = panel.querySelector(".ludo-hud__eyebrow");
  const roundLabel = panel.querySelector(".ludo-hud__round");
  const timer = panel.querySelector(".ludo-hud__timer");
  const timeTrack = panel.querySelector(".ludo-hud__time-track");
  const timeFill = timeTrack.querySelector("i");
  const rollButton = panel.querySelector(".ludo-hud__roll");
  const rollLabel = panel.querySelector(".ludo-hud__roll-label");
  const die = panel.querySelector(".ludo-hud__die");
  const pips = Array.from(die.querySelectorAll("i"));
  const unrolledDieLabel = die.querySelector("b");
  const pieceButtons = Array.from(panel.querySelectorAll("[data-ludo-token-index]"));
  const inviteButton = panel.querySelector(".ludo-hud__invite");
  const errorPanel = panel.querySelector(".ludo-hud__error");
  const errorMessage = errorPanel.querySelector("p");
  const retryButton = errorPanel.querySelector("button");
  /** @type {Map<LudoPlayerId,HTMLElement>} */
  const playerRows = new Map();
  const cleanups = [];
  let lastDieValue = -1;

  bindHudClick(rollButton, onRoll);
  bindHudClick(inviteButton, onInvite);
  bindHudClick(retryButton, onRetry);
  pieceButtons.forEach((button, tokenIndex) => bindHudClick(button, () => onTokenPick(tokenIndex)));

  /** @param {HTMLElement} button @param {()=>void} callback */
  function bindHudClick(button, callback) {
    button.addEventListener("click", callback);
    cleanups.push(() => button.removeEventListener("click", callback));
  }

  /** @param {LudoHudView} view */
  function updatePlayers(view) {
    const snapshot = view.snapshot;
    if (!snapshot) return;
    for (const [seatId, row] of playerRows) {
      if (!snapshot.playerIds.includes(seatId)) {
        row.remove();
        playerRows.delete(seatId);
      }
    }
    for (const seatId of snapshot.playerIds) {
      const playerState = snapshot.players[seatId];
      let row = playerRows.get(seatId);
      if (!row) {
        row = document.createElement("div");
        row.className = "ludo-hud__player";
        row.innerHTML = "<i class='ludo-hud__player-dot' aria-hidden='true'></i><div class='ludo-hud__player-copy'><strong></strong><span></span></div><span class='ludo-hud__home-count'></span>";
        playerRows.set(seatId, row);
        playerList.appendChild(row);
      }
      const palette = LUDO_PALETTE[playerState.color];
      const isLocalPlayer = seatId === view.playerId;
      const seriesWins = playerState.seriesWins || 0;
      const finished = playerState.finished || 0;
      row.style.setProperty("--player-color", palette.color);
      row.classList.toggle("is-current", snapshot.currentPlayerId === seatId && snapshot.started && !snapshot.gameOver);
      row.classList.toggle("is-away", !playerState.connected);
      setHudText(row.querySelector("strong"), `${palette.label}${isLocalPlayer ? " · You" : ""}`);
      setHudText(row.querySelector(".ludo-hud__player-copy span"), !playerState.connected ? "Not connected" : seriesWins ? `${seriesWins} ${seriesWins === 1 ? "win" : "wins"}` : "Ready at the table");
      setHudText(row.querySelector(".ludo-hud__home-count"), `${finished}/4 home${seriesWins ? ` · ${seriesWins}W` : ""}`);
      row.setAttribute("aria-label", `${palette.label}${isLocalPlayer ? ", you" : ""}, ${finished} of 4 pieces home, ${seriesWins} series wins${playerState.connected ? "" : ", disconnected"}`);
    }
  }

  return {
    update(view) {
      const snapshot = view.snapshot;
      const localPlayer = snapshot?.players[view.playerId];
      const localPalette = LUDO_PALETTE[localPlayer?.color ?? "red"];
      const currentPlayer = snapshot?.players[snapshot.currentPlayerId];
      const currentPalette = LUDO_PALETTE[currentPlayer?.color ?? "red"];
      const presentation = getLudoTurnPresentation(view);
      panel.dataset.ludoPhase = snapshot?.phase ?? "loading";
      panel.dataset.ludoPlayerId = view.playerId ?? "";
      panel.dataset.ludoRevision = snapshot?.revision ?? "";
      panel.dataset.ludoRoundId = snapshot?.roundId ?? "";
      panel.style.setProperty("--ludo-piece-color", localPalette.color);
      panel.style.setProperty("--ludo-turn-color", currentPalette.color);
      setHudText(roundLabel, `ROUND ${snapshot?.roundId ?? 1}`);
      setHudText(eyebrow, view.playerId ? `${localPalette.label.toUpperCase()} · YOU` : "YOUR TABLE");
      setHudText(headline, presentation.title);
      setHudText(description, presentation.description);
      setHudText(rollLabel, presentation.actionLabel);
      rollButton.disabled = !view.canRoll || Boolean(view.errorMessage);
      rollButton.classList.toggle("is-rolling", snapshot?.phase === "rolling" || view.pendingRoll);
      inviteButton.hidden = Boolean(view.allPlayersConnected || view.errorMessage);
      updatePlayers(view);

      const diceValue = getLudoDisplayedDiceValue(snapshot);
      if (lastDieValue !== diceValue) {
        lastDieValue = diceValue;
        die.dataset.ludoDiceValue = String(diceValue);
        die.setAttribute("aria-label", diceValue ? `Die: ${diceValue}` : "No roll yet");
        pips.forEach((pip, index) => { pip.hidden = !DIE_PIP_POSITIONS[diceValue].includes(index); });
        unrolledDieLabel.hidden = diceValue !== 0;
      }
      pieceButtons.forEach((button, tokenIndex) => {
        button.disabled = !view.canChoose || !view.legalTokenIndices.includes(tokenIndex) || Boolean(view.errorMessage);
        button.setAttribute("aria-pressed", String(view.selectedTokenIndex === tokenIndex));
        const progress = localPlayer?.tokens[tokenIndex] ?? LUDO_LIMITS.YARD;
        button.dataset.ludoTokenProgress = String(progress);
        button.title = `Piece ${tokenIndex + 1} · ${getLudoPieceProgressLabel(progress)}`;
      });

      const decisionActive = snapshot?.started && !snapshot.gameOver &&
        (snapshot.phase === "roll" || snapshot.phase === "choose") && snapshot.turnEndsAtMs > 0 && view.ready;
      const remainingMs = decisionActive ? Math.max(0, snapshot.turnEndsAtMs - view.serverNowMs) : 0;
      setHudText(timer, decisionActive ? `${Math.min(30, Math.ceil(remainingMs / 1000))}s` : "");
      timeTrack.hidden = !decisionActive;
      timeFill.style.transform = `scaleX(${Math.min(1, remainingMs / LUDO_LIMITS.TURN_TIMEOUT_MS)})`;
      timer.classList.toggle("is-urgent", decisionActive && remainingMs <= 5000);
      errorPanel.hidden = !view.errorMessage;
      setHudText(errorMessage, view.errorMessage ?? "");
      retryButton.hidden = !view.retryAvailable;
    },
    resize(width, height) {
      const compact = width < 1000 || height < 520;
      const panelWidth = compact ? 210 : Math.min(280, Math.max(248, Math.round(width * 0.24)));
      const sideInset = compact ? COMPACT_SIDE_INSET_PX : HUD_SIDE_INSET_PX;
      panel.classList.toggle("is-compact", compact);
      panel.style.width = `${panelWidth}px`;
      panel.style.right = `${sideInset}px`;
      panel.style.bottom = `${sideInset}px`;
      return panelWidth + sideInset * 2;
    },
    dispose() {
      cleanups.forEach((cleanup) => cleanup());
      panel.remove();
      styleNode.remove();
      playerRows.clear();
    },
  };
}

/**
 * Keep the settled result visible while the next turn has no active die value.
 * A new round's empty action clears the previous round's displayed result.
 * @param {LudoClientView["snapshot"]} snapshot
 * @returns {number} Zero only before the first roll of a round.
 */
export function getLudoDisplayedDiceValue(snapshot) {
  const currentValue = snapshot?.diceValue;
  if (Number.isInteger(currentValue) && currentValue >= 1 && currentValue <= 6) return currentValue;
  const lastValue = snapshot?.lastAction?.diceValue;
  return Number.isInteger(lastValue) && lastValue >= 1 && lastValue <= 6 ? lastValue : 0;
}

/** @param {LudoHudView} view @returns {{title:string,description:string,actionLabel:string}} */
export function getLudoTurnPresentation(view) {
  const snapshot = view.snapshot;
  if (view.errorMessage) return { title: "Could not join", description: "Your table is safe. Try connecting again.", actionLabel: "Unavailable" };
  if (view.connectionStatus !== "connected") return { title: view.connectionStatus === "connecting" ? "Joining your table" : "Reconnecting…", description: "We’ll keep your place at the table.", actionLabel: "Connecting…" };
  if (!snapshot || !view.ready) return { title: view.rematchStarting ? "A fresh board" : "Getting ready", description: view.rematchStarting ? "Your next round begins shortly." : "Loading your place at the table.", actionLabel: "Getting ready…" };
  const currentPalette = LUDO_PALETTE[snapshot.players[snapshot.currentPlayerId].color];
  if (snapshot.gameOver) {
    const winner = snapshot.players[snapshot.winner];
    const winnerLabel = winner ? LUDO_PALETTE[winner.color].label : "Round";
    return { title: snapshot.winner === view.playerId ? "You win!" : `${winnerLabel} wins`, description: "Four pieces home. Nicely played.", actionLabel: "Round complete" };
  }
  if (!view.allPlayersConnected) return { title: "Waiting for player", description: "Invite a friend to join your table.", actionLabel: "Waiting for player" };
  if (!snapshot.started) return { title: "Get ready", description: "The countdown starts your match.", actionLabel: "Starting soon…" };
  if (snapshot.phase === "rolling" || view.pendingRoll) return { title: view.isMyTurn ? "Rolling your dice" : `${currentPalette.label} is rolling`, description: "Let’s see where it lands.", actionLabel: "Rolling…" };
  if (snapshot.phase === "moving" || view.pendingAction) return { title: view.isMyTurn ? "On the move" : `${currentPalette.label} is moving`, description: "A little closer to home.", actionLabel: "Moving…" };
  if (snapshot.phase === "pass") return { title: "Next turn", description: snapshot.lastMessage || "The next player rolls.", actionLabel: "Next turn…" };
  const entryRollsRemaining = getLudoEntryRollsRemaining(snapshot.players[view.playerId]);
  if (!view.isMyTurn) return {
    title: `${currentPalette.label}’s turn`,
    description: entryRollsRemaining === 1 ? "Your next roll is guaranteed to be 6."
      : snapshot.phase === "choose" ? `${currentPalette.label} rolled ${snapshot.diceValue}. Picking a piece.` : "Your next roll is coming up.",
    actionLabel: "Opponent’s turn",
  };
  if (snapshot.phase === "choose") return { title: "Choose your piece", description: `Rolled ${snapshot.diceValue}. Tap a glowing piece.`, actionLabel: "Choose a piece" };
  const description = entryRollsRemaining === 0 ? "Roll to move a piece."
    : entryRollsRemaining === 1 ? "Quick entry: your next roll is 6."
      : `Quick entry: a six within ${entryRollsRemaining} rolls.`;
  return { title: "Your turn", description, actionLabel: "Roll dice" };
}

/** @param {number} progress @returns {string} */
function getLudoPieceProgressLabel(progress) {
  if (progress === LUDO_LIMITS.YARD) return "In your yard";
  if (progress === LUDO_LIMITS.HOME_FINISH) return "Home";
  if (progress >= LUDO_LIMITS.HOME_START) return "In the home lane";
  return "On the track";
}

/**
 * Keep repeated telemetry/snapshot refreshes from replacing unchanged text.
 * @param {HTMLElement} element
 * @param {string} message
 */
function setHudText(element, message) {
  if (element.textContent !== message) element.textContent = message;
}

const LUDO_HUD_STYLES = `
.ludo-hud, .ludo-hud * { box-sizing:border-box; }
.ludo-hud { --ludo-piece-color:#fa5b6a; --ludo-turn-color:#fa5b6a; position:absolute; top:64px; right:14px; bottom:14px; z-index:2; width:268px; display:flex; flex-direction:column; gap:20px; padding:22px; overflow:auto; overscroll-behavior:contain; color:#edf3ff; background:rgba(13,24,45,.95); border:1px solid rgba(190,215,255,.12); border-radius:22px; box-shadow:0 18px 45px rgba(0,0,0,.16); font-family:Manrope,sans-serif; scrollbar-width:thin; scrollbar-color:#40516b transparent; }
.ludo-hud [hidden] { display:none !important; }
.ludo-hud button, .ludo-hud summary { font:inherit; -webkit-tap-highlight-color:transparent; touch-action:manipulation; }
.ludo-hud button { cursor:pointer; }
.ludo-hud button:disabled { cursor:default; }
.ludo-hud button:focus-visible, .ludo-hud summary:focus-visible { outline:3px solid #88eaf3; outline-offset:3px; }
.ludo-hud__header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.ludo-hud__brand { font-family:'Space Grotesk',Manrope,sans-serif; font-weight:700; font-size:21px; letter-spacing:-.8px; white-space:nowrap; }
.ludo-hud__brand span { color:#9daec8; font-weight:400; }
.ludo-hud__round { font-size:9px; font-weight:800; letter-spacing:1.1px; color:#9daec8; white-space:nowrap; }
.ludo-hud__players { display:grid; gap:10px; }
.ludo-hud__player { min-height:43px; display:flex; align-items:center; gap:10px; }
.ludo-hud__player-dot { flex:0 0 10px; width:10px; height:10px; border-radius:50%; background:var(--player-color); box-shadow:0 0 0 4px color-mix(in srgb,var(--player-color) 13%,transparent); }
.ludo-hud__player.is-current .ludo-hud__player-dot { box-shadow:0 0 0 4px color-mix(in srgb,var(--player-color) 25%,transparent),0 0 18px color-mix(in srgb,var(--player-color) 35%,transparent); }
.ludo-hud__player-copy { flex:1; min-width:0; display:grid; gap:4px; }
.ludo-hud__player-copy strong { color:#f1f5ff; font-size:12px; font-weight:800; white-space:nowrap; }
.ludo-hud__player-copy span { font-size:10px; color:#9daec8; white-space:nowrap; }
.ludo-hud__home-count { font-size:11px; color:#c2cee1; white-space:nowrap; }
.ludo-hud__player.is-away { opacity:.65; }
.ludo-hud__turn { padding-top:18px; border-top:1px solid rgba(190,215,255,.11); }
.ludo-hud__turn-line { display:flex; align-items:center; justify-content:space-between; min-height:18px; gap:8px; }
.ludo-hud__eyebrow { color:var(--ludo-piece-color); font-size:10px; letter-spacing:1.4px; font-weight:800; }
.ludo-hud__timer { color:#c5d4e9; font-size:12px; font-variant-numeric:tabular-nums; }
.ludo-hud__timer.is-urgent { color:#ffae95; }
.ludo-hud__headline h2 { margin:9px 0 7px; font-family:'Space Grotesk',Manrope,sans-serif; font-size:27px; line-height:1.12; letter-spacing:-.8px; font-weight:600; }
.ludo-hud__headline p { margin:0; color:#acbed7; font-size:12px; line-height:1.6; min-height:38px; }
.ludo-hud__time-track { height:3px; margin-top:14px; border-radius:4px; overflow:hidden; background:#2c3a50; }
.ludo-hud__time-track i { display:block; height:100%; width:100%; background:var(--ludo-turn-color); transform-origin:left; transition:transform .1s linear; }
.ludo-hud__roll { min-height:58px; flex-shrink:0; width:100%; padding:9px 12px; display:flex; align-items:center; justify-content:center; gap:12px; border:1px solid #83eff5; border-radius:13px; background:#8cebf0; color:#11243b; font-size:15px; font-weight:800; transition:background .15s,transform .15s,box-shadow .15s; box-shadow:0 5px 22px rgba(64,215,232,.09); }
.ludo-hud__roll:not(:disabled):hover { background:#b6f7f7; box-shadow:0 7px 28px rgba(64,215,232,.19); transform:translateY(-1px); }
.ludo-hud__roll:not(:disabled):active { transform:translateY(1px); }
.ludo-hud__roll:disabled { color:#acbed7; background:#1a2a43; border-color:#30405b; box-shadow:none; }
.ludo-hud__roll-label { flex:1; text-align:left; }
.ludo-hud__key { display:grid; place-items:center; width:20px; height:20px; border:1px solid currentColor; opacity:.6; font-size:10px; border-radius:5px; }
.ludo-hud__die { flex:0 0 31px; position:relative; display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); gap:3px; width:31px; height:31px; padding:6px; background:#fff4dd; border-radius:7px; color:#142841; box-shadow:0 2px 0 #d6c7a8; }
.ludo-hud__die i { width:4px; height:4px; display:block; align-self:center; justify-self:center; border-radius:50%; background:currentColor; }
.ludo-hud__die i[hidden] { display:block !important; visibility:hidden; }
.ludo-hud__die b { position:absolute; inset:0; display:grid; place-items:center; font-size:18px; }
.ludo-hud__die b[hidden] { display:none !important; }
.ludo-hud__roll.is-rolling .ludo-hud__die { animation:ludo-die-wait .6s ease-in-out infinite alternate; }
.ludo-hud__pieces { display:grid; gap:9px; }
.ludo-hud__pieces-label { display:flex; justify-content:space-between; color:#9daec8; font-size:9px; letter-spacing:1.1px; font-weight:800; }
.ludo-hud__pieces-label span:last-child { letter-spacing:1px; color:#748ba9; }
.ludo-hud__piece-grid { display:grid; grid-template-columns:repeat(4,minmax(44px,1fr)); gap:7px; }
.ludo-hud__piece { position:relative; min-width:44px; min-height:52px; border:1px solid #43516a; border-radius:11px; background:#19283e; color:#f7faff; display:flex; align-items:center; justify-content:center; gap:5px; font-size:11px; font-weight:800; transition:border-color .16s,background .16s,transform .16s; }
.ludo-hud__piece:disabled { border-color:#26364d; color:#7d91ad; background:#152137; }
.ludo-hud__piece:disabled .ludo-hud__pawn { opacity:.3; }
.ludo-hud__piece:not(:disabled):hover { background:#2d3d54; transform:translateY(-2px); }
.ludo-hud__piece[aria-pressed='true'] { border-color:var(--ludo-piece-color); background:color-mix(in srgb,var(--ludo-piece-color) 18%,#17263d); box-shadow:inset 0 0 0 1px var(--ludo-piece-color); }
.ludo-hud__piece[aria-pressed='true']:disabled { box-shadow:none; }
.ludo-hud__pawn { position:relative; width:11px; height:14px; margin-top:5px; background:var(--ludo-piece-color); border-radius:5px 5px 3px 3px; }
.ludo-hud__pawn::before { content:''; position:absolute; width:9px; height:9px; left:1px; top:-6px; border-radius:50%; background:inherit; }
.ludo-hud__pawn::after { content:''; position:absolute; width:15px; height:4px; left:-2px; bottom:-2px; border-radius:4px; background:inherit; }
.ludo-hud__footer { display:flex; align-items:center; flex-wrap:wrap; column-gap:10px; margin-top:auto; }
.ludo-hud__legend { display:flex; align-items:center; gap:4px; margin-right:auto; }
.ludo-hud__legend i { width:6px; height:6px; border-radius:50%; }
.ludo-hud__invite { min-height:44px; padding:0; color:#9de9ee; font-size:11px; font-weight:700; border:0; background:none; }
.ludo-hud__help { margin-left:auto; }
.ludo-hud__help summary { min-height:44px; display:flex; align-items:center; justify-content:flex-end; gap:6px; cursor:pointer; color:#b6c7dc; font-size:10px; list-style:none; }
.ludo-hud__help summary::-webkit-details-marker { display:none; }
.ludo-hud__help summary span { display:grid; place-items:center; width:15px; height:15px; border:1px solid #6d819e; border-radius:50%; font-size:10px; }
.ludo-hud__help[open] { flex-basis:100%; }
.ludo-hud__rules { color:#b6c7dc; font-size:11px; line-height:1.7; border-top:1px solid #2c3a50; padding-top:8px; }
.ludo-hud__rules p { margin:8px 0; }
.ludo-hud__rules strong { color:#edf3ff; }
.ludo-hud__error { padding-top:12px; border-top:1px solid #40516b; }
.ludo-hud__error p { font-size:12px; color:#ffc8ad; line-height:1.6; margin:0 0 8px; }
.ludo-hud__error button { width:100%; min-height:44px; color:#0e2439; background:#8cebf0; border:0; border-radius:9px; font-weight:800; }
.ludo-hud.is-compact { top:58px; gap:5px; padding:11px; border-radius:17px; }
.ludo-hud.is-compact .ludo-hud__brand { font-size:17px; letter-spacing:-.6px; }
.ludo-hud.is-compact .ludo-hud__round { font-size:8px; letter-spacing:.6px; }
.ludo-hud.is-compact .ludo-hud__players { gap:3px; }
.ludo-hud.is-compact .ludo-hud__player { min-height:22px; gap:7px; }
.ludo-hud.is-compact .ludo-hud__player-dot { width:7px; height:7px; flex-basis:7px; }
.ludo-hud.is-compact .ludo-hud__player-copy { gap:0; }
.ludo-hud.is-compact .ludo-hud__player-copy strong { font-size:10px; }
.ludo-hud.is-compact .ludo-hud__player-copy span { display:none; }
.ludo-hud.is-compact .ludo-hud__home-count { font-size:10px; }
.ludo-hud.is-compact .ludo-hud__turn { padding-top:6px; }
.ludo-hud.is-compact .ludo-hud__turn-line { min-height:12px; }
.ludo-hud.is-compact .ludo-hud__eyebrow { font-size:8px; letter-spacing:1px; }
.ludo-hud.is-compact .ludo-hud__timer { font-size:10px; }
.ludo-hud.is-compact .ludo-hud__headline h2 { margin:4px 0; font-size:20px; line-height:1.08; letter-spacing:-.5px; }
.ludo-hud.is-compact .ludo-hud__headline p { font-size:10px; line-height:1.4; min-height:14px; }
.ludo-hud.is-compact .ludo-hud__time-track { height:2px; margin-top:6px; }
.ludo-hud.is-compact .ludo-hud__roll { min-height:45px; padding:6px 8px; gap:8px; font-size:12px; border-radius:10px; }
.ludo-hud.is-compact .ludo-hud__die { width:27px; height:27px; flex-basis:27px; padding:5px; gap:2px; }
.ludo-hud.is-compact .ludo-hud__key { display:none; }
.ludo-hud.is-compact .ludo-hud__pieces { gap:4px; }
.ludo-hud.is-compact .ludo-hud__pieces-label { display:none; }
.ludo-hud.is-compact .ludo-hud__piece-grid { gap:3px; }
.ludo-hud.is-compact .ludo-hud__piece { min-height:44px; border-radius:9px; }
.ludo-hud.is-compact .ludo-hud__footer { gap:4px; }
.ludo-hud.is-compact .ludo-hud__legend { gap:3px; }
.ludo-hud.is-compact .ludo-hud__legend i { width:5px; height:5px; }
.ludo-hud.is-compact .ludo-hud__help summary { font-size:9px; }
.ludo-hud.is-compact .ludo-hud__invite { font-size:10px; }
@keyframes ludo-die-wait { from { transform:rotate(-9deg) translateY(-1px); } to { transform:rotate(9deg) translateY(1px); } }
@media (prefers-reduced-motion:reduce) { .ludo-hud *, .ludo-hud *::before, .ludo-hud *::after { animation:none !important; transition:none !important; } }
`;
