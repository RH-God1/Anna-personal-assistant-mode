import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createAmadeusTravelMcpServer,
  createHttpServer
} from "../mcp/amadeus-travel-server.js";

const mcp = createAmadeusTravelMcpServer({
  env: {
    ...process.env,
    AMADEUS_MCP_USE_FIXTURES: "1",
    AMADEUS_MCP_OPEN_DRY_RUN: "1"
  },
  now: () => new Date("2026-06-22T09:30:00.000Z")
});
const server = createHttpServer(mcp);
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/mcp`;
  const initialized = await rpc(url, "initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "anna-amadeus-mcp-smoke", version: "1.0.0" },
    capabilities: {}
  });
  assert.equal(initialized.serverInfo.name, "anna-amadeus-travel-mcp");

  const listed = await rpc(url, "tools/list");
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["search_flights", "search_hotels", "get_offer_details", "open_booking_url"]
  );

  const flights = await callTool(url, "search_flights", {
    origin: "SHA",
    destination: "NRT",
    departure_date: "2026-08-12",
    passengers: 1
  });
  assert.equal(flights.isError, false);
  assert.equal(flights.structuredContent.source, "amadeus_sandbox_fixture");
  assert.equal(flights.structuredContent.options[0].product, "flight");
  assert.match(flights.structuredContent.options[0].booking_url, /^https:\/\//);

  const hotels = await callTool(url, "search_hotels", {
    city: "TYO",
    checkin_date: "2026-08-12",
    checkout_date: "2026-08-14",
    guests: 1
  });
  assert.equal(hotels.isError, false);
  assert.equal(hotels.structuredContent.source, "amadeus_sandbox_fixture");
  assert.equal(hotels.structuredContent.options[0].product, "hotel");

  const details = await callTool(url, "get_offer_details", {
    offer_id: flights.structuredContent.options[0].offer_id
  });
  assert.equal(details.isError, false);
  assert.equal(details.structuredContent.product, "flight");
  assert.match(details.structuredContent.details.baggage_allowance, /baggage|carry-on|行李/i);

  const opened = await callTool(url, "open_booking_url", {
    url: flights.structuredContent.options[0].booking_url,
    dry_run: true
  });
  assert.equal(opened.isError, false);
  assert.equal(opened.structuredContent.dry_run, true);
  assert.equal(opened.structuredContent.payment_policy.mcp_handles_payment, false);

  console.log("Anna Amadeus MCP smoke passed: initialize, tool discovery, fixture searches, details, dry-run open.");
} finally {
  server.close();
}

async function rpc(url, method, params = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method,
      params
    })
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

async function callTool(url, name, args) {
  return rpc(url, "tools/call", {
    name,
    arguments: args
  });
}
