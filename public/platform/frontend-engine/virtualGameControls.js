/** Window boundary shared by independently bundled shell and game SDK modules. */
export const VIRTUAL_GAME_CONTROL_EVENT = "platformvirtualgamecontrol";

const VIRTUAL_GAME_CONTROL_OWNERS = Symbol.for("platform.virtual-game-control-owners.v1");
const SUPPORTED_CONTROL_BINDINGS = new Set(["up", "down", "left", "right", "a", "b", "x", "y"]);
const MAX_ACTIVE_CONTROL_SOURCES = 128;

/**
 * @typedef {import("../shared/touchControls.js").TouchPlatformButtonBinding} PlatformControlBinding
 * @typedef {{binding: PlatformControlBinding, pressed: boolean, held: boolean}} VirtualGameControlChange
 * @typedef {{sources: Map<symbol, Set<PlatformControlBinding>>}} VirtualGameControlOwnership
 * @typedef {{setHeld: (binding: PlatformControlBinding, active: boolean) => void, release: () => void, dispose: () => void}} VirtualGameControlSource
 */

/** @param {Window|undefined} inputWindow @returns {VirtualGameControlOwnership|undefined} */
function getVirtualGameControlOwnership(inputWindow) {
  if (!inputWindow) {
    return undefined;
  }
  if (!inputWindow[VIRTUAL_GAME_CONTROL_OWNERS]) {
    inputWindow[VIRTUAL_GAME_CONTROL_OWNERS] = { sources: new Map() };
  }
  return inputWindow[VIRTUAL_GAME_CONTROL_OWNERS];
}

/** @returns {Window|undefined} */
function getVirtualGameControlWindow() {
  return typeof window === "undefined" ? undefined : window;
}

/**
 * Read aggregate ownership without depending on DOM button presence or visibility.
 * @param {PlatformControlBinding} binding
 * @param {Window|undefined} [inputWindow]
 * @returns {boolean}
 */
export function isVirtualGameControlHeld(binding, inputWindow = getVirtualGameControlWindow()) {
  const ownership = getVirtualGameControlOwnership(inputWindow);
  return Boolean(ownership && [...ownership.sources.values()].some((bindings) => bindings.has(binding)));
}

/**
 * Create one bounded input owner. Use separate sources for controls that can hold
 * the same action at once. Release/dispose never clears another owner's state.
 * At most 128 sources may hold input concurrently; inactive sources consume no shared history.
 * @param {Window|undefined} [inputWindow]
 * @returns {VirtualGameControlSource}
 * @throws {TypeError} If setHeld receives an unsupported direction/action.
 */
export function createVirtualGameControlSource(inputWindow = getVirtualGameControlWindow()) {
  const ownership = getVirtualGameControlOwnership(inputWindow);
  const sourceId = Symbol("virtual-game-control-source");
  /** @type {Set<PlatformControlBinding>} */
  const heldBindings = new Set();
  let disposed = false;

  /** @param {PlatformControlBinding} binding @param {boolean} active */
  function setHeld(binding, active) {
    if (!SUPPORTED_CONTROL_BINDINGS.has(binding)) {
      throw new TypeError("Unsupported virtual game control binding");
    }
    if (disposed || !ownership || heldBindings.has(binding) === Boolean(active)) {
      return;
    }

    if (active) {
      if (!ownership.sources.has(sourceId) && ownership.sources.size >= MAX_ACTIVE_CONTROL_SOURCES) {
        return;
      }
      heldBindings.add(binding);
      ownership.sources.set(sourceId, heldBindings);
    } else {
      heldBindings.delete(binding);
      if (heldBindings.size === 0) {
        ownership.sources.delete(sourceId);
      }
    }
    inputWindow.dispatchEvent(new inputWindow.CustomEvent(VIRTUAL_GAME_CONTROL_EVENT, {
      detail: { binding, pressed: Boolean(active), held: isVirtualGameControlHeld(binding, inputWindow) },
    }));
  }

  function release() {
    for (const binding of heldBindings) {
      setHeld(binding, false);
    }
  }

  return {
    setHeld,
    release,
    dispose() {
      release();
      disposed = true;
    },
  };
}

/**
 * Subscribe across SDK bundle copies. Press edges remain distinct from aggregate
 * held state, so a second source can press an action without releasing the first.
 * @param {PlatformControlBinding} binding
 * @param {(controlChange: VirtualGameControlChange) => void} listener
 * @param {Window|undefined} [inputWindow]
 * @returns {() => void}
 */
export function subscribeVirtualGameControl(binding, listener, inputWindow = getVirtualGameControlWindow()) {
  if (!inputWindow) {
    return () => {};
  }
  function receiveVirtualGameControl(inputEvent) {
    const controlChange = inputEvent.detail;
    if (controlChange?.binding === binding && typeof controlChange.pressed === "boolean" && typeof controlChange.held === "boolean") {
      listener({ binding, pressed: controlChange.pressed, held: controlChange.held });
    }
  }
  inputWindow.addEventListener(VIRTUAL_GAME_CONTROL_EVENT, receiveVirtualGameControl);
  return () => inputWindow.removeEventListener(VIRTUAL_GAME_CONTROL_EVENT, receiveVirtualGameControl);
}
