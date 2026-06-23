import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAssistantService } from "./src/service.js";
import { createMutableHealthKitProvider } from "./src/health-store.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDir, "..");
const pythonAgentRoot = path.join(workspaceRoot, "services", "agent-server", "python_agent");
const root = path.join(appDir, "bundle");
const matrixProcesses = new Map();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const matrixCommands = {
  "controlled-api.build": {
    label: "Build controlled Node backend",
    description: "Run the pnpm workspace build for the controlled assistant backend.",
    cwd: workspaceRoot,
    command: "corepack",
    args: ["pnpm", "run", "build:controlled-assistant"],
    longRunning: false
  },
  "controlled-api.start": {
    label: "Start controlled Node API",
    description: "Start services/api-server on CONTROLLED_API_PORT, defaulting to 4318.",
    cwd: workspaceRoot,
    command: process.execPath,
    args: ["services/api-server/dist/server.js"],
    env: { CONTROLLED_API_PORT: process.env.CONTROLLED_API_PORT || "4318", DATABASE_URL: process.env.DATABASE_URL || "" },
    longRunning: true
  },
  "python-agent.validate": {
    label: "Validate Python agent config",
    description: "Run validate_config.py for the Python controlled agent.",
    cwd: pythonAgentRoot,
    command: path.join(pythonAgentRoot, ".venv", "bin", "python"),
    args: ["validate_config.py"],
    longRunning: false
  },
  "python-agent.start": {
    label: "Start Python FastAPI agent",
    description: "Start the Python controlled agent on port 8018.",
    cwd: pythonAgentRoot,
    command: path.join(pythonAgentRoot, ".venv", "bin", "uvicorn"),
    args: ["main:app", "--port", process.env.PYTHON_AGENT_PORT || "8018"],
    longRunning: true
  }
};

export function createServer(options = {}) {
  const healthKitProvider = options.healthKitProvider || createMutableHealthKitProvider();
  const healthKitBridgeToken = options.healthKitBridgeToken ?? process.env.HEALTHKIT_BRIDGE_TOKEN;
  const service = createAssistantService({ ...options, healthKitProvider });
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi({
          request,
          response,
          url,
          service,
          healthKitProvider,
          healthKitBridgeToken
        });
        return;
      }
      serveStatic(url.pathname, response);
    } catch (error) {
      json(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "internal server error"
      });
    }
  });
}

async function handleApi({
  request,
  response,
  url,
  service,
  healthKitProvider,
  healthKitBridgeToken
}) {
  if (request.method === "GET" && url.pathname === "/api/status") {
    json(response, 200, service.status());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/matrix/status") {
    json(response, 200, matrixStatus());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/learning/status") {
    json(response, 200, service.learningStatus());
    return;
  }
  if (request.method !== "POST") {
    json(response, 405, { error: "method not allowed" });
    return;
  }
  assertLocalMutationRequest(request);
  if (url.pathname === "/api/healthkit/snapshot") {
    assertHealthKitBridgeToken(request, healthKitBridgeToken);
  }
  const body = await readJson(request);
  const routes = {
    "/api/weather": () => service.weather({
      ...(body.location || body),
      demo: body.demo === true || body.location?.demo === true
    }),
    "/api/preflight": () => service.preflight(body),
    "/api/permissions": () => service.permissionRegistry(body),
    "/api/confirmations/list": () => service.confirmationQueue(body),
    "/api/confirmations/get": () => service.confirmationGet(body),
    "/api/confirmations/resolve": () => service.confirmationResolve(body),
    "/api/health/connect": () => service.connectHealth(body),
    "/api/health/snapshot": () => service.healthSnapshot(body),
    "/api/health/disconnect": () => service.disconnectHealth(body),
    "/api/healthkit/snapshot": () => updateHealthKitSnapshot(healthKitProvider, body),
    "/api/travel/search": () => service.travelSearch(body.travel || body),
    "/api/travel/start": () => service.travelStart(body.travel || body),
    "/api/travel/continue": () => service.travelContinue(body.travel || body),
    "/api/travel/get": () => service.travelGet(body.travel || body),
    "/api/travel/flights/search": () => service.flightSearch(body.travel || body),
    "/api/travel/hotels/search": () => service.hotelSearch(body.travel || body),
    "/api/travel/compare": () => service.travelCompare(body.travel || body),
    "/api/booking/prepare": () => service.bookingPrepare(body.booking || body),
    "/api/booking/confirmation": () => service.bookingGetConfirmation(body.booking || body),
    "/api/booking/confirm": () => service.bookingConfirm(body.booking || body),
    "/api/assistant": () => service.assist(body),
    "/api/learning/cycle": () => service.learningCycle(body.learning || body),
    "/api/matrix/start": () => startMatrixCommand(String(body.command_id || body.commandId || "")),
    "/api/matrix/stop": () => stopMatrixCommand(String(body.command_id || body.commandId || ""))
  };
  const handler = routes[url.pathname];
  if (!handler) {
    json(response, 404, { error: "not found" });
    return;
  }
  try {
    json(response, 200, await handler());
  } catch (error) {
    json(response, error.statusCode || 400, {
      error: error.message || String(error),
      ...(error.code ? { code: error.code } : {}),
      ...(error.resultCode ? { resultCode: error.resultCode } : {})
    });
  }
}

