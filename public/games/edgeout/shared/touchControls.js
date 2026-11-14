/**
 * Game-owned actions on the platform's per-device editable touch layouts.
 * Touch aims with the movement stick, so no look surface is declared.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const edgeoutTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "shove", type: "button", role: "primary", label: "Shove", icon: "back_hand" },
    { id: "dash", type: "button", role: "secondary", label: "Dash", icon: "bolt", behavior: "press" },
    { id: "block", type: "button", role: "utility", label: "Block", icon: "shield" },
  ],
};
