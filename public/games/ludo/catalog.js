/** Game-owned artwork, input advertising and optional platform control layout. */
export const ludoPresentation = {
  coverUrl: "/games/ludo/cover.svg",
  capsuleUrl: "/games/ludo/art/capsule.svg",
  backdropUrl: "/games/ludo/art/backdrop.svg",
  accentColor: "#ffc447",
  controls: ["pointer", "touch", "keyboard"],
  orientations: ["landscape", "portrait"],
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
    // Upright, the table's sheet fills the bottom, so the button waits top right.
    portrait: { defaultLayout: { x: 0.86, y: 0.1, size: 60 } },
  }],
};