function assertHealthKitBridgeToken(request, expectedToken) {
  if (!expectedToken) return;
  const provided = String(
    request.headers["x-anna-bridge-token"] ||
    String(request.headers.authorization || "").replace(/^Bearer\s+/i, "")
  );
  if (provided !== String(expectedToken)) {
    const error = new Error("healthkit bridge token is required");
    error.statusCode = 403;
    throw error;
  }
}

function updateHealthKitSnapshot(provider, body) {
  if (typeof provider.updateSnapshot !== "function") {
    throw new Error("healthkit provider does not accept pushed snapshots");
  }
  assertHealthKitSnapshot(body);
  return {
    accepted: true,
    snapshot: provider.updateSnapshot(body),
    provider: provider.kind || "custom"
  };
}

function assertHealthKitSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("healthkit snapshot must be an object");
  }
  const devices = Array.isArray(body.device_types) ? body.device_types : ["iphone", "apple_watch"];
  const unsupported = devices.filter((item) => !["iphone", "apple_watch"].includes(String(item)));
  if (unsupported.length > 0) {
    throw new Error(`healthkit snapshot only supports iPhone and Apple Watch: ${unsupported.join(", ")}`);
  }
  for (const key of ["today_steps", "heart_rate_bpm", "sleep_minutes_last_night"]) {
    if (body[key] != null && !Number.isFinite(Number(body[key]))) {
      throw new Error(`${key} must be numeric when present`);
    }
  }
}

function assertLocalMutationRequest(request) {
  const origin = request.headers.origin;
  if (origin) {
    let hostname = "";
    try {
      hostname = new URL(origin).hostname;
    } catch {
      const error = new Error("invalid request origin");
      error.statusCode = 403;
      throw error;
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      const error = new Error("cross-origin requests are not allowed");
      error.statusCode = 403;
      throw error;
    }
  }
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("content-type must be application/json");
    error.statusCode = 415;
    throw error;
  }
}

