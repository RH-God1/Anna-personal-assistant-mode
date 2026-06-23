#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_TOOL_ID = "tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36";
const { toolId: TOOL_ID, args: COMMAND_ARGS } = parseRuntimeArgs(process.argv.slice(2));

const MANIFEST = {
  id: TOOL_ID,
  tool_id: TOOL_ID,
  name: TOOL_ID,
  display_name: "Anna Personal Assistant",
  version: "0.1.24",
  description: "Chinese/English personal assistant capability routing, weather, air quality, consent-gated health context, Duffel/Amadeus sandbox travel review, memory-only confirmation queue, and user-triggered reinforcement learning memory.",
  license: "MIT",
  tags: ["assistant", "multimodal", "weather", "health", "privacy"],
  credentials: [{
    name: "DUFFEL_ACCESS_TOKEN",
    display_name: "Duffel Access Token",
    description: "Duffel API access token used for live flight offer requests. Local development may also provide DUFFEL_ACCESS_TOKEN in the environment.",
    required: false,
    sensitive: true
  }, {
    name: "AMADEUS_CLIENT_ID",
    display_name: "Amadeus Client ID",
    description: "Optional Amadeus sandbox client id. Local development may also provide AMADEUS_CLIENT_ID in the environment.",
    required: false,
    sensitive: true
  }, {
    name: "AMADEUS_CLIENT_SECRET",
    display_name: "Amadeus Client Secret",
    description: "Optional Amadeus sandbox client secret. Local development may also provide AMADEUS_CLIENT_SECRET in the environment.",
    required: false,
    sensitive: true
  }],
  tools: [{
    name: "personal_assistant",
    description: "Use action: status | permission_registry | confirmation_queue | confirmation_get | confirmation_resolve | preflight | weather | health_connect | health_connect_demo | healthkit_push_snapshot | health_snapshot | health_disconnect | travel_search | travel_start | travel_continue | travel_get | flight_search | hotel_search | travel_compare | booking_prepare | booking_get_confirmation | booking_confirm | learning_status | learning_cycle | assist.",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "message", type: "string", required: false },
      {
        name: "attachments",
        type: "array",
        items: { type: "object" },
        required: false
      },
      { name: "preferred_model", type: "string", required: false },
      { name: "location", type: "object", required: false },
      { name: "travel", type: "object", required: false },
      { name: "booking", type: "object", required: false },
      { name: "search", type: "object", required: false },
      { name: "provider", type: "string", required: false },
      { name: "bookingType", type: "string", required: false },
      { name: "confirmationId", type: "string", required: false },
      { name: "confirmation_queue_id", type: "string", required: false },
      { name: "permission_id", type: "string", required: false },
      { name: "decision", type: "string", required: false },
      { name: "userConfirmed", type: "boolean", required: false },
      { name: "createProviderOrder", type: "boolean", required: false },
      { name: "items", type: "array", items: { type: "object" }, required: false },
      { name: "travelers", type: "array", items: { type: "object" }, required: false },
      { name: "run_id", type: "string", required: false },
      { name: "event", type: "string", required: false },
      { name: "scenario", type: "string", required: false },
      { name: "route", type: "object", required: false },
      { name: "response", type: "object", required: false },
      { name: "weather_demo", type: "boolean", required: false },
      { name: "consent", type: "boolean", required: false },
      { name: "health_consent", type: "boolean", required: false },
      { name: "first_use", type: "boolean", required: false },
      { name: "user_key", type: "string", required: false },
      { name: "device_types", type: "array", items: { type: "string" }, required: false },
      { name: "snapshot", type: "object", required: false },
      { name: "session_id", type: "string", required: false }
    ]
  }],
  runtime: { type: "node", min_version: "18.0.0" },
  privacy_capabilities: {
    reads_pii: true,
    writes_external: true,
    requires_human_confirmation: true
  }
};

