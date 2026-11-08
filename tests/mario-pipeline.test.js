import test from "node:test";
import assert from "node:assert/strict";
import { createMarioTestSession, readMarioSnapshotField } from "./mario-test-helpers.js";

for (const gameId of ["mario", "mario-touch"]) {
  test(`${gameId} acknowledges queued movement only after authoritative simulation`, () => {
    const session = createMarioTestSession(gameId);
    const client = session.connectPlayer();
    session.connectPlayer();
    const state = session.getState();
    const playerState = state.players.p1;
    const joinedPayload = client.socketEvents.find(([eventName]) => eventName === "gameJoined")[1];
    assert.equal(joinedPayload.inputEpoch, 1);
    state.started = true;
    state.startAt = null;
    const initialX = playerState.x;
    session.sendInputFrame(client, 1, { right: true });
    assert.equal(playerState.lastInputSeqAck, 0);
    session.advanceSimulation();
    assert.ok(Math.abs(playerState.x - initialX - 920 / 3600) < 1e-9);
    assert.equal(playerState.lastInputSeqAck, 1);
    session.advanceSimulation();
    assert.ok(playerState.x > initialX + 0.7, "held movement continues between packets");
    const snapshot = session.emitSnapshot();
    assert.equal(readMarioSnapshotField(snapshot, "inputProtocol"), 2);
    assert.equal(readMarioSnapshotField(snapshot, "players.p1.inputEpoch"), 1);
    assert.equal(readMarioSnapshotField(snapshot, "players.p1.inputSeqAck"), 1);
    assert.equal(readMarioSnapshotField(snapshot, "players.p1.movementEpoch"), 0);
  });

  test(`${gameId} pauses progress on disconnect and clears stale controls for both seats`, () => {
    const session = createMarioTestSession(gameId);
    const firstClient = session.connectPlayer();
    const secondClient = session.connectPlayer();
    const state = session.getState();
    state.started = true;
    state.startAt = null;
    state.players.p1.x = 108;
    state.players.p2.x = 148;
    const token = state.players.p1.rejoinToken;
    const oldFrame = session.sendInputFrame(firstClient, 1, { right: true, jump: true });
    session.sendInputFrame(secondClient, 1, { right: true, run: true });
    firstClient.disconnect();
    assert.equal(state.started, false);
    for (const playerState of Object.values(state.players)) {
      assert.equal(playerState.input.right, false);
      assert.equal(playerState.input.jump, false);
      assert.equal(playerState.inputEpoch, 2);
    }
    session.advanceSimulation();
    assert.equal(state.players.p1.x, 108);
    assert.equal(state.players.p2.x, 148);
    const rejoinedClient = session.connectPlayer(token);
    assert.equal(rejoinedClient.socket.data.playerId, "p1");
    assert.equal(state.players.p1.inputEpoch, 3);
    rejoinedClient.socketHandlers.input(oldFrame);
    state.started = true;
    state.startAt = null;
    session.advanceSimulation();
    assert.equal(state.players.p1.x, 108);
    assert.equal(state.players.p2.x, 148);
    assert.equal(state.players.p1.lastInputSeqAck, 0);
  });

  test(`${gameId} rematches preserve seat tokens and advance input ownership`, () => {
    const session = createMarioTestSession(gameId);
    const firstClient = session.connectPlayer();
    const secondClient = session.connectPlayer();
    const previousState = session.getState();
    const oldFrame = session.sendInputFrame(firstClient, 1, { right: true, jump: true });
    previousState.gameOver = true;
    previousState.players.p1.finished = true;
    firstClient.socketHandlers.rematch();
    secondClient.socketHandlers.rematch();
    const nextState = session.getState();
    assert.notEqual(nextState, previousState);
    for (const playerId of ["p1", "p2"]) {
      assert.equal(nextState.players[playerId].rejoinToken, previousState.players[playerId].rejoinToken);
      assert.equal(nextState.players[playerId].inputEpoch, previousState.players[playerId].inputEpoch + 1);
      assert.equal(nextState.players[playerId].finished, false);
      assert.equal(nextState.players[playerId].connected, true);
    }
    firstClient.socketHandlers.input(oldFrame);
    nextState.started = true;
    nextState.startAt = null;
    const initialX = nextState.players.p1.x;
    session.advanceSimulation();
    assert.equal(nextState.players.p1.x, initialX);
    assert.equal(nextState.players.p1.lastInputSeqAck, 0);
  });
}

test("Mario merges a complete short jump press from an ordered input burst", () => {
  const session = createMarioTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  session.sendInputFrame(client, 1);
  session.advanceSimulation();
  session.advanceSimulation();
  session.advanceSimulation();
  const groundY = state.players.p1.y;
  session.sendInputFrame(client, 2, { jump: true });
  session.sendInputFrame(client, 3);
  session.advanceSimulation();
  assert.ok(state.players.p1.y < groundY - 6);
  assert.equal(state.players.p1.lastInputSeqAck, 3);
});

test("Mario preserves both players' progress and seat tokens while both reconnect", () => {
  const session = createMarioTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  state.players.p1.x = 176;
  state.players.p2.x = 208;
  state.enemies[0].x = 264;
  const firstToken = state.players.p1.rejoinToken;
  const secondToken = state.players.p2.rejoinToken;
  firstClient.disconnect();
  secondClient.disconnect();
  assert.equal(state.players.p1.x, 176);
  assert.equal(state.players.p2.x, 208);
  assert.equal(state.enemies[0].x, 264);
  assert.equal(state.started, false);
  assert.equal(state.players.p1.rejoinToken, firstToken);
  assert.equal(state.players.p2.rejoinToken, secondToken);
  const rejoinedFirst = session.connectPlayer(firstToken);
  const rejoinedSecond = session.connectPlayer(secondToken);
  assert.equal(rejoinedFirst.socket.data.playerId, "p1");
  assert.equal(rejoinedSecond.socket.data.playerId, "p2");
  assert.equal(state.players.p1.x, 176);
  assert.equal(state.players.p2.x, 208);
  assert.equal(state.abandonedAt, null);
  assert.ok(state.startAt > 0);
});

test("Mario legacy fallback preserves a complete short jump press", () => {
  const session = createMarioTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  client.socketHandlers.input({ type: "jump", value: true });
  client.socketHandlers.input({ type: "jump", value: false });
  session.advanceSimulation();
  assert.ok(state.players.p1.y < 186, "short legacy taps retain the original queued jump behavior");
});

test("Mario hurt and falling respawns expose discontinuities without changing race results", () => {
  const session = createMarioTestSession();
  session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  const playerState = state.players.p1;
  playerState.x = 112;
  playerState.y = 480;
  const originalEpoch = playerState.movementEpoch;
  session.advanceSimulation();
  assert.equal(playerState.movementEpoch, originalEpoch + 1);
  assert.equal(playerState.y, 192);
  assert.equal(playerState.finished, false);
  assert.equal(state.winner, null);

  const enemyState = state.enemies[0];
  Object.assign(enemyState, { x: 160, y: 192, vx: 0, vy: 0, alive: true, stomped: false });
  Object.assign(playerState, { x: 160, y: 192, vx: 0, vy: 0, hurtCooldown: 0 });
  session.advanceSimulation();
  assert.equal(playerState.movementEpoch, originalEpoch + 2);
  assert.equal(playerState.hurtCooldown, 0.85);
  assert.equal(playerState.x, 64);
  assert.equal(playerState.y, 192);
  assert.equal(enemyState.alive, true);
});
