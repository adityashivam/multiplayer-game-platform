export const webglSamplePresentation = {
  coverUrl: "/games/webgl-sample/assets/cover.svg",
  accentColor: "#76d5ff",
  controls: ["keyboard", "touch"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const webglSampleTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "steer", type: "stick", role: "move", label: "Steer", icon: "joystick", platformBinding: "horizontal" },
    { id: "play", type: "button", role: "primary", label: "Play / Retry", icon: "replay", behavior: "press", platformBinding: "a" },
  ],
};
