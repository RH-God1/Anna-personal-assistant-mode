import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateContract,
  generateGo,
  generatePython,
  generateTypeScript,
  validateContract
} from "../src/generator.js";

const contract = JSON.parse(fs.readFileSync(
  new URL("../contracts/travel-agent.contract.json", import.meta.url),
  "utf8"
));

test("validates duplicate actions", () => {
  assert.throws(() => validateContract({
    name: "Bad",
    version: "1",
    tool: "bad",
    actions: [{ name: "x", input: {}, output: {} }, { name: "x", input: {}, output: {} }]
  }), /Duplicate/);
});

test("generates language types from one contract", () => {
  assert.match(generateTypeScript(contract), /interface SearchQuery/);
  assert.match(generateTypeScript(contract), /type ActionName = "start_run" \| "continue"/);
  assert.match(generatePython(contract), /class StartRunInput\(TypedDict\)/);
  assert.match(generateGo(contract), /type ContinueInput struct/);
});

test("writes deterministic SDK, fixture and UI mock files", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "contract-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "contract-b-"));
  const a = generateContract(contract, first);
  const b = generateContract(contract, second);
  assert.deepEqual(a, b);
  assert.equal(Object.keys(a).length, 6);
  assert.match(fs.readFileSync(path.join(first, "fixtures/happy-path.jsonl"), "utf8"), /await_traveler_info/);
});
