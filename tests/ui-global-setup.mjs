import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const apiBaseUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "4187"}`;
const snapshotPath = path.join(rootDir, "data", "agencies", "058", "latest.json");
const backupPath = path.join(rootDir, "tmp", "ui-smoke-latest.json");
const leagueConfigPath = path.join(rootDir, "data", "agencies", "058", "league-configs.json");
const leagueConfigBackupPath = path.join(rootDir, "tmp", "ui-smoke-league-configs.json");
const defaultLeagueConfigs = [
  { id: "bronze", zonageMinutes: 45, loadingSeconds: 195, unloadingSeconds: 75, scoreTargetPercent: 45 },
  { id: "argent", zonageMinutes: 30, loadingSeconds: 165, unloadingSeconds: 60, scoreTargetPercent: 50 },
  { id: "or", zonageMinutes: 25, loadingSeconds: 150, unloadingSeconds: 55, scoreTargetPercent: 60 },
  { id: "platine", zonageMinutes: 20, loadingSeconds: 135, unloadingSeconds: 50, scoreTargetPercent: 70 },
];

export default async function globalSetup() {
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(snapshotPath, backupPath);
  await fs.copyFile(leagueConfigPath, leagueConfigBackupPath);
  await fs.writeFile(leagueConfigPath, JSON.stringify(defaultLeagueConfigs, null, 2), "utf8");

  let apiReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/health`);
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

  const leagueResponse = await fetch(`${apiBaseUrl}/api/agencies/058/league-configs`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": "LOCAL-058-DEV",
    },
    body: JSON.stringify({ configs: defaultLeagueConfigs }),
  });
  if (!leagueResponse.ok) {
    throw new Error(`Impossible de préparer les règles de ligue UI (${leagueResponse.status}).`);
  }

  const response = await fetch(`${apiBaseUrl}/api/agencies/058/time-range`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": "LOCAL-058-DEV",
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
