import test from "node:test";
import assert from "node:assert/strict";
import {
  createAxisMovementController,
  createHorizontalSeparationController,
  createSideViewCharacterController,
  createTimedActionController,
} from "../public/platform/shared/simulationControllers.js";

const CHARACTER_STATE_BINDINGS = {
  x: "center",
  y: "height",
  vx: "horizontalSpeed",
  vy: "verticalSpeed",
  facing: "heading",
  disabled: "removed",
};
const CHARACTER_INPUT_BINDINGS = { negative: "west", positive: "east", jump: "leap" };
const CHARACTER_MOVEMENT = {
  speed: 12,
  busySpeed: 3,
  jumpSpeed: -20,
  gravity: 8,
  floorY: 100,
  minX: 10,
  maxX: 90,
  groundTolerance: 0.5,
};
const ACTION_STATE_BINDINGS = {
  active: "casting",
  kind: "ability",
  remainingSec: "castSec",
  cooldownSec: "lockSec",
};

function createCharacterState(overrides = {}) {
  return {
    center: 40,
    height: 100,
    horizontalSpeed: 0,
    verticalSpeed: 0,
    heading: 1,
    removed: false,
    casting: false,
    ability: null,
    castSec: 0,
    lockSec: 0,
    touched: true,
    ...overrides,
  };
}

function createActionController(overrides = {}) {
  return createTimedActionController({
    state: ACTION_STATE_BINDINGS,
    definitions: {
      pulse: { duration: 0.5, cooldown: 0.25 },
      burst: { duration: 0.75, cooldown: 0.5 },
    },
    bindings: [
      { inputKey: "special", actionId: "burst" },
      { inputKey: "primary", actionId: "pulse" },
    ],
    onStart: (playerState) => {
      playerState.touched = false;
    },
    ...overrides,
  });
}

function createCharacterController(overrides = {}) {
  return createSideViewCharacterController({
    state: CHARACTER_STATE_BINDINGS,
    input: CHARACTER_INPUT_BINDINGS,
    movement: CHARACTER_MOVEMENT,
    actions: createActionController(),
    ...overrides,
  });
}

test("axis movement binds unrelated state/input keys and enforces configured speed and bounds", () => {
  const stepAxis = createAxisMovementController({
    state: { position: "progress" },
    input: { negative: "rewind", positive: "advance" },
    speed: 8,
    min: 2,
    max: 12,
  });
  const playerState = { progress: 5, score: 9 };
  const inputState = { rewind: false, advance: true };
  assert.equal(stepAxis(playerState, inputState, 0.25), undefined);
  assert.deepEqual(playerState, { progress: 7, score: 9 });
  assert.deepEqual(inputState, { rewind: false, advance: true });

  stepAxis(playerState, { rewind: true, advance: false }, 1);
  assert.equal(playerState.progress, 2);
  stepAxis(playerState, inputState, 10);
  assert.equal(playerState.progress, 12);
});

test("axis movement cancels opposing controls and clamps an idle out-of-bounds pose", () => {
  const stepAxis = createAxisMovementController({
    state: { position: "offset" },
    input: { negative: "north", positive: "south" },
    speed: 3,
    min: -4,
    max: 4,
  });
  const playerState = { offset: 1 };
  stepAxis(playerState, { north: true, south: true }, 2);
  assert.equal(playerState.offset, 1);
  playerState.offset = 10;
  stepAxis(playerState, {}, 0);
  assert.equal(playerState.offset, 4);
});

test("configured action bindings select priority and advance start timers in the same step", () => {
  const actions = createActionController();
  const playerState = createCharacterState();
  actions.step(playerState, { special: true, primary: true }, 0.25);
  assert.equal(actions.isActive(playerState), true);
  assert.equal(playerState.ability, "burst");
  assert.equal(playerState.castSec, 0.5);
  assert.equal(playerState.lockSec, 1);
  assert.equal(playerState.touched, false);

  actions.step(playerState, { primary: true }, 0.5);
  assert.equal(playerState.casting, false);
  assert.equal(playerState.ability, null);
  assert.equal(playerState.castSec, 0);
  assert.equal(playerState.lockSec, 0.5);
  actions.step(playerState, { primary: true }, 0.75);
  assert.equal(playerState.casting, false);
  assert.equal(playerState.lockSec, -0.25);
  actions.step(playerState, { primary: true }, 0.125);
  assert.equal(playerState.ability, "pulse");
  assert.equal(playerState.castSec, 0.375);
  assert.equal(playerState.lockSec, 0.625);
});

