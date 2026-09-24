import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API = process.env.API_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
      { find: /^@webclient\/ui$/, replacement: path.resolve(__dirname, "../../packages/ui/src/index.ts") },
      { find: /^@webclient\/ui\//, replacement: path.resolve(__dirname, "../../packages/ui/src") + "/" },
    ] },
  server: {
    port: 5173,
    // dev: same-origin calls to the API (the service also allows CORS for this origin)
    proxy: { "/api": { target: API, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  build: { outDir: "dist", sourcemap: true },
});
