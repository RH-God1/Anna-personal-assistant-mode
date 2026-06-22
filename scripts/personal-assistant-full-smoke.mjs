import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appDir = path.join(root, "08-personal-assistant-anna-app");
const hostDir = path.join(root, "10-anna-local-host-lab");
const uiReport = path.join(appDir, "UI_SMOKE_ZH.md");
const doctorReport = path.join(appDir, "HEALTHKIT_DOCTOR_ZH.md");
const healthReport = path.join(appDir, "HEALTHKIT_BRIDGE_SMOKE_ZH.md");
const realReport = path.join(appDir, "REAL_HANDOFF_SMOKE_ZH.md");
const browserReport = path.join(appDir, "BROWSER_HANDOFF_SMOKE_ZH.md");
const fullReport = path.join(appDir, "FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md");
const hostReport = path.join(hostDir, "HOST_PERSONAL_ASSISTANT_SMOKE_ZH.md");

await run("npm", ["--prefix", "08-personal-assistant-anna-app", "run", "smoke:ui:report"]);
await run("npm", ["--prefix", "08-personal-assistant-anna-app", "run", "healthkit:doctor:report"]);
await run("npm", ["--prefix", "08-personal-assistant-anna-app", "run", "smoke:healthkit-bridge:report"]);
await run("npm", ["--prefix", "08-personal-assistant-anna-app", "run", "smoke:real:report"]);
await run("npm", ["--prefix", "08-personal-assistant-anna-app", "run", "smoke:browser-handoff:report"]);
await run("npm", ["--prefix", "10-anna-local-host-lab", "run", "smoke:personal-assistant-host:report"]);

const ui = fs.readFileSync(uiReport, "utf8").trim();
const doctor = fs.readFileSync(doctorReport, "utf8").trim();
const health = fs.readFileSync(healthReport, "utf8").trim();
const real = fs.readFileSync(realReport, "utf8").trim();
const browser = fs.readFileSync(browserReport, "utf8").trim();
const host = fs.readFileSync(hostReport, "utf8").trim();
const rendered = [
  "# Anna 个人助理完整 Smoke 总报告",
  "",
  `生成时间：${formatShanghaiTime(new Date())}（Asia/Shanghai）`,
  `UTC：${new Date().toISOString()}`,
  "",
  "## 总结",
  "",
  "- 网页端 UI smoke 证明用户可以在 Anna 个人助理模式里实际点击 HealthKit 同意门、生成机票酒店候选、确认候选或否决后换平台。",
  "- HealthKit doctor 报告证明 iOS Companion 工程、HealthKit entitlement、本地网络权限和本机 iPhone 安装条件已被逐项检查。",
  "- HealthKit bridge smoke 证明 Anna 网页端可读取 companion 推送的 iPhone/Apple Watch 风格快照，而不是只显示默认模拟值。",
  "- 真实外站 smoke 证明 Anna 主体可以生成 Expedia Flights 与 Booking.com 的匿名官方搜索链接，并支持用户选择 Trip.com 官方入口。",
  "- 真实浏览器 handoff smoke 证明 Anna 会在用户确认候选并授权订购接管后，从网页端打开外部订票/订房网页，并在外站打开后停在用户资料门。",
  "- Host smoke 证明同一套个人助理模式可在 Anna Local Host iframe 中通过 Host SDK、Executa、隐私审计和匿名字段包验证。",
  "- service-level 外站探测会记录 human challenge；browser-level 测试会记录实际加载/超时状态。项目始终停在用户资料门或 `payment_handoff`，不绕过验证码、不提交个人信息、不确认订单、不付款。",
  "",
  "## 报告文件",
  "",
  "- `UI_SMOKE_ZH.md`：网页端本地 UI 操作、桌面与移动端布局。",
  "- `HEALTHKIT_DOCTOR_ZH.md`：iOS Companion、HealthKit 权限声明、LAN 与本机 Xcode/签名准备度。",
  "- `HEALTHKIT_BRIDGE_SMOKE_ZH.md`：Companion 风格 HealthKit 快照推送、网页端连接与健康边界。",
  "- `REAL_HANDOFF_SMOKE_ZH.md`：真实外站可达性、challenge 分类与人工接管边界。",
  "- `BROWSER_HANDOFF_SMOKE_ZH.md`：从 Anna 网页端打开真实外部网页的浏览器级接管证据。",
  "- `10-anna-local-host-lab/HOST_PERSONAL_ASSISTANT_SMOKE_ZH.md`：Anna Host iframe 内个人助理主体、健康、旅行与审计证据。",
  "",
  "## UI Smoke 摘要",
  "",
  stripTitle(ui),
  "",
  "## HealthKit Doctor 摘要",
  "",
  stripTitle(doctor),
  "",
  "## HealthKit Bridge Smoke 摘要",
  "",
  stripTitle(health),
  "",
  "## 真实 Handoff Smoke 摘要",
  "",
  stripTitle(real),
  "",
  "## 真实浏览器 Handoff Smoke 摘要",
  "",
  stripTitle(browser),
  "",
  "## Anna Host 个人助理 Smoke 摘要",
  "",
  stripTitle(host)
].join("\n");

fs.writeFileSync(fullReport, `${rendered}\n`);
console.log(`Wrote ${fullReport}`);

function stripTitle(markdown) {
  return markdown
    .split("\n")
    .filter((line, index) => !(index === 0 && line.startsWith("# ")))
    .join("\n")
    .trim();
}

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit"
  });
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
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
