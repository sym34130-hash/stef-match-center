import { defineConfig, devices } from "@playwright/test";

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
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 1024 } } },
    { name: "tablet", use: { ...devices["iPad Mini"], browserName: "chromium", viewport: { width: 1024, height: 768 }, isMobile: false } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
