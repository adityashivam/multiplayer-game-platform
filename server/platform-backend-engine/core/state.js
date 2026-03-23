export function bothPlayersConnected(state) {
  return state.players.p1.connected && state.players.p2.connected;
}

export function scheduleStart(state, countdownMs, onScheduleStart) {
  if (!state.started && !state.gameOver && !state.startAt && bothPlayersConnected(state)) {
    if (onScheduleStart) {
      onScheduleStart(state);
    }
    state.startAt = Date.now() + countdownMs;
  }
}
