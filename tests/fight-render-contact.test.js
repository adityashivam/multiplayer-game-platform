import test from "node:test";
import assert from "node:assert/strict";
import { constrainFightRenderPose } from "../public/games/fight/renderContact.js";
import * as contactPresentation from "../public/games/fight/renderContact.js";

test("render contact preserves the predicted local fighter while separating a delayed opponent", () => {
  const pose = { p1x: 560, p1y: 870, p2x: 666, p2y: 870 };
  assert.deepEqual(constrainFightRenderPose(pose, { localPlayerId: "p1" }), {
    p1x: 560, p1y: 870, p2x: 680, p2y: 870,
  });
  assert.deepEqual(constrainFightRenderPose(pose, { localPlayerId: "p2" }), {
    p1x: 546, p1y: 870, p2x: 666, p2y: 870,
  });
  assert.deepEqual(pose, { p1x: 560, p1y: 870, p2x: 666, p2y: 870 });
});

test("render contact respects both arena walls and either player order", () => {
  const cases = [
    { positions: [1080, 1180], localPlayerId: "p1", expected: [1060, 1180] },
    { positions: [1080, 1180], localPlayerId: "p2", expected: [1060, 1180] },
    { positions: [100, 180], localPlayerId: "p1", expected: [100, 220] },
    { positions: [100, 180], localPlayerId: "p2", expected: [100, 220] },
    { positions: [180, 100], localPlayerId: "p1", expected: [220, 100] },
    { positions: [1180, 1080], localPlayerId: "p2", expected: [1180, 1060] },
  ];
  for (const { positions, localPlayerId, expected } of cases) {
    const correctedPose = constrainFightRenderPose({ p1x: positions[0], p1y: 870, p2x: positions[1], p2y: 870 }, { localPlayerId });
    assert.deepEqual([correctedPose.p1x, correctedPose.p2x], expected);
  }
});

test("render contact uses the authoritative side order when mixed timelines cross", () => {
  const players = { p1: { x: 600, y: 870 }, p2: { x: 720, y: 870 } };
  const originalPlayers = structuredClone(players);
  assert.deepEqual(constrainFightRenderPose({ p1x: 730, p1y: 870, p2x: 700, p2y: 870 }, {
    localPlayerId: "p1", players,
  }), { p1x: 730, p1y: 870, p2x: 850, p2y: 870 });
  assert.deepEqual(players, originalPlayers);
});

test("render contact permits a clear jump-over but constrains a low landing before artwork offsets", () => {
  const airbornePose = { p1x: 700, p1y: 770, p2x: 700, p2y: 870 };
  assert.deepEqual(constrainFightRenderPose(airbornePose, { localPlayerId: "p1" }), airbornePose);
  assert.deepEqual(constrainFightRenderPose({ ...airbornePose, p1y: 775 }, {
    localPlayerId: "p1", players: { p1: { x: 650, y: 775 }, p2: { x: 770, y: 870 } },
  }), { p1x: 700, p1y: 775, p2x: 820, p2y: 870 });
});

test("a predicted jump cross-up does not restore stale airborne side order on landing", () => {
  const pose = { p1x: 690, p1y: 775, p2x: 620, p2y: 870 };
  const contactBeforeAuthorityLands = constrainFightRenderPose(pose, {
    localPlayerId: "p1", players: { p1: { x: 610, y: 650 }, p2: { x: 620, y: 870 } },
  });
  assert.deepEqual(contactBeforeAuthorityLands, { p1x: 690, p1y: 775, p2x: 570, p2y: 870 });
  const contactAfterAuthorityLands = constrainFightRenderPose(pose, {
    localPlayerId: "p1", players: { p1: { x: 700, y: 780 }, p2: { x: 580, y: 870 } },
  });
  assert.deepEqual(contactAfterAuthorityLands, contactBeforeAuthorityLands,
    "an authority side update must not move the delayed opponent across the local fighter");
});

