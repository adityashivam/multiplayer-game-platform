export const marioPresentation = {
  coverUrl: "/games/mario/assets/cover.svg",
  accentColor: "#a9db87",
  controls: ["keyboard", "touch"],
};

/** Shared by both Mario renderers, which expose the same standard input actions.
 * @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const marioTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick", platformBinding: "horizontal" },
    { id: "jump", type: "button", role: "primary", label: "Jump", icon: "arrow_upward", platformBinding: "a" },
    { id: "run", type: "button", role: "secondary", label: "Run", icon: "sprint", platformBinding: "b" },
  ],
};
