import { spawnSync } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cliPackage = "@anna-ai/cli@0.1.30";
const checks = [];

checkNodeVersion();
checkPackageEngine();
checkCommand("npm", ["--version"], "npm");
checkCommand("uv", ["--version"], "uv");
await checkAnnaCli();

for (const item of checks) {
  const mark = item.ok ? "✓" : "✗";
  console.log(`${mark} ${item.name}: ${item.message}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  process.exitCode = 1;
} else {
  console.log("Anna beginner guide environment checks passed.");
}

function checkNodeVersion() {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  if (major >= 22) {
    pass("node", `v${version}`);
  } else {
    fail("node", `v${version}; Anna beginner guide requires Node.js 22+`);
  }
}

function checkPackageEngine() {
  const engine = packageJson.engines?.node || "";
  if (/>=\s*22/.test(engine)) {
    pass("package engines.node", engine);
  } else {
    fail("package engines.node", `${engine || "missing"}; should declare >=22 for Anna CLI development`);
  }
}

function checkCommand(command, args, name) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    pass(name, firstLine(result.stdout));
    return result;
  }
  fail(name, firstLine(result.stderr) || `${command} is unavailable`);
  return result;
}

async function checkAnnaCli() {
  const globalCli = spawnSync("anna-app", ["--version"], { encoding: "utf8" });
  if (globalCli.status === 0) {
    pass("anna-app cli", `global ${firstLine(globalCli.stdout)}`);
    checkAnnaDoctor(["anna-app", "doctor"], "global anna-app doctor");
    return;
  }

  const cachedCli = await findCachedAnnaCli();
  if (cachedCli) {
    const cachedVersion = spawnSync(process.execPath, [cachedCli, "--version"], { encoding: "utf8" });
    if (cachedVersion.status === 0) {
      pass("anna-app cli", `cached ${cliPackage} ${firstLine(cachedVersion.stdout)}`);
      checkAnnaDoctor([process.execPath, cachedCli, "doctor"], "cached anna-app doctor");
      return;
    }
  }

  const npxCli = spawnSync("npx", ["--yes", cliPackage, "--version"], {
    encoding: "utf8",
    timeout: 15000
  });
  if (npxCli.status !== 0) {
    fail(
      "anna-app cli",
      `${cliPackage} unavailable through npx; install globally or allow npm registry access`
    );
    return;
  }
  pass("anna-app cli", `npx ${cliPackage} ${firstLine(npxCli.stdout)}`);
  checkAnnaDoctor(["npx", "--yes", cliPackage, "doctor"], "npx anna-app doctor");
}

async function findCachedAnnaCli() {
  const cacheRoot = path.join(os.homedir(), ".npm", "_npx");
  let entries = [];
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = path.join(cacheRoot, entry.name, "node_modules", "@anna-ai", "cli", "package.json");
    const cliPath = path.join(cacheRoot, entry.name, "node_modules", "@anna-ai", "cli", "dist", "cli.js");
    try {
      const packageData = JSON.parse(await readFile(packagePath, "utf8"));
      await access(cliPath);
      if (packageData.version === "0.1.30") {
        return cliPath;
      }
    } catch {
      // Ignore unrelated npx cache entries.
    }
  }
  return null;
}

function checkAnnaDoctor(command, name) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 15000 });
  if (result.status === 0 && /all required checks passed/.test(result.stdout)) {
    pass(name, "all required checks passed");
  } else {
    fail(name, firstLine(result.stderr) || firstLine(result.stdout) || "doctor did not pass");
  }
}

function firstLine(value) {
  return String(value || "").trim().split("\n")[0] || "";
}

function pass(name, message) {
  checks.push({ name, message, ok: true });
}

function fail(name, message) {
  checks.push({ name, message, ok: false });
}
