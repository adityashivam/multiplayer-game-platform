import test from "node:test";
import assert from "node:assert/strict";
import { createFightAnimationTrack } from "../public/games/fight/presentation.js";
import { FIGHT_ATTACK_DEFINITIONS } from "../public/games/fight/shared/simulation.js";

const authoredMoveClips = {
  light: { frameCount: 8 },
  light2: { frameCount: 6 },
  finisher: { frameCount: 8 },
  heavy: { frameCount: 8 },
  sweep: { frameCount: 8, holdFrame: 2 },
  launcher: { frameCount: 8 },
  aerial: { frameCount: 8 },
  special: { frameCount: 8 },
  jump: { frameCount: 8 },
  slide: { frameCount: 8 },
  dodge: { frameCount: 8 },
  guard: { frameCount: 8 },
};

const groundedPlayer = {
  y: 870,
  vx: 0,
  vy: 0,
  attacking: false,
  attackId: 0,
  attackType: null,
  attackTimer: 0,
  dashTimer: 0,
  dashType: null,
  dead: false,
};

function createAuthoredAnimationTrack() {
  return createFightAnimationTrack({
    attackDefinitions: FIGHT_ATTACK_DEFINITIONS,
    groundY: 870,
    frameCounts: { idle: 8, run: 8, jump: 2, attack: 12, death: 6 },
    moveClips: authoredMoveClips,
    combat: { DASH_DURATION_SEC: 0.16, SLIDE_DURATION_SEC: 0.32 },
    jumpSpeed: -1300,
    gravity: 1600,
  });
}

test("every combat move selects its authored clip and its own frame count", () => {
  for (const attackType of ["light", "light2", "finisher", "heavy", "sweep", "launcher", "aerial", "special"]) {
    const animationTrack = createAuthoredAnimationTrack();
    const attackDefinition = FIGHT_ATTACK_DEFINITIONS[attackType];
    const attackPlayer = {
      ...groundedPlayer,
      attacking: true,
      attackId: 1,
      attackType,
      attackTimer: attackDefinition.duration,
    };
    const startupSample = animationTrack.sample(attackPlayer, 1000);
    const activeSample = animationTrack.sample(attackPlayer, 1000 + (attackDefinition.startupSec + attackDefinition.activeSec / 2) * 1000);
    const recoverySample = animationTrack.sample(attackPlayer, 1000 + attackDefinition.duration * 1000 - 1);

    assert.equal(startupSample.clipId, attackType);
    assert.equal(startupSample.pose, "attack");
    assert.equal(startupSample.phase, "startup");
    assert.equal(startupSample.frame, 0);
    assert.equal(activeSample.clipId, attackType);
    assert.equal(activeSample.phase, "active");
    assert.equal(activeSample.frame, attackType === "light2" ? 2 : 3);
    assert.equal(recoverySample.phase, "recovery");
    assert.equal(recoverySample.frame, attackType === "light2" ? 5 : 7);
  }
});

test("a move clip advances between snapshots and keeps its occurrence through timer corrections", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const heavyPlayer = { ...groundedPlayer, attacking: true, attackId: 4, attackType: "heavy", attackTimer: 0.53 };
  animationTrack.sample(heavyPlayer, 1000);
  const activeSample = animationTrack.sample(heavyPlayer, 1220);
  const correctedSample = animationTrack.sample({ ...heavyPlayer, attackTimer: 0.53 }, 1260);
  const rolledBackSample = animationTrack.sample(groundedPlayer, 1300);
  const nextOccurrence = animationTrack.sample({ ...heavyPlayer, attackId: 1 }, 1600);

  assert.equal(activeSample.clipId, "heavy");
  assert.ok(correctedSample.frame >= activeSample.frame);
  assert.equal(correctedSample.presentationId, 1);
  assert.equal(rolledBackSample.clipId, "heavy");
  assert.equal(rolledBackSample.presentationId, 1);
  assert.equal(nextOccurrence.clipId, "heavy");
  assert.equal(nextOccurrence.presentationId, 2);
  assert.equal(nextOccurrence.frame, 0);
});

test("jump playback includes takeoff ascent apex and descent without showing its landing in the air", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const flightSamples = [
    { nowMs: 1000, y: 870, vy: -1300, frame: 0 },
    { nowMs: 1120, y: 705, vy: -1100, frame: 1 },
    { nowMs: 1350, y: 500, vy: -700, frame: 2 },
    { nowMs: 1740, y: 344, vy: -80, frame: 3 },
    { nowMs: 1940, y: 360, vy: 300, frame: 4 },
    { nowMs: 2130, y: 430, vy: 650, frame: 5 },
    { nowMs: 2400, y: 700, vy: 1200, frame: 6 },
  ];

  for (const flightSample of flightSamples) {
    const animation = animationTrack.sample({ ...groundedPlayer, y: flightSample.y, vy: flightSample.vy }, flightSample.nowMs);
    assert.equal(animation.clipId, "jump");
    assert.equal(animation.pose, "jump");
    assert.equal(animation.frame, flightSample.frame);
  }
  const lateAirSample = animationTrack.sample({ ...groundedPlayer, y: 700, vy: 1200 }, 5000);
  assert.equal(lateAirSample.clipId, "jump");
  assert.equal(lateAirSample.frame, 6);
});

