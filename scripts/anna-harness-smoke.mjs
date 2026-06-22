import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliVersion = "0.1.30";
const commonEnv = {
  ...process.env,
  PATH: [path.join(os.homedir(), ".local", "bin"), process.env.PATH || ""]
    .filter(Boolean)
    .join(path.delimiter)
};
const personalAssistantToolId = readToolId(
  "08-personal-assistant-anna-app/executas/personal-assistant-node/executa.json"
);

const targets = [
  {
    project: "02-bilingual-focus-flow",
    archived: true,
    bundleMarker: "双语 Focus Flow",
    expectedExecuta: "tool-test-focus-session-12345678",
    async check(base, sessionId) {
      const state = await sessionCall(base, sessionId, "tools", "invoke", {
        tool_id: "tool-test-focus-session-12345678",
        method: "session",
        args: { action: "get_state" }
      });
      if (!state.today || typeof state.today.focused_seconds !== "number") {
        throw new Error("Focus Flow session tool returned an unexpected payload.");
      }
      const write = await sessionCall(base, sessionId, "chat", "write_message", {
        role: "user",
        content: "smoke: focus"
      });
      if (!write.message_id) throw new Error("Focus Flow chat.write_message did not return message_id.");
    }
  },
  {
    project: "04-travel-agent-anna-app",
    bundleMarker: "隐私旅行代理",
    expectedExecuta: "tool-test-private-travel-agent-12345678",
    async check(base, sessionId) {
      const result = await sessionCall(base, sessionId, "tools", "invoke", {
        tool_id: "tool-test-private-travel-agent-12345678",
        method: "travel_agent",
        args: {
          action: "start_run",
          product: "rail",
          provider: "sandbox",
          search: {
            product: "rail",
            origin: "SHA",
            destination: "BJS",
            departureDate: "2026-07-01"
          }
        }
      });
      if (result.state !== "await_traveler_info") {
        throw new Error(`Travel Agent unexpected state: ${result.state || "unknown"}`);
      }
    }
  },
  {
    project: "08-personal-assistant-anna-app",
    bundleMarker: "个人助理模式",
    expectedExecuta: personalAssistantToolId,
    async check(base, sessionId) {
      const result = await sessionCall(base, sessionId, "tools", "invoke", {
        tool_id: personalAssistantToolId,
        method: "personal_assistant",
        args: {
          action: "assist",
          message: "我在两个选择之间纠结，请帮我区分事实、预测和代价",
          preferred_model: "anna-auto"
        }
      });
      if (result.route?.intent !== "decision") {
        throw new Error(`Assistant unexpected route: ${result.route?.intent || "unknown"}`);
      }
      const travel = await sessionCall(base, sessionId, "tools", "invoke", {
        tool_id: personalAssistantToolId,
        method: "personal_assistant",
        args: {
          action: "travel_search",
          search: {
            product: "hotel",
            destination: "Hangzhou",
            departureDate: "2026-07-02"
          }
        }
      });
      if (travel.offers?.[0]?.product !== "hotel" || travel.offers[0].can_auto_book !== false) {
        throw new Error("Assistant travel_search did not return a privacy-gated hotel offer.");
      }
      const write = await sessionCall(base, sessionId, "chat", "write_message", {
        role: "user",
        content: "smoke: assistant"
      });
      if (!write.message_id) throw new Error("Assistant chat.write_message did not return message_id.");
    }
  }
];

function readToolId(relativePath) {
  const filePath = path.join(root, relativePath);
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value.tool_id) throw new Error(`${relativePath} is missing tool_id.`);
  return value.tool_id;
}

const requested = process.argv.slice(2);
const selected = requested.length === 0
  ? targets.filter((target) => !target.archived)
  : targets.filter((target) => requested.includes(target.project));

if (selected.length === 0) {
  console.error(`No known Anna harness smoke targets matched: ${requested.join(", ")}`);
  process.exit(1);
}

await runSimple(
  "doctor",
  ["--yes", `@anna-ai/cli@${cliVersion}`, "doctor"],
  root
);

for (const target of selected) {
  await smokeTarget(target);
}

console.log(`Anna harness smoke passed for ${selected.map((item) => item.project).join(", ")}.`);

async function smokeTarget(target) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await smokeTargetOnce(target);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2 && isRetryableBridgeColdStart(error)) {
        console.warn(`${target.project} anna-app dev bridge cold-start timed out; retrying once.`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function smokeTargetOnce(target) {
  const projectDir = path.join(root, target.project);
  const port = await freePort();
  const child = spawn(
    "npx",
    ["--yes", `@anna-ai/cli@${cliVersion}`, "dev", "--no-llm", "--no-watch", "--port", String(port)],
    {
      cwd: projectDir,
      env: commonEnv,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  try {
    await waitForDashboard(child, () => output, port, target.project);
    const base = `http://127.0.0.1:${port}`;
    const config = await fetchJson(`${base}/api/config`);
    if (!Array.isArray(config.executas) || !config.executas.includes(target.expectedExecuta)) {
      throw new Error(`${target.project} did not expose expected executa ${target.expectedExecuta}.`);
    }
    if (typeof config.bundle_base !== "string" || !config.bundle_base.startsWith("/anna-apps/")) {
      throw new Error(`${target.project} returned an invalid bundle_base.`);
    }

    const session = await fetchJson(`${base}/api/session/create`, { method: "POST" });
    if (!session.session_id || !session.window_uuid || !session.token) {
      throw new Error(`${target.project} session create response is incomplete.`);
    }

    const bundle = await fetchText(
      `${base}${config.bundle_base}?wid=${encodeURIComponent(session.window_uuid)}&t=${encodeURIComponent(session.token)}`
    );
    if (!bundle.includes(target.bundleMarker)) {
      throw new Error(`${target.project} bundle did not contain marker ${target.bundleMarker}.`);
    }

    const refreshed = await fetchJson(`${base}/api/session/refresh-token`, { method: "POST" });
    if (!refreshed.token || typeof refreshed.token !== "string") {
      throw new Error(`${target.project} refresh-token did not return a token.`);
    }

    await target.check(base, session.session_id);
  } finally {
    child.kill("SIGINT");
    await Promise.race([
      once(child, "exit").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
    if (!child.killed) child.kill("SIGKILL");
  }
}

function isRetryableBridgeColdStart(error) {
  const message = String(error?.message || error);
  return /bridge failed to start|bridge did not signal ready|uvx anna-app-runtime-local/i.test(message);
}

async function sessionCall(base, sessionId, ns, method, args) {
  const body = await fetchJson(`${base}/api/session/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      ns,
      method,
      args
    })
  });
  if (body.ok !== true) {
    const code = body.error?.code || "unknown";
    const message = body.error?.message || "unknown session call failure";
    throw new Error(`Session call ${ns}.${method} failed: ${code} ${message}`);
  }
  return body.result;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${JSON.stringify(value)}`);
  }
  return value;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function waitForDashboard(child, getOutput, port, project) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${project} anna-app dev exited early:\n${getOutput()}`);
    }
    if (getOutput().includes(`dashboard http://localhost:${port}/`)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${project} anna-app dev did not report a dashboard in time:\n${getOutput()}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function runSimple(label, args, cwd) {
  const child = spawn("npx", args, {
    cwd,
    env: commonEnv,
    stdio: "inherit"
  });
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`anna-app ${label} failed with exit code ${code}`);
  }
}
