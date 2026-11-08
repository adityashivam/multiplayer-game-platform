import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createDrawBoard } from "../public/games/draw/client/drawBoard.js";
import { createGameRoomConnection } from "../public/platform/frontend-engine/gameRoomConnection.js";
import { SOCKET_EVENT } from "../public/platform/shared/networkProtocol.js";
import {
  DRAW_EVENT,
  DRAW_SYNC_INPUT,
  DRAW_PLAYER_COLORS,
  normalizeDrawPoint,
  normalizeDrawSize,
} from "../public/games/draw/shared/drawing.js";

const DRAW_ENTRY_SOURCE = readFileSync(new URL("../public/games/draw/main.js", import.meta.url), "utf8");

/**
 * Run the actual browser entry with real board and room SDK modules. Native
 * EventTargets provide pointer/window events; canvas and transport replace only
 * browser IO. Supplying import bindings avoids Node's lack of browser / routes.
 */
function createDrawClientSession() {
  const sentPackets = [];
  const socketSubscribers = new Map();
  const animationFrames = new Map();
  let nextAnimationFrameId = 1;
  let connected = true;
  let board;
  let paintedFrames = 0;
  const drawingContext = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (label) => ({ width: label.length * 8 }),
    fillRect() { paintedFrames += 1; },
  }, { get: (context, property) => context[property] ?? (() => {}) });
  const canvas = Object.assign(new EventTarget(), {
    style: {},
    getContext: () => drawingContext,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {},
  });
  const windowRef = Object.assign(new EventTarget(), {
    location: { pathname: "/games/draw/drawingroom" },
    history: { replaceState() {} },
  });
  const documentRef = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  const storedValues = new Map();
  const storage = {
    getItem: (storageKey) => storedValues.get(storageKey) ?? null,
    setItem: (storageKey, value) => storedValues.set(storageKey, value),
  };
  const socket = {
    onEvent(eventName, callback) {
      if (!socketSubscribers.has(eventName)) socketSubscribers.set(eventName, new Set());
      socketSubscribers.get(eventName).add(callback);
      return () => socketSubscribers.get(eventName).delete(callback);
    },
    onConnectionChange: () => () => {},
    send: (eventName, payload) => sentPackets.push({ eventName, payload: structuredClone(payload) }),
    isConnected: () => connected,
    getConnectionState: () => connected ? "connected" : "disconnected",
    getPing: () => 300,
    destroy() { connected = false; },
  };
  function createControllerButton() {
    const pressSubscribers = new Set();
    return {
      onPress(callback) {
        pressSubscribers.add(callback);
        return () => pressSubscribers.delete(callback);
      },
      press() { pressSubscribers.forEach((subscriber) => subscriber()); },
    };
  }
  const controllerButtons = {
    start: createControllerButton(),
    x: createControllerButton(),
    y: createControllerButton(),
  };
  const bindings = {
    window: windowRef,
    document: documentRef,
    CustomEvent,
    getGameDomRefs: () => ({ canvas }),
    getGameControls: () => ({ menu: { start: controllerButtons.start }, actions: controllerButtons }),
    getGameSocket: () => socket,
    hideEndGameModal() {},
    registerRematchHandler() {},
    openShareModal() {},
    updateConnectionState() {},
    createGameRoomConnection: (options) => createGameRoomConnection({ ...options, windowRef, storage }),
    createDrawBoard() {
      board = createDrawBoard();
      return board;
    },
    SOCKET_EVENT,
    DRAW_EVENT,
    DRAW_SYNC_INPUT,
    DRAW_PLAYER_COLORS,
    normalizeDrawPoint,
    normalizeDrawSize,
    requestAnimationFrame(callback) {
      const animationFrameId = nextAnimationFrameId++;
      animationFrames.set(animationFrameId, callback);
      return animationFrameId;
    },
    cancelAnimationFrame: (animationFrameId) => animationFrames.delete(animationFrameId),
  };
  runInNewContext(DRAW_ENTRY_SOURCE.replace(/^import .+ from ["'][^"']+["'];\r?\n/gm, ""), bindings, {
    filename: "public/games/draw/main.js",
  });

  function receiveEvent(eventName, payload) {
    for (const subscriber of socketSubscribers.get(eventName) ?? []) subscriber(payload);
  }

  function pointerEvent(eventName, point = { x: 0.2, y: 0.3 }) {
    const event = new Event(eventName, { cancelable: true });
    Object.assign(event, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: point.x * 1280,
      clientY: point.y * 720,
    });
    canvas.dispatchEvent(event);
  }

  function receiveState({ started = false, connectedRival = true, revision = 0, clearVersion = 0 } = {}) {
    receiveEvent("state", {
      started,
      startAt: started ? null : 5000,
      gameOver: false,
      revision,
      clearVersion,
      players: { p1: { connected: true }, p2: { connected: connectedRival } },
    });
  }

  return {
    sentPackets,
    receiveEvent,
    receiveState,
    pointerEvent,
    board: () => board,
    join() { receiveEvent("gameJoined", { gameId: "drawingroom", playerId: "p1", rejoinToken: "retained-seat" }); },
    hydrate(strokes = [], revision = 0, clearVersion = 0) {
      receiveEvent("drawBoard", { strokes, revision, clearVersion });
    },
    clear: () => controllerButtons.x.press(),
    dispose: () => windowRef.dispatchEvent(new CustomEvent("kaboom:dispose-game", { detail: { gameId: "draw" } })),
    pendingAnimationFrames: () => animationFrames.size,
    paintedFrames: () => paintedFrames,
    renderNextFrame() {
      const [animationFrameId, renderFrame] = animationFrames.entries().next().value;
      animationFrames.delete(animationFrameId);
      renderFrame();
    },
    getStrokePackets: () => sentPackets.filter((packet) => packet.eventName === "input" && packet.payload.type?.startsWith("stroke")),
  };
}

