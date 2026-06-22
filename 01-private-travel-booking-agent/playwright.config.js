const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  testIgnore: "**/*.manual.spec.js",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8797",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: "npm run serve:api",
    url: "http://127.0.0.1:8797/health",
    reuseExistingServer: false,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      CI: process.env.CI,
      TRAVEL_AGENT_API_PORT: "8797",
      OPENAI_LLM_MODE: "mock"
    }
  }
});
