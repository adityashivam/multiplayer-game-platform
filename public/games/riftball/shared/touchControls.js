/**
 * Game-owned actions use the platform's per-device editable touch layouts.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const riftballTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "aim", type: "look", role: "look", label: "Aim", editable: false },
    { id: "strike", type: "button", role: "primary", label: "Strike", icon: "sports_handball", behavior: "hold-look" },
    { id: "dash", type: "button", role: "secondary", label: "Dash", icon: "bolt", behavior: "press" },
    { id: "jump", type: "button", role: "jump", label: "Jump", icon: "arrow_upward", behavior: "press" },
    { id: "feint", type: "button", role: "utility", label: "Feint", icon: "undo", behavior: "press" },
  ],
};