test("Draw entry prevents drawing until recovery and the authoritative countdown complete", () => {
  const client = createDrawClientSession();
  client.join();
  client.pointerEvent("pointerdown");
  assert.equal(client.getStrokePackets().length, 0);
  client.hydrate();
  client.receiveState();
  client.pointerEvent("pointerdown");
  client.clear();
  assert.equal(client.getStrokePackets().length, 0);
  assert.equal(client.sentPackets.filter((packet) => packet.payload?.type === "clear").length, 0);

  client.receiveState({ started: true });
  client.pointerEvent("pointerdown");
  client.pointerEvent("pointermove", { x: 0.4, y: 0.5 });
  client.pointerEvent("pointerup");
  assert.deepEqual(client.getStrokePackets().map((packet) => packet.payload.type), ["strokeStart", "strokeMove", "strokeEnd"]);
  assert.deepEqual(structuredClone(client.board().getStrokes()[0].points), [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }]);
  client.dispose();
});

test("Draw entry preserves immediate points when delayed local stroke echoes arrive", () => {
  const client = createDrawClientSession();
  client.join();
  client.hydrate();
  client.receiveState({ started: true });
  client.pointerEvent("pointerdown");
  client.pointerEvent("pointermove", { x: 0.4, y: 0.5 });
  client.pointerEvent("pointermove", { x: 0.6, y: 0.7 });
  const strokeId = client.getStrokePackets()[0].payload.strokeId;
  client.receiveEvent("drawEvent", { action: "start", owner: "p1", strokeId, point: { x: 0.2, y: 0.3 }, revision: 1, clearVersion: 0 });
  client.receiveEvent("drawEvent", { action: "move", owner: "p1", strokeId, point: { x: 0.4, y: 0.5 }, revision: 2, clearVersion: 0 });
  assert.deepEqual(structuredClone(client.board().getStroke(strokeId).points), [
    { x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.7 },
  ]);
  client.pointerEvent("pointerup");
  client.dispose();
});

test("Draw entry stays paused when board recovery beats the disconnect lifecycle snapshot", () => {
  const client = createDrawClientSession();
  client.join();
  client.hydrate();
  client.receiveState({ started: true });
  client.receiveEvent("playerLeft", { playerId: "p2" });
  client.hydrate();
  client.pointerEvent("pointerdown");
  assert.equal(client.getStrokePackets().length, 0, "a recovered board cannot reuse the old playing lifecycle");
  assert.equal(client.board().getStrokes().length, 0, "no server-rejected optimistic stroke may survive pause");
  client.receiveState({ connectedRival: false });
  client.receiveState({ started: false, connectedRival: true });
  client.pointerEvent("pointerdown");
  assert.equal(client.getStrokePackets().length, 0, "the resumed countdown still rejects drawing");
  client.receiveState({ started: true });
  client.pointerEvent("pointerdown");
  assert.equal(client.getStrokePackets().length, 1);
  client.dispose();
});

test("Draw entry waits for its own clear and cleans up input and rendering on disposal", () => {
  const client = createDrawClientSession();
  client.join();
  client.hydrate();
  client.receiveState({ started: true });
  client.clear();
  client.receiveEvent("drawEvent", { action: "clear", owner: "p2", revision: 1, clearVersion: 1 });
  client.pointerEvent("pointerdown");
  assert.equal(client.getStrokePackets().length, 0, "a competing clear cannot release this player's pending clear");
  client.receiveEvent("drawEvent", { action: "clear", owner: "p1", revision: 2, clearVersion: 2 });
  client.pointerEvent("pointerdown");
  client.pointerEvent("pointerup");
  assert.equal(client.getStrokePackets().length, 2);
  client.renderNextFrame();
  assert.ok(client.paintedFrames() > 0);
  client.dispose();
  const sentPacketsAfterDispose = client.sentPackets.length;
  assert.equal(client.pendingAnimationFrames(), 0);
  client.pointerEvent("pointerdown");
  client.pointerEvent("pointermove", { x: 0.7, y: 0.8 });
  client.clear();
  client.receiveEvent("state", { started: true, players: { p1: { connected: true }, p2: { connected: true } } });
  assert.equal(client.sentPackets.length, sentPacketsAfterDispose, "disposed pointer/controller/socket events do not send commands");
  assert.equal(client.pendingAnimationFrames(), 0);
});
