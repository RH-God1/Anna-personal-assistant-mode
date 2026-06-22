#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "src", "server.js");
const configPath = path.join(root, "bridge.config.json");

const child = spawn(process.execPath, [serverPath, configPath], {
  stdio: ["pipe", "pipe", "pipe"]
});

let nextId = 0;
let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines.filter(Boolean)) {
    const message = JSON.parse(line);
    const handler = pending.get(message.id);
    if (handler) {
      pending.delete(message.id);
      handler(message);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  for (const [id, handler] of pending) {
    pending.delete(id);
    handler({
      id,
      error: {
        code: -32000,
        message: `MCP server exited (${code ?? signal ?? "unknown"})`
      }
    });
  }
});

function rpc(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "anna-mcp-smoke", version: "1.0.0" },
    capabilities: {}
  });
  assert.equal(initialized.serverInfo.name, "anna-executa-to-mcp-bridge");

  await rpc("ping");

  const listed = await rpc("tools/list");
  const toolNames = listed.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, ["travel__travel_agent", "personal__personal_assistant"]);

  const search = await rpc("tools/call", {
    name: "travel__travel_agent",
    arguments: {
      action: "search",
      search: {
        product: "rail",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengers: { adults: 1 }
      }
    }
  });
  assert.equal(search.isError, false);
  assert.equal(search.structuredContent.provider, "sandbox");
  assert.equal(search.structuredContent.offers[0].canAutoBook, false);
  assert.equal(search.structuredContent.privacy.piiAccepted, false);
  assert.equal(search.structuredContent.privacy.externalTransmission, false);

  const blocked = await rpc("tools/call", {
    name: "travel__travel_agent",
    arguments: {
      action: "search",
      search: {
        product: "rail",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengerName: "blocked-by-smoke"
      }
    }
  });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.content[0].text, "Request blocked by the bridge privacy policy.");

  const permissions = await rpc("tools/call", {
    name: "personal__personal_assistant",
    arguments: {
      action: "permission_registry"
    }
  });
  assert.equal(permissions.isError, false);
  assert.ok(permissions.structuredContent.some((item) => item.id === "travel.search.amadeus_sandbox"));
  assert.ok(permissions.structuredContent.some((item) => item.id === "booking.create_order" && item.status === "blocked_in_this_runtime"));

  const amadeus = await rpc("tools/call", {
    name: "personal__personal_assistant",
    arguments: {
      action: "flight_search",
      provider: "amadeus",
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-08-12",
      passengers: { adults: 1 }
    }
  });
  assert.equal(amadeus.isError, false);
  assert.equal(amadeus.structuredContent.provider, "amadeus");
  assert.equal(amadeus.structuredContent.offers[0].offer_source, "amadeus_sandbox_fixture");

  console.log("Anna MCP smoke test passed: initialize, tools/list, tools/call, privacy block, personal assistant safety, Amadeus sandbox.");
} finally {
  child.stdin.end();
  child.kill("SIGTERM");
}
