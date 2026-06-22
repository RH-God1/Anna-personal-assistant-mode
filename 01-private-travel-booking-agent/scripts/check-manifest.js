const fs = require("fs");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

const requiredFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => [
    ...(entry.js || []),
    ...(entry.css || [])
  ])
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));
const unsafeMatches = [
  ...(manifest.host_permissions || []),
  ...manifest.content_scripts.flatMap((entry) => entry.matches || [])
].filter((pattern) => pattern === "<all_urls>");

if (missing.length > 0) {
  console.error(`Missing extension files: ${missing.join(", ")}`);
  process.exit(1);
}

if (unsafeMatches.length > 0) {
  console.error("Manifest must use an explicit travel-site allowlist instead of <all_urls>.");
  process.exit(1);
}

console.log("Manifest OK");
