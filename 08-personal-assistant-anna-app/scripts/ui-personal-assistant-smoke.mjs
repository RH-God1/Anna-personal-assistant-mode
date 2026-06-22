import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "../../01-private-travel-booking-agent/node_modules/playwright/index.mjs";
import { createServer } from "../server.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || "json";
const outFile = options.out || null;

const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");

let browser;
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch(chromeLaunchOptions());

  const desktop = await runDesktopScenario(browser, base);
  const mobile = await runMobileScenario(browser, base);
  const summary = {
    scenario: "anna-personal-assistant-ui-smoke",
    generated_at: new Date().toISOString(),
    generated_at_shanghai: formatShanghaiTime(new Date()),
    base_url: base,
    desktop,
    mobile,
    boundaries: [
      "UI smoke only opens local Anna preview.",
      "It does not open external booking sites.",
      "It asks for user confirmation and booking-assistance authorization before opening external booking sites.",
      "It does not collect traveler identity, confirm a real order, or pay."
    ]
  };

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

function chromeLaunchOptions() {
  const executablePath = process.env.ANNA_UI_SMOKE_BROWSER_EXECUTABLE || findRealGoogleChrome();
  return {
    ...(executablePath ? { executablePath } : {}),
    headless: process.env.ANNA_UI_SMOKE_HEADFUL === "1" ? false : true
  };
}

function findRealGoogleChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(process.env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function runDesktopScenario(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#healthConsent").check();
  await page.locator("#healthConnectButton").click();
  await expectText(page, "#healthBadge", "已连接");
  await page.waitForFunction(() => document.querySelectorAll("#travelOfficialSite option").length >= 3);
  const officialSiteOptions = await page.evaluate(() => ({
    flight: Array.from(document.querySelectorAll("#travelOfficialSite option")).map((option) => option.textContent)
  }));

  await page.locator("#travelPlanButton").click();
  await page.waitForSelector("#travelResult:not([hidden])");
  await expectText(page, "#travelStatus", "等待用户确认");
  await expectText(page, "#travelBoundary", "等待你确认");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待订购授权");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待外站接管");
  await expectText(page, "#travelSite", "Expedia Flights");

  const result = await page.evaluate(() => ({
    title: document.title,
    connection: document.querySelector("#connectionStatus")?.textContent,
    health: document.querySelector("#healthBadge")?.textContent,
    travel_status: document.querySelector("#travelStatus")?.textContent,
    travel_site: document.querySelector("#travelSite")?.textContent,
    travel_route: document.querySelector("#travelRoute")?.textContent,
    travel_link: document.querySelector("#travelLink")?.href,
    field_mode: document.querySelector("#travelFieldMode")?.textContent,
    confirm_disabled: document.querySelector("#travelConfirmButton")?.disabled,
    reject_disabled: document.querySelector("#travelRejectButton")?.disabled,
    open_disabled: document.querySelector("#travelOpenButton")?.disabled,
    field_values: Object.fromEntries(Array.from(document.querySelectorAll("#travelFieldList dt")).map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent || ""
    ])),
    assistant_title: document.querySelector("#assistantOutput h3")?.textContent,
    model_options: document.querySelectorAll("#modelSelect option").length
  }));
  assert.equal(result.title, "Anna 个人助理模式");
  assert.equal(result.travel_site, "Expedia Flights");
  assert.equal(result.confirm_disabled, true);
  assert.equal(result.reject_disabled, true);
  assert.equal(result.open_disabled, false);
  assert.match(result.travel_link, /^https:\/\/www\.expedia\.com\/Flights-Search\?/);
  assert.equal(result.field_mode, "已写入官方搜索链接");
  assert.equal(result.field_values["目的地 / 城市"], "NRT");
  assert.ok(result.model_options > 0);

  await page.locator("#travelProduct").selectOption("hotel");
  await page.waitForFunction(() => document.querySelector("#travelOfficialSite")?.value === "booking");
  officialSiteOptions.hotel = await page.evaluate(() => (
    Array.from(document.querySelectorAll("#travelOfficialSite option")).map((option) => option.textContent)
  ));
  await page.locator("#travelOfficialSite").selectOption("trip");
  await page.locator("#travelPlanButton").click();
  await expectText(page, "#travelStatus", "等待用户确认");
  await expectText(page, "#travelSite", "Trip.com Hotels");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待订购授权");
  await page.locator("#travelConfirmButton").click();
  await expectText(page, "#travelStatus", "等待外站接管");
  const alternate = await page.evaluate(() => ({
    travel_status: document.querySelector("#travelStatus")?.textContent,
    travel_site: document.querySelector("#travelSite")?.textContent,
    travel_route: document.querySelector("#travelRoute")?.textContent,
    travel_link: document.querySelector("#travelLink")?.href,
    field_mode: document.querySelector("#travelFieldMode")?.textContent,
    field_values: Object.fromEntries(Array.from(document.querySelectorAll("#travelFieldList dt")).map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent || ""
    ])),
    boundary: document.querySelector("#travelBoundary")?.textContent
  }));
  assert.equal(alternate.travel_site, "Trip.com Hotels");
  assert.equal(alternate.travel_link, "https://www.trip.com/hotels/");
  assert.equal(alternate.field_mode, "需要用户手动输入");
  assert.equal(alternate.field_values["目的地 / 城市"], "Tokyo");
  assert.equal(alternate.field_values["入住"], "2026-08-12");
  assert.equal(alternate.field_values["退房"], "2026-08-13");
  assert.equal(alternate.field_values["晚数"], "1");
  assert.match(alternate.boundary || "", /手动输入匿名行程字段/);

  await page.locator("#messageInput").fill("帮我订上海到东京机票和东京酒店，2026-08-12，住2晚，1人，先不要付款");
  await page.locator("#sendButton").click();
  await expectText(page, "#bookingCompareResult", "推荐方案");
  await expectText(page, "#bookingCompareResult", "duffel");
  await expectText(page, "#assistantOutput", "booking_prepare");
  const inferred = await page.evaluate(() => ({
    intent: document.querySelector("#modelDecision")?.textContent,
    booking_status: document.querySelector("#bookingStatus")?.textContent,
    booking_type: document.querySelector("#bookingType")?.value,
    booking_destination_input: document.querySelector("#bookingDestination")?.value,
    booking_result: document.querySelector("#bookingCompareResult")?.textContent,
    prepare_disabled: document.querySelector("#bookingPrepareButton")?.disabled,
    assistant_text: document.querySelector("#assistantOutput")?.textContent,
    travel_status: document.querySelector("#travelStatus")?.textContent,
    travel_link: document.querySelector("#travelLink")?.href
  }));
  assert.match(inferred.intent || "", /text \+ tools|Anna 自动选择/);
  assert.equal(inferred.booking_type, "flight_hotel");
  assert.equal(inferred.booking_destination_input, "NRT");
  assert.equal(inferred.prepare_disabled, false);
  assert.match(inferred.booking_result || "", /duffel|航班|酒店/i);
  assert.match(inferred.assistant_text || "", /Duffel|booking_prepare|外部浏览器/);
  assert.doesNotMatch(inferred.assistant_text || "", /Expedia|Booking\.com|Trip\.com|Flights-Search/i);
  await page.close();
  return {
    ...result,
    official_site_options: officialSiteOptions,
    alternate_handoff: alternate,
    inferred_booking: inferred
  };
}

