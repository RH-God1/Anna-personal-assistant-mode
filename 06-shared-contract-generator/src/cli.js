#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateContract } from "./generator.js";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (!["generate", "check"].includes(command) || !args.schema || !args.out) {
  console.error("Usage: anna-contract <generate|check> --schema FILE --out DIR");
  process.exit(2);
}

const schemaPath = path.resolve(args.schema);
const outputPath = path.resolve(args.out);
const contract = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

if (command === "generate") {
  const files = generateContract(contract, outputPath);
  console.log(`Generated ${Object.keys(files).length} files in ${outputPath}`);
} else {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-contract-check-"));
  generateContract(contract, temp);
  const differences = compareDirectories(temp, outputPath);
  fs.rmSync(temp, { recursive: true, force: true });
  if (differences.length) {
    console.error(`Generated contract is stale:\n${differences.map((item) => `- ${item}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Generated contract is current: ${outputPath}`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--schema") parsed.schema = values[++index];
    else if (values[index] === "--out") parsed.out = values[++index];
  }
  return parsed;
}

function compareDirectories(expected, actual, prefix = "") {
  const expectedFiles = list(expected);
  const actualFiles = list(actual);
  const names = new Set([...expectedFiles, ...actualFiles]);
  const differences = [];
  for (const name of [...names].sort()) {
    const expectedPath = path.join(expected, name);
    const actualPath = path.join(actual, name);
    const label = path.join(prefix, name);
    if (!fs.existsSync(expectedPath)) differences.push(`unexpected ${label}`);
    else if (!fs.existsSync(actualPath)) differences.push(`missing ${label}`);
    else if (fs.statSync(expectedPath).isDirectory() && fs.statSync(actualPath).isDirectory()) {
      differences.push(...compareDirectories(expectedPath, actualPath, label));
    } else if (fs.readFileSync(expectedPath, "utf8") !== fs.readFileSync(actualPath, "utf8")) {
      differences.push(`changed ${label}`);
    }
  }
  return differences;
}

function list(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}
