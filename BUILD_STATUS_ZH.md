# Anna 构建与修复状态

更新日期：2026-06-19

## 已修复的实际问题

### Anna Executa 协议与验证链

- 三个 Node Executa 的 `describe` manifest 已恢复必需的 `name`，并与本地
  `tool_id` 一致。
- `health` 统一返回协议状态 `ready`。
- 未知方法/工具返回 `-32601`，非法 JSON 返回 `-32700`，内部异常返回
  `-32603`。
- 个人助理的 `attachments` 对象数组声明了 `items: { "type": "object" }`。
- 根目录全量验证已纳入 `@anna-ai/cli@0.1.30 validate --strict`。

### 01 Private Travel Booking Agent

- 阻止 `payment_completed` 跳过旅客信息 gate。
- 阻止重复/逆向状态迁移。
- 为官方网页接管增加 `await_official_site → human_handoff` 独立状态。
- 拒绝负数、非整数和超范围乘客数量。
- 非法 JSON 返回 400，超过 64 KiB 的请求返回 413。
- `/holds` 与 `/book-intents` 拒绝空 ID。
- 关闭自动导航后，“启动”和“重新扫描”均不再点击页面。
- 缩小安全点击关键词，移除 `ok`、`确定`、`book` 等宽泛匹配。
- 成功状态不再仅凭 URL 中的 `success/complete` 误判。
- 扩展权限由 `<all_urls>` 改为明确旅行站点 allowlist。
- 增加 content-script Chromium E2E。

## 已完成的新项目

- 双语 Focus Flow：locale catalog、standalone runtime、短窗口布局、统一分钟规则。
- i18n QA：键、占位符、HTML 引用、pseudo-locale、最小窗口风险检查。
- Travel Agent Anna App：schema 2、bundled Executa、PII gate 和状态机。
- Executa-to-MCP Bridge：MCP 2025-11-25、allowlist、timeout、metadata-only audit。
- Shared Contract Generator：一份契约生成 Node/Python/Go/fixture/UI mock。
- Privacy Capability Labels：能力矛盾校验、风险、badges、consent 和报告。
- Anna 个人助理模式：与 Anna 风格一致的前端、模型能力路由、真实天气与空气质量、
  模拟 HealthKit 桥接、网页端机票酒店官方 handoff 面板，以及心理学、逻辑与高情商回复策略。
- Anna 多模型项目工作区：总项目与子项目格式、每个子项目独立模型绑定、显式共享
  记忆、跨子项目依赖产物、来源追踪和模型中立上下文包。
- Anna Local Host Lab：本地 SDK、窗口 capability token、manifest ACL、长驻 Executa
  子进程池、隔离 HOME、外部网络授权、元数据审计、三个 App 的 Chromium E2E，
  以及真实 Host 内个人助理多轮场景压测。
- 三个 schema 2 Anna App 现已补充官方 `anna-app dev` harness smoke，能在
  Anna CLI 正式开发壳中完成 dashboard、session、bundle 与关键 Host RPC 验证。
- 个人助理网页端已能从真实 UI 触发 HealthKit 同意门与机票/酒店 handoff：
  生成 Expedia Flights 与 Booking.com 的匿名搜索链接，并在真实外站验证码/反自动化
  challenge 前停到 `human_handoff`，不绕过登录、验证码、旅客身份、订单确认或付款。
- 个人助理旅行 handoff 已支持按机票/酒店选择官方平台：默认深链仍覆盖
  Expedia Flights 与 Booking.com，可选 Trip.com/携程等官方入口；入口型平台不把字段写入
  URL，由用户手动输入 Anna 展示的匿名行程字段。
- 个人助理旅行状态机已新增候选确认门：Anna 会先根据提示词生成机票/酒店候选、单程/往返、
  返程日期、预算匹配和预估价说明，状态停在 `await_user_confirmation`；用户回复“是”或点击
  “确认此方案”后才进入 `await_official_site`，用户回复“否”或点击“换平台再搜”会轮换到下一个官方平台候选。
- Anna 主体已能从自然语言旅行请求推导匿名行程字段，例如“帮我订上海到东京机票和东京酒店，
  2026-08-12，住2晚，1人”，并自动生成机票+酒店组合官方 handoff；UI smoke 已断言该自然语言组合接管路径，
  且酒店匿名字段包含入住、退房和晚数。
- 个人助理网页端新增匿名字段包，显示字段方式、目的地/城市、日期、成人等匿名行程字段；
  UI smoke 与真实浏览器 handoff smoke 均已断言该字段包可见并随报告输出。
- 个人助理 HealthKit bridge 已新增 companion-style 推送 smoke：向
  `/api/healthkit/snapshot` 推送 iPhone/Apple Watch 风格快照，再从网页端健康同意门读取，
  生成 `08-personal-assistant-anna-app/HEALTHKIT_BRIDGE_SMOKE_ZH.md`；同时修正网页端健康
  徽标，真实 companion provider 显示 `已连接 · Companion`，不再误标为模拟。
