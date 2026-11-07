/**
 * Optional pure simulation helpers. Games choose mechanics, field names and input
 * bindings; custom simulation callbacks can be used instead of these controllers.
 */

const DEFAULT_CHARACTER_STEP_OPTIONS = Object.freeze({ active: true });

/**
 * @template PlayerState, InputState
 * @template {string} ActionId
 * @typedef {object} TimedActionController
 * @property {(player: PlayerState, input: InputState, dtSec: number) => void} step
 * @property {(player: PlayerState) => void} reset Clears action state, retaining cooldown.
 * @property {(player: PlayerState) => boolean} isActive
 */

/**
 * @template InputState, PlayerState
 * @template {string} ActionId
 * @typedef {object} TimedActionBinding
 * @property {keyof InputState} inputKey
 * @property {ActionId} actionId
 * @property {(player: PlayerState, input: InputState) => boolean} [when]
 *   Optional complete trigger predicate; defaults to the bound input's value.
 */

/**
 * Validate field bindings once, outside simulation and prediction replay.
 * @template Bindings
 * @param {Bindings} bindings
 * @param {ReadonlyArray<keyof Bindings>} requiredKeys
 * @param {ReadonlyArray<keyof Bindings>} [optionalKeys]
 * @throws {TypeError} If a required or supplied optional binding is not a field key.
 */
function validateControllerFieldBindings(bindings, requiredKeys, optionalKeys = []) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new TypeError("Simulation controller requires field bindings.");
  }
  for (const bindingName of [...requiredKeys, ...optionalKeys]) {
    const fieldKey = bindings[bindingName];
    if (fieldKey === undefined && optionalKeys.includes(bindingName)) {
      continue;
    }
    const validFieldKey = (typeof fieldKey === "string" && fieldKey.length > 0) ||
      typeof fieldKey === "symbol" || (typeof fieldKey === "number" && Number.isFinite(fieldKey));
    if (!validFieldKey) {
      throw new TypeError(`Simulation controller requires a valid ${String(bindingName)} field binding.`);
    }
  }
}

/**
 * @param {string} settingName
 * @param {number} settingValue
 * @param {number} [minimum]
 */
function validateSimulationNumber(settingName, settingValue, minimum = -Infinity) {
  if (!Number.isFinite(settingValue) || settingValue < minimum) {
    throw new TypeError(`Simulation controller has invalid ${settingName}.`);
  }
}

/**
 * @param {number} minimum
 * @param {number} maximum
 */
function validateSimulationBounds(minimum, maximum) {
  validateSimulationNumber("minimum bound", minimum);
  validateSimulationNumber("maximum bound", maximum, minimum);
}

/**
 * Create bounded movement along any one state axis. Opposing controls cancel.
 * The returned step mutates only the bound position and does not mutate input.
 * @template PlayerState, InputState
 * @param {object} config
 * @param {{position: keyof PlayerState}} config.state
 * @param {{negative: keyof InputState, positive: keyof InputState}} config.input
 * @param {number} config.speed Units per second.
 * @param {number} config.min Minimum center position.
 * @param {number} config.max Maximum center position.
 * @returns {(player: PlayerState, input: InputState, dtSec: number) => void}
 * @throws {TypeError} If bindings, speed or bounds are invalid.
 */
export function createAxisMovementController({ state, input, speed, min, max }) {
  validateControllerFieldBindings(state, ["position"]);
  validateControllerFieldBindings(input, ["negative", "positive"]);
  validateSimulationNumber("speed", speed, 0);
  validateSimulationBounds(min, max);
  const { position } = state;
  const { negative, positive } = input;

  return function stepAxisMovement(player, inputState, dtSec) {
    let velocity = 0;
    if (inputState[negative] && !inputState[positive]) {
      velocity = -speed;
    } else if (inputState[positive] && !inputState[negative]) {
      velocity = speed;
    }

    player[position] += velocity * dtSec;
    player[position] = Math.max(min, Math.min(max, player[position]));
  };
}

