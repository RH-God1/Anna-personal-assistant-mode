import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createAssistantService } from "../src/service.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || process.env.ANNA_REAL_SMOKE_FORMAT || "json";
const outFile = options.out || process.env.ANNA_REAL_SMOKE_REPORT || null;
const timeoutMs = Number(process.env.ANNA_REAL_HANDOFF_TIMEOUT_MS || 20000);
const service = createAssistantService({
  now: () => new Date("2026-06-19T09:00:00.000Z")
});

const preflight = await service.preflight({
  user_key: "real-smoke",
  weather_demo: true,
  location: {
    latitude: 31.2304,
    longitude: 121.4737,
    label: "上海"
  }
});
assert.equal(preflight.context.permissions.location, "weather_report_ready");
assert.equal(preflight.context.permissions.health, "requested");

const health = service.connectHealth({
  consent: true,
  deviceTypes: ["iphone", "apple_watch"]
});
assert.equal(health.mode, "healthkit-companion-bridge");
assert.equal(health.privacy.storage, "memory_only");

const flight = service.travelStart({
  product: "flight",
  origin: "SHA",
  destination: "NRT",
  departureDate: "2026-08-12",
  passengers: { adults: 1 },
  provider: "official-handoff"
});
const hotel = service.travelStart({
  product: "hotel",
  destination: "Tokyo",
  departureDate: "2026-08-12",
  passengers: { adults: 1 },
  provider: "official-handoff"
});
const tripHotel = service.travelStart({
  product: "hotel",
  destination: "Tokyo",
  departureDate: "2026-08-12",
  passengers: { adults: 1 },
  provider: "official-handoff",
  official_site: "trip"
});

assertHandoff(flight, "www.expedia.com");
assertHandoff(hotel, "www.booking.com");
assertHandoff(tripHotel, "www.trip.com", { itineraryInUrl: false });

const probes = [];
const confirmedRuns = [];
for (const run of [flight, hotel, tripHotel]) {
  const confirmed = service.travelContinue({
    run_id: run.id,
    event: "是"
  });
  assert.equal(confirmed.state, "await_booking_authorization");
  assert.equal(confirmed.next_gate, "booking_authorization");
  const authorized = service.travelContinue({
    run_id: confirmed.id,
    event: "booking_authorized"
  });
  assert.equal(authorized.state, "await_official_site");
  assert.equal(authorized.next_gate, "official_site");
  confirmedRuns.push(authorized);
  probes.push(await probeOfficialSite(authorized.selected_offer.handoff.url, timeoutMs));
  const continued = service.travelContinue({
    run_id: authorized.id,
    event: "official_site_opened"
  });
  assert.equal(continued.state, "await_user_details");
  assert.equal(continued.next_gate, "user_details_or_saved_profile");
  const details = service.travelContinue({
    run_id: continued.id,
    event: "traveler_info_completed"
  });
  assert.equal(details.state, "await_payment");
  const payment = service.travelContinue({
    run_id: details.id,
    event: "payment_prompt_shown"
  });
  assert.equal(payment.state, "payment_handoff");
  assert.equal(payment.next_gate, null);
}

