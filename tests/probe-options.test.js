import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  parseAndValidateProbeOptions,
  resolveProbeGameConfig,
} from "../scripts/lib/probeOptions.js";
import { createProbeInputState } from "../scripts/lib/probeClient.js";
import {
  fightGameMeta,
  pongGameMeta,
  marioGameMeta,
  marioTouchGameMeta,
  roadRashGameMeta,
  drawGameMeta,
  webglSampleGameMeta,
} from "../server/platform-backend-engine/games/metadata.js";

test("probe options retain the required URL and 30 second default while defaulting to fight", () => {
  const probeOptions = parseAndValidateProbeOptions(["--url", "https://example.test"], { defaultGameId: "fight" });

  assert.equal(probeOptions.serverUrl.href, "https://example.test/");
  assert.equal(probeOptions.durationSeconds, 30);
  assert.equal(probeOptions.gameId, "fight");
});

test("probe options select a game and retain fractional diagnostic durations", () => {
  const probeOptions = parseAndValidateProbeOptions([
    "--game", "paddles", "--seconds", "0.5", "--url", "http://localhost:3000",
  ]);

  assert.equal(probeOptions.gameId, "paddles");
  assert.equal(probeOptions.durationSeconds, 0.5);
  assert.equal(probeOptions.serverUrl.origin, "http://localhost:3000");
});

test("probe options reject missing, unknown, repeated and malformed arguments", () => {
  const malformedArguments = [
    [],
    ["--url"],
    ["--url", "http://example.test", "--seconds"],
    ["--url", "http://example.test", "--seconds", "0"],
    ["--url", "http://example.test", "--seconds", "-1"],
    ["--url", "http://example.test", "--seconds", "121"],
    ["--url", "http://example.test", "--seconds", "Infinity"],
    ["--url", "http://example.test", "--seconds", "many"],
    ["--url", "http://example.test", "--game"],
    ["--url", "http://example.test", "--game", " "],
    ["--url", "http://example.test", "--players", "500"],
    ["--url", "http://example.test", "extra"],
    ["--url", "http://example.test", "--url", "http://other.test"],
  ];

  for (const cliArguments of malformedArguments) {
    assert.throws(() => parseAndValidateProbeOptions(cliArguments, { defaultGameId: "fight" }), /Usage:/, JSON.stringify(cliArguments));
  }

  assert.throws(() => parseAndValidateProbeOptions(["--url", "ftp://example.test"], { defaultGameId: "fight" }), /URL must use http or https/);
  assert.throws(() => parseAndValidateProbeOptions(["--url", "not-a-url"], { defaultGameId: "fight" }), /Invalid URL/);
});

test("invalid probe CLI arguments exit before making network requests", () => {
  const probeProcess = spawnSync(process.execPath, [
    "scripts/network-probe.mjs", "--url", "http://localhost:1", "--seconds", "121",
  ], { encoding: "utf8", timeout: 3000 });

  assert.equal(probeProcess.status, 1);
  assert.match(probeProcess.stderr, /Usage:/);
  assert.equal(probeProcess.stdout, "");
});

test("catalog selection uses the selected namespace, arbitrary slots and input schema", () => {
  const gameCatalog = {
    games: [
      {
        id: "paddles",
        name: "Three Paddles",
        namespace: "/paddles",
        room: { playerIds: ["north", "south", "green-team"] },
        networking: {
          namespace: "/paddles",
          tickRateHz: 30,
          inputProtocol: 1,
          inputTemplate: { climb: false, dive: false, blink: false },
        },
      },
      fightGameMeta,
    ],
  };
  const probeGameConfig = resolveProbeGameConfig(gameCatalog, "paddles");

  assert.deepEqual(probeGameConfig, {
    id: "paddles",
    name: "Three Paddles",
    namespace: "/paddles",
    playerIds: ["north", "south", "green-team"],
    tickRateHz: 30,
    inputProtocol: 1,
    inputTemplate: { climb: false, dive: false, blink: false },
  });
  probeGameConfig.playerIds.push("visitor");
  probeGameConfig.inputTemplate.climb = true;
  assert.deepEqual(gameCatalog.games[0].room.playerIds, ["north", "south", "green-team"]);
  assert.equal(gameCatalog.games[0].networking.inputTemplate.climb, false);
});

