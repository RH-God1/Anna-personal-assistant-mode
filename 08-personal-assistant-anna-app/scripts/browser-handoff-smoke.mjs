import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "../../01-private-travel-booking-agent/node_modules/playwright/index.mjs";
import { createServer } from "../server.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || "json";
const outFile = options.out || null;
const externalTimeoutMs = Number(process.env.ANNA_BROWSER_HANDOFF_TIMEOUT_MS || 20000);

const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");

let browser;
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1365, height: 920 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#healthConsent").check();
  await page.locator("#healthConnectButton").click();
  await expectText(page, "#healthBadge", "已连接");

  const runs = [];
  runs.push(await openCurrentHandoff(page, {
    scenario: "flight-expedia-default",
    expectedSite: "Expedia Flights",
    expectedHost: "www.expedia.com"
  }));
  runs.push(await prepareAndOpen(page, {
    scenario: "hotel-booking-default",
    product: "hotel",
    site: "booking",
    expectedSite: "Booking.com",
    expectedHost: "www.booking.com"
  }));
  runs.push(await prepareAndOpen(page, {
    scenario: "hotel-trip-selected",
    product: "hotel",
    site: "trip",
    expectedSite: "Trip.com Hotels",
    expectedHost: "www.trip.com"
  }));
  runs.push(...await openNaturalLanguageBundle(page));

  const summary = {
    scenario: "anna-personal-assistant-browser-handoff-smoke",
    generated_at: new Date().toISOString(),
    generated_at_shanghai: formatShanghaiTime(new Date()),
    base_url: base,
    health: await page.locator("#healthBadge").textContent(),
    runs,
    boundaries: [
      "This smoke starts from the local Anna personal assistant UI.",
      "It confirms Anna's proposed flight/hotel candidate before opening an external booking website.",
      "It requires an explicit booking-assistance authorization before opening the external site.",
      "It opens real external booking websites in browser popups.",
      "It does not bypass anti-automation challenges, log in, collect traveler identity, confirm orders, or pay.",
      "The local Anna run must stop at user-details and payment handoff gates."
    ]
  };

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
  server.close();
}

async function prepareAndOpen(page, config) {
  await page.locator("#travelProduct").selectOption(config.product);
  await page.waitForFunction(
    ({ site }) => document.querySelector("#travelOfficialSite")?.querySelector(`option[value="${site}"]`),
    { site: config.site }
  );
  await page.locator("#travelOfficialSite").selectOption(config.site);
  return openCurrentHandoff(page, config);
}

async function openCurrentHandoff(page, config) {
  await page.locator("#travelPlanButton").click();
  await page.waitForSelector("#travelResult:not([hidden])");
  await expectText(page, "#travelStatus", "等待用户确认");
  await expectText(page, "#travelBoundary", "等待你确认");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待订购授权");
  await expectText(page, "#travelBoundary", "授权订购接管");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待外站接管");
  await expectText(page, "#travelSite", config.expectedSite);

  const localBeforeOpen = await page.evaluate(() => ({
    site: document.querySelector("#travelSite")?.textContent,
    route: document.querySelector("#travelRoute")?.textContent,
    link: document.querySelector("#travelLink")?.href,
    confirm_disabled: document.querySelector("#travelConfirmButton")?.disabled,
    open_disabled: document.querySelector("#travelOpenButton")?.disabled,
    field_mode: document.querySelector("#travelFieldMode")?.textContent,
    field_values: Object.fromEntries(Array.from(document.querySelectorAll("#travelFieldList dt")).map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent || ""
    ])),
    boundary: document.querySelector("#travelBoundary")?.textContent
  }));
  assert.equal(localBeforeOpen.site, config.expectedSite);
  assert.equal(localBeforeOpen.confirm_disabled, true);
  assert.equal(localBeforeOpen.open_disabled, false);
  assert.equal(new URL(localBeforeOpen.link).protocol, "https:");
  assert.ok(Object.keys(localBeforeOpen.field_values).length >= 5);

  const popupPromise = page.context().waitForEvent("page", { timeout: Math.min(externalTimeoutMs, 3000) })
    .then((popup) => ({ popup, open_method: "browser_new_page_from_ui_click" }))
    .catch(() => null);
  await page.locator("#travelLink").click();
  await expectText(page, "#travelStatus", "等待用户填写资料");
  const opened = await popupPromise || await openFallbackPage(page, localBeforeOpen.link);
  const external = await inspectExternalPopup(opened.popup, config.expectedHost, opened.open_method);
  const localAfterOpen = await page.evaluate(() => ({
    status: document.querySelector("#travelStatus")?.textContent,
    site: document.querySelector("#travelSite")?.textContent,
    route: document.querySelector("#travelRoute")?.textContent,
    boundary: document.querySelector("#travelBoundary")?.textContent
  }));
  assert.equal(localAfterOpen.status, "等待用户填写资料");
  await opened.popup.close().catch(() => {});
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待付款交接");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "payment_handoff");
  const terminalStatus = await page.locator("#travelStatus").textContent();

  return {
    scenario: config.scenario,
    product_site: localBeforeOpen.site,
    route: localBeforeOpen.route,
    field_mode: localBeforeOpen.field_mode,
    field_values: localBeforeOpen.field_values,
    local_link_host: new URL(localBeforeOpen.link).host,
    local_status_after_open: localAfterOpen.status,
    local_terminal_status: terminalStatus,
    local_boundary: localAfterOpen.boundary,
    external
  };
}

