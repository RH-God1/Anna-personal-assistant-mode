import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const APP_SPECS = [
  {
    slug: "personal-assistant-mode",
    label: "Anna 个人助理模式",
    verify: verifyPersonalAssistant
  },
  {
    slug: "private-travel-agent",
    label: "隐私旅行代理",
    verify: verifyTravelAgent
  }
];

async function main() {
  const account = await loadCurrentAccount();
  const client = createClient(account);
  const summary = [];

  for (const spec of APP_SPECS) {
    const app = await findDeveloperAppBySlug(client, spec.slug);
    if (!app) {
      throw new Error(`Developer app not found: ${spec.slug}`);
    }

    log(`\n==> ${spec.label} (${spec.slug})`);
    const install = await ensureDeveloperInstall(client, app);
    const session = await openRuntimeWindow(client, app.id);

    try {
      const hello = await rpc(client, session, "window", "hello", {});
      await rpc(client, session, "window", "ready", {});
      const tools = await rpc(client, session, "tools", "list", {});
      const result = await spec.verify({
        app,
        hello,
        session,
        tools
      }, client);
      summary.push({
        slug: spec.slug,
        app_id: app.id,
        install,
        window_uuid: session.windowUuid,
        tools: tools.tools.map(({ tool_id: toolId }) => toolId),
        checks: result.checks
      });
      log(`   ok: ${result.checks.join(" | ")}`);
    } finally {
      await closeWindow(client, session).catch(() => {});
    }
  }

  log("\nAnna real runtime smoke passed for all installed apps.");
  console.log(JSON.stringify({
    host: account.host,
    verified_at: new Date().toISOString(),
    apps: summary
  }, null, 2));
}

async function verifyPersonalAssistant(context, client) {
  const toolId = singleToolId(context.tools, context.app.slug);
  const checks = [];

  const status = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "status"
  });
  assertEqual(status.service, "anna-personal-assistant", "assistant service id");
  checks.push("status");

  const preflight = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "preflight",
    first_use: true,
    weather_demo: true,
    location: {
      latitude: 31.23,
      longitude: 121.474,
      label: "上海"
    }
  });
  assertEqual(preflight.mode, "personal_assistant_preflight", "assistant preflight mode");
  assertEqual(preflight.context.permissions.health, "requested", "assistant health permission request");
  checks.push("preflight");

  const writing = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "assist",
    message: "请帮我把今天剩余的工作整理成一个三步收尾计划。"
  });
  assertEqual(writing.route.intent, "writing", "assistant writing intent");
  assertEqual(writing.route.selected_model.id, "qwen-plus", "assistant writing route");
  checks.push("writing-route");

  const companion = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "assist",
    message: "我有点焦虑，不知道怎么和同事开口聊这件事。"
  });
  assertEqual(companion.route.intent, "companion", "assistant companion intent");
  assertEqual(companion.route.selected_model.id, "minimax-m2-7", "assistant companion route");
  checks.push("companion-route");

  const weather = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "weather",
    latitude: 31.23,
    longitude: 121.474,
    label: "上海"
  });
  assertEqual(weather.source, "Open-Meteo", "assistant weather provider");
  checks.push("weather-live");

  const healthConnect = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "health_connect_demo",
    consent: true
  });
  const healthSessionId = healthConnect.session_id;
  assertTruthy(healthSessionId, "assistant health session id");

  const healthAssist = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "assist",
    message: "请结合我的健康情况提醒我今天收工前注意什么。",
    health_session_id: healthSessionId
  });
  assertEqual(healthAssist.route.intent, "health", "assistant health intent");
  assertEqual(healthAssist.route.selected_model.id, "anna-auto", "assistant health host route");
  checks.push("health-route");

  const hotel = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "travel_search",
    search: {
      product: "hotel",
      destination: "Hangzhou",
      departureDate: "2026-07-02"
    }
  });
  assertEqual(hotel.offers?.[0]?.product, "hotel", "assistant hotel product");
  assertEqual(hotel.offers?.[0]?.can_auto_book, false, "assistant travel no auto book");
  checks.push("travel-hotel");

  const healthDisconnect = await invokeTool(client, context.session, toolId, "personal_assistant", {
    action: "health_disconnect",
    session_id: healthSessionId
  });
  assertEqual(healthDisconnect.disconnected, true, "assistant health disconnect");
  checks.push("health-disconnect");

  return { checks };
}

