import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const deployDir = path.join(rootDir, ".deploy");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archivePath = path.join(deployDir, `stef-match-center-v1-${stamp}.tar.gz`);
const manifestPath = path.join(deployDir, `stef-match-center-v1-${stamp}.manifest.json`);

const checks = [
  { name: "build", args: ["run", "build"] },
  { name: "test", args: ["run", "test"] },
  { name: "test:deploy", args: ["run", "test:deploy"] },
];

await fs.mkdir(deployDir, { recursive: true });

for (const check of checks) {
  await runPackageManager(check.args);
}

await run("tar", [
  "-czf",
  archivePath,
  "--exclude=./node_modules",
  "--exclude=./dist",
  "--exclude=./.deploy",
  "--exclude=./data/agencies/*",
  "--exclude=./.git",
  "--exclude=./.env",
  "--exclude=./*.tsbuildinfo",
  "--exclude=./.DS_Store",
  "--exclude=./playwright-report",
  "--exclude=./test-results",
  ".",
]);

const archiveStat = await fs.stat(archivePath);
const manifest = {
  createdAt: new Date().toISOString(),
  archive: archivePath,
  archiveSizeBytes: archiveStat.size,
  sourceRoot: rootDir,
  requiredRuntime: {
    node: ">=22",
    packageManager: "pnpm",
    startCommand: "pnpm start",
    buildCommand: "pnpm build",
  },
  requiredEnvironment: {
    PORT: "assigned by host, default 4174",
    STEF_DATA_DIR: "storage path for imports and causeries; Render Free storage is ephemeral",
    STEF_UPLOAD_LIMIT_MB: "20",
    STEF_AGENCIES_JSON:
      '[{"code":"058","name":"Agence 058","accessCode":"CHANGE_ME_BEFORE_SHARING","canImport":true}]',
  },
  excludedByDesign: [
    "node_modules",
    "dist",
    "data/agencies/*",
    ".env",
    ".git",
    ".deploy",
  ],
  validatedChecks: checks.map((check) => check.name),
};

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

console.log(`Archive déploiement prête: ${archivePath}`);
console.log(`Manifeste: ${manifestPath}`);

async function runPackageManager(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    const isNodeScript = /\.(c|m)?js$/i.test(npmExecPath);
    await run(isNodeScript ? process.execPath : npmExecPath, isNodeScript ? [npmExecPath, ...args] : args);
    return;
  }
  await run("pnpm", args);
}

async function run(command, args) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Commande échouée (${code}) : ${[command, ...args].join(" ")}`));
    });
  });
}
