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
    { name: "desktop", testIgnore: /responsive-regression\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 1024 } } },
    { name: "tablet", testIgnore: /responsive-regression\.spec\.ts/, use: { ...devices["iPad Mini"], browserName: "chromium", viewport: { width: 1024, height: 768 }, isMobile: false } },
    { name: "mobile", testIgnore: /responsive-regression\.spec\.ts/, use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    {
      name: "responsive",
      testMatch: /responsive-regression\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1536, height: 864 },
        isMobile: false,
        reducedMotion: "reduce",
      },
    },
  ],
  webServer: {
    command: `STEF_BIND_HOST=127.0.0.1 PORT=${apiPort} VITE_PORT=${webPort} pnpm dev`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
