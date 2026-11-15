/**
 * Draw the platform's home-screen icons as PNG files with no image tooling:
 * a dark square with a cyan gamepad inside the central 60% (the maskable
 * safe zone, so Android can crop it to any shape). Run with
 * `node scripts/generate-platform-icons.mjs`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ICON_SIZES_PX = Object.freeze([180, 192, 512]);
const SUPERSAMPLES_PER_AXIS = 4;
const OUTPUT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/platform/public/icons");
const BACKGROUND_TOP = Object.freeze([0x0f, 0x1a, 0x20]);
const BACKGROUND_BOTTOM = Object.freeze([0x14, 0x2a, 0x33]);
const GLYPH_COLOR = Object.freeze([0x00, 0xda, 0xf3]);
const CUTOUT_COLOR = Object.freeze([0x0f, 0x1a, 0x20]);

/**
 * Signed distance to a rounded box centred at (cx, cy), in unit-square coordinates.
 * @param {number} x @param {number} y @param {number} cx @param {number} cy
 * @param {number} halfWidth @param {number} halfHeight @param {number} radius
 */
function distanceToRoundedBox(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const offsetX = Math.abs(x - cx) - halfWidth + radius;
  const offsetY = Math.abs(y - cy) - halfHeight + radius;
  const outside = Math.hypot(Math.max(offsetX, 0), Math.max(offsetY, 0));
  return outside + Math.min(Math.max(offsetX, offsetY), 0) - radius;
}

/** @param {number} x @param {number} y @param {number} cx @param {number} cy @param {number} radius */
function distanceToCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

/**
 * Colour of one sample point in the unit square: gamepad body with grips,
 * a d-pad and two face buttons cut out of it.
 * @param {number} x @param {number} y
 * @returns {readonly number[]} RGB
 */
function sampleIconColor(x, y) {
  const body = Math.min(
    distanceToRoundedBox(x, y, 0.5, 0.47, 0.27, 0.12, 0.12),
    distanceToCircle(x, y, 0.33, 0.58, 0.1),
    distanceToCircle(x, y, 0.67, 0.58, 0.1),
  );
  if (body > 0) {
    const shade = y;
    return BACKGROUND_TOP.map((channel, index) => channel + (BACKGROUND_BOTTOM[index] - channel) * shade);
  }
  const dpad = Math.min(
    distanceToRoundedBox(x, y, 0.36, 0.48, 0.075, 0.024, 0.01),
    distanceToRoundedBox(x, y, 0.36, 0.48, 0.024, 0.075, 0.01),
  );
  const buttons = Math.min(
    distanceToCircle(x, y, 0.63, 0.44, 0.032),
    distanceToCircle(x, y, 0.7, 0.51, 0.032),
  );
  return dpad <= 0 || buttons <= 0 ? CUTOUT_COLOR : GLYPH_COLOR;
}

/**
 * Supersampled RGBA pixels for a square icon.
 * @param {number} sizePx
 * @returns {Buffer} PNG scanlines, each prefixed by filter byte 0.
 */
function renderIconScanlines(sizePx) {
  const rowBytes = sizePx * 4 + 1;
  const scanlines = Buffer.alloc(rowBytes * sizePx);
  const sampleCount = SUPERSAMPLES_PER_AXIS * SUPERSAMPLES_PER_AXIS;
  for (let row = 0; row < sizePx; row += 1) {
    scanlines[row * rowBytes] = 0;
    for (let column = 0; column < sizePx; column += 1) {
      const color = [0, 0, 0];
      for (let sampleY = 0; sampleY < SUPERSAMPLES_PER_AXIS; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPERSAMPLES_PER_AXIS; sampleX += 1) {
          const sample = sampleIconColor(
            (column + (sampleX + 0.5) / SUPERSAMPLES_PER_AXIS) / sizePx,
            (row + (sampleY + 0.5) / SUPERSAMPLES_PER_AXIS) / sizePx,
          );
          color[0] += sample[0];
          color[1] += sample[1];
          color[2] += sample[2];
        }
      }
      const offset = row * rowBytes + 1 + column * 4;
      scanlines[offset] = Math.round(color[0] / sampleCount);
      scanlines[offset + 1] = Math.round(color[1] / sampleCount);
      scanlines[offset + 2] = Math.round(color[2] / sampleCount);
      scanlines[offset + 3] = 255;
    }
  }
  return scanlines;
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** @param {Buffer} bytes */
function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function encodePngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(computeCrc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {number} sizePx @returns {Buffer} */
function encodeIconPng(sizePx) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sizePx, 0);
  header.writeUInt32BE(sizePx, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    encodePngChunk("IHDR", header),
    encodePngChunk("IDAT", deflateSync(renderIconScanlines(sizePx), { level: 9 })),
    encodePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
for (const sizePx of ICON_SIZES_PX) {
  const outputPath = path.join(OUTPUT_DIRECTORY, `icon-${sizePx}.png`);
  writeFileSync(outputPath, encodeIconPng(sizePx));
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}