test("an optional action predicate can select an action from another control and player pose", () => {
  const actions = createActionController({
    bindings: [
      {
        inputKey: "special",
        actionId: "burst",
        when: (playerState, inputState) => inputState.special ||
          (inputState.primary && playerState.height < 95),
      },
      { inputKey: "primary", actionId: "pulse" },
    ],
  });
  const groundedPlayer = createCharacterState();
  const airbornePlayer = createCharacterState({ height: 94 });
  actions.step(groundedPlayer, { primary: true }, 0);
  actions.step(airbornePlayer, { primary: true }, 0);
  assert.equal(groundedPlayer.ability, "pulse");
  assert.equal(airbornePlayer.ability, "burst");
});

test("character motion uses pre-action speed/facing and integrates jump after action selection", () => {
  const stepCharacter = createCharacterController();
  const playerState = createCharacterState();
  const inputState = { west: true, east: false, leap: true, primary: true };
  assert.equal(stepCharacter(playerState, inputState, 0.25), playerState);
  assert.equal(playerState.horizontalSpeed, -12);
  assert.equal(playerState.heading, -1);
  assert.equal(playerState.center, 37);
  assert.equal(playerState.verticalSpeed, -18);
  assert.equal(playerState.height, 95.5);
  assert.equal(playerState.ability, "pulse");
  assert.equal(playerState.castSec, 0.25);

  stepCharacter(playerState, { east: true }, 0.25);
  assert.equal(playerState.horizontalSpeed, 3);
  assert.equal(playerState.heading, -1);
  assert.equal(playerState.center, 37.75);
  assert.equal(playerState.height, 91.5);
  assert.equal(playerState.casting, false);
  stepCharacter(playerState, { east: true }, 0.25);
  assert.equal(playerState.horizontalSpeed, 12);
  assert.equal(playerState.heading, 1);
  assert.equal(playerState.center, 40.75);
});

test("disabled character simulation changes only horizontal velocity even while inactive", () => {
  const stepCharacter = createCharacterController();
  const playerState = createCharacterState({
    removed: true, height: 110, horizontalSpeed: 9, verticalSpeed: 4,
    casting: true, ability: "burst", castSec: 0.5, lockSec: 0.75,
  });
  const expectedPlayer = { ...playerState, horizontalSpeed: 0 };
  stepCharacter(playerState, { west: true, primary: true }, 1, { active: false });
  assert.deepEqual(playerState, expectedPlayer);
});

test("inactive character simulation clears motion/actions, clamps the floor and retains cooldown", () => {
  const stepCharacter = createCharacterController();
  const playerState = createCharacterState({
    height: 110, horizontalSpeed: 9, verticalSpeed: 4,
    casting: true, ability: "burst", castSec: 0.5, lockSec: 0.75,
  });
  stepCharacter(playerState, { west: true, primary: true }, 1, { active: false });
  assert.deepEqual(playerState, createCharacterState({ lockSec: 0.75 }));
});

test("character controllers also support movement without action, facing or disabled fields", () => {
  const stepCharacter = createCharacterController({
    state: { x: "center", y: "height", vx: "horizontalSpeed", vy: "verticalSpeed" },
    actions: undefined,
  });
  const playerState = { center: 89, height: 99.5, horizontalSpeed: 0, verticalSpeed: 0 };
  stepCharacter(playerState, { east: true, leap: true }, 0.25);
  assert.deepEqual(playerState, { center: 90, height: 95, horizontalSpeed: 12, verticalSpeed: -18 });

  const airbornePlayer = { center: 40, height: 99.4, horizontalSpeed: 0, verticalSpeed: 0 };
  stepCharacter(airbornePlayer, { leap: true }, 0);
  assert.equal(airbornePlayer.verticalSpeed, 0);
  stepCharacter(airbornePlayer, {}, 1);
  assert.equal(airbornePlayer.height, 100);
  assert.equal(airbornePlayer.verticalSpeed, 0);
});