- 个人助理 HealthKit doctor 已可生成
  `08-personal-assistant-anna-app/HEALTHKIT_DOCTOR_ZH.md`，逐项记录 iOS Companion
  工程、HealthKit entitlement、本地网络权限、LAN 地址，以及 Full Xcode、iOS toolchain
  和 Apple Development 签名身份这些真机安装条件。
- 新增 `08-personal-assistant-anna-app` 的 `npm run smoke:real`：从 Anna 个人助理
  主体执行 preflight、HealthKit 桥接、机票/酒店官方 handoff，并联网分类 Expedia、
  Booking.com 与 Trip.com 官方入口的真实响应；该命令因依赖外网，不纳入默认 `npm run verify`。
- 新增 `08-personal-assistant-anna-app` 的 `npm run smoke:browser-handoff`：从个人助理
  本地网页先确认 Anna 候选，再实际点击外站链接，打开真实订票/订房网页；当前报告还覆盖自然语言机票+酒店
  组合请求中的两项外站接管，并验证本地 Anna run 停在 `human_handoff`。
- 根目录补充 `npm run smoke:personal:real` 与 `npm run smoke:personal:real:report`；
  后者会生成 `08-personal-assistant-anna-app/REAL_HANDOFF_SMOKE_ZH.md` 作为本次真实
  handoff 测试报告。
- 根目录补充 `npm run smoke:personal:healthkit` 与
  `npm run smoke:personal:healthkit:report`；后者会生成
  `08-personal-assistant-anna-app/HEALTHKIT_BRIDGE_SMOKE_ZH.md`，证明网页端读取的是
  companion 推送快照而不是默认模拟值。
- 根目录补充 `npm run smoke:personal:healthkit-doctor:report`，生成
  `08-personal-assistant-anna-app/HEALTHKIT_DOCTOR_ZH.md`，并由完整总报告纳入健康真机准备度证据。
- 根目录补充 `npm run smoke:personal:browser-handoff` 与
  `npm run smoke:personal:browser-handoff:report`；后者会生成
  `08-personal-assistant-anna-app/BROWSER_HANDOFF_SMOKE_ZH.md` 作为网页端真实外站打开证据，
  记录官方域名、打开方式、自然语言组合行程和人工接管状态。
- 根目录补充 `npm run smoke:personal:host` 与 `npm run smoke:personal:host:report`；
  后者会生成 `10-anna-local-host-lab/HOST_PERSONAL_ASSISTANT_SMOKE_ZH.md`，证明个人助理
  可在 Anna Local Host iframe 中经 Host SDK 与真实 Executa 完成 Companion 风格健康快照、旅行
  handoff、匿名字段包、自然语言机票+酒店组合接管、用户触发外站新页和 metadata-only 审计。
- 根目录补充 `npm run smoke:personal:ui` 与 `npm run smoke:personal:ui:report`；
  后者会生成 `08-personal-assistant-anna-app/UI_SMOKE_ZH.md`，证明网页端个人助理可
  完成 HealthKit 同意门、旅行 handoff 链接生成，并通过移动端无横向溢出检查。
- 根目录补充 `npm run smoke:personal:full:report`，串联 UI smoke、HealthKit doctor、HealthKit bridge
  smoke、真实外站 smoke、浏览器 handoff smoke 与 Host smoke，生成 `08-personal-assistant-anna-app/FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md`
  作为个人助理模式当前端到端测试总览。
- 官方 `anna-app dev` harness smoke 对 `uvx anna-app-runtime-local` 冷启动 bridge
  超时增加一次自动重试，避免首次安装 runtime 时 8 秒内部超时造成误报失败。

## 仍需外部条件的事项

- 三个 Anna App 已使用 `@anna-ai/cli@0.1.30` 完成
  `anna-app validate --strict`。`dev/publish` 仍需要 Anna host、账号和服务端环境。
- Amadeus 等真实旅行 API 需要用户自己的官方凭据、授权和明确行程外传同意。
- 真实订单、实名旅客、验证码和付款不会由这些项目自动执行。
- Apple Watch/iPhone 健康数据仍需要 iOS/watchOS Companion App 和 HealthKit 授权；
  当前实验不会通过浏览器蓝牙绕过 HealthKit。当前 Mac 的 doctor 报告会明确列出 Full Xcode、
  iOS toolchain 和签名身份等真机安装条件是否具备。
- Anna 的具体模型多模态能力需要主机正式能力清单；实验版只声明任务所需能力。
- 多模型工作区当前不直接调用模型；真实调度仍需要 Anna 主机提供模型注册表、供应商
  授权、上下文窗口和调用审计。
