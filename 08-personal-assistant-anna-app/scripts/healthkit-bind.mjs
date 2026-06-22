import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const openXcode = process.argv.includes("--open-xcode") || process.env.ANNA_OPEN_XCODE === "1";
const projectPath = path.join(root, "ios-companion", "AnnaHealthCompanion.xcodeproj");

console.log("Anna HealthKit binding workflow");
console.log("");

const doctor = runNodeScript("healthkit-doctor.mjs");
console.log("Binding readiness");
console.log(doctor.stdout.trim());
if (doctor.stderr.trim()) {
  console.error(doctor.stderr.trim());
}
console.log("");

const pairing = runNodeScript("healthkit-pairing.mjs");
console.log("Bridge pairing");
console.log(pairing.stdout.trim());
if (pairing.stderr.trim()) {
  console.error(pairing.stderr.trim());
}
console.log("");

const blockers = doctor.stdout
  .split("\n")
  .filter((line) =>
    /^· (xcode app|xcode|ios toolchain|codesigning identity):/.test(line) ||
    /^✗ /.test(line)
  );

if (blockers.length > 0) {
  console.log("Binding status: blocked before iPhone install");
  console.log("Resolve these items, then rerun npm run healthkit:bind:");
  for (const blocker of blockers) {
    console.log(`- ${blocker.replace(/^· |^✗ /, "")}`);
  }
  console.log("");
  console.log("After installing full Xcode, select it with:");
  console.log("sudo xcode-select -s /Applications/Xcode.app/Contents/Developer");
  console.log("");
  console.log("Then open the companion project, choose your Apple Development team, run it on your iPhone, approve HealthKit, and start foreground live sync.");
  process.exit(0);
}

console.log("Binding status: ready for iPhone install");
console.log(`Companion project: ${projectPath}`);
console.log("Next iPhone steps:");
console.log("1. Open the Xcode project.");
console.log("2. Select the AnnaHealthCompanion target and your Apple Development team.");
console.log("3. Run on your iPhone.");
console.log("4. Approve the HealthKit system prompt.");
console.log("5. Enter the Bridge URL and token shown above.");
console.log("6. Tap \"开始前台实时同步\" while testing.");

if (openXcode) {
  const opened = spawnSync("open", [projectPath], { encoding: "utf8" });
  if (opened.status === 0) {
    console.log("");
    console.log("Opened the Xcode project.");
  } else {
    console.log("");
    console.log("Could not open the Xcode project automatically. Open it manually from the path above.");
  }
}

function runNodeScript(name) {
  const script = path.join(root, "scripts", name);
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: process.env,
    encoding: "utf8"
  });
}
