import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projects = [
  ["01-private-travel-booking-agent", ["check", "test:api", "test:browser"]],
  ["03-i18n-qa-harness", ["check", "test"]],
  ["04-travel-agent-anna-app", ["check", "test", "validate:anna"]],
  ["05-executa-to-mcp-bridge", ["check", "test"]],
  ["06-shared-contract-generator", ["generate", "check", "test"]],
  ["07-privacy-capability-labels", ["generate", "check", "test"]],
  ["08-personal-assistant-anna-app", ["check", "test", "validate:anna"]],
  ["09-multi-model-project-workspace", ["check", "test", "experiment"]],
  ["10-anna-local-host-lab", ["check", "test", "test:browser"]]
];

for (const [project, scripts] of projects) {
  for (const script of scripts) {
    console.log(`\n==> ${project}: npm run ${script}`);
    const result = spawnSync("npm", ["run", script], {
      cwd: path.join(root, project),
      stdio: "inherit",
      env: process.env
    });
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

console.log(`\n==> root: npm run smoke:anna`);
{
  const result = spawnSync("npm", ["run", "smoke:anna"], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log("\nAll Anna projects verified.");
