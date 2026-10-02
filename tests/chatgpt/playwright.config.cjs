const {defineConfig} = require('@playwright/test');
const base = require('../playwright.config.js');
module.exports = defineConfig({...base, timeout: 60_000, fullyParallel: true, workers: 2, testDir: './browser', outputDir: '../../build/embedded-test-results'});
