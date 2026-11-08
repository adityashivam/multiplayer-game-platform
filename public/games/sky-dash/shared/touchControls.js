/** Game intent only: platform presets, editing, gestures and persistence stay in the SDK. */
export const skyDashTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "jump", type: "button", role: "primary", label: "Jump", icon: "arrow_upward", behavior: "press" },
    { id: "dash", type: "button", role: "secondary", label: "Dash", icon: "bolt", behavior: "press" },
    { id: "dive", type: "button", role: "jump", label: "Dive", icon: "south_east", behavior: "press" },
  ],
};
