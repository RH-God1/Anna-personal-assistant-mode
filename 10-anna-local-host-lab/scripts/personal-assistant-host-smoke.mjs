import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../01-private-travel-booking-agent/node_modules/playwright/index.mjs";
import { createLocalAnnaHost } from "../src/host.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || "json";
const outFile = options.out || null;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const externalTimeoutMs = Number(process.env.ANNA_HOST_HANDOFF_TIMEOUT_MS || 20000);

const host = createLocalAnnaHost();
let browser;
try {
  const base = await host.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expectText(page, "body", "Anna Host");

  await page.locator('[data-app="personal-assistant-mode"]').click();
  const frame = page.frameLocator("#appFrame");
  await expectText(frame, "#connectionStatus", "已连接 Anna");
  await expectText(page, "#auditList", "window.create / ok");

  const pushedHealth = await pushCompanionHealthSnapshot(host, base);
  await frame.locator("#healthConsent").check();
  await frame.locator("#healthConnectButton").click();
  await expectText(frame, "#healthBadge", "已连接 · Companion");
  const healthUi = await frame.locator("body").evaluate(() => ({
    badge: document.querySelector("#healthBadge")?.textContent,
    steps: document.querySelector("#stepCount")?.textContent,
    heart: document.querySelector("#heartRate")?.textContent,
    sleep: document.querySelector("#sleepValue")?.textContent
  }));
  assert.equal(healthUi.steps, "7340");
  assert.equal(healthUi.heart, "83");
  assert.equal(healthUi.sleep, "6h 38m");

  const defaultFlight = await planTravel(frame, {
    expectedSite: "Expedia Flights",
    expectedFieldMode: "已写入官方搜索链接"
  });

  await frame.locator("#travelProduct").selectOption("hotel");
  await frame.locator("#travelOfficialSite").selectOption("trip");
  const tripHotel = await planTravel(frame, {
    expectedSite: "Trip.com Hotels",
    expectedFieldMode: "需要用户手动输入"
  });

  const naturalLanguageBundle = await inferTravelBundle(page, frame);

  await frame.locator("#messageInput").fill("结合刚才的健康数据和东京行程，提醒我接管边界");
  await frame.locator("#sendButton").click();
  await expectText(frame, "#assistantOutput", "单次读数不能说明健康状态");
  const assistantSummary = await frame.locator("#assistantOutput").innerText();

  const audit = await fetchJson(`${base}/api/audit?limit=80`, host.adminToken);
  const status = await fetchJson(`${base}/api/status`, host.adminToken);
  assert.ok(audit.entries.some((entry) => entry.app === "personal-assistant-mode" &&
    entry.namespace === "tools" &&
    entry.method === "invoke" &&
    entry.outcome === "ok"));

  const summary = {
    scenario: "anna-local-host-personal-assistant-smoke",
    generated_at: new Date().toISOString(),
    generated_at_shanghai: formatShanghaiTime(new Date()),
    host_url: base,
    host_privacy_mode: status.privacy_mode,
    active_apps: status.apps.map((app) => app.slug),
    health: healthUi,
    pushed_health: pushedHealth,
    assistant_summary: truncate(assistantSummary, 240),
    travel: [defaultFlight, tripHotel],
    natural_language_bundle: naturalLanguageBundle,
    audit: {
      entries: audit.entries.length,
      personal_assistant_tool_calls: audit.entries.filter((entry) => (
        entry.app === "personal-assistant-mode" &&
        entry.namespace === "tools" &&
        entry.method === "invoke"
      )).length,
      contains_argument_values: auditContainsArgumentValues(audit.entries)
    },
    boundaries: [
    "This smoke runs the personal assistant inside Anna Local Host Lab.",
    "Host audit remains metadata-only and records keys rather than payload values.",
    "The Host iframe proves Anna-run handoff generation and user-triggered external popup loading.",
    "The assistant does not collect traveler identity, confirm orders, or pay."
    ]
  };
  assert.equal(summary.audit.contains_argument_values, false);

  await page.close();
  const rendered = format === "markdown"
    ? renderMarkdown(summary)
    : JSON.stringify(summary, null, 2);
  if (outFile) {
    const absolute = path.resolve(outFile);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `${rendered}\n`);
    console.log(`Wrote ${absolute}`);
  } else {
    console.log(rendered);
  }
} finally {
  if (browser) await browser.close();
  await host.close();
}