test("Fight and Pong expose distinct queued input contracts through the catalog", () => {
  const gameCatalog = { games: [fightGameMeta, pongGameMeta] };
  const fightProbe = resolveProbeGameConfig(gameCatalog, "fight");
  const pongProbe = resolveProbeGameConfig(gameCatalog, "pong");

  assert.equal(fightProbe.namespace, "/fight");
  assert.equal(fightProbe.inputProtocol, 2);
  assert.deepEqual(fightProbe.inputTemplate, {
    left: false, right: false, jump: false, attack: false, heavyAttack: false, aerialAttack: false,
    block: false, dash: false, specialAttack: false, crouch: false,
  });
  assert.equal(pongProbe.namespace, "/pong");
  assert.equal(pongProbe.inputProtocol, 2);
  assert.deepEqual(pongProbe.inputTemplate, { up: false, down: false });
  assert.deepEqual(pongProbe.playerIds, ["p1", "p2"]);
  assert.equal(pongProbe.tickRateHz, 60);
});

test("probe selection rejects player slots that cannot preserve snapshot paths", () => {
  for (const playerId of ["team.red", "01", "constructor", "__proto__"]) {
    const gameMetadata = structuredClone(pongGameMeta);
    gameMetadata.room.playerIds = [playerId];
    assert.throws(() => resolveProbeGameConfig({ games: [gameMetadata] }, "pong"), /player/i);
  }
});

test("migrated platformer/racing games expose queued input and Draw remains event-driven", () => {
  const gameCatalog = { games: [marioGameMeta, marioTouchGameMeta, roadRashGameMeta, drawGameMeta] };

  for (const gameId of ["mario", "mario-touch", "roadrash", "draw"]) {
    const probeGameConfig = resolveProbeGameConfig(gameCatalog, gameId);

    assert.equal(probeGameConfig.namespace, `/${gameId}`);
    if (gameId === "draw") {
      assert.equal(probeGameConfig.inputProtocol, null);
      assert.equal(probeGameConfig.inputTemplate, null);
    } else {
      assert.equal(probeGameConfig.inputProtocol, 2);
      const expectedKeys = gameId === "roadrash"
        ? ["left", "right", "throttle", "brake", "kickLeft", "kickRight"]
        : ["left", "right", "run", "jump"];
      assert.deepEqual(Object.keys(probeGameConfig.inputTemplate).sort(), expectedKeys.sort());
    }
    assert.deepEqual(probeGameConfig.playerIds, ["p1", "p2"]);
  }
});

test("omitted continuous-input capabilities select snapshots-only probing", () => {
  const probeGameConfig = resolveProbeGameConfig({
    games: [{
      id: "whiteboard",
      name: "Whiteboard",
      namespace: "/whiteboard",
      room: { playerIds: ["artist", "viewer"] },
      networking: { namespace: "/whiteboard", tickRateHz: 20 },
    }],
  }, "whiteboard");

  assert.equal(probeGameConfig.inputProtocol, null);
  assert.equal(probeGameConfig.inputTemplate, null);
  assert.deepEqual(probeGameConfig.playerIds, ["artist", "viewer"]);
});

test("catalog selection rejects unknown, unsupported and ambiguous games", () => {
  assert.throws(() => resolveProbeGameConfig({ games: [fightGameMeta] }, "missing"), /Unknown game/);
  assert.throws(() => resolveProbeGameConfig({ games: [webglSampleGameMeta] }, "webgl-sample"), /multiplayer|networked/i);
  assert.throws(() => resolveProbeGameConfig({ games: [fightGameMeta, fightGameMeta] }, "fight"), /duplicate|ambiguous/i);
  assert.throws(() => resolveProbeGameConfig({}, "fight"), /catalog/i);
  assert.throws(() => resolveProbeGameConfig({ games: null }, "fight"), /catalog/i);
});

