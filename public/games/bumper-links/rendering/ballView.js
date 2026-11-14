import * as THREE from "three";
import { BUMPER_LINKS_BALL_COLORS, BUMPER_LINKS_BALL_SETTINGS } from "../shared/config.js";

/** @typedef {import("../client/snapshotPose.js").BumperLinksPresentedBall} BumperLinksPresentedBall */
/** @typedef {import("../client/aim.js").BumperLinksAimPoint} BumperLinksAimPoint */

const MAX_AIM_POINTS = 24;
const RIVAL_AIM_LENGTH_M = 0.9;
const ROLL_RAD_PER_M = 1 / BUMPER_LINKS_BALL_SETTINGS.radius;

/**
 * Ball meshes, the local ready ring, rival aim ticks and the local aim
 * line. Visual roll is presentation only.
 * @param {THREE.Scene} scene
 */
export function createBumperLinksBallViews(scene) {
  const radius = BUMPER_LINKS_BALL_SETTINGS.radius;
  const ballGeometry = new THREE.SphereGeometry(radius, 24, 16);
  const ringGeometry = new THREE.RingGeometry(radius * 1.5, radius * 1.9, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false });
  const rivalAimMaterial = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45 });
  const aimMaterial = new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.95 });
  const aimPositions = new Float32Array(MAX_AIM_POINTS * 3);
  const aimGeometry = new THREE.BufferGeometry();
  aimGeometry.setAttribute("position", new THREE.BufferAttribute(aimPositions, 3));
  const aimLine = new THREE.Line(aimGeometry, aimMaterial);
  aimLine.frustumCulled = false;
  aimLine.visible = false;
  const aimTarget = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }));
  aimTarget.rotation.x = -Math.PI / 2;
  aimTarget.visible = false;
  const readyRing = new THREE.Mesh(ringGeometry, ringMaterial);
  readyRing.rotation.x = -Math.PI / 2;
  readyRing.visible = false;
  scene.add(aimLine, aimTarget, readyRing);
  const aimColor = new THREE.Color();
  const fullPowerColor = new THREE.Color("#ffb547");
  const rollAxis = new THREE.Vector3();

  /** @type {Map<string,{mesh:THREE.Mesh,material:THREE.MeshStandardMaterial,aimTick:THREE.Line,lastX:number,lastZ:number}>} */
  const views = new Map();

  /** @param {BumperLinksPresentedBall} ball */
  function ensureBumperLinksBallView(ball) {
    let view = views.get(ball.id);
    if (view) return view;
    const material = new THREE.MeshStandardMaterial({
      color: BUMPER_LINKS_BALL_COLORS[ball.slotIndex % BUMPER_LINKS_BALL_COLORS.length],
      roughness: 0.35,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(ballGeometry, material);
    mesh.castShadow = true;
    const tickGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, RIVAL_AIM_LENGTH_M)]);
    const aimTick = new THREE.Line(tickGeometry, rivalAimMaterial);
    scene.add(mesh, aimTick);
    view = { mesh, material, aimTick, lastX: ball.x, lastZ: ball.z };
    views.set(ball.id, view);
    return view;
  }

  return {
    /**
     * @param {readonly BumperLinksPresentedBall[]} balls
     * @param {string} playerId
     * @param {{ready:boolean,timeSec:number,reducedMotion:boolean}} options
     */
    updateBalls(balls, playerId, { ready, timeSec, reducedMotion }) {
      for (const ball of balls) {
        const view = ensureBumperLinksBallView(ball);
        view.mesh.visible = !ball.sunk;
        view.mesh.position.set(ball.x, ball.y, ball.z);
        const travelX = ball.x - view.lastX;
        const travelZ = ball.z - view.lastZ;
        const travel = Math.hypot(travelX, travelZ);
        if (travel > 1e-4 && travel < 2) {
          view.mesh.rotateOnWorldAxis(rollAxis.set(travelZ / travel, 0, -travelX / travel), travel * ROLL_RAD_PER_M);
        }
        view.lastX = ball.x;
        view.lastZ = ball.z;
        const showTick = ball.id !== playerId && ball.atRest && !ball.sunk && ball.connected;
        view.aimTick.visible = showTick;
        if (showTick) {
          view.aimTick.position.set(ball.x, ball.y - radius * 0.8, ball.z);
          view.aimTick.rotation.y = ball.aimYaw;
        }
        if (ball.id === playerId) {
          readyRing.visible = ready && !ball.sunk;
          readyRing.position.set(ball.x, ball.y - radius + 0.01, ball.z);
          ringMaterial.opacity = reducedMotion ? 0.7 : 0.5 + Math.sin(timeSec * 5) * 0.3;
        }
      }
      if (!balls.some((ball) => ball.id === playerId)) readyRing.visible = false;
    },
    /**
     * @param {readonly BumperLinksAimPoint[]|null} points
     * @param {number} count
     * @param {number} power 0 while not charging.
     */
    updateAim(points, count, power) {
      const visible = Boolean(points && count > 1);
      aimLine.visible = visible;
      aimTarget.visible = visible;
      if (!visible) return;
      const used = Math.min(count, MAX_AIM_POINTS);
      for (let index = 0; index < used; index += 1) {
        aimPositions[index * 3] = points[index].x;
        aimPositions[index * 3 + 1] = points[index].y - radius * 0.85;
        aimPositions[index * 3 + 2] = points[index].z;
      }
      aimGeometry.attributes.position.needsUpdate = true;
      aimGeometry.setDrawRange(0, used);
      aimLine.computeLineDistances();
      aimColor.set("#ffffff").lerp(fullPowerColor, Math.min(1, power));
      aimMaterial.color.copy(aimColor);
      const last = points[used - 1];
      aimTarget.position.set(last.x, last.y - radius * 0.85 + 0.01, last.z);
    },
    dispose() {
      for (const view of views.values()) {
        scene.remove(view.mesh, view.aimTick);
        view.material.dispose();
        view.aimTick.geometry.dispose();
      }
      views.clear();
      scene.remove(aimLine, aimTarget, readyRing);
      ballGeometry.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      rivalAimMaterial.dispose();
      aimMaterial.dispose();
      aimGeometry.dispose();
      aimTarget.geometry.dispose();
      aimTarget.material.dispose();
    },
  };
}
