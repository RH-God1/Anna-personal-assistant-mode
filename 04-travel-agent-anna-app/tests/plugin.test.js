import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function createClient(t) {
  const child = spawn(process.execPath, [
    new URL("../executas/travel-agent-node/travel_agent_plugin.cjs", import.meta.url).pathname
  ], {
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || ""
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => child.kill());
  let id = 0;
  let buffer = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve) => {
    const requestId = ++id;
    pending.set(requestId, resolve);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params
    })}\n`);
  });
  const invoke = (args) => rpc("invoke", {
    tool: "travel_agent",
    arguments: args
  });
  invoke.rpc = rpc;
  invoke.raw = (line) => new Promise((resolve) => {
    pending.set(null, resolve);
    child.stdin.write(`${line}\n`);
  });
  return invoke;
}

test("sandbox run enforces traveler and payment gates", async (t) => {
  const call = createClient(t);
  const describe = await call.rpc("describe");
  assert.equal(describe.result.name, "tool-test-private-travel-agent-12345678");
  assert.equal(describe.result.tools[0].name, "travel_agent");

  const health = await call.rpc("health");
  assert.equal(health.result.status, "ready");

  const unsupported = await call.rpc("initialize");
  assert.equal(unsupported.error.code, -32601);

  const malformed = await call.raw("{");
  assert.equal(malformed.error.code, -32700);

  const started = await call({
    action: "start_run",
    product: "flight",
    provider: "sandbox",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengers: { adults: 1 }
    }
  });
  assert.equal(started.result.success, true);
  assert.equal(started.result.data.state, "await_traveler_info");
  const runId = started.result.data.id;

  const skipped = await call({ action: "continue", run_id: runId, event: "payment_completed" });
  assert.equal(skipped.result.success, false);
  assert.equal(skipped.result.error.code, "invalid_transition");

  const info = await call({ action: "continue", run_id: runId, event: "traveler_info_completed" });
  assert.equal(info.result.data.state, "await_payment");
  const paid = await call({ action: "continue", run_id: runId, event: "payment_completed" });
  assert.equal(paid.result.data.state, "post_payment");
});

test("rejects PII and invalid passenger counts", async (t) => {
  const call = createClient(t);
  const pii = await call({
    action: "start_run",
    product: "rail",
    search: {
      product: "rail",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengerName: "Sensitive"
    }
  });
  assert.equal(pii.result.success, false);
  assert.match(pii.result.error.message, /Sensitive user data/);

  const invalid = await call({
    action: "search",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengers: { adults: -2 }
    }
  });
  assert.equal(invalid.result.success, false);
  assert.match(invalid.result.error.message, /passengers\.adults/);
});

test("official provider enters a separate human handoff state", async (t) => {
  const call = createClient(t);
  const started = await call({
    action: "start_run",
    product: "flight",
    provider: "official-handoff",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-07-01"
    }
  });
  assert.equal(started.result.data.state, "await_official_site");
  assert.match(started.result.data.selectedOffer.handoff.url, /^https:\/\/www\.expedia\.com\/Flights-Search\?/);
  assert.equal(started.result.data.selectedOffer.canAutoBook, false);
  const completed = await call({
    action: "continue",
    run_id: started.result.data.id,
    event: "official_site_opened"
  });
  assert.equal(completed.result.data.state, "human_handoff");
});
