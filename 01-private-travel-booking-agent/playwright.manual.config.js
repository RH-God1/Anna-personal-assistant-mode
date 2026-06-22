const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.manual.spec.js",
  fullyParallel: false,
  reporter: "list",
  timeout: 0,
  use: {
    headless: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      slowMo: 150
    }
  },
  projects: [
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"]
      }
    }
  ]
});
