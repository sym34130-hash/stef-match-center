import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const snapshotPath = path.join(rootDir, "data", "agencies", "058", "latest.json");
const backupPath = path.join(rootDir, "tmp", "ui-smoke-latest.json");

export default async function globalTeardown() {
  try {
    await fs.copyFile(backupPath, snapshotPath);
  } finally {
    await fs.rm(backupPath, { force: true });
  }
}
