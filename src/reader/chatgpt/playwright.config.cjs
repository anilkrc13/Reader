const {defineConfig} = require('@playwright/test');
const base = require('../../../playwright.config.js');
module.exports = defineConfig({...base, fullyParallel: true, workers: 2, testDir: './tests/browser', outputDir: '../../../build/embedded-test-results'});
