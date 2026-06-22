import { defineConfig } from "../01-private-travel-booking-agent/node_modules/@playwright/test/index.mjs";

const port = Number(process.env.ANNA_HOST_TEST_PORT || 8811);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 }
  },
  webServer: {
    command: `PORT=${port} node src/server.js`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [{
    name: "chromium",
    use: { browserName: "chromium" }
  }]
});
