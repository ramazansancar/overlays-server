import { defineConfig } from '@playwright/test';

/**
 * Browser tests of the status page. Each spec starts its own fake camera + server (see e2e/), so no web server
 * is configured here. Locally the installed Chrome is used; CI installs Playwright's Chromium.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    locale: 'en-US',
    acceptDownloads: true,
  },
});
