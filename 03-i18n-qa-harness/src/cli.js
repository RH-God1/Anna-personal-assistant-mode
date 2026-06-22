#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { auditBundle, buildPseudoCatalog, loadCatalogs } from "./core.js";

const args = parseArgs(process.argv.slice(2));
if (!args.bundle) {
  console.error("Usage: anna-i18n-qa --bundle PATH [--base en] [--write-pseudo] [--json]");
  process.exit(2);
}

const bundle = path.resolve(args.bundle);
const base = args.base || "en";
const result = auditBundle(bundle, base);

if (args.writePseudo) {
  const catalogs = loadCatalogs(path.join(bundle, "locales"));
  if (!catalogs[base]) {
    console.error(`Cannot generate pseudo locale: ${base} is missing.`);
    process.exit(2);
  }
  const target = path.join(bundle, "locales", "pseudo.json");
  fs.writeFileSync(target, `${JSON.stringify(buildPseudoCatalog(catalogs[base]), null, 2)}\n`);
  result.pseudoLocale = target;
}

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Locales: ${result.locales.join(", ") || "none"}`);
  console.log(`Errors: ${result.errorCount}; warnings: ${result.warningCount}`);
  result.issues.forEach((item) => console.log(`[${item.severity}] ${item.code}: ${item.message}`));
}

process.exitCode = result.errorCount > 0 ? 1 : 0;

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--bundle") parsed.bundle = values[++index];
    else if (value === "--base") parsed.base = values[++index];
    else if (value === "--write-pseudo") parsed.writePseudo = true;
    else if (value === "--json") parsed.json = true;
  }
  return parsed;
}
