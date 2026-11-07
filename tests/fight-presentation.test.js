import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import {
  createFightAnimationTrack,
  createFightAttackCueTracker,
  createFightCombatEventFeed,
  createFightInputController,
  readFightKeyboardInput,
} from "../public/games/fight/presentation.js";
import {
  readFightSpriteFrame,
  readFightSpritePlacement,
} from "../public/games/fight/spritePresentation.js";
import { readFightCompactHudLayout } from "../public/games/fight/hudLayout.js";

const attackDefinitions = {
  light: { duration: 0.24, startupSec: 0.06, activeSec: 0.06 },
  heavy: { duration: 0.48, startupSec: 0.16, activeSec: 0.12 },
};

function createAnimationTrack() {
  return createFightAnimationTrack({
    attackDefinitions,
    groundY: 870,
    frameCounts: { idle: 8, run: 8, jump: 2, attack: 6, death: 6 },
  });
}

const idlePlayer = {
  y: 870, vx: 0, vy: 0, dir: 1, attacking: false, attackTimer: 0,
  attackId: 0, attackType: null, dead: false,
};

test("attack frames advance between snapshots and finish the authored swing", () => {
  const animationTrack = createAnimationTrack();
  const attackingPlayer = { ...idlePlayer, attacking: true, attackId: 1, attackType: "light", attackTimer: 0.24 };

  assert.equal(animationTrack.sample(attackingPlayer, 1000).frame, 0);
  assert.equal(animationTrack.sample(attackingPlayer, 1090).frame, 2);
  assert.equal(animationTrack.sample({ ...idlePlayer, attackId: 1 }, 1180).pose, "attack");
  assert.equal(animationTrack.sample({ ...idlePlayer, attackId: 1 }, 1250).pose, "idle");
});

test("same attack identity never restarts on correction while a new swing does", () => {
  const animationTrack = createAnimationTrack();
  const attackingPlayer = { ...idlePlayer, attacking: true, attackId: 4, attackType: "heavy", attackTimer: 0.48 };
  animationTrack.sample(attackingPlayer, 1000);
  const advancedFrame = animationTrack.sample({ ...attackingPlayer, attackTimer: 0.40 }, 1220).frame;

  assert.ok(advancedFrame > 0);
  assert.equal(animationTrack.sample({ ...attackingPlayer, attackTimer: 0.48 }, 1220).frame, advancedFrame);
  assert.equal(animationTrack.sample({ ...attackingPlayer, attackId: 5 }, 1230).frame, 0);
  assert.equal(animationTrack.sample({ ...attackingPlayer, attackId: 4 }, 1240).attackId, 5);
});

test("a legitimate swing reuses its simulation ID after prediction rolls back", () => {
  const animationTrack = createAnimationTrack();
  const attackingPlayer = { ...idlePlayer, attacking: true, attackId: 1, attackType: "light", attackTimer: 0.24 };
  const predictedSwing = animationTrack.sample(attackingPlayer, 1000);
  animationTrack.sample(idlePlayer, 1100);
  const legitimateSwing = animationTrack.sample(attackingPlayer, 1500);

  assert.equal(legitimateSwing.pose, "attack");
  assert.equal(legitimateSwing.frame, 0);
  assert.equal(predictedSwing.presentationId, 1);
  assert.equal(legitimateSwing.presentationId, 2);
});

test("idle counter rollback preserves the visible swing until a new action starts", () => {
  const animationTrack = createAnimationTrack();
  const predictedHeavy = { ...idlePlayer, attacking: true, attackId: 4, attackType: "heavy", attackTimer: 0.48 };
  animationTrack.sample(predictedHeavy, 1000);
  const correctedSwing = animationTrack.sample(idlePlayer, 1200);
  const laterSwing = animationTrack.sample({ ...predictedHeavy, attackId: 1 }, 1500);

  assert.equal(correctedSwing.pose, "attack");
  assert.ok(correctedSwing.frame > 0);
  assert.equal(correctedSwing.presentationId, 1);
  assert.equal(laterSwing.pose, "attack");
  assert.equal(laterSwing.attackId, 1);
  assert.equal(laterSwing.presentationId, 2);
});

