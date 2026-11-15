/**
 * Plain-language steps to unblock the microphone, chosen from the user agent.
 * Pure, so every device's wording is tested without a browser.
 */

/** @typedef {"ios"|"android"|"desktop"|"in-app"} MicrophoneGuideDevice */
/** @typedef {{device:MicrophoneGuideDevice,steps:string[]}} MicrophoneUnblockGuide */

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|WhatsApp|Snapchat|TikTok|musical_ly|\bLine\/|; wv\)/;
const IOS_DEVICE = /\b(iPhone|iPad|iPod)\b/;
const ANDROID_DEVICE = /\bAndroid\b/;

const OPERATING_SYSTEM_STEP = Object.freeze({
  mac: "Still silent? Open System Settings → Privacy & Security → Microphone and turn on your browser.",
  windows: "Still silent? Open Windows Settings → Privacy & security → Microphone and allow your browser.",
  other: "Still silent? Check that your computer's privacy settings let your browser use the microphone.",
});

/** @param {string} userAgent */
function describeDesktopMicrophoneSteps(userAgent) {
  const systemStep = /Macintosh|Mac OS X/.test(userAgent) ? OPERATING_SYSTEM_STEP.mac
    : /Windows/.test(userAgent) ? OPERATING_SYSTEM_STEP.windows
      : OPERATING_SYSTEM_STEP.other;
  if (/Firefox\//.test(userAgent)) {
    return ["Click the crossed-out microphone in the address bar and remove the block.", systemStep];
  }
  if (/Version\/[\d.]+ Safari\//.test(userAgent) && !/Chrome\/|Edg\//.test(userAgent)) {
    return ["In the Safari menu, choose Settings for This Website, then set Microphone to Allow.", systemStep];
  }
  return ["Click the icon just left of the web address and switch Microphone to Allow.", systemStep];
}

/** @param {string} userAgent */
function describeIosMicrophoneSteps(userAgent) {
  if (/CriOS\//.test(userAgent)) {
    return [
      "Open the iPhone Settings app → Chrome and turn on Microphone.",
      "Come back to this tab; if Chrome asks, choose Allow.",
    ];
  }
  if (/FxiOS\//.test(userAgent)) {
    return [
      "Open the iPhone Settings app → Firefox and turn on Microphone.",
      "Come back to this tab; if Firefox asks, choose Allow.",
    ];
  }
  if (/EdgiOS\//.test(userAgent)) {
    return [
      "Open the iPhone Settings app → Edge and turn on Microphone.",
      "Come back to this tab; if Edge asks, choose Allow.",
    ];
  }
  return [
    "Tap aA in the address bar → Website Settings → Microphone → Allow.",
    "If that's greyed out, open the Settings app → Apps → Safari → Microphone and choose Ask or Allow.",
  ];
}

/**
 * @param {{userAgent:string}} environment
 * @returns {MicrophoneUnblockGuide}
 */
export function describeMicrophoneUnblockGuide({ userAgent }) {
  const agent = typeof userAgent === "string" ? userAgent : "";
  if (IN_APP_BROWSER.test(agent)) {
    return {
      device: "in-app",
      steps: [
        "This app's built-in browser can't use your microphone. Open this page in Chrome or Safari.",
        "Use the app's menu (often ⋯ or the share icon) and choose Open in browser.",
      ],
    };
  }
  if (IOS_DEVICE.test(agent)) return { device: "ios", steps: describeIosMicrophoneSteps(agent) };
  if (ANDROID_DEVICE.test(agent)) {
    return {
      device: "android",
      steps: [
        "Tap the icon just left of the web address → Permissions → Microphone → Allow.",
        "Still blocked? Open Android Settings → Apps → your browser → Permissions → Microphone → Allow.",
      ],
    };
  }
  return { device: "desktop", steps: describeDesktopMicrophoneSteps(agent) };
}
