#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const PRODUCTS = new Set(["flight", "rail", "bus", "hotel"]);
const runs = new Map();
const OFFICIAL_SITES = {
  flight: {
    id: "expedia",
    name: "Expedia Flights",
    origin: "https://www.expedia.com",
    home: "https://www.expedia.com/Flights"
  },
  hotel: {
    id: "booking",
    name: "Booking.com",
    origin: "https://www.booking.com",
    home: "https://www.booking.com/"
  }
};
const MANIFEST = {
  name: "tool-test-private-travel-agent-12345678",
  display_name: "Private Travel Agent",
  version: "1.0.0",
  description: "Anonymous itinerary planning with mandatory human gates.",
  license: "MIT",
  tools: [{
    name: "travel_agent",
    description: "Search and advance a privacy-preserving travel run.",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "product", type: "string", required: false },
      { name: "provider", type: "string", required: false },
      { name: "search", type: "object", required: false },
      { name: "run_id", type: "string", required: false },
      { name: "event", type: "string", required: false }
    ]
  }],
  runtime: { type: "node", min_version: "18.0.0" },
  privacy_capabilities: {
    reads_pii: false,
    writes_external: false,
    requires_human_confirmation: true
  }
};

function travelAgent(args) {
  assertNoPii(args);
  switch (args.action) {
    case "search":
      return search({
        ...(args.search || args),
        provider: args.provider || args.search?.provider
      });
    case "start_run":
      return startRun(args);
    case "continue":
      return continueRun(args.run_id, args.event);
    case "get_run":
      return getRun(args.run_id);
    default:
      throw new Error(`Unknown action: ${JSON.stringify(args.action)}`);
  }
}

function search(input) {
  const query = normalizeQuery(input);
  const provider = input.provider || "sandbox";
  const official = provider === "official-handoff";
  const handoff = official ? officialHandoffFor(query) : null;
  return {
    query,
    provider,
    offers: [{
      id: official ? `${query.product}-official-handoff` : `${query.product}-sandbox-1`,
      product: query.product,
      title: official ? `${handoff.site.name} 官方网页人工接管` : `Sandbox ${productLabel(query.product)}推荐方案`,
      schedule: `${query.origin || "目的地"} → ${query.destination || query.origin} · ${query.departureDate}`,
      price: official ? null : priceFor(query.product),
      canAutoBook: false,
      handoff,
      gates: official
        ? ["official_site"]
        : ["traveler_info", "order_confirmation", "payment"]
    }],
    privacy: {
      piiAccepted: false,
      externalTransmission: false,
      externalTransmissionAfterHandoff: official ? ["anonymous_itinerary_fields"] : []
    }
  };
}

function officialHandoffFor(query) {
  const site = OFFICIAL_SITES[query.product];
  if (!site) {
    throw new Error(`Official handoff is only configured for flight and hotel: ${query.product}`);
  }
  const url = query.product === "flight"
    ? flightUrl(query, site)
    : hotelUrl(query, site);
  return {
    mode: "official-web",
    site,
    url,
    itineraryInUrl: true,
    anonymousFields: {
      product: query.product,
      origin: query.origin,
      destination: query.destination,
      departureDate: query.departureDate,
      passengers: query.passengers
    },
    userControlledSteps: [
      "打开官方网页并核对匿名行程字段",
      "用户自行处理登录、验证码、旅客身份信息、订单确认与付款",
      "Anna 只记录 official_site_opened，不记录页面文本、订单号或支付信息"
    ]
  };
}

function flightUrl(query, site) {
  const params = new URLSearchParams({
    trip: "oneway",
    leg1: `from:${query.origin},to:${query.destination},departure:${query.departureDate}TANYT`,
    passengers: `adults:${query.passengers.adults},children:${query.passengers.children},seniors:0,infantinlap:Y`,
    mode: "search"
  });
  return `${site.origin}/Flights-Search?${params.toString()}`;
}

function hotelUrl(query, site) {
  const params = new URLSearchParams({
    ss: query.destination || query.origin,
    checkin: query.departureDate,
    checkout: addDays(query.departureDate, 1),
    group_adults: String(query.passengers.adults),
    group_children: String(query.passengers.children),
    no_rooms: "1"
  });
  return `${site.origin}/searchresults.html?${params.toString()}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startRun(args) {
  const result = search({ ...(args.search || {}), provider: args.provider });
  const selectedOffer = result.offers[0];
  const official = args.provider === "official-handoff";
  const run = {
    id: `run_${randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    product: result.query.product,
    provider: result.provider,
    query: result.query,
    selectedOffer,
    state: official ? "await_official_site" : "await_traveler_info",
    nextGate: official ? "official_site" : "traveler_info",
    events: [{
      type: "human_gate",
      gate: official ? "official_site" : "traveler_info",
      at: new Date().toISOString()
    }],
    privacy: result.privacy
  };
  runs.set(run.id, run);
  return clone(run);
}