async function verifyTravelAgent(context, client) {
  const toolId = singleToolId(context.tools, context.app.slug);
  const checks = [];

  const searched = await invokeTool(client, context.session, toolId, "travel_agent", {
    action: "search",
    provider: "sandbox",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengers: { adults: 1 }
    }
  });
  assertEqual(searched.provider, "sandbox", "travel search provider");
  assertTruthy(searched.offers?.[0]?.id, "travel offer id");
  checks.push("search");

  const started = await invokeTool(client, context.session, toolId, "travel_agent", {
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
  assertEqual(started.state, "await_traveler_info", "travel start state");
  checks.push("start-run");

  const travelerInfo = await invokeTool(client, context.session, toolId, "travel_agent", {
    action: "continue",
    run_id: started.id,
    event: "traveler_info_completed"
  });
  assertEqual(travelerInfo.state, "await_payment", "travel traveler gate");
  checks.push("traveler-gate");

  const payment = await invokeTool(client, context.session, toolId, "travel_agent", {
    action: "continue",
    run_id: started.id,
    event: "payment_completed"
  });
  assertEqual(payment.state, "post_payment", "travel payment gate");
  checks.push("payment-gate");

  const blocked = await invokeToolRaw(client, context.session, toolId, "travel_agent", {
    action: "start_run",
    product: "flight",
    provider: "sandbox",
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passenger_name: "Blocked Example"
    }
  });
  assertEqual(blocked.success, false, "travel pii block");
  checks.push("pii-block");

  const official = await invokeTool(client, context.session, toolId, "travel_agent", {
    action: "start_run",
    product: "hotel",
    provider: "official-handoff",
    search: {
      product: "hotel",
      destination: "Hangzhou",
      departureDate: "2026-07-02",
      passengers: { adults: 1 }
    }
  });
  assertEqual(official.state, "await_user_confirmation", "travel official handoff confirmation");
  assertEqual(official.next_gate, "user_booking_confirmation", "travel official handoff gate");
  checks.push("official-handoff");

  return { checks };
}

async function loadCurrentAccount() {
  const file = path.join(homedir(), ".config", "anna", "credentials.json");
  const raw = JSON.parse(await readFile(file, "utf8"));
  const current = raw.current;
  if (!current || !raw.accounts?.[current]?.pat) {
    throw new Error("No current Anna CLI account found. Run `anna-app login` first.");
  }
  return {
    host: current,
    pat: raw.accounts[current].pat
  };
}

function createClient(account) {
  return {
    host: account.host.replace(/\/$/, ""),
    pat: account.pat
  };
}

async function findDeveloperAppBySlug(client, slug) {
  const response = await requestJson(client, "GET", "/api/v1/developer/apps", {
    query: { slug }
  });
  return Array.isArray(response) ? response[0] || null : null;
}

async function ensureDeveloperInstall(client, app) {
  const before = await getGrant(client, app.id);
  if (before?.installed_version) {
    return {
      mode: "already-installed",
      installed_version: before.installed_version
    };
  }

  const install = await requestJson(client, "POST", `/api/v1/developer/apps/${app.id}/install`);
  if (Array.isArray(install.failed_executas) && install.failed_executas.length > 0) {
    throw new Error(`${app.slug} install failed executas: ${JSON.stringify(install.failed_executas)}`);
  }
  const after = await getGrant(client, app.id);
  if (!after?.installed_version) {
    throw new Error(`${app.slug} install did not produce an installed_version grant`);
  }
  return {
    mode: "developer-install",
    installed_version: after.installed_version
  };
}

async function getGrant(client, appId) {
  return requestJson(client, "GET", `/api/v1/apps/${appId}/grants`, {
    allowStatuses: [404]
  });
}

async function openRuntimeWindow(client, appId) {
  const windowData = await requestJson(client, "POST", "/api/v1/anna-apps/runtime/windows", {
    body: { app_id: appId }
  });
  const bundleUrl = new URL(windowData.bundle_url, client.host);
  const token = windowData.token || bundleUrl.searchParams.get("t");
  if (!token) throw new Error(`runtime window for app ${appId} did not return a token`);
  return {
    windowUuid: windowData.window_uuid,
    token
  };
}

async function closeWindow(client, session) {
  await requestJson(client, "DELETE", `/api/v1/anna-apps/runtime/windows/${session.windowUuid}`, {
    headers: { "X-Anna-App-Token": session.token },
    allowStatuses: [200, 204, 404]
  });
}

async function rpc(client, session, ns, method, args) {
  const response = await requestJson(client, "POST", "/api/v1/anna-apps/runtime/rpc", {
    body: {
      id: randomUUID(),
      window_uuid: session.windowUuid,
      ns,
      method,
      args
    },
    headers: { "X-Anna-App-Token": session.token }
  });
  if (response.error) {
    throw new Error(`${ns}.${method} failed: ${response.error.code || "runtime_error"} ${response.error.message || ""}`.trim());
  }
  return response.result;
}

async function invokeTool(client, session, toolId, method, args) {
  const payload = await invokeToolRaw(client, session, toolId, method, args);
  if (payload.success !== true) {
    throw new Error(`tool ${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.data ?? payload.result ?? payload;
}

async function invokeToolRaw(client, session, toolId, method, args) {
  const result = await rpc(client, session, "tools", "invoke", {
    tool_id: toolId,
    method,
    args,
    timeoutMs: 30_000
  });
  return result.result ?? result;
}

function singleToolId(tools, slug) {
  if (!Array.isArray(tools.tools) || tools.tools.length !== 1) {
    throw new Error(`${slug} expected exactly one runtime tool`);
  }
  return tools.tools[0].tool_id;
}

async function requestJson(client, method, requestPath, {
  body,
  headers,
  query,
  allowStatuses = []
} = {}) {
  const url = new URL(client.host + requestPath);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${client.pat}`,
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const parsed = text ? tryJson(text) : null;
  if (!response.ok && !allowStatuses.includes(response.status)) {
    throw new Error(`${method} ${requestPath} failed (${response.status}): ${stringifyErrorBody(parsed)}`);
  }
  return parsed;
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringifyErrorBody(value) {
  if (typeof value === "string") return value.slice(0, 300);
  if (value && typeof value === "object") {
    if (typeof value.detail === "string") return value.detail;
    return JSON.stringify(value).slice(0, 300);
  }
  return String(value);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value`);
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
