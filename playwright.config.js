const {defineConfig} = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {timeout: 8_000},
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
});