async function planTravel(frame, { expectedSite, expectedFieldMode }) {
  await frame.locator("#travelPlanButton").click();
  await expectText(frame, "#travelStatus", "等待用户确认");
  await expectText(frame, "#travelBoundary", "等待你确认");
  await expectText(frame, "#travelSite", expectedSite);
  await expectText(frame, "#travelFieldMode", expectedFieldMode);
  await frame.locator("#travelConfirmButton").click();
  await expectText(frame, "#travelStatus", "等待订购授权");
  await frame.locator("#travelConfirmButton").click();
  await expectText(frame, "#travelStatus", "等待外站接管");
  const result = await frame.locator("body").evaluate(() => ({
    status: document.querySelector("#travelStatus")?.textContent,
    site: document.querySelector("#travelSite")?.textContent,
    route: document.querySelector("#travelRoute")?.textContent,
    link: document.querySelector("#travelLink")?.href,
    field_mode: document.querySelector("#travelFieldMode")?.textContent,
    field_values: Object.fromEntries(Array.from(document.querySelectorAll("#travelFieldList dt")).map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent || ""
    ])),
    boundary: document.querySelector("#travelBoundary")?.textContent
  }));
  assert.equal(result.status, "等待外站接管");
  assert.equal(result.site, expectedSite);
  assert.equal(result.field_mode, expectedFieldMode);
  assert.equal(new URL(result.link).protocol, "https:");
  assert.match(result.boundary, /旅客身份|付款/);
  return {
    site: result.site,
    route: result.route,
    link_host: new URL(result.link).host,
    field_mode: result.field_mode,
    destination: result.field_values["目的地 / 城市"],
    adults: result.field_values["成人"],
    status: result.status
  };
}

async function fetchJson(url, adminToken) {
  const response = await fetch(url, {
    headers: { "X-Anna-Admin-Token": adminToken }
  });
  assert.equal(response.ok, true);
  return response.json();
}

async function expectText(scope, selector, text) {
  await scope.locator(selector).waitFor({ state: "visible" });
  await scope.locator(selector).filter({ hasText: text }).first().waitFor();
}

function auditContainsArgumentValues(entries) {
  const serialized = JSON.stringify(entries);
  return /SHA|NRT|Tokyo|passport|phone|email|card|cvv|姓名|身份证|手机号/i.test(serialized);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      parsed.format = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      parsed.out = argv[index + 1];
      index += 1;
    }
  }
  if (parsed.format && !["json", "markdown"].includes(parsed.format)) {
    throw new Error("--format must be json or markdown");
  }
  return parsed;
}

