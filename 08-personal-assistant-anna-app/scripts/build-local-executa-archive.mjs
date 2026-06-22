import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const executaRoot = path.join(appRoot, "executas", "personal-assistant-node");
const executa = JSON.parse(await fs.readFile(path.join(executaRoot, "executa.json"), "utf8"));
const toolId = executa.tool_id;
const version = executa.version;
const platform = process.env.ANNA_EXECUTA_PLATFORM || currentPlatformKey();
const distDir = process.env.ANNA_EXECUTA_ARCHIVE_DIR
  || path.join(appRoot, "dist-anna");
const stageDir = path.join(distDir, "archive-stage");
const archiveName = `${toolId}-${platform}.tar.gz`;
const archivePath = path.join(distDir, archiveName);
const bundleArchiveDir = process.env.ANNA_EXECUTA_BUNDLE_DIR
  || path.join(appRoot, "bundle", "executa");
const bundleArchivePath = path.join(bundleArchiveDir, archiveName);
const pluginManifest = JSON.parse(execFileSync(process.execPath, [
  path.join(executaRoot, "personal_assistant_plugin.cjs"),
  "describe"
], {
  cwd: executaRoot,
  encoding: "utf8"
}));

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(path.join(stageDir, "bin"), { recursive: true });
await copyFile("personal_assistant_plugin.cjs");
await copyFile("package.json");
await copyDir(path.join(executaRoot, "lib"), path.join(stageDir, "lib"));

const entrypoint = `bin/${toolId}`;
await fs.writeFile(path.join(stageDir, "manifest.json"), `${JSON.stringify({
  ...pluginManifest,
  name: pluginManifest.name || toolId,
  id: pluginManifest.id || toolId,
  tool_id: pluginManifest.tool_id || toolId,
  version,
  runtime: {
    ...(pluginManifest.runtime || {}),
    binary: {
      entrypoint: { default: entrypoint },
      permissions: { [entrypoint]: "0o755" }
    }
  }
}, null, 2)}\n`);

await fs.writeFile(path.join(stageDir, entrypoint), [
  "#!/bin/sh",
  "PRG=$0",
  "while [ -L \"$PRG\" ]; do",
  "  DIR=$(CDPATH= cd -- \"$(dirname -- \"$PRG\")\" && pwd)",
  "  LINK=$(readlink \"$PRG\")",
  "  case $LINK in",
  "    /*) PRG=$LINK ;;",
  "    *) PRG=$DIR/$LINK ;;",
  "  esac",
  "done",
  "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$PRG\")\" && pwd)",
  "EXECUTA_HOME=${EXECUTA_HOME:-$(CDPATH= cd -- \"$SCRIPT_DIR/..\" && pwd)}",
  "cd \"$EXECUTA_HOME\" || exit 1",
  `exec env ANNA_EXECUTA_TOOL_ID="${toolId}" node personal_assistant_plugin.cjs "$@"`,
  ""
].join("\n"));
await fs.chmod(path.join(stageDir, entrypoint), 0o755);

await fs.mkdir(distDir, { recursive: true });
await fs.rm(archivePath, { force: true });
execFileSync("tar", ["-czf", archivePath, "-C", stageDir, "."], { stdio: "inherit" });
const stat = await fs.stat(archivePath);
const sha256 = await sha256File(archivePath);

if (process.env.ANNA_EXECUTA_COPY_TO_BUNDLE !== "0") {
  await fs.mkdir(bundleArchiveDir, { recursive: true });
  await fs.copyFile(archivePath, bundleArchivePath);
}

console.log(JSON.stringify({
  archivePath,
  bundleArchivePath,
  archiveName,
  toolId,
  version,
  platform,
  size: stat.size,
  sha256,
  entrypoint,
  format: "tar.gz"
}, null, 2));

async function copyFile(relativePath) {
  await fs.copyFile(path.join(executaRoot, relativePath), path.join(stageDir, relativePath));
}

async function copyDir(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
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

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}