test("catalog selection rejects malformed capabilities and bounds accidental probe load", () => {
  const validGame = {
    id: "custom",
    name: "Custom",
    namespace: "/custom",
    room: { playerIds: ["alpha", "beta"] },
    networking: {
      namespace: "/custom", tickRateHz: 30, inputProtocol: 2, inputTemplate: { climb: false },
    },
  };
  const invalidGames = [
    { ...validGame, room: undefined },
    { ...validGame, room: { playerIds: [] } },
    { ...validGame, room: { playerIds: ["alpha", "alpha"] } },
    { ...validGame, room: { playerIds: ["alpha", ""] } },
    { ...validGame, room: { playerIds: Array.from({ length: 9 }, (_, index) => `slot-${index}`) } },
    { ...validGame, networking: undefined },
    { ...validGame, networking: { ...validGame.networking, namespace: "custom" } },
    { ...validGame, networking: { ...validGame.networking, namespace: "/other" } },
    { ...validGame, networking: { ...validGame.networking, tickRateHz: 0 } },
    { ...validGame, networking: { ...validGame.networking, tickRateHz: 121 } },
    { ...validGame, networking: { ...validGame.networking, tickRateHz: Infinity } },
    { ...validGame, networking: { ...validGame.networking, inputProtocol: 7 } },
    { ...validGame, networking: { ...validGame.networking, inputTemplate: {} } },
    { ...validGame, networking: { ...validGame.networking, inputTemplate: { climb: 1 } } },
    { ...validGame, networking: { ...validGame.networking, inputProtocol: null } },
    { ...validGame, networking: { ...validGame.networking, inputTemplate: [] } },
    {
      ...validGame,
      networking: {
        ...validGame.networking,
        inputTemplate: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`control${index}`, false])),
      },
    },
  ];

  for (const invalidGame of invalidGames) {
    assert.throws(() => resolveProbeGameConfig({ games: [invalidGame] }, "custom"), /probe|namespace|player|input|tick/i);
  }
});

test("generic probe input alternates only supplied controls without mutating the template", () => {
  const inputTemplate = { climb: false, dive: false, blink: false };

  assert.deepEqual(createProbeInputState(inputTemplate, 0), { climb: false, dive: true, blink: false });
  assert.deepEqual(createProbeInputState(inputTemplate, 2000), { climb: true, dive: false, blink: false });
  assert.deepEqual(createProbeInputState(inputTemplate, 4000), { climb: false, dive: true, blink: false });
  assert.deepEqual(inputTemplate, { climb: false, dive: false, blink: false });
  assert.deepEqual(createProbeInputState({ pulse: false }, 0), { pulse: true });
  assert.deepEqual(createProbeInputState({ pulse: false }, 2000), { pulse: false });
});

test("numeric probe capabilities retain their bounds and numeric defaults during sampling", () => {
  const gameCatalog = { games: [{
    id: "analog", name: "Analog", namespace: "/analog", room: { playerIds: ["pilot"] },
    networking: {
      namespace: "/analog", tickRateHz: 60, inputProtocol: 2,
      inputTemplate: { axis: 0, heading: 0.5, tool: 2, boost: false, brake: false },
      numericInputs: {
        axis: { min: -1, max: 1 }, heading: { min: -3.2, max: 3.2 }, tool: { min: 0, max: 4, integer: true },
      },
    },
  }] };
  const probeGameConfig = resolveProbeGameConfig(gameCatalog, "analog");
  assert.deepEqual(probeGameConfig.numericInputs, {
    axis: { min: -1, max: 1 }, heading: { min: -3.2, max: 3.2 }, tool: { min: 0, max: 4, integer: true },
  });
  assert.deepEqual(createProbeInputState(probeGameConfig.inputTemplate, 0), {
    axis: 0, heading: 0.5, tool: 2, boost: false, brake: true,
  });
  assert.deepEqual(createProbeInputState(probeGameConfig.inputTemplate, 2000), {
    axis: 0, heading: 0.5, tool: 2, boost: true, brake: false,
  });
  assert.deepEqual(createProbeInputState({ axis: 0.25 }, 0), { axis: 0.25 });
  probeGameConfig.numericInputs.axis.max = 100;
  assert.equal(gameCatalog.games[0].networking.numericInputs.axis.max, 1);
});

test("probe rejects malformed numeric ranges and invalid numeric defaults", () => {
  for (const networking of [
    { inputTemplate: { axis: 0 }, numericInputs: { axis: { min: -1, max: Infinity } } },
    { inputTemplate: { axis: 3 }, numericInputs: { axis: { min: -1, max: 1 } } },
    { inputTemplate: { tool: 0.5 }, numericInputs: { tool: { min: 0, max: 3, integer: true } } },
    { inputProtocol: null, inputTemplate: null, numericInputs: { axis: { min: -1, max: 1 } } },
  ]) {
    assert.throws(() => resolveProbeGameConfig({ games: [{
      id: "analog", namespace: "/analog", room: { playerIds: ["pilot"] },
      networking: { namespace: "/analog", tickRateHz: 60, inputProtocol: 2, ...networking },
    }] }, "analog"), /input|numeric|probe/i);
  }
});
