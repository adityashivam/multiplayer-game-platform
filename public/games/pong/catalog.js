export const pongPresentation = {
  coverUrl: "/games/pong/assets/cover.svg",
  capsuleUrl: "/games/pong/art/capsule.svg",
  backdropUrl: "/games/pong/art/backdrop.svg",
  accentColor: "#63e6dc",
  controls: ["keyboard", "touch"],
  orientations: ["landscape", "portrait"],
};

/** @type {import("../../platform/shared/touchControls.js").TouchControlsDescriptor} */
export const pongTouchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    {
      id: "paddle",
      type: "stick",
      role: "move",
      label: "Move paddle",
      icon: "swap_vert",
      platformBinding: "vertical",
      // Upright, the court turns and the paddle slides sideways under the picture.
      portrait: { platformBinding: "horizontal", defaultLayout: { x: 0.5, y: 0.9, size: 96 } },
    },
  ],
};
