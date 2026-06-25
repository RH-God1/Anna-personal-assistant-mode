import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import dns from "node:dns/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
const executaDir = path.join(root, "executas/personal-assistant-node");
const annaCli = process.env.ANNA_APP_CLI || findCachedAnnaCli() || "npx";
const annaCliPrefix = annaCli === "npx" ? ["--yes", "@anna-ai/cli@0.1.30"] : [];

await assertNetworkReady();
assertReleaseVersions();

run("npm", ["run", "check"], root);
run("npm", ["test"], root);
run("npm", ["run", "build:executa-binary"], root);
assertArchiveMetadata();
runAnna(["validate", "--strict"], root);

runAnna(["executa", "publish", "--publish"], executaDir);
runAnna(["apps", "publish"], root);
runAnna(["apps", "cut", app.version, "--changelog", releaseChangelog()], root);
runAnna(["apps", "release", app.version, "--allow-create"], root);
runAnna(["apps", "status", app.slug], root);

function assertReleaseVersions() {
  const executa = readExecuta();
  if (!/^0\.1\.\d+$/.test(app.version)) {
    throw new Error(`Unexpected app version: ${app.version}`);
  }
  if (!/^0\.1\.\d+$/.test(executa.version)) {
    throw new Error(`Unexpected executa version: ${executa.version}`);
  }
  const binaryUrl = executa.distribution?.profiles?.binary?.binary_urls?.["darwin-arm64"]?.url || "";
  if (!binaryUrl.includes(`/${app.slug}/${app.version}/executa/`)) {
    throw new Error(`Executa binary URL does not point at app version ${app.version}: ${binaryUrl}`);
  }
}

function assertArchiveMetadata() {
  const executa = readExecuta();
  const platform = process.env.ANNA_EXECUTA_PLATFORM || currentPlatformKey();
  const binaryUrl = executa.distribution?.profiles?.binary?.binary_urls?.[platform];
  if (!binaryUrl) {
    throw new Error(`Missing binary_urls metadata for ${platform}`);
  }
  const archiveName = executa.distribution?.profiles?.binary?.package_name;
  const archivePath = path.join(root, "bundle", "executa", archiveName || "");
  if (!archiveName || !existsSync(archivePath)) {
    throw new Error(`Missing bundle archive: ${archivePath}`);
  }
  const actualSize = statSync(archivePath).size;
  const actualSha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (binaryUrl.size !== actualSize || binaryUrl.sha256 !== actualSha256) {
    throw new Error(`Executa archive metadata mismatch: expected ${binaryUrl.sha256}/${binaryUrl.size}, got ${actualSha256}/${actualSize}`);
  }
}

async function assertNetworkReady() {
  try {
    await dns.lookup("anna.partners");
  } catch (error) {
    throw new Error(`Cannot resolve anna.partners; release would fail before upload: ${error.message}`);
  }
}

function releaseChangelog() {
  return [
    "Fix booking handoff so candidate selection opens the fillable confirmation page.",
    "Create user-confirmed sandbox/test provider order records before checkout handoff.",
    "Expose checkout opening and user-reported payment status actions.",
    "Mount FastAPI booking proxy routes for prepare, confirmation, confirm, open-checkout, and report-payment."
  ].join(" ");
}

function runAnna(args, cwd) {
  run(annaCli, [...annaCliPrefix, ...args], cwd);
}

function readExecuta() {
  return JSON.parse(readFileSync(path.join(executaDir, "executa.json"), "utf8"));
}

function currentPlatformKey() {
  const osName = os.platform();
  const arch = os.arch();
  if (osName === "darwin" && arch === "arm64") return "darwin-arm64";
  if (osName === "darwin" && arch === "x64") return "darwin-x86_64";
  if (osName === "linux" && arch === "x64") return "linux-x86_64";
  if (osName === "linux" && arch === "arm64") return "linux-arm64";
  throw new Error(`unsupported platform for Anna Executa binary archive: ${osName}-${arch}`);
}

function findCachedAnnaCli() {
  const cacheRoot = path.join(os.homedir(), ".npm", "_npx");
  if (!existsSync(cacheRoot)) return "";
  const result = spawnSync("find", [
    cacheRoot,
    "-path",
    "*/node_modules/@anna-ai/cli/dist/cli.js",
    "-print",
    "-quit"
  ], {
    encoding: "utf8"
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