const PARAMETER_DESCRIPTIONS = {
  action: "Operation to run, such as status, flight_search, hotel_search, booking_prepare, or booking_confirm.",
  message: "Natural-language user request or assistant context.",
  attachments: "Optional uploaded files or multimodal attachment metadata.",
  preferred_model: "Optional model preference for assistant routing.",
  location: "Location input for weather or contextual assistant actions.",
  travel: "Travel search criteria or travel workflow state.",
  booking: "Booking preparation, confirmation, or lookup payload.",
  search: "Search criteria used by flight or hotel search actions.",
  provider: "Preferred provider adapter. Current structured travel booking backend enables Duffel sandbox/test and Amadeus sandbox/MCP; official-handoff is allowed only when the user explicitly asks for official website/browser handoff.",
  bookingType: "Booking type: flight, hotel, or flight_hotel.",
  confirmationId: "Booking confirmation identifier returned by booking_prepare.",
  confirmation_queue_id: "Human confirmation queue identifier returned by safety-gated actions.",
  permission_id: "Permission registry identifier to inspect.",
  decision: "Human confirmation decision such as approved or rejected.",
  userConfirmed: "Whether the current Anna confirmation UI collected an explicit user confirmation.",
  createProviderOrder: "Whether booking_confirm should create a supplier order record after explicit user confirmation. Set false to defer to user-controlled checkout without creating an order.",
  items: "Selected flight or hotel offer items for comparison or preparation.",
  travelers: "Traveler or guest summary data; do not include card numbers or raw identity documents.",
  run_id: "Workflow run identifier for continuing an existing task.",
  event: "Client event name used by guided workflows.",
  scenario: "Learning-loop scenario label used for manual training or evaluation.",
  route: "Optional route metadata for a learning-loop review.",
  response: "Optional assistant response object for a learning-loop review.",
  weather_demo: "Whether to use weather demo data.",
  consent: "General user consent flag for gated actions.",
  health_consent: "User consent flag for health-related context.",
  first_use: "Whether this is the first use of a guided workflow.",
  user_key: "User-scoped key for local demo state.",
  device_types: "Device type hints for health integration.",
  snapshot: "Health or travel state snapshot provided by the client.",
  session_id: "Client session identifier for workflow continuity."
};

for (const tool of MANIFEST.tools) {
  for (const parameter of tool.parameters) {
    if (!parameter.description) {
      parameter.description = PARAMETER_DESCRIPTIONS[parameter.name] || `${parameter.name} input.`;
    }
  }
}

let servicePromise;
let appliedCredentialSignature = "";

function applyCredentialContext(context = {}) {
  const credentials = context.credentials && typeof context.credentials === "object"
    ? context.credentials
    : {};
  const duffelToken = credentials.DUFFEL_ACCESS_TOKEN || credentials.duffel_access_token;
  if (!duffelToken || process.env.DUFFEL_ACCESS_TOKEN === duffelToken) return;
  process.env.DUFFEL_ACCESS_TOKEN = duffelToken;
  const nextSignature = `duffel:${duffelToken.length}:${duffelToken.slice(-6)}`;
  if (appliedCredentialSignature && appliedCredentialSignature !== nextSignature) {
    servicePromise = null;
  }
  appliedCredentialSignature = nextSignature;
  const amadeusClientId = credentials.AMADEUS_CLIENT_ID || credentials.amadeus_client_id;
  const amadeusClientSecret = credentials.AMADEUS_CLIENT_SECRET || credentials.amadeus_client_secret;
  if (amadeusClientId) process.env.AMADEUS_CLIENT_ID = amadeusClientId;
  if (amadeusClientSecret) process.env.AMADEUS_CLIENT_SECRET = amadeusClientSecret;
}

function getService() {
  if (!servicePromise) {
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "./lib/service.js")).href;
    const healthUrl = pathToFileURL(path.resolve(__dirname, "./lib/health-store.js")).href;
    servicePromise = Promise.all([import(moduleUrl), import(healthUrl)])
      .then(([{ createAssistantService }, { createBridgeableHealthKitProvider }]) =>
        createAssistantService({ healthKitProvider: createBridgeableHealthKitProvider() })
      );
  }
  return servicePromise;
}