function renderMarkdown(result) {
  const rows = result.travel.map((item) => [
    item.site,
    item.route,
    item.link_host,
    item.field_mode,
    item.destination,
    item.adults,
    item.status
  ]);
  return [
    "# Anna Host 个人助理 Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- Anna Local Host Lab 中的个人助理 App 可连接 Host SDK，并通过真实 Executa 触发 HealthKit 同意门与旅行 handoff。",
    "- Host iframe 内可见匿名字段包；默认 Expedia Flights 深链和 Trip.com Hotels 入口型接管均可生成。",
    "- Host iframe 内也可从自然语言请求生成机票+酒店组合候选，酒店项包含入住、退房和晚数，确认后才打开外站。",
    "- Host 审计保持 metadata-only：记录工具调用键名，不记录行程字段值、页面文本、订单号或 PII。",
    "",
    "## Host 运行结果",
    "",
    `- Host privacy mode：${result.host_privacy_mode}`,
    `- 活跃 App：${result.active_apps.join(" / ")}`,
    `- 健康状态：${result.health.badge}`,
    `- Companion 快照：今日步数 ${result.health.steps}，心率 ${result.health.heart} bpm，睡眠 ${result.health.sleep}`,
    `- Companion 来源：${result.pushed_health.snapshot.source}`,
    `- 助理回复摘要：${result.assistant_summary}`,
    `- personal-assistant 工具调用审计数：${result.audit.personal_assistant_tool_calls}`,
    `- 审计是否包含参数值：${result.audit.contains_argument_values}`,
    "",
    "## 旅行接管",
    "",
    "| 平台 | 行程 | 链接域名 | 字段方式 | 目的地/城市 | 成人 | 状态 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "## 自然语言组合接管",
    "",
    `- 状态：${result.natural_language_bundle.status}`,
    `- 主平台：${result.natural_language_bundle.site}`,
    `- 主行程：${result.natural_language_bundle.route}`,
    `- 酒店项：${result.natural_language_bundle.hotel_item}`,
    `- 组合项数量：${result.natural_language_bundle.bundle_items.length}`,
    "",
    "## Host 外站打开",
    "",
    "| 产品 | 平台 | 本地链接域名 | 外站域名 | 到达目标域 | 外站打开后状态 | 测试终点 | 加载 | 分类 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...result.natural_language_bundle.external_openings.map((item) => `| ${[
      item.product,
      item.site,
      item.local_link_host,
      item.external.url_host,
      item.external.reached_expected_host ? "yes" : "no",
      item.local_status_after_open,
      item.local_terminal_status,
      item.external.load_state,
      item.external.classification
    ].map(escapeCell).join(" | ")} |`),
    "",
    "## 边界",
    "",
    "- 该 smoke 在 Anna Host iframe 中验证个人助理主体、Host RPC、用户确认门和用户触发的外站新页。",
    "- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。",
    "- 不确认订单、不付款、不保存页面文本、订单号或支付信息。"
  ].join("\n");
}

async function pushCompanionHealthSnapshot(host, base) {
  const assistantWindow = [...host.windows.values()].find((window_) => window_.appSlug === "personal-assistant-mode");
  assert.ok(assistantWindow);
  const app = host.registry.apps.get("personal-assistant-mode");
  const result = await rpcWindow(base, host.getWindowToken(assistantWindow.id), {
    namespace: "tools",
    method: "invoke",
    args: {
      tool_id: app.toolIds["personal-assistant"],
      method: "personal_assistant",
      args: {
        action: "healthkit_push_snapshot",
        companion_consent: true,
        snapshot: {
          observed_at: new Date().toISOString(),
          today_steps: 7340,
          heart_rate_bpm: 83,
          sleep_minutes_last_night: 398,
          sleep_source: "Apple Watch",
          source: "Anna iOS HealthKit Companion host smoke"
        }
      }
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.data.bridge_kind, "ios-watchos-companion");
  assert.equal(result.data.snapshot.today_steps, 7340);
  assert.equal(result.data.snapshot.heart_rate_bpm, 83);
  return result.data;
}

async function rpcWindow(base, appToken, payload) {
  const response = await fetch(`${base}/api/runtime/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "null",
      "X-Anna-App-Token": appToken
    },
    body: JSON.stringify(payload)
  });
  const value = await response.json();
  assert.equal(response.ok, true);
  return value.result;
}

async function inferTravelBundle(page, frame) {
  await frame.locator("#messageInput").fill("帮我用官方网页接管上海到东京机票和东京酒店，2026-08-12，住2晚，1人，先不要付款");
  await frame.locator("#sendButton").click();
  await expectText(frame, "#travelBundleSummary", "机票");
  await expectText(frame, "#travelBundleSummary", "酒店");
  await expectText(frame, "#travelBundleSummary", "2026-08-14");
  await expectText(frame, "#travelStatus", "等待用户确认");
  const result = await frame.locator("body").evaluate(() => {
    const bundleItems = Array.from(document.querySelectorAll("#travelBundleSummary div")).map((item) => (
      Array.from(item.children).map((child) => child.textContent).join(" · ")
    ));
    return {
      status: document.querySelector("#travelStatus")?.textContent,
      site: document.querySelector("#travelSite")?.textContent,
      route: document.querySelector("#travelRoute")?.textContent,
      link: document.querySelector("#travelLink")?.href,
      field_mode: document.querySelector("#travelFieldMode")?.textContent,
      field_values: Object.fromEntries(Array.from(document.querySelectorAll("#travelFieldList dt")).map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent || ""
      ])),
      bundle_items: bundleItems
    };
  });
  assert.equal(result.status, "等待用户确认");
  assert.equal(result.site, "Expedia Flights");
  assert.equal(new URL(result.link).host, "www.expedia.com");
  assert.equal(result.field_values["目的地 / 城市"], "NRT");
  const hotelItem = result.bundle_items.find((item) => /酒店/.test(item)) || "";
  assert.match(hotelItem, /Tokyo/);
  assert.match(hotelItem, /2026-08-14/);
  assert.match(hotelItem, /2晚/);
  const externalOpenings = [];
  externalOpenings.push(await openBundleExternal(page, frame, {
    product: "flight",
    site: "Expedia Flights",
    expectedHost: "www.expedia.com"
  }));
  externalOpenings.push(await openBundleExternal(page, frame, {
    product: "hotel",
    site: "Booking.com",
    expectedHost: "www.booking.com"
  }));
  return {
    status: result.status,
    site: result.site,
    route: result.route,
    link_host: new URL(result.link).host,
    field_mode: result.field_mode,
    destination: result.field_values["目的地 / 城市"],
    bundle_items: result.bundle_items,
    hotel_item: hotelItem,
    external_openings: externalOpenings
  };
}

