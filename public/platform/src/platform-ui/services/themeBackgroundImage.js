import { PLATFORM_THEME_LIMITS } from "./platformThemes.js";

/** Largest edge kept for a background image; larger pictures are scaled down. */
const MAX_EDGE_PX = 1600;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const QUALITY_STEPS = Object.freeze([0.82, 0.72, 0.62, 0.52]);
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

/**
 * Turn a picked picture into a background a theme can embed: decoded on this
 * device, scaled to at most 1600px, re-encoded as WebP (JPEG where WebP
 * encoding isn't available) and shrunk until it fits the theme limit. Only
 * the re-encoded pixels are kept, so metadata such as location is dropped.
 * Nothing is uploaded.
 * @param {File} file
 * @returns {Promise<{ok:true,image:string}|{ok:false,error:string}>}
 */
export async function prepareThemeBackgroundImage(file) {
  if (!file || !ACCEPTED_TYPES.has(file.type)) return { ok: false, error: "Choose a PNG, JPEG, WebP, GIF or AVIF image." };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: "That image is too large (25 MB maximum)." };

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: "That image couldn't be read." };
  }

  try {
    let scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITY_STEPS) {
        let image = canvas.toDataURL("image/webp", quality);
        if (!image.startsWith("data:image/webp")) image = canvas.toDataURL("image/jpeg", quality);
        if (image.length <= PLATFORM_THEME_LIMITS.maxImageChars) return { ok: true, image };
      }
      scale *= 0.75;
    }
    return { ok: false, error: "That image couldn't be made small enough; try a simpler picture." };
  } finally {
    bitmap.close?.();
  }
}