function continueRun(id, event) {
  const run = requiredRun(id);
  const transitions = {
    "await_traveler_info:traveler_info_completed": {
      state: "await_payment",
      nextGate: "payment"
    },
    "await_payment:payment_completed": {
      state: "post_payment",
      nextGate: null
    },
    "await_official_site:official_site_opened": {
      state: "human_handoff",
      nextGate: null
    }
  };
  const transition = transitions[`${run.state}:${event}`];
  if (!transition) {
    const error = new Error(`Event ${event} is not allowed while run is in state ${run.state}.`);
    error.code = "invalid_transition";
    throw error;
  }
  run.state = transition.state;
  run.nextGate = transition.nextGate;
  run.updatedAt = new Date().toISOString();
  run.events.push({ type: "user_confirmed", event, at: run.updatedAt });
  return clone(run);
}

function getRun(id) {
  return clone(requiredRun(id));
}

function requiredRun(id) {
  const run = runs.get(id);
  if (!run) throw new Error(`Run not found: ${id}`);
  return run;
}

function normalizeQuery(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("search must be an object");
  }
  const product = clean(input.product, "product", 24);
  if (!PRODUCTS.has(product)) throw new Error(`Unsupported product: ${product}`);
  const origin = optional(input.origin, "origin", 80);
  const destination = optional(input.destination, "destination", 80);
  const departureDate = clean(input.departureDate, "departureDate", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    throw new Error("departureDate must use YYYY-MM-DD");
  }
  if (product !== "hotel" && (!origin || !destination)) {
    throw new Error("origin and destination are required");
  }
  if (product === "hotel" && !origin && !destination) {
    throw new Error("hotel destination is required");
  }
  return {
    product,
    origin,
    destination,
    departureDate,
    passengers: {
      adults: boundedInteger(input.passengers?.adults, 1, 9, 1, "passengers.adults"),
      children: boundedInteger(input.passengers?.children, 0, 9, 0, "passengers.children")
    }
  };
}

function assertNoPii(value, path = "args") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/(?:^|[_-])(?:full)?name$|passenger(?!s$)|traveler|contact|identity|id.?card|passport|phone|mobile|email|bank|card|cvv|cvc|password|姓名|身份证|护照|手机号|验证码|支付密码/i.test(key)) {
        throw new Error(`Sensitive user data is not accepted: ${path}.${key}`);
      }
      assertNoPii(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" &&
      (/\b1[3-9]\d{9}\b/.test(value) || /\b(?:\d[ -]*?){13,19}\b/.test(value))) {
    throw new Error(`Sensitive user data is not accepted: ${path}`);
  }
}

function clean(value, field, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.trim().length > max) throw new Error(`${field} is too long`);
  return value.trim();
}

function optional(value, field, max) {
  if (value == null || value === "") return null;
  return clean(value, field, max);
}

function boundedInteger(value, min, max, fallback, field) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return number;
}

function priceFor(product) {
  return { flight: 680, rail: 553, bus: 98, hotel: 438 }[product];
}

function productLabel(product) {
  return { flight: "机票", rail: "高铁", bus: "巴士", hotel: "酒店" }[product];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function handle(method, params) {
  if (typeof method !== "string" || !method) {
    throw rpcError(-32600, "Invalid request: method is required");
  }
  if (method === "describe") return MANIFEST;
  if (method === "health") {
    return { status: "ready", message: "", details: { runs: runs.size } };
  }
  if (method === "invoke") {
    if (params.tool !== "travel_agent") {
      throw rpcError(-32601, `Unknown tool: ${params.tool}`);
    }
    try {
      return { success: true, data: travelAgent(params.arguments || {}) };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code || "invalid_request",
          message: error.message
        }
      };
    }
  }
  throw rpcError(-32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${error.message}` }
    })}\n`);
    return;
  }
  try {
    const result = handle(request.method, request.params || {});
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: error.rpcCode || -32603, message: error.message }
    })}\n`);
  }
});
