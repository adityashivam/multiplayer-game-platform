/**
 * iPhone browsers (all WebKit, Chrome included) cannot put a page into real
 * fullscreen; only a site launched from the home screen runs without
 * browser bars. These helpers decide when to say so.
 */

const IPHONE_USER_AGENT = /\b(iPhone|iPod)\b/;

export const HOME_SCREEN_FULLSCREEN_TIP = "For true fullscreen on iPhone, tap Share, then Add to Home Screen, and play from that icon.";

/**
 * @typedef {object} HomeScreenFullscreenEnvironment
 * @property {string} userAgent
 * @property {boolean} standalone Already launched from the home screen.
 * @property {boolean} fullscreenEnabled Whether the page fullscreen API is available.
 */

/**
 * @param {HomeScreenFullscreenEnvironment} environment
 * @returns {boolean} Whether to suggest Add to Home Screen instead of page fullscreen.
 */
export function shouldSuggestHomeScreenFullscreen({ userAgent, standalone, fullscreenEnabled }) {
  return IPHONE_USER_AGENT.test(userAgent) && !standalone && !fullscreenEnabled;
}

/**
 * Read the environment from the browser.
 * @param {Window} browserWindow
 * @returns {HomeScreenFullscreenEnvironment}
 */
export function readHomeScreenFullscreenEnvironment(browserWindow) {
  const displayModeStandalone = ["standalone", "fullscreen"].some((mode) => browserWindow.matchMedia?.(`(display-mode: ${mode})`).matches);
  return {
    userAgent: browserWindow.navigator.userAgent,
    standalone: browserWindow.navigator.standalone === true || displayModeStandalone,
    fullscreenEnabled: browserWindow.document.fullscreenEnabled === true,
  };
}
