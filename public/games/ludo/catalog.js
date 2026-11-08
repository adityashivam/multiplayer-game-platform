/** Game-owned artwork, input advertising and optional platform control layout. */
export const ludoPresentation = {
  coverUrl: "/games/ludo/cover.svg",
  accentColor: "#ffc447",
  controls: ["pointer", "touch", "keyboard"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const ludoTouchControls = {
  apiVersion: 1,
  customizable: true,
  allowedPresets: ["two-thumb"],
  defaultPreset: "two-thumb",
  controls: [{
    id: "confirm",
    type: "button",
    role: "primary",
    label: "Roll / move",
    icon: "casino",
    behavior: "press",
    platformBinding: "a",
    defaultLayout: { x: 0.08, y: 0.85, size: 64 },
  }],
};