test("render contact clamps extrapolated positions and leaves valid separated poses intact", () => {
  assert.deepEqual(constrainFightRenderPose({ p1x: 100, p1y: 870, p2x: 1250, p2y: 870 }), {
    p1x: 100, p1y: 870, p2x: 1180, p2y: 870,
  });
  assert.deepEqual(constrainFightRenderPose({ p1x: 200, p1y: 870, p2x: 1000, p2y: 870 }), {
    p1x: 200, p1y: 870, p2x: 1000, p2y: 870,
  });
});

test("unowned render poses share displacement and settle contact once", () => {
  const correctedPose = constrainFightRenderPose({ p1x: 550, p1y: 870, p2x: 650, p2y: 870 });
  assert.deepEqual(correctedPose, { p1x: 540, p1y: 870, p2x: 660, p2y: 870 });
  assert.deepEqual(constrainFightRenderPose(correctedPose), correctedPose);
});

test("contact playback keeps side order until displayed fighters have vertical clearance", () => {
  assert.equal(typeof contactPresentation.createFightRenderContact, "function");
  const playback = contactPresentation.createFightRenderContact();
  const options = { localPlayerId: "p1", deltaSec: 1 / 60, players: { p1: { x: 600, y: 870 }, p2: { x: 720, y: 740 } } };
  const firstFrame = playback.sample({ p1x: 600, p1y: 870, p2x: 620, p2y: 788 }, options);
  const crossedRawFrame = playback.sample({ p1x: 630, p1y: 870, p2x: 625, p2y: 782 }, options);
  assert.equal(firstFrame.p2x, 720);
  assert.equal(crossedRawFrame.p2x, 750);
  assert.equal(crossedRawFrame.p1x, 630);
});

test("contact playback releases its correction gradually when a launcher gains clearance", () => {
  assert.equal(typeof contactPresentation.createFightRenderContact, "function");
  const playback = contactPresentation.createFightRenderContact();
  const options = { localPlayerId: "p1", deltaSec: 1 / 60 };
  playback.sample({ p1x: 600, p1y: 870, p2x: 620, p2y: 788 }, options);
  const clearPose = { p1x: 600, p1y: 870, p2x: 620, p2y: 760 };
  let renderedPose = playback.sample(clearPose, options);
  assert.ok(renderedPose.p2x > 690 && renderedPose.p2x < 720, "clearing contact must not discard the100px correction in one frame");
  for (let frame = 0; frame < 90; frame++) renderedPose = playback.sample(clearPose, options);
  assert.ok(Math.abs(renderedPose.p2x - 620) < .001);
  assert.deepEqual(clearPose, { p1x: 600, p1y: 870, p2x: 620, p2y: 760 });
});

test("contact correction release depends on elapsed time and resets for a new round", () => {
  assert.equal(typeof contactPresentation.createFightRenderContact, "function");
  const settledPositions = [];
  for (const framesPerSecond of [30, 60, 120]) {
    const playback = contactPresentation.createFightRenderContact();
    const options = { localPlayerId: "p1", deltaSec: 1 / framesPerSecond };
    playback.sample({ p1x: 600, p1y: 870, p2x: 620, p2y: 788 }, options);
    let renderedPose;
    for (let frame = 0; frame < framesPerSecond / 2; frame++) {
      renderedPose = playback.sample({ p1x: 600, p1y: 870, p2x: 620, p2y: 700 }, options);
    }
    settledPositions.push(renderedPose.p2x);
    playback.reset();
    assert.deepEqual(playback.sample({ p1x: 900, p1y: 870, p2x: 800, p2y: 870 }, options), {
      p1x: 900, p1y: 870, p2x: 780, p2y: 870,
    });
  }
  assert.ok(settledPositions.every((x) => x > 620 && x < 621));
  assert.ok(Math.max(...settledPositions) - Math.min(...settledPositions) < 1e-8);
});

