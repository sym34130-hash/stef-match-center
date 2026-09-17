import { defineConfig, devices } from "@playwright/test";

process.env.PLAYWRIGHT_API_PORT ??= "4187";
process.env.PLAYWRIGHT_WEB_PORT ??= "5187";
const apiPort = process.env.PLAYWRIGHT_API_PORT;
const webPort = process.env.PLAYWRIGHT_WEB_PORT;
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  globalSetup: "./tests/ui-global-setup.mjs",
  globalTeardown: "./tests/ui-global-teardown.mjs",
  // The API test harness persists one shared snapshot per agency.
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 1024 } } },
    { name: "tablet", use: { ...devices["iPad Mini"], browserName: "chromium", viewport: { width: 1024, height: 768 }, isMobile: false } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `STEF_BIND_HOST=127.0.0.1 PORT=${apiPort} VITE_PORT=${webPort} pnpm dev`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
