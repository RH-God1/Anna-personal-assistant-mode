import fs from "node:fs";
import path from "node:path";
import { createRuntimeLabels, renderMarkdown, validateManifest } from "./core.js";

export function generate(manifest, outputDir) {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Privacy manifest invalid:\n${errors.join("\n")}`);
  const files = {
    "privacy-runtime.json": `${JSON.stringify(createRuntimeLabels(manifest), null, 2)}\n`,
    "privacy-report.md": `${renderMarkdown(manifest).trim()}\n`
  };
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, name), content);
  }
  return files;
}