test("horizontal separation binds custom poses, splits overlap and clamps arena edges", () => {
  const separatePlayers = createHorizontalSeparationController({
    state: { x: "center", y: "height", vx: "horizontalSpeed" },
    minX: 10,
    maxX: 90,
    minDistance: 30,
    verticalLimit: 10,
  });
  const firstPlayer = { center: 50, height: 20, horizontalSpeed: 5 };
  const secondPlayer = { center: 50, height: 20, horizontalSpeed: -5 };
  separatePlayers(firstPlayer, secondPlayer);
  assert.deepEqual(firstPlayer, { center: 65, height: 20, horizontalSpeed: 0 });
  assert.deepEqual(secondPlayer, { center: 35, height: 20, horizontalSpeed: 0 });

  firstPlayer.center = 12;
  secondPlayer.center = 14;
  separatePlayers(firstPlayer, secondPlayer);
  assert.equal(firstPlayer.center, 10);
  assert.equal(secondPlayer.center, 40);
});

test("horizontal separation transfers blocked wall displacement to the other body", () => {
  const separatePlayers = createHorizontalSeparationController({
    state: { x: "center", y: "height", vx: "speed" },
    minX: 10, maxX: 90, minDistance: 30, verticalLimit: 10,
  });
  const cases = [
    { positions: [10, 14], expected: [10, 40] },
    { positions: [86, 90], expected: [60, 90] },
    { positions: [14, 10], expected: [40, 10] },
    { positions: [90, 86], expected: [90, 60] },
    { positions: [10, 10], expected: [40, 10] },
    { positions: [90, 90], expected: [90, 60] },
    { positions: [-100, 10], expected: [40, 10] },
  ];

  for (const { positions, expected } of cases) {
    const firstPlayer = { center: positions[0], height: 20, speed: 5 };
    const secondPlayer = { center: positions[1], height: 20, speed: -5 };
    separatePlayers(firstPlayer, secondPlayer);
    assert.deepEqual([firstPlayer.center, secondPlayer.center], expected);
    assert.equal(firstPlayer.speed, 0);
    assert.equal(secondPlayer.speed, 0);
    separatePlayers(firstPlayer, secondPlayer);
    assert.deepEqual([firstPlayer.center, secondPlayer.center], expected, "contact must settle in one step");
  }
});

test("contact requires strict horizontal/vertical overlap while bounds always apply", () => {
  const separatePlayers = createHorizontalSeparationController({
    state: { x: "cx", y: "cy", vx: "speed" },
    minX: 0,
    maxX: 100,
    minDistance: 20,
    verticalLimit: 10,
  });
  const firstPlayer = { cx: 30, cy: 0, speed: 4 };
  const secondPlayer = { cx: 50, cy: 0, speed: -4 };
  separatePlayers(firstPlayer, secondPlayer);
  assert.equal(firstPlayer.speed, 4);
  secondPlayer.cx = 31;
  secondPlayer.cy = 10;
  separatePlayers(firstPlayer, secondPlayer);
  assert.equal(firstPlayer.cx, 30);
  assert.equal(firstPlayer.speed, 4);
  firstPlayer.cx = -1;
  separatePlayers(firstPlayer, secondPlayer);
  assert.equal(firstPlayer.cx, 0);
});

test("controller constructors reject invalid bindings, timings and bounds before stepping", () => {
  const axisConfig = {
    state: { position: "position" }, input: { negative: "less", positive: "more" },
    speed: 2, min: 0, max: 1,
  };
  assert.throws(() => createAxisMovementController({ ...axisConfig, speed: NaN }), TypeError);
  assert.throws(() => createAxisMovementController({ ...axisConfig, min: 2 }), TypeError);
  assert.throws(() => createAxisMovementController({ ...axisConfig, state: { position: "" } }), TypeError);
  assert.throws(() => createActionController({ bindings: [{ inputKey: "primary", actionId: "missing" }] }), TypeError);
  assert.throws(() => createActionController({
    definitions: {
      pulse: { duration: -1, cooldown: 0 },
      burst: { duration: 0.5, cooldown: 0.25 },
    },
  }), TypeError);
  assert.throws(() => createCharacterController({ movement: { ...CHARACTER_MOVEMENT, gravity: Infinity } }), TypeError);
  assert.throws(() => createCharacterController({ state: { ...CHARACTER_STATE_BINDINGS, vx: undefined } }), TypeError);
  assert.throws(() => createCharacterController({ actions: false }), TypeError);
  assert.throws(() => createCharacterController({ actions: null }), TypeError);
  assert.throws(() => createHorizontalSeparationController({
    state: { x: "x", y: "y", vx: "vx" },
    minX: 0, maxX: 1, minDistance: 2, verticalLimit: -1,
  }), TypeError);
});
