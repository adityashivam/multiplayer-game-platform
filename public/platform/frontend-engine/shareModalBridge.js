let controller = null;

export function registerShareModalController(next) {
  controller = typeof next === "function" ? next : null;
}

export function openShareModal() {
  if (controller) controller(true);
}

export function closeShareModal() {
  if (controller) controller(false);
}
