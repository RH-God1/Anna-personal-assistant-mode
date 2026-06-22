import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRuntimeLabels,
  promptFor,
  riskLevel,
  validateCapabilities,
  validateManifest
} from "../src/core.js";
import { generate } from "../src/generator.js";

const manifest = JSON.parse(fs.readFileSync(
  new URL("../manifests/anna-projects.json", import.meta.url),
  "utf8"
));

test("validates the Anna project privacy manifest", () => {
  assert.deepEqual(validateManifest(manifest), []);
});

test("rejects contradictory external and human-gate declarations", () => {
  const errors = validateCapabilities({
    reads_pii: false,
    writes_external: false,
    requires_human_confirmation: false,
    human_gates: ["payment"],
    data_classes: [],
    retention: "memory_only",
    external_domains: ["example.com"]
  }, "bad");
  assert(errors.some((error) => /external_domains must be empty/.test(error)));
  assert(errors.some((error) => /human_gates must be empty/.test(error)));
});

test("maps privacy declarations to runtime badges and MCP annotations", () => {
  const labels = createRuntimeLabels(manifest);
  assert.deepEqual(labels["private-travel-agent"].badges, [
    "no-pii",
    "local-only",
    "human-gated"
  ]);
  assert.equal(labels["private-travel-agent"].mcp_annotations.readOnlyHint, true);
  assert.equal(riskLevel(manifest.tools[0].capabilities), "guarded");
  assert.match(promptFor(manifest.tools[0]), /不读取个人信息/);
});

test("generates deterministic report files", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-b-"));
  assert.deepEqual(generate(manifest, first), generate(manifest, second));
  assert.match(fs.readFileSync(path.join(first, "privacy-report.md"), "utf8"), /隐私旅行代理/);
});
