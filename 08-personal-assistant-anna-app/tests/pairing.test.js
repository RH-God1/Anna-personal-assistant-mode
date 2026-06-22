import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("healthkit pairing script prints bridge command, URL and token", () => {
  const script = new URL("../scripts/healthkit-pairing.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: "9911",
      HEALTHKIT_BRIDGE_TOKEN: "test-token"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /HOST=0\.0\.0\.0 PORT=9911 HEALTHKIT_BRIDGE_TOKEN='test-token' npm run serve/);
  assert.match(result.stdout, /anna-healthkit:\/\/pair\?bridge_url=http%3A%2F%2F/);
  assert.match(result.stdout, /token=test-token/);
  assert.match(result.stdout, /Bridge Token:\ntest-token/);
  assert.match(result.stdout, /\/api\/healthkit\/snapshot/);
});

test("healthkit pairing script only prints companion-allowed local bridge URLs", () => {
  const script = new URL("../scripts/healthkit-pairing.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: "9913",
      HEALTHKIT_BRIDGE_TOKEN: "local-only-token"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /http:\/\/169\.254\./);
  assert.doesNotMatch(result.stdout, /http:\/\/127\./);
  assert.doesNotMatch(result.stdout, /https:\/\//);
  if (result.stdout.includes("Bridge URLs")) {
    assert.match(result.stdout, /http:\/\/(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/);
  }
});

test("healthkit doctor reports companion readiness without requiring full Xcode", () => {
  const script = new URL("../scripts/healthkit-doctor.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    env: process.env,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /xcode project/);
  assert.match(result.stdout, /shared scheme/);
  assert.match(result.stdout, /healthkit entitlement/);
  assert.match(result.stdout, /local network usage description/);
  assert.match(result.stdout, /xcode/);
  assert.match(result.stdout, /xcode app/);
  assert.match(result.stdout, /ios toolchain/);
  assert.match(result.stdout, /codesigning identity/);
});

test("healthkit bind script combines readiness and pairing guidance", () => {
  const script = new URL("../scripts/healthkit-bind.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: "9912",
      HEALTHKIT_BRIDGE_TOKEN: "bind-test-token"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Anna HealthKit binding workflow/);
  assert.match(result.stdout, /Binding readiness/);
  assert.match(result.stdout, /Bridge pairing/);
  assert.match(result.stdout, /HOST=0\.0\.0\.0 PORT=9912 HEALTHKIT_BRIDGE_TOKEN='bind-test-token' npm run serve/);
  assert.match(result.stdout, /anna-healthkit:\/\/pair\?bridge_url=http%3A%2F%2F/);
  assert.match(result.stdout, /Binding status: (blocked before iPhone install|ready for iPhone install)/);
});