test("ordinary same-ID and older active snapshots keep one presentation occurrence", () => {
  const animationTrack = createAnimationTrack();
  const attackingPlayer = { ...idlePlayer, attacking: true, attackId: 5, attackType: "heavy", attackTimer: 0.48 };
  const firstSwing = animationTrack.sample(attackingPlayer, 1000);
  const olderActiveSwing = animationTrack.sample({ ...attackingPlayer, attackId: 4 }, 1100);
  const sameSwing = animationTrack.sample(attackingPlayer, 1200);
  const recoveredSwing = animationTrack.sample({ ...idlePlayer, attackId: 5 }, 1250);

  assert.equal(firstSwing.presentationId, 1);
  assert.equal(olderActiveSwing.presentationId, 1);
  assert.equal(sameSwing.presentationId, 1);
  assert.equal(recoveredSwing.presentationId, 1);
  assert.ok(sameSwing.frame > olderActiveSwing.frame);
});

test("attack cues play once per presentation occurrence when simulation IDs are reused", () => {
  const animationTrack = createAnimationTrack();
  const attackCueTracker = createFightAttackCueTracker();
  const attackingPlayer = { ...idlePlayer, attacking: true, attackId: 1, attackType: "light", attackTimer: 0.24 };
  const predictedSwing = animationTrack.sample(attackingPlayer, 1000);
  assert.equal(attackCueTracker.consumeAttackCue("p1", predictedSwing), "light");
  assert.equal(attackCueTracker.consumeAttackCue("p1", predictedSwing), null);
  assert.equal(attackCueTracker.consumeAttackCue("p1", animationTrack.sample(idlePlayer, 1100)), null);

  const legitimateSwing = animationTrack.sample(attackingPlayer, 1500);
  assert.equal(legitimateSwing.attackId, 1);
  assert.equal(attackCueTracker.consumeAttackCue("p1", legitimateSwing), "light");
  assert.equal(attackCueTracker.consumeAttackCue("p1", legitimateSwing), null);
  assert.equal(attackCueTracker.consumeAttackCue("p2", legitimateSwing), "light");

  attackCueTracker.reset();
  animationTrack.reset();
  assert.equal(attackCueTracker.consumeAttackCue("p1", animationTrack.sample(attackingPlayer, 2000)), "light");
});

test("an observed late swing begins at its authoritative phase and death interrupts it", () => {
  const animationTrack = createAnimationTrack();
  const latePlayer = { ...idlePlayer, attacking: true, attackId: 1, attackType: "light", attackTimer: 0.06 };

  assert.equal(animationTrack.sample(latePlayer, 1000).frame, 5);
  assert.equal(animationTrack.sample({ ...latePlayer, dead: true }, 1010).pose, "death");
  assert.equal(animationTrack.sample({ ...latePlayer, dead: true }, 1700).frame, 5);
});

test("air, guard and dash presentation follow state without making extra sprite frames", () => {
  const animationTrack = createAnimationTrack();
  assert.equal(animationTrack.sample({ ...idlePlayer, y: 650, vy: -100 }, 1000).pose, "jump");
  assert.equal(animationTrack.sample({ ...idlePlayer, guarding: true }, 1010).stance, "guard");
  assert.equal(animationTrack.sample({ ...idlePlayer, dashTimer: 0.08, vx: 1100 }, 1020).stance, "dash");
  assert.ok(animationTrack.sample({ ...idlePlayer, vx: 500 }, 1090).frame < 8);
});

test("the original two-frame jump fallback retains ascending and descending poses", () => {
  const animationTrack = createAnimationTrack();
  assert.equal(animationTrack.sample({ ...idlePlayer, y: 650, vy: -300 }, 1000).frame, 0);
  assert.equal(animationTrack.sample({ ...idlePlayer, y: 700, vy: 300 }, 1100).frame, 1);
});