async function invoke(args = {}) {
  const service = await getService();
  switch (args.action) {
    case "status":
      return service.status();
    case "permission_registry":
      return service.permissionRegistry(args);
    case "confirmation_queue":
      return service.confirmationQueue(args);
    case "confirmation_get":
      return service.confirmationGet(args);
    case "confirmation_resolve":
      return service.confirmationResolve(args);
    case "preflight":
      return service.preflight(args);
    case "weather":
      return service.weather(args.location || args);
    case "health_connect":
      return service.connectHealth(args);
    case "health_connect_demo":
      return service.connectDemoHealth(args);
    case "healthkit_push_snapshot":
      return service.updateHealthKitSnapshot(args);
    case "health_snapshot":
      return service.healthSnapshot(args);
    case "health_disconnect":
      return service.disconnectHealth(args);
    case "travel_search":
      return service.travelSearch(args.travel || args);
    case "travel_start":
      return service.travelStart(args.travel || args);
    case "travel_continue":
      return service.travelContinue(args.travel || args);
    case "travel_get":
      return service.travelGet(args.travel || args);
    case "flight_search":
      return service.flightSearch(args.travel || args.search || args);
    case "hotel_search":
      return service.hotelSearch(args.travel || args.search || args);
    case "travel_compare":
      return service.travelCompare(args.travel || args.booking || args);
    case "booking_prepare":
      return service.bookingPrepare(args.booking || args);
    case "booking_get_confirmation":
      return service.bookingGetConfirmation(args.booking || args);
    case "booking_confirm":
      return service.bookingConfirm(args.booking || args);
    case "learning_status":
      return service.learningStatus();
    case "learning_cycle":
      return service.learningCycle(args.learning || args);
    case "assist":
      return service.assist(args);
    default:
      throw new Error(`Unknown action: ${JSON.stringify(args.action)}`);
  }
}

async function handle(method, params) {
  if (typeof method !== "string" || !method) {
    throw rpcError(-32600, "Invalid request: method is required");
  }
  if (method === "initialize") {
    return {
      protocolVersion: "2.0",
      serverInfo: {
        name: MANIFEST.name,
        version: MANIFEST.version
      },
      capabilities: {}
    };
  }
  if (method === "initialized") return { ok: true };
  if (method === "describe") return MANIFEST;
  if (method === "health") {
    return { status: "ready", message: "", details: {} };
  }
  if (method === "shutdown") {
    setImmediate(() => process.exit(0));
    return { ok: true };
  }
  if (method !== "invoke") {
    throw rpcError(-32601, `Method not found: ${method}`);
  }
  if (params.tool !== "personal_assistant") {
    throw rpcError(-32601, `Unknown tool: ${params.tool}`);
  }
  applyCredentialContext(params.context);
  try {
    return { success: true, data: await invoke(params.arguments || {}) };
  } catch (error) {
    return {
      success: false,
      error: {
        code: error.code || "invalid_request",
        message: error.message || String(error),
        ...(error.resultCode ? { resultCode: error.resultCode } : {})
      }
    };
  }
}

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseRuntimeArgs(argv) {
  let toolId = process.env.ANNA_EXECUTA_TOOL_ID || process.env.ANNA_TOOL_ID || DEFAULT_TOOL_ID;
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    args.push(argv[index]);
  }
  return { toolId, args };
}

if (COMMAND_ARGS[0] === "describe") {
  send(MANIFEST);
  process.exit(0);
}

if (COMMAND_ARGS[0] === "health") {
  send({ status: "ready", message: "", details: {} });
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${error.message}` }
    });
    return;
  }
  try {
    const result = await handle(request.method, request.params || {});
    send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: {
        code: error.rpcCode || -32603,
        message: error.message || String(error)
      }
    });
  }
});