/**
 * Create ordered button bindings and timers for arbitrary action identifiers.
 * A new action starts before its timers advance in the same step. Cooldown is
 * allowed to cross zero; reset clears the action while retaining that cooldown.
 * Definitions are read on start, allowing deliberate runtime timing adjustments.
 * @template PlayerState, InputState
 * @template {string} ActionId
 * @param {object} config
 * @param {{active: keyof PlayerState, kind: keyof PlayerState, remainingSec: keyof PlayerState, cooldownSec: keyof PlayerState}} config.state
 * @param {Record<ActionId, {duration: number, cooldown: number}>} config.definitions
 * @param {ReadonlyArray<TimedActionBinding<InputState, PlayerState, ActionId>>} config.bindings Highest priority first.
 * @param {(player: PlayerState, actionId: ActionId) => void} [config.onStart] Optional game-owned state reset.
 * @returns {TimedActionController<PlayerState, InputState, ActionId>}
 * @throws {TypeError} If fields, bindings or initial timing definitions are invalid.
 */
export function createTimedActionController({ state, definitions, bindings, onStart }) {
  validateControllerFieldBindings(state, ["active", "kind", "remainingSec", "cooldownSec"]);
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions) || !Array.isArray(bindings)) {
    throw new TypeError("Timed action controller requires definitions and bindings.");
  }
  if (onStart !== undefined && typeof onStart !== "function") {
    throw new TypeError("Timed action controller onStart must be a function.");
  }
  for (const binding of bindings) {
    validateControllerFieldBindings(binding, ["inputKey"]);
    if (typeof binding.actionId !== "string" || !Object.hasOwn(definitions, binding.actionId)) {
      throw new TypeError("Timed action binding requires a known action identifier.");
    }
    if (binding.when !== undefined && typeof binding.when !== "function") {
      throw new TypeError("Timed action binding when must be a function.");
    }
    const definition = definitions[binding.actionId];
    validateSimulationNumber("action duration", definition?.duration, 0);
    validateSimulationNumber("action cooldown", definition?.cooldown, 0);
  }

  const { active, kind, remainingSec, cooldownSec } = state;
  const actionBindings = bindings.map((binding) => ({ ...binding }));

  /** @param {PlayerState} player */
  function reset(player) {
    player[active] = false;
    player[kind] = null;
    player[remainingSec] = 0;
  }

  /**
   * @param {PlayerState} player
   * @param {InputState} inputState
   * @param {number} dtSec
   */
  function step(player, inputState, dtSec) {
    if (!player[active] && !(player[cooldownSec] > 0)) {
      for (const binding of actionBindings) {
        const triggered = binding.when
          ? binding.when(player, inputState)
          : inputState[binding.inputKey];
        if (!triggered) {
          continue;
        }
        const definition = definitions[binding.actionId];
        player[active] = true;
        player[kind] = binding.actionId;
        player[remainingSec] = definition.duration;
        player[cooldownSec] = definition.duration + definition.cooldown;
        onStart?.(player, binding.actionId);
        break;
      }
    }

    if (player[active]) {
      player[remainingSec] -= dtSec;
      if (player[remainingSec] <= 0) {
        reset(player);
      }
    }
    if (player[cooldownSec] > 0) {
      player[cooldownSec] -= dtSec;
    }
  }

  return { step, reset, isActive: (player) => Boolean(player[active]) };
}

/**
 * Create side-view movement, jumping and optional timed actions using field maps.
 * Coordinates increase downwards. Intent uses the action state from the start of
 * the step, then jump intent, actions, gravity, integration and bounds run in order.
 * Disabled state clears horizontal velocity only. Inactive state clears motion
 * and active actions, clamps the floor, and retains cooldown and facing.
 * @template PlayerState, InputState
 * @template {string} ActionId
 * @param {object} config
 * @param {{x: keyof PlayerState, y: keyof PlayerState, vx: keyof PlayerState, vy: keyof PlayerState, facing?: keyof PlayerState, disabled?: keyof PlayerState}} config.state
 * @param {{negative: keyof InputState, positive: keyof InputState, jump: keyof InputState}} config.input
 * @param {{speed: number, busySpeed?: number, jumpSpeed: number, gravity: number, floorY: number, minX: number, maxX: number, groundTolerance: number}} config.movement
 * @param {TimedActionController<PlayerState, InputState, ActionId>} [config.actions]
 * @returns {(player: PlayerState, input: InputState, dtSec: number, options?: {active?: boolean}) => PlayerState}
 * @throws {TypeError} If bindings, movement settings or the action controller are invalid.
 */