test("combat feed emits authoritative hits once and supports fresh rematch IDs", () => {
  const combatFeed = createFightCombatEventFeed();
  const hitEvent = { id: 1, kind: "hit", attackType: "light", damage: 25, x: 500, y: 870 };
  assert.deepEqual(combatFeed.consume([hitEvent]), [hitEvent]);
  assert.deepEqual(combatFeed.consume([hitEvent]), []);
  assert.deepEqual(combatFeed.consume([hitEvent, { ...hitEvent, id: 2, kind: "parry" }]).map((event) => event.kind), ["parry"]);
  assert.deepEqual(combatFeed.consume([{ ...hitEvent, id: 0 }, { ...hitEvent, id: NaN }]), []);
  combatFeed.reset();
  assert.deepEqual(combatFeed.consume([hitEvent]), [hitEvent]);
});

test("touch and keyboard share held input without releasing each other's movement", () => {
  const heldInputs = {};
  const inputController = createFightInputController((inputKey, active) => { heldInputs[inputKey] = active; });
  inputController.setHeld("left", "keyboard:left", true, 1000);
  inputController.setHeld("left", "touch:left", true, 1000);
  inputController.setHeld("left", "touch:left", false, 1100);
  assert.equal(heldInputs.left, true);
  inputController.setHeld("left", "keyboard:left", false, 1110);
  assert.equal(heldInputs.left, false);
});

test("direction double tap sends a dash edge once despite duplicate touch events", () => {
  const transitions = [];
  const inputController = createFightInputController((inputKey, active) => { transitions.push([inputKey, active]); });
  inputController.setHeld("right", "touch:right", true, 1000);
  inputController.setHeld("right", "touch:right", true, 1001);
  inputController.setHeld("right", "touch:right", false, 1050);
  inputController.setHeld("right", "touch:right", true, 1150);
  inputController.setHeld("right", "touch:right", true, 1151);
  assert.deepEqual(transitions.filter(([inputKey]) => inputKey === "dash"), [["dash", true], ["dash", false]]);
});

test("guard plus launcher triggers special and releases the original action", () => {
  const heldInputs = {};
  const inputController = createFightInputController((inputKey, active) => { heldInputs[inputKey] = active; });
  inputController.setAction("b", "touch:b", true, 1000);
  inputController.setAction("y", "touch:y", true, 1010);
  assert.equal(heldInputs.block, true);
  assert.equal(heldInputs.specialAttack, true);
  assert.equal(heldInputs.aerialAttack, undefined);
  inputController.setAction("b", "touch:b", false, 1020);
  inputController.setAction("y", "touch:y", false, 1030);
  assert.equal(heldInputs.specialAttack, false);
  inputController.reset();
  assert.equal(heldInputs.block, false);
});

test("held attack controls send one latched press while movement and guard stay held", () => {
  const inputLatch = createInputLatch({ attack: false, left: false, block: false }, { edgeKeys: ["attack"] });
  const inputController = createFightInputController((inputKey, active) => inputLatch.set(inputKey, active), { edgeKeys: ["attack"] });
  inputController.setHeld("left", "keyboard:left", true, 1000);
  inputController.setHeld("block", "keyboard:guard", true, 1000);
  inputController.setHeld("attack", "keyboard:light", true, 1000);
  assert.deepEqual(inputLatch.capture(), { attack: true, left: true, block: true });
  inputController.setHeld("attack", "keyboard:light", true, 1010);
  assert.deepEqual(inputLatch.capture(), { attack: false, left: true, block: true });
  inputController.setHeld("attack", "touch:a", true, 1020);
  assert.equal(inputLatch.capture().attack, true);
  assert.equal(inputLatch.capture().attack, false);
});

