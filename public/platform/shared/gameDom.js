export function getGameDomRefs() {
  const canvas = document.getElementById("game-canvas") || document.querySelector("canvas");

  return {
    canvas,
  };
}

function createControl(elements) {
  const list = Array.from(elements || []).filter(Boolean);
  return {
    onPress(handler) {
      if (typeof handler !== "function" || list.length === 0) return () => {};
      list.forEach((el) => el.addEventListener("click", handler));
      return () => list.forEach((el) => el.removeEventListener("click", handler));
    },
    onHold(onDown, onUp) {
      if (typeof onDown !== "function" || typeof onUp !== "function" || list.length === 0) {
        return () => {};
      }
      const cleanups = list.map((el) => bindHold(el, onDown, onUp));
      return () => cleanups.forEach((cleanup) => cleanup());
    },
  };
}

function bindHold(button, onDown, onUp) {
  const start = (event) => {
    event.preventDefault();
    onDown();
  };
  const end = (event) => {
    event.preventDefault();
    onUp();
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointerleave", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("touchstart", start, { passive: false });
  button.addEventListener("touchend", end, { passive: false });
  button.addEventListener("touchcancel", end, { passive: false });
  return () => {
    button.removeEventListener("pointerdown", start);
    button.removeEventListener("pointerup", end);
    button.removeEventListener("pointerleave", end);
    button.removeEventListener("pointercancel", end);
    button.removeEventListener("touchstart", start);
    button.removeEventListener("touchend", end);
    button.removeEventListener("touchcancel", end);
  };
}

export function getGameControls() {
  return {
    dpad: {
      up: createControl(document.querySelectorAll('[data-dir="up"]')),
      down: createControl(document.querySelectorAll('[data-dir="down"]')),
      left: createControl(document.querySelectorAll('[data-dir="left"]')),
      right: createControl(document.querySelectorAll('[data-dir="right"]')),
    },
    menu: {
      select: createControl(document.querySelectorAll('[data-action="select"]')),
      start: createControl(document.querySelectorAll('[data-action="start"]')),
    },
    actions: {
      x: createControl(document.querySelectorAll('[data-action="x"]')),
      a: createControl(document.querySelectorAll('[data-action="a"]')),
      b: createControl(document.querySelectorAll('[data-action="b"]')),
      y: createControl(document.querySelectorAll('[data-action="y"]')),
    },
  };
}
