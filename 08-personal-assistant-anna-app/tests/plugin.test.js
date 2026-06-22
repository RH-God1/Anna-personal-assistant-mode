import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pluginPath = new URL("../executas/personal-assistant-node/personal_assistant_plugin.cjs", import.meta.url).pathname;

function createClient(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-plugin-learning-"));
  const child = spawn(process.execPath, [pluginPath], {
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      ANNA_LEARNING_MEMORY_PATH: path.join(dir, "learning-memory.json")
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
  const invoke = (arguments_) => rpc("invoke", {
    tool: "personal_assistant",
    arguments: arguments_
  });
  invoke.rpc = rpc;
  invoke.raw = (line) => new Promise((resolve) => {
    pending.set(null, resolve);
    child.stdin.write(`${line}\n`);
  });
  return invoke;
}

test("Executa CLI describe returns an Agent-discoverable manifest", async () => {
  const { stdout } = await execFileAsync(process.execPath, [pluginPath, "describe"], {
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || ""
    }
  });
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.id, "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36");
  assert.equal(manifest.tool_id, "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36");
  assert.equal(manifest.name, "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36");
  assert.equal(manifest.tools[0].name, "personal_assistant");
});

test("Executa exposes status and consent-gated health flow", async (t) => {
  const call = createClient(t);
  const describe = await call.rpc("describe");
  assert.equal(describe.result.name, "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36");
  assert.deepEqual(
    describe.result.tools[0].parameters.find(({ name }) => name === "attachments").items,
    { type: "object" }
  );

  const health = await call.rpc("health");
  assert.equal(health.result.status, "ready");

  const initialized = await call.rpc("initialize", {
    protocolVersion: "2.0",
    clientInfo: { name: "matrix-agent", version: "1.0" },
    capabilities: {}
  });
  assert.equal(initialized.result.protocolVersion, "2.0");
  assert.equal(initialized.result.serverInfo.name, "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36");
  assert.deepEqual(initialized.result.capabilities, {});

  const malformed = await call.raw("{");
  assert.equal(malformed.error.code, -32700);

  const status = await call({ action: "status" });
  assert.equal(status.result.success, true);
  assert.equal(status.result.data.service, "anna-personal-assistant");
  assert.equal(status.result.data.routing.text_specializations.decision, "qwen3-max");
  assert.equal(status.result.data.routing.text_specializations.general, "gemini-3.1-flash-lite-preview");
  assert.equal(status.result.data.healthkit_bridge.action, "health_connect");
  assert.deepEqual(status.result.data.healthkit_bridge.supported_devices, ["iphone", "apple_watch"]);
  assert.equal(status.result.data.learning.trigger, "user_instruction_required");
  assert.equal(status.result.data.learning.curriculum.length, 3);
  assert.deepEqual(
    status.result.data.learning.curriculum.map((section) => section.required_books_per_cycle),
    [5, 5, 5]
  );

  const learning = await call({ action: "learning_cycle", message: "请进行本次强化学习" });
  assert.equal(learning.result.success, true);
  assert.equal(learning.result.data.mode, "autonomous_reinforcement_learning");
  assert.equal(learning.result.data.reading_batch.length, 3);
  assert.deepEqual(
    learning.result.data.reading_batch.map((section) => section.books_read_this_cycle),
    [5, 5, 5]
  );
  assert.equal(learning.result.data.memory_update.stored, true);

  const rejected = await call({ action: "health_connect", consent: false });
  assert.equal(rejected.result.success, false);
  assert.match(rejected.result.error.message, /explicit consent/);

  const connected = await call({ action: "health_connect", consent: true });
  assert.equal(connected.result.success, true);
  assert.equal(connected.result.data.mode, "healthkit-companion-bridge");
  assert.equal(connected.result.data.bridge_kind, "demo");

  const demoConnected = await call({ action: "health_connect_demo", consent: true });
  assert.equal(demoConnected.result.success, true);
  assert.equal(demoConnected.result.data.bridge_kind, "demo");

  const preflight = await call({
    action: "preflight",
    first_use: true,
    weather_demo: true,
    location: {
      latitude: 31.2304,
      longitude: 121.4737,
      label: "上海"
    }
  });
  assert.equal(preflight.result.success, true);
  assert.equal(preflight.result.data.context.permissions.health, "requested");
  assert.ok(preflight.result.data.messages.some((item) => item.kind === "health_permission_request"));
});

