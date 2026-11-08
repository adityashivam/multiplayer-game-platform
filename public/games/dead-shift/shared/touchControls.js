/**
 * Game-owned touch intent; the platform supplies presets, pointer ownership,
 * layout persistence and the optional editor. Aim only changes local camera
 * presentation and is deliberately absent from the network input schema.
 * @type {import("../../../platform/shared/touchControls.js").TouchControlsDescriptor}
 */
export const deadShiftTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "look", type: "look", role: "look", label: "Look", editable: false },
    { id: "fire", type: "button", role: "primary", label: "Fire", icon: "my_location", behavior: "hold-look" },
    { id: "aim", type: "button", role: "secondary", label: "Aim", icon: "center_focus_strong", behavior: "hold-look" },
    { id: "reload", type: "button", role: "reload", label: "Reload", icon: "sync", behavior: "press" },
    { id: "jump", type: "button", role: "jump", label: "Jump", icon: "arrow_upward", behavior: "press" },
    { id: "weapon", type: "button", role: "utility", label: "Weapon", icon: "swap_horiz", behavior: "press" },
  ],
};
