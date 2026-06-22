#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generate } from "./generator.js";

const [command, ...values] = process.argv.slice(2);
const args = parse(values);
if (!["generate", "check"].includes(command) || !args.manifest || !args.out) {
  console.error("Usage: anna-privacy-labels <generate|check> --manifest FILE --out DIR");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifest), "utf8"));
const output = path.resolve(args.out);
if (command === "generate") {
  const files = generate(manifest, output);
  console.log(`Generated ${Object.keys(files).length} privacy artifacts.`);
} else {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-label-check-"));
  const expected = generate(manifest, temp);
  const differences = Object.keys(expected).filter((name) => {
    const actual = path.join(output, name);
    return !fs.existsSync(actual) ||
      fs.readFileSync(actual, "utf8") !== fs.readFileSync(path.join(temp, name), "utf8");
  });
  fs.rmSync(temp, { recursive: true, force: true });
  if (differences.length) {
    console.error(`Privacy artifacts are stale: ${differences.join(", ")}`);
    process.exit(1);
  }
  console.log("Privacy artifacts are current.");
}

function parse(args) {
  const output = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--manifest") output.manifest = args[++index];
    else if (args[index] === "--out") output.out = args[++index];
  }
  return output;
}
