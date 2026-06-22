import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
const format = options.format || process.env.ANNA_DASHBOARD_LIVE_FORMAT || "json";
const outFile = options.out || process.env.ANNA_DASHBOARD_LIVE_REPORT || null;
const targetUrl = options.url || process.env.ANNA_DASHBOARD_URL || "https://anna.partners/dashboard";
const timeoutMs = Number(process.env.ANNA_DASHBOARD_LIVE_TIMEOUT_MS || 20000);

const result = await probeDashboard(targetUrl, timeoutMs);

assert.equal(result.target, targetUrl, "dashboard probe must target the configured Anna URL");
assert.equal(result.secret_handling, "no_credentials_sent", "dashboard probe must not send credentials");
assert.match(result.url, /^https:\/\/anna\.partners\//, "dashboard probe must stay on anna.partners");
assert.ok(
  ["auth_required", "reachable", "unexpected_status", "network_or_timeout"].includes(result.classification),
  `unknown dashboard classification: ${result.classification}`
);

const rendered = format === "markdown"
  ? renderMarkdown(result)
  : JSON.stringify(result, null, 2);

if (outFile) {
  const absolute = path.resolve(outFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${rendered}\n`);
  console.log(`Wrote ${absolute}`);
} else {
  console.log(rendered);
}

async function probeDashboard(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const generatedAt = new Date();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "user-agent": "AnnaPersonalAssistantDashboardLiveSmoke/0.1"
      }
    });
    const body = await response.text().catch(() => "");
    const finalUrl = response.url || url;
    return {
      scenario: "anna-dashboard-live-smoke",
      generated_at: generatedAt.toISOString(),
      generated_at_shanghai: formatShanghaiTime(generatedAt),
      target: url,
      url: finalUrl,
      status: response.status,
      classification: classifyDashboardResponse(response.status, body),
      body_signal: summarizeBody(body),
      redirected: response.redirected,
      server: response.headers.get("server"),
      render_id: response.headers.get("rndr-id"),
      secret_handling: "no_credentials_sent",
      next_step: response.status === 401
        ? "Use an authenticated browser session or Anna CLI credentials for a user-controlled Dashboard test."
        : "Review Dashboard UI state in an authenticated browser session before release."
    };
  } catch (error) {
    return {
      scenario: "anna-dashboard-live-smoke",
      generated_at: generatedAt.toISOString(),
      generated_at_shanghai: formatShanghaiTime(generatedAt),
      target: url,
      url,
      status: null,
      classification: "network_or_timeout",
      error: error.name === "AbortError" ? "timeout" : "network_error",
      secret_handling: "no_credentials_sent",
      next_step: "Retry from an authenticated browser session and compare against local smoke reports."
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyDashboardResponse(status, body) {
  if ([301, 302, 303, 307, 308, 401, 403].includes(status) || /could not validate credentials|unauthorized|login/i.test(body)) {
    return "auth_required";
  }
  if (status >= 200 && status < 300) {
    return "reachable";
  }
  return "unexpected_status";
}

function summarizeBody(body) {
  if (/could not validate credentials/i.test(body)) return "could_not_validate_credentials";
  if (/login|sign in/i.test(body)) return "login_prompt_or_auth_page";
  if (!body) return "empty";
  return "body_received";
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
    } else if (arg === "--url") {
      parsed.url = argv[index + 1];
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
    "# Anna Dashboard Live Smoke 报告",
    "",
    `生成时间：${result.generated_at_shanghai}（Asia/Shanghai）`,
    `UTC：${result.generated_at}`,
    "",
    "## 结论",
    "",
    result.classification === "auth_required"
      ? "- 线上 Anna Dashboard 可达，但未认证请求被正确挡在登录/凭据边界。"
      : `- 线上 Anna Dashboard 探测结果：${result.classification}。`,
    "- 本检查不发送 cookie、token、密码或浏览器会话，不会登录，也不会触发订单、付款或发布。",
    "",
    "## 结果",
    "",
    `- 目标：${result.target}`,
    `- 最终 URL：${result.url}`,
    `- HTTP：${result.status ?? "n/a"}`,
    `- 分类：${result.classification}`,
    `- 是否跳转：${result.redirected === undefined ? "n/a" : String(result.redirected)}`,
    `- 页面/接口信号：${result.body_signal || result.error || "n/a"}`,
    `- secret handling：${result.secret_handling}`,
    `- 下一步：${result.next_step}`,
    "",
    "## 边界",
    "",
    "- 该 smoke 只验证线上入口可达性和未认证边界。",
    "- 真实 Dashboard 订购测试仍需要用户在浏览器中完成登录、MFA 和任何最终确认。"
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
