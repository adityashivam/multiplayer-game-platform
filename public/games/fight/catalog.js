export const fightPresentation = {
  coverUrl: "/games/fight/assets/cover.svg",
  capsuleUrl: "/games/fight/art/capsule.svg",
  backdropUrl: "/games/fight/art/backdrop.svg",
  accentColor: "#ffae85",
  controls: ["keyboard", "touch"],
  orientations: ["landscape", "portrait"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const fightTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick", platformBinding: "horizontal", portrait: { defaultLayout: { x: 0.2, y: 0.85, size: 112 } } },
    { id: "jump", type: "button", role: "jump", label: "Jump", icon: "arrow_upward", platformBinding: "up", portrait: { defaultLayout: { x: 0.56, y: 0.91, size: 52 } } },
    { id: "crouch", type: "button", role: "utility", label: "Crouch", icon: "arrow_downward", platformBinding: "down", defaultLayout: { x: 0.6, y: 0.57, size: 56 }, portrait: { defaultLayout: { x: 0.56, y: 0.78, size: 52 } } },
    { id: "attack", type: "button", role: "primary", label: "Attack", icon: "swords", platformBinding: "a", portrait: { defaultLayout: { x: 0.88, y: 0.91, size: 64 } } },
    { id: "heavy", type: "button", role: "secondary", label: "Heavy attack", icon: "flash_on", platformBinding: "x", portrait: { defaultLayout: { x: 0.72, y: 0.78, size: 52 } } },
    { id: "block", type: "button", role: "secondary", label: "Block", icon: "shield", platformBinding: "b", defaultLayout: { x: 0.74, y: 0.84 }, portrait: { defaultLayout: { x: 0.72, y: 0.91, size: 52 } } },
    { id: "air-special", type: "button", role: "utility", label: "Air / Special", icon: "flare", platformBinding: "y", defaultLayout: { x: 0.91, y: 0.49, size: 60 }, portrait: { defaultLayout: { x: 0.88, y: 0.78, size: 52 } } },
  ],
};
