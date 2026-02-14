import { emitEvent } from "./events.js";

export function tickGames({
  games,
  nsp,
  tickMs = 1000 / 60,
  dtFallback = 1 / 60,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  stateEvent = "state",
  shouldCleanup,
}) {
  const now = Date.now();
  const toDelete = [];

  for (const [gameId, state] of games.entries()) {
    if (shouldCleanup && shouldCleanup(state, now)) {
      toDelete.push(gameId);
      continue;
    }

    const dt = (now - state.lastUpdate) / 1000 || dtFallback;
    state.lastUpdate = now;

    if (beforeUpdate) {
      beforeUpdate(state, dt);
    }

    if (updateState) {
      updateState(state, dt);
    }

    if (serializeState) {
      let payload = serializeState(state);
      payload = decorateStatePayload(payload, state, now, tickMs);
      emitEvent({ nsp, gameId, type: stateEvent, payload, target: "game" });
    }

    if (afterEmit) {
      afterEmit(state, dt);
    }
  }

  for (const id of toDelete) {
    games.delete(id);
  }
}

function decorateStatePayload(payload, state, now, tickMs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const existingNet =
    payload.net && typeof payload.net === "object" && !Array.isArray(payload.net) ? payload.net : {};
  const seq = Number.isFinite(existingNet.seq) ? existingNet.seq : ((state.__netSeq || 0) + 1);
  state.__netSeq = seq;
  const tickRate = tickMs > 0 ? Math.round(1000 / tickMs) : null;

  return {
    ...payload,
    net: {
      ...existingNet,
      seq,
      serverTime: Number.isFinite(existingNet.serverTime) ? existingNet.serverTime : now,
      tickRate: Number.isFinite(existingNet.tickRate) ? existingNet.tickRate : tickRate,
    },
  };
}
