import test from "node:test";
import assert from "node:assert/strict";
import {
  createAmadeusTravelMcpServer,
  toolDefinitions
} from "../mcp/amadeus-travel-server.js";

test("Amadeus MCP exposes the required four travel tools", () => {
  assert.deepEqual(
    toolDefinitions().map((tool) => tool.name),
    ["search_flights", "search_hotels", "get_offer_details", "open_booking_url"]
  );
});

test("Amadeus MCP normalizes fixture flight and hotel offers", async () => {
  const mcp = createAmadeusTravelMcpServer({
    env: {
      AMADEUS_MCP_USE_FIXTURES: "1",
      AMADEUS_MCP_OPEN_DRY_RUN: "1"
    },
    now: () => new Date("2026-06-22T09:30:00.000Z")
  });

  const listed = await mcp.dispatch("tools/list");
  assert.equal(listed.tools.length, 4);

  const flights = await mcp.dispatch("tools/call", {
    name: "search_flights",
    arguments: {
      origin: "SHA",
      destination: "NRT",
      departure_date: "2026-08-12",
      passengers: 1
    }
  });
  assert.equal(flights.isError, false);
  assert.equal(flights.structuredContent.source, "amadeus_sandbox_fixture");
  assert.equal(flights.structuredContent.options[0].product, "flight");
  assert.ok(flights.structuredContent.options[0].airline);
  assert.ok(flights.structuredContent.options[0].booking_url);

  const hotels = await mcp.dispatch("tools/call", {
    name: "search_hotels",
    arguments: {
      city: "Tokyo",
      checkin_date: "2026-08-12",
      checkout_date: "2026-08-14",
      guests: 1
    }
  });
  assert.equal(hotels.isError, false);
  assert.equal(hotels.structuredContent.query.city, "TYO");
  assert.equal(hotels.structuredContent.options[0].product, "hotel");
  assert.ok(hotels.structuredContent.options[0].hotel_name);
  assert.ok(hotels.structuredContent.options[0].nightly_price);

  const details = await mcp.dispatch("tools/call", {
    name: "get_offer_details",
    arguments: {
      offer_id: flights.structuredContent.options[0].offer_id
    }
  });
  assert.equal(details.isError, false);
  assert.equal(details.structuredContent.details.offer_id, flights.structuredContent.options[0].offer_id);
  assert.match(details.structuredContent.details.baggage_allowance, /carry-on|baggage|checked/i);
  assert.equal(details.structuredContent.payment_policy.anna_handles_payment, false);
  assert.equal(details.structuredContent.payment_policy.requires_same_turn_confirmation, true);
  assert.equal(details.structuredContent.payment_policy.max_urls_per_confirmation, 1);
});

test("open_booking_url records a dry run and never handles payment", async () => {
  const mcp = createAmadeusTravelMcpServer({
    env: { AMADEUS_MCP_OPEN_DRY_RUN: "1" },
    now: () => new Date("2026-06-22T09:31:00.000Z")
  });
  const opened = await mcp.dispatch("tools/call", {
    name: "open_booking_url",
    arguments: {
      url: "https://developers.amadeus.com/self-service/apis-docs?offer_id=test",
      dry_run: true
    }
  });
  assert.equal(opened.isError, false);
  assert.equal(opened.structuredContent.opened, false);
  assert.equal(opened.structuredContent.dry_run, true);
  assert.equal(opened.structuredContent.payment_policy.user_completes_payment_in_browser, true);
  assert.match(opened.structuredContent.payment_policy.open_failure_fallback, /raw URL/);
  assert.equal(mcp.state.openedUrls.length, 1);
});
