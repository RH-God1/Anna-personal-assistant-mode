import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "../../01-private-travel-booking-agent/node_modules/playwright/index.mjs";
import { createServer } from "../server.js";

const options = parseArgs(process.argv.slice(2));
const format = options.format || "json";
const outFile = options.out || null;
const bridgeToken = "healthkit-smoke-token";
const pushedSnapshot = {
  observed_at: "2026-06-19T03:30:00.000Z",
  today_steps: 8320,
  heart_rate_bpm: 81,
  sleep_minutes_last_night: 410,
  sleep_source: "Apple Watch",
  source: "Anna iOS HealthKit Companion smoke",
  device_types: ["iphone", "apple_watch"]
};

const server = createServer({ healthKitBridgeToken: bridgeToken });
server.listen(0, "127.0.0.1");
await once(server, "listening");

let browser;
try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const accepted = await pushHealthKitSnapshot(base);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.provider, "ios-watchos-companion");
  assert.equal(accepted.snapshot.heart_rate_bpm, pushedSnapshot.heart_rate_bpm);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#healthConsent").check();
  await page.locator("#healthConnectButton").click();
  await expectText(page, "#healthBadge", "Companion");
  await expectText(page, "#stepCount", String(pushedSnapshot.today_steps));
  await expectText(page, "#heartRate", String(pushedSnapshot.heart_rate_bpm));
  await expectText(page, "#sleepValue", "6h 50m");

  const ui = await page.evaluate(() => ({
    connection: document.querySelector("#connectionStatus")?.textContent,
    badge: document.querySelector("#healthBadge")?.textContent,
    steps: document.querySelector("#stepCount")?.textContent,
    heart_rate: document.querySelector("#heartRate")?.textContent,
    sleep: document.querySelector("#sleepValue")?.textContent,
    assistant_text: document.querySelector("#assistantOutput")?.textContent
  }));
  assert.match(ui.assistant_text || "", /Anna iOS HealthKit Companion smoke|Apple Watch|今日步数 8320|心率 81 bpm/);
  await page.close();

  const summary = {
    scenario: "anna-healthkit-companion-bridge-smoke",
    generated_at: new Date().toISOString(),
    generated_at_shanghai: formatShanghaiTime(new Date()),
    base_url: base,
    pushed_snapshot: {
      observed_at: pushedSnapshot.observed_at,
      today_steps: pushedSnapshot.today_steps,
      heart_rate_bpm: pushedSnapshot.heart_rate_bpm,
      sleep_minutes_last_night: pushedSnapshot.sleep_minutes_last_night,
      sleep_source: pushedSnapshot.sleep_source,
      source: pushedSnapshot.source,
      device_types: pushedSnapshot.device_types
    },
    accepted: {
      provider: accepted.provider,
      bridge_kind: "ios-watchos-companion",
      storage: "memory_only"
    },
    ui,
    boundaries: [
      "This smoke pushes a companion-style HealthKit snapshot to the local bridge.",
      "It does not read Apple Health directly from the browser.",
      "It verifies the Anna UI uses the pushed companion snapshot instead of demo fixture values.",
      "Health data remains memory-only and is not treated as medical diagnosis."
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

async function pushHealthKitSnapshot(base) {
  const response = await fetch(`${base}/api/healthkit/snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anna-Bridge-Token": bridgeToken
    },
    body: JSON.stringify(pushedSnapshot)
  });
  assert.equal(response.status, 200);
  return response.json();
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
    "# Anna HealthKit Companion Bridge Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    "- 本地 HealthKit bridge 接收 iOS/watchOS Companion 风格快照，并返回 `ios-watchos-companion` provider。",
    "- Anna 网页端健康同意门连接后显示 `已连接 · Companion`，读取的是推送快照而不是默认模拟值。",
    "- 健康数据只保存在当前 Node 进程内存，不做医疗诊断。",
    "",
    "## 推送快照",
    "",
    `- 设备：${result.pushed_snapshot.device_types.join(" / ")}`,
    `- 来源：${result.pushed_snapshot.source}`,
    `- 今日步数：${result.pushed_snapshot.today_steps}`,
    `- 心率：${result.pushed_snapshot.heart_rate_bpm} bpm`,
    `- 睡眠：${result.pushed_snapshot.sleep_minutes_last_night} 分钟（${result.pushed_snapshot.sleep_source}）`,
    "",
    "## UI 结果",
    "",
    `- 连接状态：${result.ui.connection}`,
    `- 健康徽标：${result.ui.badge}`,
    `- 今日步数显示：${result.ui.steps}`,
    `- 心率显示：${result.ui.heart_rate}`,
    `- 睡眠显示：${result.ui.sleep}`,
    "",
    "## 边界",
    "",
    "- 浏览器不直接读取 Apple Health。",
    "- 真实设备需要 iOS/watchOS Companion App 和 HealthKit 授权。",
    "- 不把步数、心率或睡眠快照解释为医疗诊断。",
    "- 不持久化保存健康快照。"
  ].join("\n");
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
