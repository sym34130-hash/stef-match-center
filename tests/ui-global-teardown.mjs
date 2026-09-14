import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const snapshotPath = path.join(rootDir, "data", "agencies", "058", "latest.json");
const backupPath = path.join(rootDir, "tmp", "ui-smoke-latest.json");
const leagueConfigPath = path.join(rootDir, "data", "agencies", "058", "league-configs.json");
const leagueConfigBackupPath = path.join(rootDir, "tmp", "ui-smoke-league-configs.json");

export default async function globalTeardown() {
  try {
    await fs.copyFile(backupPath, snapshotPath);
    await fs.copyFile(leagueConfigBackupPath, leagueConfigPath);
  } finally {
    await fs.rm(backupPath, { force: true });
    await fs.rm(leagueConfigBackupPath, { force: true });
  }
}
