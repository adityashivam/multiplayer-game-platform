export const fightPresentation = {
  coverUrl: "/games/fight/assets/cover.svg",
  accentColor: "#ffae85",
  controls: ["keyboard", "touch"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const fightTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick", platformBinding: "horizontal" },
    { id: "jump", type: "button", role: "jump", label: "Jump", icon: "arrow_upward", platformBinding: "up" },
    { id: "crouch", type: "button", role: "utility", label: "Crouch", icon: "arrow_downward", platformBinding: "down", defaultLayout: { x: 0.6, y: 0.57, size: 56 } },
    { id: "attack", type: "button", role: "primary", label: "Attack", icon: "swords", platformBinding: "a" },
    { id: "heavy", type: "button", role: "secondary", label: "Heavy attack", icon: "flash_on", platformBinding: "x" },
    { id: "block", type: "button", role: "secondary", label: "Block", icon: "shield", platformBinding: "b", defaultLayout: { x: 0.74, y: 0.84 } },
    { id: "air-special", type: "button", role: "utility", label: "Air / Special", icon: "flare", platformBinding: "y", defaultLayout: { x: 0.91, y: 0.49, size: 60 } },
  ],
};