function serveStatic(pathname, response) {
  const file = safeStaticFile(pathname);
  if (!file) {
    response.writeHead(404, staticHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }
  response.writeHead(200, staticHeaders(
    types[path.extname(file)] || "application/octet-stream"
  ));
  fs.createReadStream(file).pipe(response);
}

function safeStaticFile(pathname) {
  let relative;
  try {
    if (pathname === "/matrix") {
      relative = "matrix.html";
    } else if (pathname === "/") {
      relative = "index.html";
    } else if (pathname.startsWith("/booking/confirm/")) {
      const nestedAsset = decodeURIComponent(pathname.slice("/booking/confirm/".length));
      relative = ["app.js", "anna-tool-ids.js", "icon.svg", "style.css"].includes(nestedAsset)
        ? nestedAsset
        : "index.html";
    } else {
      relative = decodeURIComponent(pathname.slice(1));
    }
  } catch {
    return null;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()) {
    return null;
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
}

function matrixStatus() {
  return {
    commands: Object.fromEntries(Object.entries(matrixCommands).map(([id, command]) => [
      id,
      {
        id,
        label: command.label,
        description: command.description,
        longRunning: command.longRunning,
        running: Boolean(matrixProcesses.get(id)?.running),
        lastExitCode: matrixProcesses.get(id)?.exitCode ?? null,
        output: matrixProcesses.get(id)?.output ?? []
      }
    ]))
  };
}

function startMatrixCommand(commandId) {
  const definition = matrixCommands[commandId];
  if (!definition) {
    const error = new Error("matrix command is not allowlisted");
    error.statusCode = 404;
    throw error;
  }
  const existing = matrixProcesses.get(commandId);
  if (definition.longRunning && existing?.running) {
    return { command_id: commandId, running: true, output: existing.output };
  }

  assertExecutableExists(definition.command);
  const record = {
    command_id: commandId,
    label: definition.label,
    running: true,
    started_at: new Date().toISOString(),
    exitCode: null,
    output: []
  };
  matrixProcesses.set(commandId, record);

  const child = spawn(definition.command, definition.args, {
    cwd: definition.cwd,
    env: { ...process.env, ...(definition.env || {}) },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  record.pid = child.pid;
  record.child = child;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => appendMatrixOutput(record, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendMatrixOutput(record, "stderr", chunk));
  child.on("error", (error) => {
    appendMatrixOutput(record, "error", error.message);
    record.running = false;
    record.exitCode = 1;
    record.finished_at = new Date().toISOString();
  });
  child.on("close", (code) => {
    record.running = false;
    record.exitCode = code ?? 0;
    record.finished_at = new Date().toISOString();
  });

  return summarizeMatrixRecord(record);
}

function stopMatrixCommand(commandId) {
  const record = matrixProcesses.get(commandId);
  if (!record?.running || !record.child) {
    return { command_id: commandId, running: false };
  }
  record.child.kill("SIGTERM");
  appendMatrixOutput(record, "system", "Sent SIGTERM.");
  return summarizeMatrixRecord(record);
}

function appendMatrixOutput(record, stream, chunk) {
  const text = String(chunk).split(/\r?\n/).filter(Boolean);
  for (const line of text) {
    record.output.push({ at: new Date().toISOString(), stream, line: line.slice(0, 2000) });
  }
  if (record.output.length > 80) {
    record.output.splice(0, record.output.length - 80);
  }
}

function summarizeMatrixRecord(record) {
  return {
    command_id: record.command_id,
    label: record.label,
    running: record.running,
    pid: record.pid,
    started_at: record.started_at,
    finished_at: record.finished_at,
    exitCode: record.exitCode,
    output: record.output
  };
}

function assertExecutableExists(command) {
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    const error = new Error(`matrix command executable is missing: ${command}`);
    error.statusCode = 400;
    throw error;
  }
}

function staticHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 128 * 1024) {
        tooLarge = true;
        body = "";
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("request body exceeds 128 KiB");
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("invalid JSON");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

const server = createServer();
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8808);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Anna Personal Assistant Mode: http://${host}:${port}`);
    if (host !== "127.0.0.1" && host !== "localhost" && !process.env.HEALTHKIT_BRIDGE_TOKEN) {
      console.warn("HEALTHKIT_BRIDGE_TOKEN is recommended when exposing the bridge beyond localhost.");
    }
  });
}

export { server };
