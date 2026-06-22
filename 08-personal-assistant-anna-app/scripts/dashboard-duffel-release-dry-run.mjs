import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(appRoot, "..");
const executaRoot = path.join(appRoot, "executas", "personal-assistant-node");
const appJson = JSON.parse(fs.readFileSync(path.join(appRoot, "app.json"), "utf8"));
const version = appJson.version;

const commands = [
  {
    label: "Anna app static and guide checks",
    cwd: appRoot,
    command: "npm",
    args: ["run", "check"]
  },
  {
    label: "Anna app tests",
    cwd: appRoot,
    command: "npm",
    args: ["test"]
  },
  {
    label: "Anna strict validation",
    cwd: appRoot,
    command: "npm",
    args: ["run", "validate:anna"]
  },
  {
    label: "Duffel booking UI smoke",
    cwd: appRoot,
    command: "npm",
    args: ["run", "smoke:ui"]
  },
  {
    label: "Learning memory smoke",
    cwd: appRoot,
    command: "npm",
    args: ["run", "smoke:learning"]
  },
  {
    label: "Remote app status (read-only)",
    cwd: appRoot,
    command: "npx",
    args: ["--yes", "@anna-ai/cli@0.1.30", "apps", "status", "personal-assistant-mode"]
  },
  {
    label: "Remote app grants (read-only)",
    cwd: appRoot,
    command: "npx",
    args: ["--yes", "@anna-ai/cli@0.1.30", "apps", "grants", "personal-assistant-mode"]
  },
  {
    label: "Bundled Executa publish dry-run",
    cwd: executaRoot,
    command: "npx",
    args: ["--yes", "@anna-ai/cli@0.1.30", "executa", "publish", "--dry-run"]
  },
  {
    label: "App push dry-run",
    cwd: appRoot,
    command: "npx",
    args: ["--yes", "@anna-ai/cli@0.1.30", "apps", "push", "--dry-run"]
  },
  {
    label: `App cut ${version} dry-run`,
    cwd: appRoot,
    command: "npx",
    args: ["--yes", "@anna-ai/cli@0.1.30", "apps", "cut", version, "--dry-run"]
  }
];

for (const item of commands) {
  console.log(`\n==> ${item.label}`);
  console.log(`$ ${[item.command, ...item.args].join(" ")}`);
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    console.error(`\nFailed: ${item.label}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nDuffel Dashboard release dry-run passed for personal-assistant-mode ${version}.`);
console.log("No remote write was performed. Real push/cut still requires explicit user confirmation.");
