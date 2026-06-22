import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Anna beginner guide compliance script passes", () => {
  const script = new URL("../scripts/check-anna-guide.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    env: process.env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Anna guide compliance checks passed/);
});
