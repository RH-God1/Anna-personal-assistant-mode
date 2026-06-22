import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checks = [];
const options = parseArgs(process.argv.slice(2));

await checkFile(
  "xcode project",
  path.join(root, "ios-companion", "AnnaHealthCompanion.xcodeproj", "project.pbxproj")
);
await checkFile(
  "shared scheme",
  path.join(root, "ios-companion", "AnnaHealthCompanion.xcodeproj", "xcshareddata", "xcschemes", "AnnaHealthCompanion.xcscheme")
);
await checkContains(
  "healthkit entitlement",
  path.join(root, "ios-companion", "AnnaHealthCompanion", "AnnaHealthCompanion.entitlements"),
  "com.apple.developer.healthkit"
);
await checkContains(
  "local network usage description",
  path.join(root, "ios-companion", "AnnaHealthCompanion", "Info.plist"),
  "NSLocalNetworkUsageDescription"
);
await checkContains(
  "local networking ATS exception",
  path.join(root, "ios-companion", "AnnaHealthCompanion", "Info.plist"),
  "NSAllowsLocalNetworking"
);

checkLanAddress();
await checkXcodeCandidates();
checkXcode();
checkIosToolchain();
checkSigningIdentity();

const failedRequired = checks.filter((item) => item.required && item.status !== "ok");
for (const item of checks) {
  const mark = item.status === "ok" ? "✓" : item.required ? "✗" : "·";
  console.log(`${mark} ${item.name}: ${item.message}`);
}

if (options.format === "markdown") {
  const rendered = renderMarkdown(checks);
  if (options.out) {
    const outPath = path.resolve(root, options.out);
    await writeFile(outPath, `${rendered}\n`);
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(rendered);
  }
}

if (failedRequired.length > 0) {
  process.exitCode = 1;
}

function parseArgs(args) {
  const parsed = { format: "text", out: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      parsed.format = args[index + 1] || parsed.format;
      index += 1;
    } else if (arg === "--out") {
      parsed.out = args[index + 1] || "";
      index += 1;
    }
  }
  if (!["text", "markdown"].includes(parsed.format)) {
    throw new Error(`Unsupported format: ${parsed.format}`);
  }
  return parsed;
}

function renderMarkdown(items) {
  const requiredFailures = items.filter((item) => item.required && item.status !== "ok");
  const warnings = items.filter((item) => item.status === "warn");
  const readiness = requiredFailures.length === 0
    ? "Anna 侧 HealthKit Companion 文件、权限声明与本地桥接预检已通过。"
    : "Anna 侧 HealthKit Companion 仍有必需文件或权限声明缺失。";
  const blockers = warnings.length === 0
    ? "未发现本机 iPhone 安装准备项告警。"
    : warnings.map((item) => `- ${item.name}：${item.message}`).join("\n");

  return [
    "# Anna HealthKit Doctor 报告",
    "",
    `生成时间：${formatShanghaiTime(new Date())}（Asia/Shanghai）`,
    `UTC：${new Date().toISOString()}`,
    "",
    "## 结论",
    "",
    `- ${readiness}`,
    "- 本报告只检查 Companion 工程、权限、LAN 与本机 iOS 构建条件，不读取真实 HealthKit 数据。",
    "- 真实 iPhone/Apple Watch 数据读取仍必须由用户在 iOS HealthKit 系统弹窗中授权。",
    "",
    "## 当前本机限制",
    "",
    blockers,
    "",
    "## 检查明细",
    "",
    "| 项目 | 状态 | 必需 | 结果 |",
    "| --- | --- | --- | --- |",
    ...items.map((item) =>
      `| ${escapeCell(item.name)} | ${item.status} | ${item.required ? "yes" : "no"} | ${escapeCell(item.message)} |`
    )
  ].join("\n");
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function checkFile(name, file) {
  try {
    await access(file, constants.R_OK);
    ok(name, path.relative(root, file));
  } catch {
    fail(name, `missing ${path.relative(root, file)}`);
  }
}

async function checkContains(name, file, pattern) {
  try {
    const text = await readFile(file, "utf8");
    if (text.includes(pattern)) ok(name, pattern);
    else fail(name, `missing ${pattern}`);
  } catch {
    fail(name, `cannot read ${path.relative(root, file)}`);
  }
}

function checkLanAddress() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        addresses.push(`${entry.address} (${name})`);
      }
    }
  }
  if (addresses.length === 0) {
    warn("lan address", "no LAN IPv4 address detected; connect Mac and iPhone to the same network");
  } else {
    ok("lan address", addresses.join(", "));
  }
}

async function checkXcodeCandidates() {
  const candidates = [
    "/Applications/Xcode.app",
    "/Applications/Xcode-beta.app"
  ];
  const found = [];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      found.push(candidate);
    } catch {
      // Missing candidates are summarized below.
    }
  }
  if (found.length === 0) {
    warn("xcode app", "no /Applications/Xcode.app or /Applications/Xcode-beta.app found");
  } else {
    ok("xcode app", found.join(", "));
  }
}

function checkXcode() {
  const selected = spawnSync("xcode-select", ["-p"], { encoding: "utf8" });
  const selectedPath = selected.stdout.trim();
  if (selected.status !== 0) {
    warn("xcode-select", "xcode-select is unavailable");
    return;
  }
  if (selectedPath.endsWith("/CommandLineTools")) {
    warn("xcode", `${selectedPath}; full Xcode is required for iPhone install`);
    return;
  }
  const version = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
  if (version.status === 0) {
    ok("xcode", version.stdout.trim().replace(/\n/g, " · "));
  } else {
    warn("xcode", "xcodebuild is unavailable; full Xcode is required for iPhone install");
  }
}

function checkIosToolchain() {
  const result = spawnSync("xcrun", ["simctl", "list", "devices", "available"], {
    encoding: "utf8"
  });
  if (result.status === 0) {
    ok("ios toolchain", "xcrun simctl is available");
  } else {
    warn("ios toolchain", "xcrun simctl unavailable; full Xcode is required for iPhone build/install");
  }
}

function checkSigningIdentity() {
  const result = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    warn("codesigning identity", "unable to inspect keychain signing identities");
    return;
  }
  const match = output.match(/(\d+)\s+valid identities found/);
  const count = match ? Number(match[1]) : 0;
  if (count > 0) {
    ok("codesigning identity", `${count} valid identities found`);
  } else {
    warn("codesigning identity", "0 valid identities found; iPhone install needs an Apple Development signing identity");
  }
}

function ok(name, message) {
  checks.push({ name, message, status: "ok", required: true });
}

function fail(name, message) {
  checks.push({ name, message, status: "fail", required: true });
}

function warn(name, message) {
  checks.push({ name, message, status: "warn", required: false });
}

function formatShanghaiTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
