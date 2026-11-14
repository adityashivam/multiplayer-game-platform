/**
 * Game-owned driving controls on the platform's per-device touch layouts.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const driftlineTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "steer", type: "stick", role: "move", label: "Steer", icon: "swap_horiz" },
    { id: "throttle", type: "button", role: "primary", label: "Throttle", icon: "speed" },
    { id: "brake", type: "button", role: "secondary", label: "Brake", icon: "do_not_disturb_on" },
    { id: "handbrake", type: "button", role: "jump", label: "Handbrake", icon: "u_turn_left" },
    { id: "recover", type: "button", role: "utility", label: "Reset car", icon: "restart_alt", behavior: "press", defaultLayout: { size: 48 } },
  ],
};
