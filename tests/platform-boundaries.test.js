import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const platformDirectories = [
  "public/platform/frontend-engine",
  "public/platform/shared",
  "server/platform-backend-engine/core",
];

async function listJavaScriptModules(directoryPath) {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const moduleGroups = await Promise.all(directoryEntries.map((directoryEntry) => {
    const entryPath = path.join(directoryPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) return listJavaScriptModules(entryPath);
    return directoryEntry.name.endsWith(".js") ? [entryPath] : [];
  }));
  return moduleGroups.flat();
}

test("all reusable engine modules bundle independently of concrete game packages", async () => {
  const moduleGroups = await Promise.all(platformDirectories.map((directoryPath) =>
    listJavaScriptModules(path.join(repositoryRoot, directoryPath))));
  const bundleResult = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: moduleGroups.flat(),
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    write: false,
    outdir: "unused-platform-boundary-build",
    metafile: true,
    logLevel: "silent",
    plugins: [{
      name: "platform-browser-module-paths",
      setup(bundleContext) {
        bundleContext.onResolve({ filter: /^\/platform\// }, (moduleRequest) => ({
          path: path.join(repositoryRoot, "public", moduleRequest.path),
        }));
      },
    }],
  });

  const concreteGameDirectories = ["public/games/", "server/platform-backend-engine/games/"];
  const importedGameModules = Object.keys(bundleResult.metafile.inputs)
    .filter((modulePath) => concreteGameDirectories.some((gameDirectory) => modulePath.startsWith(gameDirectory)));

  assert.deepEqual(importedGameModules, [], "game packages may depend on the SDK; engine modules must not depend on game packages");
});
