/**
 * Game-owned flight controls on the platform's per-device touch layouts.
 * The stick flies (pitch and roll); touch pilots turn by banking and pulling.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const skybreakTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "stick", type: "stick", role: "move", label: "Flight stick", icon: "flight" },
    { id: "fire", type: "button", role: "primary", label: "Cannon", icon: "my_location" },
    { id: "missile", type: "button", role: "secondary", label: "Missile", icon: "rocket_launch", behavior: "press" },
    { id: "boost", type: "button", role: "jump", label: "Boost", icon: "local_fire_department" },
    { id: "flare", type: "button", role: "utility", label: "Flares", icon: "flare", behavior: "press" },
    { id: "brake", type: "button", role: "utility", label: "Airbrake", icon: "do_not_disturb_on" },
  ],
};
