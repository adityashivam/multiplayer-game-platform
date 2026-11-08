import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "/platform/dist/",
  plugins: [react()],
  build: {
    outDir: path.resolve(root, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      external: [
        "/platform/frontend-engine/shareModalBridge.js",
        "/platform/frontend-engine/endGameBridge.js",
        "/platform/frontend-engine/connectionBridge.js",
        "/platform/frontend-engine/roomLifecycleBridge.js",
      ],
    },
  },
  server: {
    port: 5173,
  },
});