const summary = {
  scenario: "anna-personal-assistant-real-smoke",
  generated_at: new Date().toISOString(),
  generated_at_shanghai: formatShanghaiTime(new Date()),
  preflight: {
    weather: preflight.context.weather?.source,
    health_permission: preflight.context.permissions.health
  },
  health: {
    mode: health.mode,
    bridge_kind: health.bridge_kind,
    storage: health.privacy.storage
  },
  travel: confirmedRuns.map((run, index) => ({
    product: run.product,
    provider: run.provider,
    user_confirmation_gate_passed: true,
    booking_authorization_gate_passed: true,
    state_after_open: "await_user_details",
    terminal_test_state: "payment_handoff",
    site: run.selected_offer.handoff.site.name,
    url_host: new URL(run.selected_offer.handoff.url).host,
    itinerary_in_url: run.selected_offer.handoff.itinerary_in_url,
    external_probe: probes[index]
  }))
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

function assertHandoff(run, expectedHost, { itineraryInUrl = true } = {}) {
  assert.equal(run.state, "await_user_confirmation");
  assert.equal(run.next_gate, "user_booking_confirmation");
  assert.equal(run.selected_offer.can_auto_book, false);
  assert.equal(run.privacy.pii_accepted, false);
  assert.equal(run.selected_offer.handoff.itinerary_in_url, itineraryInUrl);
  assert.deepEqual(
    run.privacy.external_transmission_after_handoff,
    [itineraryInUrl ? "anonymous_itinerary_fields_in_url" : "user_entered_anonymous_itinerary_fields"]
  );
  const url = new URL(run.selected_offer.handoff.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.host, expectedHost);
  const structuredFields = JSON.stringify({
    query: run.query,
    anonymous_fields: run.selected_offer.handoff.anonymous_fields,
    privacy: run.privacy
  });
  assert.doesNotMatch(structuredFields, /passport|id.?card|phone|email|cvv|card_number|name|身份证号|护照号|手机号/i);
}

async function probeOfficialSite(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "AnnaPersonalAssistantRealSmoke/0.1"
      }
    });
    const text = await response.text().catch(() => "");
    const headers = {
      "x-app-info": response.headers.get("x-app-info"),
      "x-page-id": response.headers.get("x-page-id"),
      server: response.headers.get("server")
    };
    return {
      status: response.status,
      host: new URL(response.url).host,
      classification: classifyExternalResponse(response, text, headers),
      challenge_signals: challengeSignals(text, headers)
    };
  } catch (error) {
    return {
      status: null,
      host: new URL(url).host,
      classification: "network_or_timeout",
      error: error.name === "AbortError" ? "timeout" : "network_error"
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyExternalResponse(response, text, headers) {
  const signals = challengeSignals(text, headers);
  if (signals.length > 0 || response.status === 429 || response.status === 202) {
    return "human_challenge";
  }
  if (response.ok) return "reachable";
  return "unexpected_status";
}

function challengeSignals(text, headers) {
  const haystack = [
    text,
    headers["x-app-info"],
    headers["x-page-id"],
    headers.server
  ].filter(Boolean).join("\n");
  const signals = [];
  if (/not a robot|captcha|challenge|awswaf|waf|wildcard-challenge/i.test(haystack)) {
    signals.push("anti_automation_challenge");
  }
  if (/captcha-pwa/i.test(haystack)) signals.push("captcha_pwa");
  if (/challenge\.js/i.test(haystack)) signals.push("challenge_js");
  return [...new Set(signals)];
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
  const travelRows = result.travel.map((item) => [
    item.product,
    item.site,
    item.url_host,
    item.itinerary_in_url ? "URL 匿名字段" : "手动输入匿名字段",
    item.state_after_open,
    item.terminal_test_state,
    String(item.external_probe.status ?? "n/a"),
    item.external_probe.classification,
    (item.external_probe.challenge_signals || []).join(", ") || "none"
  ]);
  return [
    "# Anna 个人助理真实 Handoff Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- Anna 主体已完成 preflight、天气上下文、HealthKit 桥接、机票与酒店候选确认门和官方 handoff。",
    "- 默认深链平台与用户选择的 Trip.com 酒店官方入口均可进入人工接管。",
    "- 机票和酒店 run 均先经过用户确认门和订购接管授权；外站打开后停在用户填写资料门，模拟资料完成后停在 `payment_handoff`。",
    "- 外站访问只做可达性与 challenge 分类；验证码、登录、旅客信息和支付仍由用户本人处理。",
    "",
    "## 健康与前置问候",
    "",
    `- 天气来源：${result.preflight.weather}`,
    `- 健康权限状态：${result.preflight.health_permission}`,
    `- 健康桥接：${result.health.mode} / ${result.health.bridge_kind}`,
    `- 存储边界：${result.health.storage}`,
    "",
    "## 旅行 Handoff",
    "",
    "| 产品 | 平台 | 域名 | 匿名字段方式 | 外站打开后状态 | 测试终点 | HTTP | 分类 | challenge 信号 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...travelRows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "## 人工接管边界",
    "",
    "- 不绕过验证码或反自动化页面。",
    "- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。",
    "- 不确认订单、不付款、不保存页面文本、订单号或支付信息。"
  ].join("\n");
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
