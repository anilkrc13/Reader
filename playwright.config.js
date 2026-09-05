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
    // Locally the installed Chrome is the realistic target. CI sets
    // READER_PLAYWRIGHT_CHANNEL=chromium to use Playwright's own pinned build,
    // so a runner's Chrome auto-update cannot change what the suite tests.
    channel: process.env.READER_PLAYWRIGHT_CHANNEL === "chromium" ? undefined : "chrome",
    headless: true,
  },
});