async function openBundleExternal(page, frame, config) {
  const link = frame.locator(`#travelBundleSummary [data-bundle-product="${config.product}"]`).first();
  await link.waitFor({ state: "visible" });
  const href = await link.getAttribute("href");
  assert.ok(href);
  assert.equal(new URL(href).host, config.expectedHost);
  await link.click();
  await expectText(frame, "#travelStatus", "等待订购授权");
  await link.click();
  await expectText(frame, "#travelStatus", "等待外站接管");
  await expectText(frame, "#travelSite", config.site);
  const popupPromise = page.context().waitForEvent("page", { timeout: externalTimeoutMs })
    .then((popup) => ({ popup, fallback: false }))
    .catch((error) => {
      if (error.name !== "TimeoutError") throw error;
      return null;
    });
  await link.click();
  const captured = await popupPromise;
  const popup = captured?.popup || await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (!captured) {
    await popup.goto(href, { waitUntil: "domcontentloaded", timeout: externalTimeoutMs }).catch(() => {});
  }
  const external = await inspectExternalPopup(popup, config.expectedHost);
  await expectText(frame, "#travelStatus", "等待用户填写资料");
  await expectText(frame, "#travelSite", config.site);
  const local = await frame.locator("body").evaluate(() => ({
    status: document.querySelector("#travelStatus")?.textContent,
    site: document.querySelector("#travelSite")?.textContent
  }));
  assert.equal(local.status, "等待用户填写资料");
  assert.equal(local.site, config.site);
  await frame.locator("#travelConfirmButton").click();
  await expectText(frame, "#travelStatus", "等待付款交接");
  await frame.locator("#travelConfirmButton").click();
  await expectText(frame, "#travelStatus", "payment_handoff");
  const terminalStatus = await frame.locator("#travelStatus").textContent();
  await popup.close().catch(() => {});
  return {
    product: config.product === "flight" ? "机票" : "酒店",
    site: config.site,
    local_link_host: new URL(href).host,
    local_status_after_open: local.status,
    local_terminal_status: terminalStatus,
    external_open_fallback: captured ? "captured_popup" : "manual_new_page_after_click_timeout",
    external
  };
}

async function inspectExternalPopup(popup, expectedHost) {
  const reach = await waitForPopupHostOrError(popup, expectedHost);
  const load = await popup.waitForLoadState("domcontentloaded", { timeout: externalTimeoutMs })
    .then(() => "domcontentloaded")
    .catch((error) => error.name === "TimeoutError" ? "timeout" : "load_error");
  await popup.waitForTimeout(500).catch(() => {});
  const url = popup.url();
  const parsed = safeUrl(url);
  const title = await popup.title().catch(() => "");
  const body = await popup.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  return {
    url_host: parsed?.host || parsed?.protocol || "unavailable",
    reached_expected_host: reach.reachedExpectedHost,
    load_state: load,
    classification: classifyExternalPage({ load, title, body, reachedExpectedHost: reach.reachedExpectedHost })
  };
}

async function waitForPopupHostOrError(popup, expectedHost) {
  const deadline = Date.now() + externalTimeoutMs;
  let lastUrl = popup.url();
  while (Date.now() < deadline) {
    lastUrl = popup.url();
    const parsed = safeUrl(lastUrl);
    if (parsed?.protocol === "https:" && parsed.host === expectedHost) {
      return { reachedExpectedHost: true, lastUrl };
    }
    if (parsed?.protocol === "chrome-error:") {
      return { reachedExpectedHost: false, lastUrl };
    }
    await popup.waitForTimeout(100);
  }
  return { reachedExpectedHost: false, lastUrl };
}

function classifyExternalPage({ load, title, body, reachedExpectedHost }) {
  const text = `${title}\n${body}`;
  if (/not a robot|captcha|challenge|awswaf|waf|verify you are human|enable javascript/i.test(text)) {
    return "human_challenge";
  }
  if (!reachedExpectedHost || load === "timeout") return "network_or_timeout";
  return "browser_reached_external_site";
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatShanghaiTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
