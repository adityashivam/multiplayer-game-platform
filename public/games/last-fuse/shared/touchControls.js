/**
 * Game-owned actions on the platform's per-device editable touch layouts.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const lastFuseTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Run", icon: "joystick" },
    { id: "jump", type: "button", role: "jump", label: "Jump", icon: "arrow_upward", behavior: "press" },
    { id: "dash", type: "button", role: "primary", label: "Dash", icon: "bolt", behavior: "press" },
  ],
};