async function runMobileScenario(browser, base) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#travelPlanButton").click();
  await page.waitForSelector("#travelResult:not([hidden])");
  await expectText(page, "#travelStatus", "等待用户确认");
  const result = await page.evaluate(() => ({
    scroll_width: document.documentElement.scrollWidth,
    client_width: document.documentElement.clientWidth,
    travel_visible: !!document.querySelector("#travelResult:not([hidden])"),
    packet_visible: !!document.querySelector("#travelHandoffPacket:not([hidden])"),
    field_mode: document.querySelector("#travelFieldMode")?.textContent,
    link_text: document.querySelector("#travelLink")?.textContent,
    confirm_disabled: document.querySelector("#travelConfirmButton")?.disabled
  }));
  assert.equal(result.travel_visible, true);
  assert.equal(result.packet_visible, true);
  assert.equal(result.scroll_width, result.client_width);
  assert.equal(result.field_mode, "已写入官方搜索链接");
  assert.match(result.link_text || "", /Expedia Flights/);
  assert.equal(result.confirm_disabled, false);
  await page.close();
  return result;
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
  return [
    "# Anna 个人助理网页端 UI Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- 网页端个人助理模式可完成 HealthKit 同意门、显式官方接管流程，以及自然语言订票默认 Duffel 结构化比价。",
    "- 桌面端可见 Expedia Flights 官方候选并授权后生成链接，也可切换到 Trip.com Hotels 官方入口。",
    "- 自然语言“帮我订机票/酒店”不会默认打开外站，会落到 Duffel booking_prepare 前的推荐方案。",
    "- 移动端 390px 宽度下无横向溢出。",
    "",
    "## 桌面端结果",
    "",
    `- 连接状态：${result.desktop.connection}`,
    `- 健康状态：${result.desktop.health}`,
    `- 旅行状态：${result.desktop.travel_status}`,
    `- 旅行平台：${result.desktop.travel_site}`,
    `- 行程：${result.desktop.travel_route}`,
    `- 链接域名：${new URL(result.desktop.travel_link).host}`,
    `- 字段方式：${result.desktop.field_mode}`,
    `- 匿名字段：目的地 ${result.desktop.field_values["目的地 / 城市"]}，成人 ${result.desktop.field_values["成人"]}`,
    `- 机票平台选项：${result.desktop.official_site_options.flight.join(" / ")}`,
    `- 酒店平台选项：${result.desktop.official_site_options.hotel.join(" / ")}`,
    `- 备用接管：${result.desktop.alternate_handoff.travel_site} · ${new URL(result.desktop.alternate_handoff.travel_link).host} · ${result.desktop.alternate_handoff.field_mode}`,
    `- 酒店匿名日期：入住 ${result.desktop.alternate_handoff.field_values["入住"]}，退房 ${result.desktop.alternate_handoff.field_values["退房"]}，${result.desktop.alternate_handoff.field_values["晚数"]} 晚`,
    `- 自然语言 Duffel 预订类型：${result.desktop.inferred_booking.booking_type}`,
    `- 自然语言 Duffel 比价摘要：${truncate(result.desktop.inferred_booking.booking_result, 180)}`,
    `- 模型选项数量：${result.desktop.model_options}`,
    "",
    "## 移动端结果",
    "",
    `- viewport/client width：${result.mobile.client_width}`,
    `- scroll width：${result.mobile.scroll_width}`,
    `- 旅行结果可见：${result.mobile.travel_visible}`,
    `- 匿名字段包可见：${result.mobile.packet_visible}`,
    `- 链接文本：${result.mobile.link_text}`,
    "",
    "## 边界",
    "",
    "- 该 UI smoke 只打开本地 Anna 预览页。",
    "- 不打开外部订票/订房网站。",
    "- 不收集旅客身份、不确认订单、不付款。"
  ].join("\n");
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
