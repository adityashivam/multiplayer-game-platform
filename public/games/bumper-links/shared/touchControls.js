/**
 * Game-owned actions on the platform's per-device editable touch layouts.
 * The stick turns the aim; holding Putt charges and releasing shoots.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const bumperLinksTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger"],
  controls: [
    { id: "aim", type: "stick", role: "move", label: "Aim", icon: "joystick" },
    { id: "shoot", type: "button", role: "primary", label: "Putt", icon: "sports_golf", behavior: "hold" },
  ],
};
