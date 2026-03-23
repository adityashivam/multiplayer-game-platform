export const ACTION_BUTTONS = [
  { action: "y", label: "Y" },
  { action: "a", label: "A" },
  { action: "x", label: "X" },
  { action: "b", label: "B" },
];

const UTILITY_BUTTONS = {
  home: { action: "home", label: "HOME", ariaLabel: "Home" },
  start: { action: "start", label: "START", ariaLabel: "Start" },
};

export const CONTROLLER_LAYOUTS = {
  full: {
    kind: "full",
    utilityButtons: [UTILITY_BUTTONS.home, UTILITY_BUTTONS.start],
  },
  "split-left": {
    kind: "split",
    primaryCluster: "dpad",
    utilityAlignment: "end",
    utilityButtons: [UTILITY_BUTTONS.home],
  },
  "split-right": {
    kind: "split",
    primaryCluster: "actions",
    utilityAlignment: "start",
    utilityButtons: [UTILITY_BUTTONS.start],
  },
};

export function getControllerLayout(variant = "full") {
  return CONTROLLER_LAYOUTS[variant] || CONTROLLER_LAYOUTS.full;
}

