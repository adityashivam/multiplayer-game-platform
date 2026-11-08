export const pongPresentation = {
  coverUrl: "/games/pong/assets/cover.svg",
  accentColor: "#63e6dc",
  controls: ["keyboard", "touch"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const pongTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "paddle", type: "stick", role: "move", label: "Move paddle", icon: "swap_vert", platformBinding: "vertical" },
  ],
};