test("long render gaps and new input ownership discard an unseen crossover's old contact order", () => {
  for (const resumedClock of [{ nowMs: 1000, inputEpoch: 1 }, { nowMs: 17, inputEpoch: 2 }]) {
    const playback = contactPresentation.createFightRenderContact();
    playback.sample({ p1x: 600, p1y: 870, p2x: 620, p2y: 870 }, {
      localPlayerId: "p1", deltaSec: 1 / 60, nowMs: 0, inputEpoch: 1,
    });
    const resumedPose = playback.sample({ p1x: 900, p1y: 870, p2x: 800, p2y: 870 }, {
      localPlayerId: "p1", deltaSec: 1 / 60, ...resumedClock,
      players: { p1: { x: 900, y: 870 }, p2: { x: 780, y: 870 } },
    });
    assert.deepEqual(resumedPose, { p1x: 900, p1y: 870, p2x: 780, p2y: 870 });
  }
});

test("landing contact uses the local collision model when delayed artwork shows a different side", () => {
  const playback = contactPresentation.createFightRenderContact();
  const players = { p1: { x: 671, y: 746 }, p2: { x: 612, y: 870 } };
  playback.sample({ p1x: 595, p1y: 765, p2x: 591, p2y: 870 }, {
    localPlayerId: "p1", localSimulationPosition: { x: 595, y: 765 }, players, deltaSec: 1 / 60,
  });
  const landedPose = playback.sample({ p1x: 520, p1y: 775, p2x: 591, p2y: 870 }, {
    localPlayerId: "p1", localSimulationPosition: { x: 520, y: 775 }, players, deltaSec: 1 / 60,
  });
  assert.deepEqual(landedPose, { p1x: 520, p1y: 775, p2x: 640, p2y: 870 },
    "the delayed opponent should move49px, not jump191px across the local fighter");

  const otherPlayback = contactPresentation.createFightRenderContact();
  const otherPlayers = { p1: { x: 612, y: 870 }, p2: { x: 671, y: 746 } };
  otherPlayback.sample({ p1x: 591, p1y: 870, p2x: 595, p2y: 765 }, {
    localPlayerId: "p2", localSimulationPosition: { x: 595, y: 765 }, players: otherPlayers, deltaSec: 1 / 60,
  });
  assert.deepEqual(otherPlayback.sample({ p1x: 591, p1y: 870, p2x: 520, p2y: 775 }, {
    localPlayerId: "p2", localSimulationPosition: { x: 520, y: 775 }, players: otherPlayers, deltaSec: 1 / 60,
  }), { p1x: 640, p1y: 870, p2x: 520, p2y: 775 });
});

test("an exact-X airborne tie adopts the same landing order as shared physics at either wall", () => {
  const cases = [
    {
      localPlayerId: "p2", initial: { p1x: 100, p1y: 870, p2x: 220, p2y: 870 },
      airborne: { p1x: 100, p1y: 870, p2x: 100, p2y: 700 },
      landing: { p1x: 100, p1y: 870, p2x: 100, p2y: 775 },
      expected: { p1x: 220, p1y: 870, p2x: 100, p2y: 775 },
      players: { p1: { x: 100, y: 870 }, p2: { x: 100, y: 700 } },
    },
    {
      localPlayerId: "p1", initial: { p1x: 1060, p1y: 870, p2x: 1180, p2y: 870 },
      airborne: { p1x: 1180, p1y: 700, p2x: 1180, p2y: 870 },
      landing: { p1x: 1180, p1y: 775, p2x: 1180, p2y: 870 },
      expected: { p1x: 1180, p1y: 775, p2x: 1060, p2y: 870 },
      players: { p1: { x: 1180, y: 700 }, p2: { x: 1180, y: 870 } },
    },
  ];
  for (const scenario of cases) {
    const playback = contactPresentation.createFightRenderContact();
    const options = { localPlayerId: scenario.localPlayerId, deltaSec: 1 / 60 };
    playback.sample(scenario.initial, options);
    playback.sample(scenario.airborne, {
      ...options, players: scenario.players,
      localSimulationPosition: { x: scenario.localPlayerId === "p1" ? 1180 : 100, y: 700 },
    });
    assert.deepEqual(playback.sample(scenario.landing, options), scenario.expected);
  }
});
