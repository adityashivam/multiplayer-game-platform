export const roadRashPresentation = {
  coverUrl: "/games/roadrash/assets/cover.svg",
  accentColor: "#ffc078",
  controls: ["keyboard", "touch"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const roadRashTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "steer", type: "stick", role: "move", label: "Steer", icon: "joystick", platformBinding: "horizontal" },
    { id: "throttle", type: "button", role: "primary", label: "Throttle", icon: "speed", platformBinding: "up" },
    { id: "brake", type: "button", role: "secondary", label: "Brake", icon: "pan_tool", platformBinding: "down" },
    { id: "kick-left", type: "button", role: "utility", label: "Kick left", icon: "arrow_back", behavior: "press", platformBinding: "x", defaultLayout: { x: 0.65, y: 0.84, size: 60 } },
    { id: "kick-right", type: "button", role: "utility", label: "Kick right", icon: "arrow_forward", behavior: "press", platformBinding: "b", defaultLayout: { x: 0.91, y: 0.54, size: 60 } },
  ],
};
