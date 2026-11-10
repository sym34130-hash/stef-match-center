import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Independent, disposable agencies. Never touches data/agencies/058, local dev
// snapshots, Render production, or confidential HM/106J reference files.
const dataDir = path.join(os.tmpdir(), `stef-p1-synthetic-${process.pid}`);
const agencies = ["058", "059", "060"].map(code => ({
  code, name: `Agence synthétique ${code}`, accessCode: `CI-ONLY-${code}`, canImport: true,
}));
export default defineConfig({
  testDir: "./tests/ci-synthetic",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"], ["html", { outputFolder: "artifacts/p1-playwright-report", open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5287", trace: "retain-on-failure",
    screenshot: "only-on-failure", video: "retain-on-failure", acceptDownloads: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 864 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5287",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "4287", VITE_PORT: "5287", STEF_BIND_HOST: "127.0.0.1",
      STEF_DATA_DIR: dataDir, NODE_ENV: "test",
      STEF_AGENCIES_JSON: JSON.stringify(agencies),
    },
  },
});
