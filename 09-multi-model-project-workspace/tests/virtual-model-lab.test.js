import test from "node:test";
import assert from "node:assert/strict";
import { runVirtualModelExperiment } from "../src/virtual-model-lab.js";

test("virtual multi-model lab completes all collaboration and fault checks", () => {
  const report = runVirtualModelExperiment();

  assert.equal(report.passed, true);
  assert.equal(report.virtual_models.length, 5);
  assert.ok(report.subproject_count >= 8);
  assert.ok(report.checks.length >= 9);
  assert.equal(report.checks.every((check) => check.passed), true);
  assert.deepEqual(
    report.synthesis.used_artifacts.sort(),
    ["api-contract.json", "ui-analysis.md"]
  );
  assert.ok(
    report.synthesis.context_budget.used <=
      report.synthesis.context_budget.maximum
  );
});
