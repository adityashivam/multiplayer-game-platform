export const drawPresentation = {
  coverUrl: "/games/draw/assets/cover.svg",
  accentColor: "#b5adff",
  controls: ["pointer", "touch"],
};

/** Drawing gestures remain on the canvas; only the existing clear action is overlaid.
 * @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const drawTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "clear", type: "button", role: "utility", label: "Clear", icon: "delete", behavior: "press", platformBinding: "x", defaultLayout: { x: 0.91, y: 0.85, size: 60 } },
  ],
};
