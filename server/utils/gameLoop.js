import { emitEvent } from "./events.js";

export function tickGames({
  games,
  nsp,
  dtFallback = 1 / 60,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  stateEvent = "state",
}) {
  const now = Date.now();

  for (const [gameId, state] of games.entries()) {
    const dt = (now - state.lastUpdate) / 1000 || dtFallback;
    state.lastUpdate = now;

    if (beforeUpdate) {
      beforeUpdate(state, dt);
    }

    if (updateState) {
      updateState(state, dt);
    }

    if (serializeState) {
      emitEvent({ nsp, gameId, type: stateEvent, payload: serializeState(state), target: "game" });
    }

    if (afterEmit) {
      afterEmit(state, dt);
    }
  }
}
