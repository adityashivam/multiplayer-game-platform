import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gamesRoot = path.join(repositoryRoot, "public", "games");
const ART_SPECS = Object.freeze({
  capsuleUrl: { viewBox: "0 0 600 900" },
  backdropUrl: { viewBox: "0 0 1920 1080" },
});
const MAX_ART_BYTES = 45 * 1024;

/** Every bundled game's exported presentation objects, keyed by game folder. */
async function readBundledPresentations() {
  const presentations = [];
  for (const folder of await readdir(gamesRoot)) {
    const catalogPath = path.join(gamesRoot, folder, "catalog.js");
    try {
      await stat(catalogPath);
    } catch {
      continue;
    }
    const catalog = await import(pathToFileURL(catalogPath).href);
    for (const [exportName, value] of Object.entries(catalog)) {
      if (exportName.endsWith("Presentation") && value && typeof value === "object") presentations.push({ folder, exportName, presentation: value });
    }
  }
  return presentations;
}

test("every bundled game ships a capsule and a backdrop in the shared art kit", async () => {
  const presentations = await readBundledPresentations();
  assert.ok(presentations.length >= 16, `found ${presentations.length} presentations`);
  for (const { folder, exportName, presentation } of presentations) {
    for (const [artworkKey, spec] of Object.entries(ART_SPECS)) {
      const artworkUrl = presentation[artworkKey];
      assert.equal(typeof artworkUrl, "string", `${folder} ${exportName}.${artworkKey} is missing`);
      assert.ok(artworkUrl.startsWith(`/games/${folder}/`), `${folder} art lives in its own package: ${artworkUrl}`);
      const artworkPath = path.join(repositoryRoot, "public", artworkUrl);
      const svg = await readFile(artworkPath, "utf8");
      const bytes = Buffer.byteLength(svg);
      assert.ok(bytes <= MAX_ART_BYTES, `${artworkUrl} is ${bytes} bytes`);
      assert.match(svg, /<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${artworkUrl} is standalone SVG`);
      assert.ok(svg.includes(`viewBox="${spec.viewBox}"`), `${artworkUrl} uses viewBox ${spec.viewBox}`);
      assert.doesNotMatch(svg, /<text\b|<image\b|<script\b|<foreignObject\b|href="(?:https?:)?\/\//i, `${artworkUrl} has no text, raster, script or external reference`);
    }
  }
});