test("jump phase advances at render cadence and landing holds once before idle", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const takeoffPlayer = { ...groundedPlayer, y: 850, vy: -1300 };
  assert.equal(animationTrack.sample(takeoffPlayer, 1000).frame, 0);
  assert.equal(animationTrack.sample(takeoffPlayer, 1200).frame, 1);
  assert.equal(animationTrack.sample({ ...groundedPlayer, y: 700, vy: 1200 }, 2400).frame, 6);

  const landingSample = animationTrack.sample(groundedPlayer, 2500);
  assert.equal(landingSample.clipId, "landing");
  assert.equal(landingSample.frame, 7);
  assert.equal(animationTrack.sample(groundedPlayer, 2550).clipId, "landing");
  assert.equal(animationTrack.sample(groundedPlayer, 2620).clipId, "idle");
  assert.equal(animationTrack.sample(groundedPlayer, 2800).clipId, "idle");
});

test("a new takeoff immediately cancels the landing hold", () => {
  const animationTrack = createAuthoredAnimationTrack();
  animationTrack.sample({ ...groundedPlayer, y: 700, vy: 1200 }, 1000);
  animationTrack.sample(groundedPlayer, 1100);
  const takeoffSample = animationTrack.sample({ ...groundedPlayer, y: 850, vy: -1300 }, 1120);

  assert.equal(takeoffSample.clipId, "jump");
  assert.equal(takeoffSample.frame, 0);
});

test("slide and dodge use distinct duration-bound clips and timer corrections never restart them", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const dodgingPlayer = { ...groundedPlayer, dashTimer: 0.16, dashType: "dodge", vx: 1100 };
  assert.equal(animationTrack.sample(dodgingPlayer, 1000).clipId, "dodge");
  assert.equal(animationTrack.sample(dodgingPlayer, 1080).frame, 4);
  assert.equal(animationTrack.sample({ ...dodgingPlayer, dashTimer: 0.16 }, 1120).frame, 6);
  assert.equal(animationTrack.sample(groundedPlayer, 1180).clipId, "idle");

  const slidingPlayer = { ...groundedPlayer, dashTimer: 0.32, dashType: "slide", vx: 850 };
  assert.equal(animationTrack.sample(slidingPlayer, 2000).clipId, "slide");
  assert.equal(animationTrack.sample(slidingPlayer, 2080).frame, 2);
  assert.equal(animationTrack.sample(slidingPlayer, 2160).frame, 4);
  assert.equal(animationTrack.sample(slidingPlayer, 2500).frame, 7);
});

test("late mobility observation starts in its current phase", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const lateSlide = animationTrack.sample({ ...groundedPlayer, dashType: "slide", dashTimer: 0.08 }, 1000);

  assert.equal(lateSlide.clipId, "slide");
  assert.equal(lateSlide.frame, 6);
});

test("hit stun cancels mobility and cannot resume the same stale dodge", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const dodgingPlayer = { ...groundedPlayer, dashType: "dodge", dashTimer: 0.16 };
  animationTrack.sample(dodgingPlayer, 1000);
  const hurtSample = animationTrack.sample({ ...dodgingPlayer, stunTimer: 0.2 }, 1040);
  assert.equal(hurtSample.stance, "stun");
  assert.equal(hurtSample.clipId, "idle");
  assert.equal(animationTrack.sample(dodgingPlayer, 1080).clipId, "idle");
  animationTrack.sample(groundedPlayer, 1200);
  assert.equal(animationTrack.sample(dodgingPlayer, 1300).clipId, "dodge");
});

test("death and paused rounds interrupt movement clips", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const slidingPlayer = { ...groundedPlayer, dashType: "slide", dashTimer: 0.32 };
  animationTrack.sample(slidingPlayer, 1000);
  assert.equal(animationTrack.sample({ ...slidingPlayer, dead: true }, 1040).clipId, "death");
  animationTrack.reset();
  animationTrack.sample(slidingPlayer, 2000);
  assert.equal(animationTrack.sample(slidingPlayer, 2040, { active: false }).clipId, "idle");
  assert.equal(animationTrack.sample(slidingPlayer, 2080).clipId, "idle");
});

test("hit stun interrupts a swing while snapshot rollback alone preserves it", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const heavyPlayer = { ...groundedPlayer, attacking: true, attackId: 1, attackType: "heavy", attackTimer: 0.53 };
  animationTrack.sample(heavyPlayer, 1000);
  assert.equal(animationTrack.sample(groundedPlayer, 1100).clipId, "heavy");
  assert.equal(animationTrack.sample({ ...groundedPlayer, stunTimer: 0.2 }, 1120).clipId, "idle");
});

test("guard has a defensive clip and crouch holds the low sweep preparation", () => {
  const animationTrack = createAuthoredAnimationTrack();
  const guardSample = animationTrack.sample({ ...groundedPlayer, guarding: true }, 1000);
  assert.equal(guardSample.clipId, "guard");
  assert.equal(guardSample.pose, "idle");
  assert.equal(animationTrack.sample({ ...groundedPlayer, guarding: true }, 1600).frame, 7);
  const crouchSample = animationTrack.sample({ ...groundedPlayer, crouching: true }, 1700);
  assert.equal(crouchSample.clipId, "sweep");
  assert.equal(crouchSample.pose, "idle");
  assert.equal(crouchSample.frame, 2);
});