test("Executa routes multimodal requests and serves deterministic weather demo", async (t) => {
  const call = createClient(t);
  const routed = await call({
    action: "assist",
    message: "帮我看这张图",
    attachments: [{ name: "desk.png", type: "image/png", size: 42 }],
    preferred_model: "gemma-4-e4b-it"
  });
  assert.equal(routed.result.data.route.selected_model.id, "anna-auto");
  assert.ok(routed.result.data.route.required_capabilities.includes("vision"));

  const weather = await call({
    action: "weather",
    location: {
      latitude: 31.2304,
      longitude: 121.4737,
      label: "上海",
      demo: true
    }
  });
  assert.equal(weather.result.data.weather.label, "局部多云");
});

test("Executa exposes personal assistant travel planning without auto booking", async (t) => {
  const call = createClient(t);
  const naturalLanguage = await call({
    action: "assist",
    message: "帮我订上海到东京机票，2026-08-12，1人，先不要付款"
  });
  assert.equal(naturalLanguage.result.success, true);
  assert.equal(naturalLanguage.result.data.context.travel, null);
  assert.equal(naturalLanguage.result.data.context.booking.mode, "duffel_booking_compare");
  assert.equal(naturalLanguage.result.data.context.booking.provider, "duffel");
  assert.equal(naturalLanguage.result.data.context.booking.opens_external_browser, false);
  assert.match(naturalLanguage.result.data.response.answer, /Duffel|booking_prepare/);

  const duffelFirst = await call({
    action: "assist",
    message: "我需要订购一张2026-08-12从上海到东京的机票，1位成人。不要打开浏览器，先走Duffel。"
  });
  assert.equal(duffelFirst.result.success, true);
  assert.equal(duffelFirst.result.data.context.travel, null);
  assert.equal(duffelFirst.result.data.context.booking.mode, "duffel_booking_compare");
  assert.equal(duffelFirst.result.data.context.booking.provider, "duffel");
  assert.equal(duffelFirst.result.data.context.booking.opens_external_browser, false);
  assert.doesNotMatch(JSON.stringify(duffelFirst.result.data), /Expedia|Trip\.com|Booking\.com|Flights-Search/i);

  const hotel = await call({
    action: "travel_search",
    search: {
      product: "hotel",
      destination: "Hangzhou",
      departureDate: "2026-07-02"
    }
  });
  assert.equal(hotel.result.success, true);
  assert.equal(hotel.result.data.offers[0].product, "hotel");
  assert.equal(hotel.result.data.offers[0].can_auto_book, false);

  const flightRun = await call({
    action: "travel_start",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01"
    }
  });
  assert.equal(flightRun.result.success, true);
  assert.equal(flightRun.result.data.state, "await_traveler_info");

  const official = await call({
    action: "travel_start",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-08-12"
    },
    provider: "official-handoff"
  });
  assert.equal(official.result.success, true);
  assert.equal(official.result.data.state, "await_user_confirmation");
  assert.equal(official.result.data.next_gate, "user_booking_confirmation");
  assert.match(official.result.data.selected_offer.handoff.url, /^https:\/\/www\.expedia\.com\/Flights-Search\?/);
  assert.equal(official.result.data.selected_offer.can_auto_book, false);

  const confirmed = await call({
    action: "travel_continue",
    run_id: official.result.data.id,
    event: "是"
  });
  assert.equal(confirmed.result.success, true);
  assert.equal(confirmed.result.data.state, "await_booking_authorization");
  assert.equal(confirmed.result.data.next_gate, "booking_authorization");

  const blocked = await call({
    action: "travel_start",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengerName: "Sensitive"
    }
  });
  assert.equal(blocked.result.success, false);
  assert.match(blocked.result.error.message, /Sensitive user data/);
});
