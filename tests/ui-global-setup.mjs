import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const snapshotPath = path.join(rootDir, "data", "agencies", "058", "latest.json");
const backupPath = path.join(rootDir, "tmp", "ui-smoke-latest.json");

export default async function globalSetup() {
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(snapshotPath, backupPath);

  let apiReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://localhost:4174/api/health");
      if (response.ok) {
        apiReady = true;
        break;
      }
    } catch {
      // The Playwright web server and the API start together.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!apiReady) throw new Error("API STEF Match Center indisponible pour le smoke test UI.");

  const response = await fetch("http://localhost:4174/api/agencies/058/time-range", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": "STEF-058",
    },
    body: JSON.stringify({
      start: "13:00",
      end: "22:30",
      criteria: {
        zonageMinutes: 30,
        loadingSeconds: 165,
        unloadingSeconds: 60,
        scoreTargetPercent: 50,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Impossible de préparer le snapshot de référence UI (${response.status}).`);
  }
}
