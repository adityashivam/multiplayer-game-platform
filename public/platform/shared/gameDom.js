export function getGameDomRefs() {
  const canvas = document.getElementById("game-canvas") || document.querySelector("canvas");
  const themeToggle = document.getElementById("theme-toggle");
  const dpadButtons = Array.from(document.querySelectorAll("[data-dir]"));
  const controllerButtons = Array.from(document.querySelectorAll("[data-action]"));
  const isEmbedded = Boolean(document.getElementById("game-view"));

  return {
    canvas,
    themeToggle,
    dpadButtons,
    controllerButtons,
    isEmbedded,
  };
}