async function openNaturalLanguageBundle(page) {
  await page.locator("#messageInput").fill("请打开官方网页接管，帮我订上海到东京机票和东京酒店，2026-08-12，住2晚，1人，先不要付款");
  await page.locator("#sendButton").click();
  await page.waitForSelector("#travelBundleSummary:not([hidden])");
  await expectText(page, "#travelStatus", "等待用户确认");
  await expectText(page, "#travelBundleSummary", "机票");
  await expectText(page, "#travelBundleSummary", "酒店");

  const bundleRuns = [];
  bundleRuns.push(await openBundleItem(page, {
    scenario: "natural-language-bundle-flight",
    product: "flight",
    expectedSite: "Expedia Flights",
    expectedHost: "www.expedia.com"
  }));
  bundleRuns.push(await openBundleItem(page, {
    scenario: "natural-language-bundle-hotel",
    product: "hotel",
    expectedSite: "Booking.com",
    expectedHost: "www.booking.com"
  }));
  return bundleRuns;
}

async function openBundleItem(page, config) {
  const button = page.locator(`#travelBundleSummary [data-bundle-product="${config.product}"]`).first();
  await button.waitFor({ state: "visible" });
  const href = await button.getAttribute("href");
  assert.ok(href);
  await button.click();
  await expectText(page, "#travelStatus", "等待订购授权");
  await button.click();
  await expectText(page, "#travelStatus", "等待外站接管");
  await expectText(page, "#travelSite", config.expectedSite);
  const popupPromise = page.context().waitForEvent("page", { timeout: Math.min(externalTimeoutMs, 3000) })
    .then((popup) => ({ popup, open_method: "browser_new_page_from_ui_click" }))
    .catch(() => null);
  await button.click();
  await expectText(page, "#travelStatus", "等待用户填写资料");
  await expectText(page, "#travelSite", config.expectedSite);
  const opened = await popupPromise || await openFallbackPage(page, href);
  const external = await inspectExternalPopup(opened.popup, config.expectedHost, opened.open_method);

  const localAfterOpen = await page.evaluate(() => ({
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
  assert.equal(localAfterOpen.status, "等待用户填写资料");
  assert.equal(localAfterOpen.site, config.expectedSite);
  assert.equal(new URL(localAfterOpen.link).protocol, "https:");
  assert.ok(Object.keys(localAfterOpen.field_values).length >= 5);
  await opened.popup.close().catch(() => {});
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待付款交接");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "payment_handoff");
  const terminalStatus = await page.locator("#travelStatus").textContent();

  return {
    scenario: config.scenario,
    product_site: localAfterOpen.site,
    route: localAfterOpen.route,
    field_mode: localAfterOpen.field_mode,
    field_values: localAfterOpen.field_values,
    local_link_host: new URL(localAfterOpen.link).host,
    local_status_after_open: localAfterOpen.status,
    local_terminal_status: terminalStatus,
    local_boundary: localAfterOpen.boundary,
    external
  };
}

async function openFallbackPage(page, href) {
  const popup = await browser.newPage();
  await popup.goto(href, { waitUntil: "domcontentloaded", timeout: externalTimeoutMs }).catch(() => {});
  return { popup, open_method: "playwright_new_page_after_ui_click" };
}

async function inspectExternalPopup(popup, expectedHost, openMethod) {
  const reach = await waitForPopupHostOrError(popup, expectedHost);
  const load = await popup.waitForLoadState("domcontentloaded", { timeout: externalTimeoutMs })
    .then(() => "domcontentloaded")
    .catch((error) => error.name === "TimeoutError" ? "timeout" : "load_error");
  await popup.waitForTimeout(800).catch(() => {});
  const url = popup.url();
  const parsed = safeUrl(url);
  if (reach.reachedExpectedHost) {
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.host, expectedHost);
  }
  const title = await popup.title().catch(() => "");
  const body = await popup.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return {
    url_host: parsed?.host || parsed?.protocol || "unavailable",
    expected_host: expectedHost,
    reached_expected_host: reach.reachedExpectedHost,
    final_url_sample: sampleUrl(url),
    title: truncate(title, 120),
    open_method: openMethod,
    load_state: load,
    classification: classifyExternalPage({ load, title, body, reachedExpectedHost: reach.reachedExpectedHost }),
    challenge_signals: challengeSignals(`${title}\n${body}`)
  };
}

async function waitForPopupHostOrError(popup, expectedHost) {
  const deadline = Date.now() + externalTimeoutMs;
  let lastUrl = popup.url();
  while (Date.now() < deadline) {
    lastUrl = popup.url();
    try {
      const parsed = new URL(lastUrl);
      if (parsed.protocol === "https:" && parsed.host === expectedHost) {
        return { reachedExpectedHost: true, lastUrl };
      }
      if (parsed.protocol === "chrome-error:") {
        return { reachedExpectedHost: false, lastUrl };
      }
    } catch {
      // Keep polling while the popup is still on about:blank or a browser-internal URL.
    }
    await popup.waitForTimeout(100);
  }
  return { reachedExpectedHost: false, lastUrl };
}

function classifyExternalPage({ load, title, body, reachedExpectedHost }) {
  const signals = challengeSignals(`${title}\n${body}`);
  if (signals.length > 0) return "human_challenge";
  if (!reachedExpectedHost) return "network_or_timeout";
  if (load === "timeout") return "network_or_timeout";
  return "browser_reached_external_site";
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function challengeSignals(text) {
  const signals = [];
  if (/not a robot|captcha|challenge|awswaf|waf|wildcard-challenge|verify you are human|enable javascript/i.test(text)) {
    signals.push("anti_automation_challenge");
  }
  if (/captcha-pwa/i.test(text)) signals.push("captcha_pwa");
  if (/challenge\.js/i.test(text)) signals.push("challenge_js");
  return [...new Set(signals)];
}

async function expectText(page, selector, text) {
  await page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text),
    { selector, text }
  );
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
  const rows = result.runs.map((run) => [
    run.scenario,
    run.product_site,
    run.route,
    run.field_mode,
    run.field_values["目的地 / 城市"],
    run.local_link_host,
    run.external.url_host,
    run.external.reached_expected_host ? "yes" : "no",
    run.external.open_method,
    run.local_status_after_open,
    run.local_terminal_status,
    run.external.load_state,
    run.external.classification,
    run.external.challenge_signals.join(", ") || "none"
  ]);
  return [
    "# Anna 个人助理真实浏览器 Handoff Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- 从 Anna 个人助理本地网页端实际点击 HealthKit 同意门、生成旅行候选，用户确认后再打开真实外部订票/订房网页。",
    "- 每个外站打开后，本地 Anna run 均停在用户资料门；测试只模拟用户确认资料已填完，随后停在 `payment_handoff`。",
    "- 真实外站如返回验证码、JS challenge 或反自动化页面，测试只记录分类并停在人工接管边界。",
    "",
    "## 浏览器接管结果",
    "",
    "| 场景 | 平台 | 行程 | 字段方式 | 目的地/城市 | 本地链接域名 | 外站域名 | 到达目标域 | 打开方式 | 外站打开后状态 | 测试终点 | 加载 | 分类 | challenge 信号 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "## 健康与边界",
    "",
    `- 健康状态：${result.health}`,
    "- 打开的是真实外部网页，但不绕过验证码或反自动化页面。",
    "- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。",
    "- 不确认订单、不付款、不保存页面文本、订单号或支付信息。"
  ].join("\n");
}

function sampleUrl(url) {
  return truncate(url.replace(/[?&](token|session|sid|auth|key|code)=[^&]+/gi, "$1=redacted"), 180);
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
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
