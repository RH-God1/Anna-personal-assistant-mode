const http = require("http");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const { assertNoPii, publicSearchQuery } = require("./privacy");
const { PRODUCTS, createRegistry } = require("./platforms");
const { createRun, getRun, appendEvent, updateRun } = require("./runs");
const { createLLMAdapter } = require("./llm/openai");

const PORT = Number(process.env.TRAVEL_AGENT_API_PORT || 8787);
const HOST = process.env.TRAVEL_AGENT_API_HOST || "127.0.0.1";
const MAX_JSON_BYTES = Number(process.env.TRAVEL_AGENT_MAX_JSON_BYTES || 64 * 1024);
const registry = createRegistry(process.env);

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "Internal server error"
    });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Travel Agent API listening on http://${HOST}:${PORT}`);
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (request.method === "POST") {
    assertLocalMutationRequest(request);
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "private-travel-agent-api",
      time: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platforms") {
    sendJson(response, 200, {
      products: PRODUCTS,
      platforms: registry.list()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/llm/status") {
    sendJson(response, 200, createLLMAdapter(process.env).status());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/llm/recommend") {
    const body = await readJson(request);
    assertNoPii(body);
    const advice = await createLLMAdapter(process.env).recommend(body);
    sendJson(response, 200, advice);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/search") {
    const body = await readJson(request);
    assertNoPii(body);
    const query = publicSearchQuery(body.search || body);
    assertProduct(query.product);
    const adapter = registry.get(body.provider, query.product);
    const result = await adapter.search(query, externalContext(body));
    sendJson(response, 200, {
      query,
      result
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/holds") {
    const body = await readJson(request);
    assertNoPii(body);
    assertIdentifier(body.offerId, "offerId");
    const adapter = registry.get(body.provider, body.product);
    const hold = await adapter.hold(body.offerId);
    sendJson(response, 200, hold);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/book-intents") {
    const body = await readJson(request);
    assertNoPii(body);
    assertIdentifier(body.holdId, "holdId");
    const adapter = registry.get(body.provider, body.product);
    const intent = await adapter.createBookIntent(body.holdId);
    sendJson(response, 200, intent);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/run") {
    const body = await readJson(request);
    assertNoPii(body);
    const run = await startAgentRun(body);
    sendJson(response, 200, run);
    return;
  }

  const continueMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/continue$/);
  if (request.method === "POST" && continueMatch) {
    const body = await readJson(request);
    assertNoPii(body);
    const run = continueRun(continueMatch[1], body.event);
    sendJson(response, 200, run);
    return;
  }

  const llmAdviceMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/llm-advice$/);
  if (request.method === "POST" && llmAdviceMatch) {
    const body = await readJson(request);
    assertNoPii(body);
    const run = getRun(llmAdviceMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "Run not found" });
      return;
    }

    const advice = await createLLMAdapter(process.env).recommend({
      run,
      consentToShareWithLLM: body.consentToShareWithLLM === true
    });
    updateRun(run.id, {
      llmAdvice: advice
    });
    appendEvent(run.id, {
      type: "llm_advice",
      mode: advice.mode,
      externalTransmission: Boolean(advice.privacy && advice.privacy.externalTransmission)
    });
    sendJson(response, 200, getRun(run.id));
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const run = getRun(runMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "Run not found" });
      return;
    }
    sendJson(response, 200, run);
    return;
  }

  if (request.method === "GET" && url.pathname === "/demo") {
    sendFile(response, path.join(__dirname, "..", "public", "api-agent-demo.html"), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/manual") {
    sendFile(response, path.join(__dirname, "..", "tests", "manual-flow.html"), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/src/content.js") {
    sendFile(response, path.join(__dirname, "..", "src", "content.js"), "text/javascript; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/src/content.css") {
    sendFile(response, path.join(__dirname, "..", "src", "content.css"), "text/css; charset=utf-8");
    return;
  }

  sendJson(response, 404, {
    error: "Not found"
  });
}

async function startAgentRun(body) {
  const query = publicSearchQuery(body.search || body);
  assertProduct(query.product);
  const adapter = registry.get(body.provider, query.product);
  const searchResult = await adapter.search(query, externalContext(body));
  const offer = searchResult.offers[0] || null;

  const run = createRun({
    product: query.product,
    provider: adapter.id,
    state: offer ? "offer_selected" : "no_offer",
    query,
    selectedOffer: offer,
    privacy: searchResult.privacy || null
  });

  appendEvent(run.id, {
    type: "search_completed",
    offerCount: searchResult.offers.length
  });

  if (!offer) {
    return run;
  }

  const hold = await adapter.hold(offer.id);
  const nextGate = hold.nextGate || "traveler_info";
  updateRun(run.id, {
    state: nextGate === "official_site" ? "await_official_site" : "await_traveler_info",
    hold,
    nextGate
  });
  appendEvent(run.id, {
    type: "human_gate",
    gate: nextGate,
    message: nextGate === "official_site"
      ? "User must continue on the official website."
      : "User must enter traveler/contact information outside the Agent API."
  });

  return getRun(run.id);
}

function continueRun(runId, event) {
  const run = getRun(runId);

  if (!run) {
    const error = new Error(`Run not found: ${runId}`);
    error.statusCode = 404;
    throw error;
  }

  if (event === "traveler_info_completed") {
    assertRunState(run, "await_traveler_info", event);
    appendEvent(runId, {
      type: "user_confirmed",
      gate: "traveler_info"
    });
    updateRun(runId, {
      state: "await_payment",
      nextGate: "payment",
      message: "User must complete payment manually. Agent will only observe payment completion."
    });
    appendEvent(runId, {
      type: "human_gate",
      gate: "payment",
      message: "Payment is always handled by the user."
    });
    return getRun(runId);
  }

  if (event === "payment_completed") {
    assertRunState(run, "await_payment", event);
    appendEvent(runId, {
      type: "user_confirmed",
      gate: "payment"
    });
    updateRun(runId, {
      state: "post_payment",
      nextGate: null,
      message: "Payment completion captured. Agent can continue post-payment checks."
    });
    return getRun(runId);
  }

  if (event === "official_site_opened") {
    assertRunState(run, "await_official_site", event);
    appendEvent(runId, {
      type: "user_confirmed",
      gate: "official_site"
    });
    updateRun(runId, {
      state: "human_handoff",
      nextGate: null,
      message: "The user has taken over on the official website."
    });
    return getRun(runId);
  }

  const error = new Error(`Unsupported continue event: ${event}`);
  error.statusCode = 400;
  throw error;
}

function assertProduct(product) {
  if (!PRODUCTS.includes(product)) {
    const error = new Error(`Unsupported product: ${product}`);
    error.statusCode = 400;
    throw error;
  }
}

function assertRunState(run, expectedState, event) {
  if (run.state !== expectedState) {
    const error = new Error(`Event ${event} is not allowed while run is in state ${run.state}.`);
    error.statusCode = 409;
    throw error;
  }
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    const error = new Error(`${field} must be a non-empty string up to 200 characters.`);
    error.statusCode = 400;
    throw error;
  }
}

function externalContext(body) {
  return {
    consentToShareItinerary: body.consentToShareItinerary === true &&
      process.env.ALLOW_EXTERNAL_TRAVEL_API === "true"
  };
}

function assertLocalMutationRequest(request) {
  const origin = request.headers.origin;
  if (origin) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      const error = new Error("Invalid request origin.");
      error.statusCode = 403;
      throw error;
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      const error = new Error("Cross-origin requests are not allowed.");
      error.statusCode = 403;
      throw error;
    }
  }
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.statusCode = 415;
    throw error;
  }
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) {
      const error = new Error(`JSON request body exceeds ${MAX_JSON_BYTES} bytes.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_error) {
    const error = new Error("Request body must contain valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendFile(response, file, contentType) {
  if (!fs.existsSync(file)) {
    sendJson(response, 404, { error: "File not found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(fs.readFileSync(file));
}

module.exports = {
  server,
  route
};
