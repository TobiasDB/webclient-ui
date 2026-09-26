/** END-TO-END: the Run workspace against RECORDED runs (e2e/traces: the package's own traces, committed -- every
 * page snapshot and browser recording is in them, so nothing is fetched live). Its own API (:8010, serving those
 * traces) and dev server (:5180), started here -- never the ones you work with. `make e2e`. */
import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEBCLIENT = process.env.WEBCLIENT ?? path.resolve(__dirname, "../../../webclient");
const API_PORT = 8010, UI_PORT = 5180;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${UI_PORT}`, viewport: { width: 1600, height: 1000 }, trace: "retain-on-failure" },
  webServer: [
    {
      command: `${path.join(WEBCLIENT, "env/bin/python")} -m webclient.service`,
      cwd: WEBCLIENT,
      env: { WEBCLIENT_SERVICE_PORT: String(API_PORT), WEBCLIENT_TRACES_DIR: path.resolve(__dirname, "e2e/traces") },
      url: `http://localhost:${API_PORT}/ops`, reuseExistingServer: false, timeout: 90_000,
    },
    {
      command: `npx vite --port ${UI_PORT} --strictPort`,
      cwd: __dirname,
      env: { API_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${UI_PORT}`, reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