export function createSideViewCharacterController({ state, input, movement, actions }) {
  validateControllerFieldBindings(state, ["x", "y", "vx", "vy"], ["facing", "disabled"]);
  validateControllerFieldBindings(input, ["negative", "positive", "jump"]);
  const { speed, busySpeed = speed, jumpSpeed, gravity, floorY, minX, maxX, groundTolerance } = movement;
  validateSimulationNumber("speed", speed, 0);
  validateSimulationNumber("busy speed", busySpeed, 0);
  validateSimulationNumber("jump speed", jumpSpeed);
  validateSimulationNumber("gravity", gravity);
  validateSimulationNumber("floor", floorY);
  validateSimulationNumber("ground tolerance", groundTolerance, 0);
  validateSimulationBounds(minX, maxX);
  if (actions !== undefined && (!actions ||
      ["step", "reset", "isActive"].some((methodName) => typeof actions[methodName] !== "function"))) {
    throw new TypeError("Side-view character controller requires valid action methods.");
  }
  const { x, y, vx, vy, facing, disabled } = state;
  const { negative, positive, jump } = input;

  return function stepSideViewCharacter(player, inputState, dtSec, { active = true } = DEFAULT_CHARACTER_STEP_OPTIONS) {
    if (disabled !== undefined && player[disabled]) {
      player[vx] = 0;
      return player;
    }
    if (!active) {
      player[vx] = 0;
      player[vy] = 0;
      actions?.reset(player);
      if (player[y] > floorY) {
        player[y] = floorY;
      }
      return player;
    }

    const busy = actions?.isActive(player) || false;
    const movementSpeed = busy ? busySpeed : speed;
    if (inputState[negative] && !inputState[positive]) {
      player[vx] = -movementSpeed;
      if (!busy && facing !== undefined) {
        player[facing] = -1;
      }
    } else if (inputState[positive] && !inputState[negative]) {
      player[vx] = movementSpeed;
      if (!busy && facing !== undefined) {
        player[facing] = 1;
      }
    } else {
      player[vx] = 0;
    }
    if (inputState[jump] && player[y] >= floorY - groundTolerance) {
      player[vy] = jumpSpeed;
    }
    actions?.step(player, inputState, dtSec);

    player[vy] += gravity * dtSec;
    player[y] += player[vy] * dtSec;
    if (player[y] > floorY) {
      player[y] = floorY;
      player[vy] = 0;
    }
    player[x] = Math.max(minX, Math.min(maxX, player[x] + player[vx] * dtSec));
    return player;
  };
}

/**
 * Create symmetric horizontal contact separation with arena bounds. The resolver
 * mutates both players. Exactly aligned players push in a stable direction.
 * @template PlayerState
 * @param {object} config
 * @param {{x: keyof PlayerState, y: keyof PlayerState, vx: keyof PlayerState}} config.state
 * @param {number} config.minX
 * @param {number} config.maxX
 * @param {number} config.minDistance
 * @param {number} config.verticalLimit
 * @returns {(firstPlayer: PlayerState, secondPlayer: PlayerState) => void}
 * @throws {TypeError} If bindings, bounds or contact distances are invalid.
 */
export function createHorizontalSeparationController({ state, minX, maxX, minDistance, verticalLimit }) {
  validateControllerFieldBindings(state, ["x", "y", "vx"]);
  validateSimulationBounds(minX, maxX);
  validateSimulationNumber("minimum separation", minDistance, 0);
  validateSimulationNumber("vertical separation limit", verticalLimit, 0);
  const { x, y, vx } = state;

  return function resolveHorizontalSeparation(firstPlayer, secondPlayer) {
    const horizontalDistance = firstPlayer[x] - secondPlayer[x];
    if (Math.abs(horizontalDistance) < minDistance && Math.abs(firstPlayer[y] - secondPlayer[y]) < verticalLimit) {
      const pushDistance = (minDistance - Math.abs(horizontalDistance)) / 2;
      const pushDirection = horizontalDistance === 0 ? 1 : Math.sign(horizontalDistance);
      firstPlayer[x] += pushDistance * pushDirection;
      secondPlayer[x] -= pushDistance * pushDirection;
      firstPlayer[vx] = 0;
      secondPlayer[vx] = 0;
    }

    firstPlayer[x] = Math.max(minX, Math.min(maxX, firstPlayer[x]));
    secondPlayer[x] = Math.max(minX, Math.min(maxX, secondPlayer[x]));
  };
}
