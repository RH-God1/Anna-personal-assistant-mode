import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadLocalEnv({ filename = ".env" } = {}) {
  const candidates = [
    path.resolve(process.cwd(), filename),
    path.join(appRoot, filename)
  ];
  for (const file of [...new Set(candidates)]) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      loadEnvFile(file);
    }
  }
}

function loadEnvFile(file) {
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const hashIndex = trimmed.search(/\s#/);
  return hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex).trim();
}
