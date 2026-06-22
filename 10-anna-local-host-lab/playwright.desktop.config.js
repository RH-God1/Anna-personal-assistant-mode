import { defineConfig } from "../01-private-travel-booking-agent/node_modules/@playwright/test/index.mjs";

export default defineConfig({
  testDir: "./tests/desktop",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line"
});
