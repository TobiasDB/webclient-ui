// The product website: static-first (every marketing page is prerendered), with the
// dynamic fixture routes (login, /status/{code}, /slow, the cursor API, redirects, gzip)
// served on demand by the node adapter -- one artefact for the tests, the demos and prod.
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "http://localhost:4321",
  // the Host header the dynamic routes trust (robots.txt / sitemap.xml render absolute URLs from
  // it): localhost + 127.0.0.1 for the tests and the demos, SITE_HOSTS (comma list) in prod
  security: { allowedDomains: [
    { hostname: "localhost" }, { hostname: "127.0.0.1" },
    ...(process.env.SITE_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean).map((hostname) => ({ hostname })),
  ] },
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: /^@webclient\/ui$/, replacement: path.resolve(here, "../../packages/ui/src/index.ts") },
        { find: /^@webclient\/ui\//, replacement: path.resolve(here, "../../packages/ui/src") + "/" },
      ],
    },
  },
});
