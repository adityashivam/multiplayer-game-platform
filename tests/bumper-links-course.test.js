import test from "node:test";
import assert from "node:assert/strict";
import {
  createBumperLinksCourse,
  listBumperLinksNearbySolids,
  measureBumperLinksRemainingPath,
} from "../public/games/bumper-links/shared/course.js";
import { BUMPER_LINKS_BALL_SETTINGS } from "../public/games/bumper-links/shared/config.js";

const SEEDS = Array.from({ length: 50 }, (_unused, index) => index + 1);

/** Highest solid top directly below a point, or null. */
function findFloorTop(course, x, z) {
  let top = null;
  for (const solid of course.solids) {
    if (x >= solid.minX && x <= solid.maxX && z >= solid.minZ && z <= solid.maxZ) {
      top = top === null ? solid.maxY : Math.max(top, solid.maxY);
    }
  }
  return top;
}

test("course generation is deterministic per seed", () => {
  assert.deepEqual(createBumperLinksCourse(7), createBumperLinksCourse(7));
  assert.notDeepEqual(createBumperLinksCourse(7).tiles, createBumperLinksCourse(8).tiles);
});

test("course path never climbs and keeps four to seven tiles", () => {
  for (const seed of SEEDS) {
    const course = createBumperLinksCourse(seed);
    assert.ok(course.tiles.length >= 4 && course.tiles.length <= 7, `seed ${seed}: ${course.tiles.length} tiles`);
    for (let index = 1; index < course.tiles.length; index += 1) {
      assert.ok(course.tiles[index].height <= course.tiles[index - 1].height, `seed ${seed} climbs at tile ${index}`);
    }
    assert.equal(course.tiles[0].kind, "tee");
    assert.equal(course.tiles.at(-1).kind, "cup");
  }
});

test("course stays within 256 solids and has a floor under tee and cup", () => {
  for (const seed of SEEDS) {
    const course = createBumperLinksCourse(seed);
    assert.ok(course.solids.length <= 256);
    assert.ok(Math.abs(findFloorTop(course, course.tee.x, course.tee.z) - (course.tee.y - BUMPER_LINKS_BALL_SETTINGS.radius)) < 1e-6);
    assert.ok(Math.abs(findFloorTop(course, course.cup.x, course.cup.z) - course.cup.y) < 1e-6);
    assert.ok(course.waterY < Math.min(...course.tiles.map((tile) => tile.height)));
    assert.ok(course.teeYaw >= -Math.PI && course.teeYaw <= Math.PI, `seed ${seed} tee yaw ${course.teeYaw}`);
  }
});

test("nearby solids include the floor under the point", () => {
  const course = createBumperLinksCourse(3);
  const nearby = listBumperLinksNearbySolids(course, course.tee.x, course.tee.z, []);
  assert.ok(nearby.some((solid) => course.tee.x >= solid.minX && course.tee.x <= solid.maxX &&
    course.tee.z >= solid.minZ && course.tee.z <= solid.maxZ && solid.maxY <= course.tee.y));
  assert.deepEqual(listBumperLinksNearbySolids(course, 999, 999, []), []);
});

test("remaining path is zero at the cup and largest at the tee", () => {
  const course = createBumperLinksCourse(11);
  assert.ok(measureBumperLinksRemainingPath(course, course.cup.x, course.cup.z) < 1e-6);
  const teeDistance = measureBumperLinksRemainingPath(course, course.tee.x, course.tee.z);
  for (const point of course.path) {
    assert.ok(measureBumperLinksRemainingPath(course, point.x, point.z) <= teeDistance + 1e-6);
  }
});