test("keyboard maps both documented key sets and ignores unsupported keys", () => {
  assert.equal(readFightKeyboardInput("KeyA"), "left");
  assert.equal(readFightKeyboardInput("ArrowDown"), "crouch");
  assert.equal(readFightKeyboardInput("KeyJ"), "attack");
  assert.equal(readFightKeyboardInput("KeyZ"), "attack");
  assert.equal(readFightKeyboardInput("KeyK"), "heavyAttack");
  assert.equal(readFightKeyboardInput("KeyU"), "aerialAttack");
  assert.equal(readFightKeyboardInput("KeyL"), "block");
  assert.equal(readFightKeyboardInput("KeyI"), "specialAttack");
  assert.equal(readFightKeyboardInput("ShiftRight"), "dash");
  assert.equal(readFightKeyboardInput("KeyN"), null);
});

test("the generic attack alias uses the matched light clip and preserves each fighter's contact row", () => {
  for (const playerId of ["p1", "p2"]) {
    const playerNumber = playerId === "p1" ? 1 : 2;
    assert.deepEqual(readFightSpriteFrame(playerId, "attack", 3), {
      spriteName: `moves-player${playerNumber}-strikes-v4`, frame: 3,
    });
    assert.deepEqual(readFightSpritePlacement(playerId, "attack", 3), readFightSpritePlacement(playerId, "light", 3));
  }
});

test("neutral reference poses retain a consistent body size across all four sheets", () => {
  // Independently measured head-to-foot source heights exclude raised swords.
  const sourceReferences = {
    p1: { worldHeight: 208, light: 104, sweep: 107, guard: 105, idle: 118 },
    p2: { worldHeight: 212, light: 102, sweep: 121, guard: 114, idle: 127 },
  };
  for (const [playerId, reference] of Object.entries(sourceReferences)) {
    for (const clipId of ["light", "sweep", "guard", "idle"]) {
      const placement = readFightSpritePlacement(playerId, clipId, 0);
      assert.ok(Math.abs(placement.scaleY * reference[clipId] - reference.worldHeight) < .01,
        `${playerId} ${clipId} changes the fighter's body size`);
    }
  }
});

test("small portrait HUD uses letterboxes without changing the stage rectangle", () => {
  const viewportGeometry = {
    hostWidth: 304, hostHeight: 384,
    stageLeft: 0, stageTop: 106, stageWidth: 304, stageHeight: 171,
    toolbarBottom: 48,
  };
  const originalGeometry = { ...viewportGeometry };
  const hudLayout = readFightCompactHudLayout(viewportGeometry);
  assert.deepEqual(viewportGeometry, originalGeometry);
  assert.equal(hudLayout.hud.height, 48);
  assert.ok(hudLayout.hud.y >= 56);
  assert.ok(hudLayout.hud.y + hudLayout.hud.height <= 106);
  assert.ok(hudLayout.legend.y >= 277);
  assert.ok(hudLayout.legend.y + hudLayout.legend.height <= 384);
  assert.ok(hudLayout.hud.width >= 280);
});

test("tall portrait HUD stays next to the scene and clear of platform controls", () => {
  const hudLayout = readFightCompactHudLayout({
    hostWidth: 374, hostHeight: 578,
    stageLeft: 0, stageTop: 183, stageWidth: 374, stageHeight: 210,
    toolbarBottom: 48,
  });
  assert.equal(hudLayout.hud.y, 129);
  assert.equal(hudLayout.legend.y, 399);
  assert.equal(hudLayout.hud.width, 358);
});

test("short wide hosts use side letterboxes for readable compact HUD and controls", () => {
  const hudLayout = readFightCompactHudLayout({
    hostWidth: 900, hostHeight: 180,
    stageLeft: 310, stageTop: 11, stageWidth: 280, stageHeight: 158,
    toolbarBottom: 48,
  });
  assert.ok(hudLayout.hud.x + hudLayout.hud.width <= 310);
  assert.ok(hudLayout.legend.x >= 590);
  assert.ok(hudLayout.hud.y >= 56);
  assert.ok(hudLayout.legend.y + hudLayout.legend.height <= 180);
});
