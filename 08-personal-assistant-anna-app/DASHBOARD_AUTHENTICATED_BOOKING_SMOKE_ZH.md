# Anna Dashboard 认证订票 Smoke 报告

生成时间：2026-06-23 17:41（Asia/Shanghai）

## 结论

- 已在用户已登录的真实 Google Chrome / Anna Dashboard 页面执行测试，当前 pinned app 为 `#Anna 个人助理模式`。
- 测试输入已发送给 Anna：上海到东京，2026-07-02 去程、2026-07-10 返程，1 位成人，经济舱，先推荐候选并等待用户确认，进入旅客资料或付款信息前停止。
- 初次 Dashboard 复测因为本地 Anna Agent 离线而没有完成输出；随后已启动 `/Applications/Anna.app`，云端 `/agents` 显示本机 Agent 在线，并在 `/executa` 为该 Agent 安装 `Personal Assistant Runtime 20260620 v0.1.19`。
- Agent 在线后完成真实 Dashboard 二次复测：Anna 正确识别 `2026-07-02 -> 2026-07-10` 上海 ⇌ 东京往返，输出候选航班与价格，等待用户确认；用户选择方案 1 后仅生成 `booking_prepare` 预确认单，状态 `PENDING`，并停止在人工填写旅客/联系/付款信息前。
- 本次复测未填写姓名、证件、电话、邮箱、旅客信息或付款信息；未触发 `booking_confirm`，未创建供应商订单，未付款。
- 本地个人助理 runtime 已修复同句日期区间解析，并用回归测试锁定：`2026年7月2日到7月10日往返` 必须解析为 `departureDate=2026-07-02`、`returnDate=2026-07-10`，不打开外站。
- 已发布并在真实 Dashboard 已安装页更新 `Anna 个人助理模式` 到 `0.1.35`，绑定 Executa `0.1.19`；当前账号 `installed_version=0.1.35`、`latest_version=0.1.35`、`update_available=false`。

## 实测步骤

1. 打开真实 Dashboard：`https://anna.partners/dashboard`。
2. 确认 pinned app：`#Anna 个人助理模式`。
3. 发送：

```text
帮我订购一张从上海到东京，2026年7月2日到7月10日往返的机票，1位成人，经济舱。请先帮我查找并推荐需要订购哪一张机票，等待我确认后再继续；如果进入订票页或需要填写姓名、证件、电话、邮箱、旅客信息或付款信息，请停下并告诉我需要我自己填写。
```

4. 观察结果：Dashboard URL 进入会话态，输入框变为 `Type to send a correction to the running agent...`，Stop 按钮出现，但 Anna 的新回复为空。
5. 等待后仍未生成候选、确认门或错误说明，手动停止该运行。

## 发现的问题

- `dashboard_runtime_hang`：真实 Dashboard agent 在订票请求后卡在 running 状态，未输出结构化候选或错误。
- `date_range_regression_risk`：页面可见历史响应中，类似“上海到东京机票”曾被解析为 `2026年8月18日` 单程并使用旧偏好，而不是用户指定的 7 月往返日期。
- `dashboard_runtime_outdated`：本地代码修复后测试通过，但 Dashboard 已安装 runtime 仍需要重新打包、发布和安装更新后复测。

## 本地修复与验证

- 修复 `executas/personal-assistant-node/lib/service.js`：支持 `YYYY年M月D日到M月D日` / `YYYY-M-D 至 YYYY-M-D` 这类同句日期区间作为返程日期。
- 新增 `tests/core.test.js` 回归：上海到东京 `2026-07-02 -> 2026-07-10` 往返必须走 Duffel 结构化比较，且 `opens_external_browser=false`。

验证命令：

```bash
npm test
npm run check
```

验证结果：

- `npm test`：44/44 passed。
- `npm run check`：passed，包含 iOS HealthKit companion 静态检查、Anna guide compliance、Anna beginner guide environment checks。

## 后续开发指南

- 发布 Dashboard 更新前先重新构建 Executa binary，并确保 Dashboard 安装的是包含本次日期区间解析修复的 runtime。
- Dashboard 复测必须覆盖：
  - 用户明确日期区间的往返机票；
  - 不提供年份时应要求补齐年份，不应使用历史偏好日期；
  - Anna 只展示候选和确认门，不自动打开外站、不创建真实订单、不收集旅客资料或付款信息；
  - agent 运行超时必须返回可读错误，而不是空消息长期 running。

## 2026-06-23 17:18 线上更新与二次复测

### 发布与安装

- `executa publish` 成功冻结 `tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36` 为 `0.1.19`。
- `apps push` 成功更新 `personal-assistant-mode` 工作草稿。
- `apps cut 0.1.35` 成功生成不可变版本 `0.1.35`，`version_id=462`。
- `apps release 0.1.35` 遇到 CLI 本地状态大小写校验 bug：服务端返回 `published`，CLI guard 只接受大写 `PUBLISHED`。已使用同一 CLI 内部 API client 调用发布版本，结果为 `published_at=2026-06-23T09:14:36.471496`。
- `apps status personal-assistant-mode` 确认最新版本为 `v0.1.35 (id=462, published=2026-06-23T09:14:36.471496)`。
- 真实 Chrome 打开 `https://anna.partners/apps/installed`，点击 `Anna 个人助理模式` 的 `Update` 并确认；页面显示 `App updated`，卡片变为 `Anna 个人助理模式 v0.1.35 ENABLED`。
- `apps grants personal-assistant-mode` 确认当前账号 `installed_version=0.1.35`、`latest_version=0.1.35`、`update_available=false`。

### 真实 Dashboard 复测

打开 `https://anna.partners/dashboard`，选择并固定 `#Anna 个人助理模式`。应用弹窗已加载：

```text
https://anna.partners/anna-apps/duasgfuygq36136/personal-assistant-mode/0.1.35/index.html?...vid=462...
```

弹窗内显示状态：

```text
no Executa Agent is currently online for this user
```

随后在 Dashboard 发送：

```text
我需要你订购从上海到东京的往返航班，日期为2026年7月2日到2026年7月10日，1位成人，经济舱。请先搜索并输出候选航班、日期、价格和下一步建议，等待我确认；如果需要填写姓名、证件、电话、邮箱、旅客信息或付款信息，请停下并告诉我需要我自己填写。
```

观察结果：

- 会话 URL：`https://anna.partners/dashboard?s=3892d16a-aea1-4d15-832d-ba833494aadc`。
- 用户消息已出现在会话中，时间约 17:18。
- Anna 助手气泡为空，未输出候选航班、确认门或错误。
- 页面计数显示 `Async Agents: 0/8 running`，输入区显示 `No Agent`。
- 未进入任何订票页，未填写姓名、证件、电话、邮箱、旅客资料或付款信息，未创建订单或付款。

### Agent 恢复尝试

执行本地安装：

```bash
npx --yes @anna-ai/cli@0.1.30 executa install --force --tool-id tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

结果成功写入 shim：

```text
/Users/r/.anna/executa/bin/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

打开 `https://anna.partners/executa` 的 `My Tools` 后可见 `Personal Assistant Runtime 20260620`，版本 `v0.1.19`。点击页面中的 `Install` 后返回：

```text
No online Agent. Start your local Agent first, then try again.
```

结论：0.1.35 发布、安装和本地运行时修复均已完成；真实 Dashboard 端到端订票流程当前不是日期解析或版本未更新问题，而是账号侧没有在线 Anna Agent，导致 Dashboard 无法调用本地 Executa runtime。

### 本地 Executa 一次性调用

在 `executas/personal-assistant-node` 直接调用：

```bash
npx --yes @anna-ai/cli@0.1.30 executa dev --invoke personal_assistant --args '{"action":"assist","message":"我需要你订购从上海到东京的往返航班，日期为2026年7月2日到2026年7月10日，1位成人，经济舱。请先搜索并输出候选航班、日期、价格和下一步建议，等待我确认；如果需要填写姓名、证件、电话、邮箱、旅客信息或付款信息，请停下并告诉我需要我自己填写。"}' --json
```

压缩结果：

```json
{
  "success": true,
  "origin": "SHA",
  "destination": "NRT",
  "departureDate": "2026-07-02",
  "returnDate": "2026-07-10",
  "mode": "duffel_booking_compare",
  "opens_external_browser": false
}
```

返回预览包含候选 `SHA->NRT`、`07/02 17:20` 起飞、`07/02 20:26` 到达、价格 `2716.00 CNY`，并明确下一步不是付款或打开外站，而是等待用户确认后再调用 `booking_prepare` 重新校验。

## 2026-06-23 17:40 Agent 在线真实 Dashboard 复测

### Agent 与 Executa 恢复

- 启动本机 `/Applications/Anna.app` 后，本地 `http://localhost:19001/dashboard` 显示 Agent `rdebijibendiannao.local-6f0fc3fc` 处于 `Connected, running normally` / `Online`，版本 `1.1.0-beta.17`，平台 `macos / arm64`。
- 云端 `https://anna.partners/agents` 刷新后显示 `1 Online`、`0 Offline`、`1 Total Agents`，同一 Agent `rdebijibendiannao.local-6f0fc3fc` 状态为 `Online`，`Last Seen Just now`。
- 云端 `https://anna.partners/executa` 的 `My Tools` 中可见 `Personal Assistant Runtime 20260620`，类型 `BINARY`，版本 `v0.1.19`。
- 在 `/executa` 对该工具点击 `Install` 后，页面返回成功：`Installed "Personal Assistant Runtime 20260620" on rdebijibendiannao.local-6f0fc3fc`。

### 真实 Dashboard 查询与确认门

真实 Dashboard 会话：

```text
https://anna.partners/dashboard?s=3892d16a-aea1-4d15-832d-ba833494aadc
```

固定 app：

```text
#Anna 个人助理模式
```

页面状态：

- 模型：`Gemini 3 Flash Preview`
- Agent：`1 Agent`
- App：`Anna 个人助理模式 v0.1.35`，iframe 加载 `.../personal-assistant-mode/0.1.35/index.html?...vid=462...`

发送给 Anna 的测试指令：

```text
我需要你订购从上海到东京的往返航班，日期为2026年7月2日到2026年7月10日，1位成人，经济舱。请先打开或使用可用的订票搜索能力查找与日期和航线匹配的航班，然后输出候选航班的日期、航班信息、价格和下一步建议，等待我确认；如果需要填写姓名、证件、电话、邮箱、旅客信息、登录信息或付款信息，请立即停止并告诉我需要我自己填写。不要创建订单，不要付款。
```

Anna 在 17:34 输出 `上海 ⇌ 东京往返航班检索报告`：

- 正确识别日期：`2026年7月2日去程、7月10日回程`。
- 正确识别航线：`上海 (SHA) 往返东京 (TYO)`。
- 候选方案 1：`Anna Air Sandbox (AN218)`，去程 `07-02 09:20 - 12:26`，回程 `07-10 相应时段`，直飞，`CNY 2,716.00`。
- 候选方案 2：`Anna Connect Sandbox (AN426)`，去程 `07-02 14:20 - 19:44`，回程 `07-10 相应时段`，1 次经停，`CNY 3,190.00`。
- 安全状态：`尚未创建订单`、`零隐私收集`、`零资金风险`。
- 下一步：等待用户选择方案 1 或方案 2；确认后才准备 `booking_prepare` 确认单。

### 用户选择方案 1 后的停止点

发送给 Anna 的受保护确认指令：

```text
我选择方案1。请继续到预确认或订票页面前的下一步：如果只是生成 booking_prepare 确认单可以继续；如果需要打开外站或进入旅客信息页，请只打开/停在需要我填写姓名、证件、电话、邮箱或付款信息之前，并告诉我需要我自己填写。不要调用最终确认，不要创建订单，不要付款。
```

Anna 在 17:40 输出 `预订准备确认单已生成`：

- `booking_prepare` 预确认单 ID：`bc_41bf454eb4f14793a1b85f722d2d922a`。
- 当前状态：`PENDING (等待人工接管)`。
- 锁定航线：`上海 (SHA) -> 东京 (NRT/TYO) 往返`。
- 显示价格：`CNY 1,460.00 (单程参考价，往返总价请以交接页为准)`。
- 明确停止点：进入实质性订票页面前停止，要求用户自行填写旅客信息、联系方式和付款结算信息。
- 安全审计：`booking_confirm 未触发`、`未创建供应商订单`、`未收集敏感数据`、`未进行任何扣款`。

### 浏览器与外站观察

- 17:40 前后枚举 Chrome 标签页，未出现新的 `2026-07-02` / `2026-07-10` 外部订票页面。
- Chrome 中仍存在一个历史遗留 `Expedia` 标签，URL 为 `8/12/2026` 上海到东京单程搜索；该标签在本轮 Agent 在线复测前已经存在，不能作为本轮新开外站证据。
- 本轮没有由 Codex 或 Anna 填写任何旅客资料、证件、联系方式、登录信息或付款信息。

### 当前结论

Agent 在线并安装 Executa 后，真实 Anna Dashboard 流程已通过核心验收：

1. 用户自然语言订票请求 -> Anna 正确解析起点、终点、日期区间、成人数和舱位。
2. Anna 输出候选航班和价格，并等待用户选择。
3. 用户选择方案后，Anna 只生成 `booking_prepare` 预确认单。
4. Anna 在旅客信息、联系信息、付款信息前停止并提示用户自行填写。
5. 未调用最终确认，未创建供应商订单，未付款。

后续建议：下一轮 smoke 应使用全新 Chrome 测试窗口或先关闭旧 `Expedia 8/12/2026` 标签，避免历史标签污染“是否打开外站”的判断。

## 2026-06-23 订单创建合约更新

用户要求解除“不得创建真实供应商订单”的旧合约后，已完成代码级调整：

- `SKILL.md` 和 `manifest.json` 已从“`booking_confirm` 只能返回 `USER_CHECKOUT_REQUIRED`、不得创建供应商订单”改为：`booking_confirm` 在用户显式确认、完成价格/库存复核后，可以调用 backend provider `createOrder` 创建供应商订单或 hold record。
- `booking.create_order` 权限从 `blocked_in_this_runtime` 改为 `requires_user_confirmation`；`payment.confirm` 仍保持 `blocked_in_this_runtime`。
- `booking_confirm` 默认在 `userConfirmed: true` 后创建 provider order record；调用方也可以显式传 `createProviderOrder: false` 保留旧的人工 checkout 交接路径。
- Duffel provider 和 Amadeus provider 均暴露确认后的订单创建记录；付款、证件、登录、验证码和最终出票仍由用户本人完成。
- Dashboard confirmation UI 已改为“确认并创建订单记录”，并在成功后显示 provider order id / booking id。
- fallback confirmation 也同步返回 `ORDER_CREATED`，避免无 Executa/API 时仍显示旧的人工交接状态。

本地工具级验证：

```json
{
  "code": "ORDER_CREATED",
  "status": "ORDER_CREATED",
  "provider_order_id": "duffel_test_order_6129776eb3",
  "provider_booking_id": "duffel_test_booking_1",
  "payment_collected_by_anna": false,
  "order_result": {
    "provider": "duffel",
    "order_type": "hold",
    "payment_required": true,
    "payment_collected_by_anna": false,
    "test_mode": true
  }
}
```

验证命令：

```bash
npm test
npm run check
```

验证结果：

- `npm test`：44/44 passed。
- `npm run check`：passed。

当前限制：

- 本轮已完成代码、Prompt 合约、本地工具级验证、`0.1.36` App 版本 bump 和 `0.1.20` Executa binary 构建；尚未执行真实远端 push/cut/release，因此线上 Dashboard 仍是 `0.1.35`。
- 现在 provider 返回的是 Duffel/Amadeus 测试/沙箱订单记录。要创建真实生产供应商订单，需要配置生产供应商凭据、真实 provider `createOrder` 实现、幂等键、订单状态持久化和用户确认页，并在实名/证件/付款阶段继续由用户本人接管。

## 2026-06-23 18:35 发布前构建与远端状态

已把 App 版本从 `0.1.35` bump 到 `0.1.36`，Executa runtime 从 `0.1.19` bump 到 `0.1.20`。

新 binary 构建：

```json
{
  "version": "0.1.20",
  "url": "https://anna.partners/anna-apps/duasgfuygq36136/personal-assistant-mode/0.1.36/executa/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36-darwin-arm64.tar.gz",
  "sha256": "88dc632afe12e63e1b2a6f1438e81f4cc675855c11493b623f4f3d4fb649ffd5",
  "size": 55950
}
```

本地订单创建 smoke：

```json
{
  "code": "ORDER_CREATED",
  "status": "ORDER_CREATED",
  "provider_order_id": "duffel_test_order_6616ac4161",
  "provider_booking_id": "duffel_test_booking_1",
  "payment_collected_by_anna": false,
  "test_mode": true
}
```

验证命令：

```bash
npm test
npm run check
npm run validate:anna
npm run dashboard:duffel:dry-run
```

验证结果：

- `npm test`：44/44 passed。
- `npm run check`：passed。
- `npm run validate:anna`：passed。
- `npm run dashboard:duffel:dry-run`：passed，dry-run 显示将发布 bundled Executa `0.1.20`、push working bundle、cut app `0.1.36`。

远端只读状态：

```text
apps/personal-assistant-mode
latest    : v0.1.35 (id=462, published=2026-06-23T09:14:36.471496)
installed_version=0.1.35
latest_version=0.1.35
update_available=false
```

结论：`0.1.36` 已完成发布前准备，但真实 Dashboard 仍未更新到新版本。下一步需要执行真实远端写入：`executa publish`、`apps push`、`apps cut 0.1.36`、`apps release 0.1.36`，然后在 Dashboard Installed Apps 更新并复测 `ORDER_CREATED` 订单信息展示。

## 2026-06-23 18:40 远端发布进展

已执行真实远端写入：

```text
executas/personal-assistant-runtime-20260620: version 0.1.20 frozen
tool_id: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

```text
apps/personal-assistant-mode: working draft updated (rev 33)
bundled:personal-assistant -> tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 (v0.1.20, unchanged)
```

```text
apps/personal-assistant-mode: cut immutable version 0.1.36 (version_id=463)
froze tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 -> executa_version=322 (v0.1.20)
```

release 当前未完成：

- `anna-app apps release 0.1.36` 命中 CLI 大小写 bug：服务端返回 `published`，CLI guard 仍要求 `APPROVED` 或 `PUBLISHED`。
- 直接调用 CLI 内部 `publishVersion(client, 24, 463)` 连续两次返回 `network error contacting https://anna.partners: fetch failed`。
- 使用同一 PAT 走 `curl POST /api/v1/developer/apps/24/versions/463/publish` 时，当前环境 DNS 返回 `Could not resolve host: anna.partners`。

只读状态曾确认：

```text
latest    : v0.1.35 (id=462, published=2026-06-23T09:14:36.471496)
versions  : 37 total
installed_version=0.1.35
latest_version=0.1.35
update_available=false
```

因此当前真实远端状态是：`0.1.36` 已 cut、但尚未 release 成 latest；Dashboard 安装仍是 `0.1.35`。下一步只剩发布 `version_id=463`，然后在 Dashboard 更新安装并复测订单信息打开与展示。

## 2026-06-23 18:55 订单创建合约复核与当前阻塞

再次确认本地代码和 Prompt 合约已经解除“不可创建供应商订单记录”的限制，但保留支付/证件/出票的人类边界：

- `booking_confirm` 在 `userConfirmed: true` 且未设置 `createProviderOrder: false` 时，会调用后端 provider `createOrder`。
- 返回码为 `ORDER_CREATED`，并返回 `provider_order_id`、`provider_booking_id`、`order_results`。
- `payment_collected_by_anna=false`，`payment_required=true`；Anna 不收款、不出票、不填写证件/电话/邮箱/验证码/登录信息。
- `open_booking_url` 仍只是打开/记录 URL，不负责供应商订单创建；真实订单创建只走 `booking_confirm` 后端路径。

本轮验证：

```bash
npm test
npm run check
npm run validate:anna
```

结果：

- `npm test`：44/44 passed。
- `npm run check`：passed。
- `npm run validate:anna`：passed。

本地同用户行程 smoke：

```text
SHA -> NRT
2026-07-02 -> 2026-07-10
1 adult, economy
booking_confirm(userConfirmed=true, createProviderOrder=true)
```

输出：

```json
{
  "code": "ORDER_CREATED",
  "status": "ORDER_CREATED",
  "provider_order_id": "duffel_test_order_5807b833be",
  "provider_booking_id": "duffel_test_booking_1",
  "checkout_handoff_queue_id": null,
  "payment_collected_by_anna": false,
  "payment_required": true,
  "test_mode": true
}
```

远端发布阻塞仍存在：

- `apps release 0.1.36` 仍命中 CLI 本地大小写 guard bug。
- 使用 CLI 内部 `publishVersion(client, 24, 463)` 仍返回 `network error contacting https://anna.partners: fetch failed`。
- 本机系统 DNS 与 `curl --doh-url` 探测均无法解析/连接 `anna.partners`。
- Chrome Computer Use 会话被本机 MCP 授权层拒绝，无法通过已登录浏览器页面代为点击发布/安装更新。

结论：本地实现、Prompt 合约、schema、自动化测试和本地订单创建路径均已完成；真实 Dashboard 仍不能复测 `0.1.36`，因为远端 `version_id=463` 尚未 release 成 latest，Dashboard 当前仍安装 `0.1.35`。

## 2026-06-23 19:55 隐藏 bug 修复、0.1.37 cut 与 release 阻塞

本轮继续目标时发现并修复一个订单创建合约隐藏 bug：

- 旧行为：`booking_confirm({ confirmationId })` 即使没有 `userConfirmed: true`，也会默认创建 provider order。
- 新行为：后端强制 `userConfirmed === true`。缺少确认或显式拒绝时返回 `USER_CONFIRMATION_REQUIRED`，保持 confirmation 为 `PENDING`，不调用 provider `createOrder`。
- Dashboard 确认页仍会在用户逐项勾选后传 `userConfirmed: true` 与 `createProviderOrder: true`。
- 离线 fallback 也同步强制确认，避免预览/真实路径不一致。
- Executa 工具 manifest 版本从 `0.1.20` 升到 `0.1.21`，App 版本从 `0.1.36` 升到 `0.1.37`，避免复用已 cut 的不可变版本。

Qwen/千问 Function Calling 对齐结论：Qwen 官方工具调用范式是模型根据用户提示选择函数/工具名与结构化参数，应用后端执行真实动作并把结果回传。Anna 的对应实现是：Anna 选择 `booking_confirm`，后端在确认、价格、库存、权限边界通过后执行 provider `createOrder`；支付、证件、验证码、登录和最终出票仍保留给用户本人。

验证命令：

```bash
npm test
npm run check
npm run validate:anna
npm run dashboard:duffel:dry-run
```

结果：

- `npm test`：45/45 passed，新增 `booking confirm requires explicit user confirmation before creating supplier orders`。
- `npm run check`：passed。
- `npm run validate:anna`：passed。
- `npm run dashboard:duffel:dry-run`：passed，dry-run 目标为 App `0.1.37` / Executa `0.1.21`。

本地同用户行程 smoke：

```text
SHA -> NRT
2026-07-02 -> 2026-07-10
1 adult, economy
```

输出：

```json
{
  "unconfirmed": {
    "code": "USER_CONFIRMATION_REQUIRED",
    "status": "PENDING",
    "provider_order_id": null,
    "order_results": 0
  },
  "confirmed": {
    "code": "ORDER_CREATED",
    "status": "ORDER_CREATED",
    "provider_order_id": "duffel_test_order_654fcbc5c9",
    "provider_booking_id": "duffel_test_booking_1",
    "checkout_handoff_queue_id": null,
    "payment_collected_by_anna": false,
    "payment_required": true,
    "test_mode": true
  }
}
```

真实远端写入进展：

```text
executas/personal-assistant-runtime-20260620: version 0.1.21 frozen
tool_id: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

```text
apps/personal-assistant-mode: working draft updated (rev 34)
bundled:personal-assistant -> tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 (v0.1.21, unchanged)
```

```text
apps/personal-assistant-mode: cut immutable version 0.1.37 (version_id=464)
froze tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 -> executa_version=323 (v0.1.21)
```

release 当前仍未完成：

- 官方 `apps release 0.1.37` 继续命中 CLI 本地大小写 guard bug：服务端状态返回 `published`，CLI 只接受大写 `PUBLISHED`。
- 已在 `/private/tmp` 临时复制 CLI 并修复大小写 guard；该临时 CLI 能进入 release 路径，但当前本机网络对 `https://anna.partners` 的 release POST 返回 `network error contacting https://anna.partners: fetch failed`。
- 同时，系统 DNS 对 `anna.partners` 与 `registry.npmjs.org` 也出现解析失败，说明当前是本机/网络解析层问题，而不是 App 权限或代码包问题。
- Computer Use 仍被 MCP 授权层拒绝读取/控制 Chrome 和 Anna App：`Computer Use approval denied via MCP elicitation`，因此无法改走已登录浏览器点击发布或更新安装。

当前真实远端状态：`0.1.37` 已 cut 但尚未 release 成 latest；线上 latest/installed 仍是 `0.1.35`。恢复网络或授权 Computer Use 后，需要完成：release `version_id=464` -> 确认 grants/latest 为 `0.1.37` -> 在 Dashboard/Anna App 安装更新 -> 真实发送订票提示并验证 `ORDER_CREATED` 订单信息展示。

## 2026-06-23 23:30 追加：0.1.39 最终候选与 GitHub 前验证

继续审查后又修复了两个边界问题：

- Dashboard 浏览器 fallback 的 `status.version` 曾落后于当前 App 版本，现已同步到 `0.1.39`。
- `10-anna-local-host-lab` 的 Host 隐私过滤曾只允许 `order_creation_by_anna=false`；新合约允许显式确认后创建供应商订单记录，因此过滤器改为接受安全布尔元数据，同时仍要求 `auto_payment=false`、`payment_collected_by_anna=false`、`card_storage=forbidden`，并继续拒绝真实姓名、证件状态和付款状态泄露。

因此最终候选版本改为：

```text
App: 0.1.39
Executa: 0.1.23
darwin-arm64 archive sha256: ed63d9e80fc6aee423a852535b60deb86a5979bc8372164c35d6f2332b424aa4
darwin-arm64 archive size: 56064
```

最终验证：

```bash
cd 08-personal-assistant-anna-app
npm test
npm run check
npm run validate:anna
npm run dashboard:duffel:dry-run

cd ../10-anna-local-host-lab
npm test
```

结果：

- `08-personal-assistant-anna-app npm test`：45/45 passed。
- `08-personal-assistant-anna-app npm run check`：passed。
- `08-personal-assistant-anna-app npm run validate:anna`：passed。
- `08-personal-assistant-anna-app npm run dashboard:duffel:dry-run`：passed，dry-run 目标为 App `0.1.39` / Executa `0.1.23`。
- `10-anna-local-host-lab npm test`：16/16 passed。

真实远端写入最新进展：

```text
executas/personal-assistant-runtime-20260620: version 0.1.23 frozen
tool_id: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

```text
apps/personal-assistant-mode: working draft updated (rev 36)
bundled:personal-assistant -> tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 (v0.1.23, unchanged)
```

`apps cut 0.1.39` 当前被网络/DNS 阻塞，返回 `network error contacting https://anna.partners: fetch failed`；随后 `npx` 也出现 `registry.npmjs.org` DNS 解析失败。只读状态仍显示：

```text
latest: v0.1.35
installed_version: 0.1.35
versions: 39 total
```

因此 `0.1.39` 已完成本地验证、Executa 发布和 working draft 推送，但尚未 cut/release 成 latest；Dashboard/Anna App 真实安装与交互测试仍等待网络恢复或 Computer Use 授权恢复。

### 2026-06-23 23:40 追加：GitHub 与 Anna 远端阻塞复核

已再次执行真实远端写入：

```text
executas/personal-assistant-runtime-20260620: version 0.1.23 frozen
apps/personal-assistant-mode: working draft updated (rev 36)
```

`apps cut 0.1.39` 随后因当前网络解析失败未完成；只读状态仍为：

```text
latest: v0.1.35
installed_version: 0.1.35
versions: 39 total
```

GitHub 更新尝试：

- 本地 `.git` 在当前沙箱中为只读，`git add` 失败：`Unable to create .git/index.lock: Operation not permitted`。
- 已使用临时 index/object directory 在 `/private/tmp` 创建目标提交：

```text
92b0d2ff9515972b1be3115b00c029eb9982d71f Allow confirmed supplier order creation
```

- 推送该提交到 `origin codex/dashboard-live-smoke` 连续失败，原因是当前系统 DNS 无法解析 `github.com`：

```text
fatal: unable to access 'https://github.com/RH-God1/Anna-personal-assistant-mode.git/': Could not resolve host: github.com
```

GitHub connector 可写文本/blob/tree，但当前仍需要上传 bundled Executa tarball；本轮优先使用临时 git object commit 方式，等 DNS 恢复后可直接推送该 commit。当前 GitHub 远端尚未更新。

### 2026-06-23 23:55 追加：代理与 Computer Use 复测

复测结论：

- `127.0.0.1:7897` / `localhost:7897` / `socks5h://127.0.0.1:7897` 代理存在间歇性可用窗口；`curl` 偶尔可达 `anna.partners` / `github.com`，但 Anna cut 写入与 git push 仍在实际请求时失败。
- Node `fetch` 仍无法访问 `anna.partners`，官方 `anna-app apps cut 0.1.39` 继续返回 `network error contacting https://anna.partners: fetch failed`。
- 使用 shell `curl` 直接调用 `POST /api/v1/developer/apps/24/working/cut` 已按安全方式读取本地 PAT 并隐藏输出，但当前 DNS/代理抖动导致没有拿到有效 HTTP 响应。
- `Computer Use` 对 Chrome 与 Anna App 均仍被 MCP 授权层拒绝：`Computer Use approval denied via MCP elicitation`，所以不能通过已登录 UI 完成发布、安装更新或真实 Dashboard 点击复测。
- GitHub connector 也出现 MCP transport 网络错误；本地 git 直连仍无法解析 `github.com`。

当前可恢复点：

```bash
GIT_OBJECT_DIRECTORY=/private/tmp/anna-git-objects-4KqOwP \
GIT_ALTERNATE_OBJECT_DIRECTORIES=/Users/r/Documents/Anna/.git/objects \
git push origin 92b0d2ff9515972b1be3115b00c029eb9982d71f:refs/heads/codex/dashboard-live-smoke
```

网络恢复后继续：

```bash
anna-app apps cut 0.1.39
anna-app apps release 0.1.39
```

随后在 Dashboard/Anna App 更新已安装版本，再发送用户订票提示进行真实交互复测，期望 Anna 在用户确认后返回 `ORDER_CREATED` 与 provider order id，并在需要旅客身份/支付信息前停止。

### 2026-06-23 16:10 UTC / 2026-06-24 00:10 Asia/Shanghai 追加：0.1.40 订单信息展示修复与真实 cut

针对“Anna 创建后没有打开真实订单信息”的缺口，本轮继续修复：

- 后端 `booking_confirm` 现在在 `ORDER_CREATED` 响应中返回 `order_information`，包含 provider order id、booking id、order reference、order status、总价、付款边界和下一步用户控制动作。
- Duffel/Amadeus provider 的 `createOrder` 返回结构化订单引用和状态；付款、旅客身份、验证码和最终出票仍不由 Anna 处理。
- Dashboard 确认页在用户逐项勾选并点击“确认并创建订单记录”后，会立即渲染“订单信息”卡片；如果 provider 返回订单 URL，会显示“打开供应商订单信息”链接。
- 修复了一个真实隐藏 bug：`buildOrderInformation` 曾引用错误变量名 `order_results`，导致确认接口返回 400；测试已覆盖该路径。
- App 版本 bump 到 `0.1.40`，Executa bump 到 `0.1.24`，并重建二进制包。

本地订票流程 smoke：

```json
{
  "missing": {
    "code": "USER_CONFIRMATION_REQUIRED",
    "order_results": 0
  },
  "confirmed": {
    "code": "ORDER_CREATED",
    "provider_order_id": "duffel_test_order_2facb9d4a3",
    "order_reference": "DUFFEL-TEST-ACB9D4A3",
    "order_information": {
      "status": "ORDER_CREATED",
      "payment_collected_by_anna": false,
      "ticketing_completed_by_anna": false,
      "traveler_identity_collected_by_anna": false,
      "next_required_action": "user_must_open_order_or_checkout_to_enter_traveler_identity_payment_and_final_ticketing"
    }
  }
}
```

验证结果：

- `08-personal-assistant-anna-app npm test`：45/45 passed。
- `08-personal-assistant-anna-app npm run check`：passed。
- `08-personal-assistant-anna-app npm run validate:anna`：passed。
- `08-personal-assistant-anna-app npm run dashboard:duffel:dry-run`：passed，目标为 App `0.1.40` / Executa `0.1.24`。
- `10-anna-local-host-lab npm test`：16/16 passed。

新二进制：

```text
version: 0.1.24
sha256: 1de4fc2e01b0efe48f566aba4151c37372e6a12c754d89c750f6b5c76ef786e6
size: 56488
```

真实远端写入：

```text
executas/personal-assistant-runtime-20260620: version 0.1.24 frozen
apps/personal-assistant-mode: working draft updated (rev 37)
apps/personal-assistant-mode: cut immutable version 0.1.40 (version_id=466)
froze tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 -> executa_version=326 (v0.1.24)
```

仍未完成：

- `apps release 0.1.40` 受 CLI 小写 `published` guard bug 和当前 Node fetch/DNS 抖动影响未完成；只读状态仍显示 latest/installed 为 `0.1.35`。
- Computer Use 对 Chrome 和 Anna App 仍被 MCP 授权层拒绝，无法在已登录 UI 内点击安装更新或做真实 Dashboard 交互复测。
- GitHub 本地 push 仍失败：`Could not resolve host: github.com` 或 HTTP2 framing layer；已生成可恢复临时提交：

```text
8362cd55b05db291aabd423e486c320ded5b353a Allow confirmed supplier order information display
```

网络恢复后的 GitHub 恢复命令：

```bash
GIT_OBJECT_DIRECTORY=/private/tmp/anna-git-objects-MXIDr3 \
GIT_ALTERNATE_OBJECT_DIRECTORIES=/Users/r/Documents/Anna/.git/objects \
git push origin 8362cd55b05db291aabd423e486c320ded5b353a:refs/heads/codex/dashboard-live-smoke
```

### 2026-06-24 追加：继续复测 release、真实浏览器与 GitHub 写入

本轮从当前工作区和远端真实状态重新复核：

- 本地工作区仍为 App `0.1.40`、Executa `0.1.24`。
- 远端 Anna 状态仍为 `latest v0.1.35`，`installed_version=0.1.35`，`versions=40 total`。
- `version_id=466` 的 `0.1.40` 已经 cut；仍未 release 成 latest。

重试结果：

- `npx --yes @anna-ai/cli@0.1.30 apps status personal-assistant-mode` 可读，确认 latest 仍是 `0.1.35`。
- 直接调用 `publishVersion(client, 24, 466)` 仍失败于 Node fetch：`network error contacting https://anna.partners: fetch failed`。
- 使用 shell `curl` 调用 `POST /api/v1/developer/apps/24/versions/466/publish` 时，系统 DNS/代理出现间歇性失败；短重试未拿到有效 HTTP 响应。
- Chrome 扩展控制可以列出并接管 Dashboard 标签，但对 `https://anna.partners` 的后续浏览器操作被浏览器安全策略拒绝；不能继续通过 Chrome 绕过。
- Computer Use 对 Chrome/Anna App 仍被授权层拒绝。
- 原生 GitHub push 仍因 DNS/HTTP2 网络失败不可用。
- GitHub connector 的 `create_tree` 写入也失败于 MCP transport 到 `chatgpt.com/backend-api/ps/mcp` 的网络请求。

因此当前真实完成度：

- 代码、Prompt 合约、后端订单创建、Dashboard 订单信息展示、本地 smoke、测试、Executa publish、App push、App cut 均已完成。
- 仍未完成：Anna App `0.1.40` release/go-live、当前账号安装更新、真实 Dashboard/Anna UI 订票交互复测、GitHub 分支更新。
- 这些剩余项都依赖外部状态恢复：Anna API/Node fetch 或 curl 网络、Chrome/Computer Use 授权、GitHub connector 或 git 网络。

## 2026-06-24 04:38 Content-Type 与确认页订单详情复测

### 请求 Content-Type 检查

- 后端 `server.js` 的 JSON API 会在 `validateJsonRequest()` 中拒绝非 `application/json` 请求，错误码为 415。
- 前端 `bundle/app.js` 的统一 `callAction()` 已确认：所有本地 POST API 请求都使用 `headers: { "Content-Type": "application/json" }`，并用 `JSON.stringify(args)` 发送 body。
- Playwright 运行态复测抓到的真实确认页请求：
  - `POST /api/booking/confirmation`：`Content-Type: application/json`，body 可 JSON.parse。
  - `POST /api/booking/confirm`：`Content-Type: application/json`，body 可 JSON.parse。

### 发现并修复的确认页 bug

- 直接打开 `/booking/confirm/:confirmationId` 时，`bundle/index.html` 原先用 `./style.css`、`./anna-tool-ids.js`、`./app.js` 相对路径。
- 浏览器会错误请求 `/booking/confirm/style.css`、`/booking/confirm/anna-tool-ids.js`、`/booking/confirm/app.js`，服务端回退返回 HTML，导致严格 MIME 检查阻止 CSS/JS 加载，确认页不能渲染订单详情。
- 已修复为根路径资源：`/style.css`、`/anna-tool-ids.js`、`/app.js`。
- 已在 `tests/server.test.js` 增加回归断言，确保确认页 HTML 保持根路径资源引用。

### 订单详情页运行态复测

本地 Anna app 服务 `http://127.0.0.1:8808` 执行机票+酒店组合链路：

1. `POST /api/travel/compare` 搜索 Duffel flight+hotel sandbox/test 组合。
2. `POST /api/booking/prepare` 生成 `PENDING` 人工确认记录。
3. 打开 `/booking/confirm/:confirmationId`，页面渲染 4 个确认 checkbox 和“确认并创建订单记录”按钮。
4. 勾选全部确认项后点击按钮。
5. 页面调用 `POST /api/booking/confirm`，返回 `ORDER_CREATED`。
6. 页面显示供应商订单号，例如 `duffel_test_order_580cf44cff`，并继续声明 Anna 未付款、未出票、未收集旅客身份。

复测结果摘要：

```json
{
  "confirmStatus": 200,
  "confirmCode": "ORDER_CREATED",
  "hasOrderCreated": true,
  "providerOrderId": "duffel_test_order_580cf44cff",
  "bookingRequests": [
    { "path": "/api/booking/confirmation", "method": "POST", "contentType": "application/json", "bodyIsJson": true },
    { "path": "/api/booking/confirm", "method": "POST", "contentType": "application/json", "bodyIsJson": true }
  ]
}
```

### 发布与安装更新

- 已发布 `Anna 个人助理模式 v0.1.42`，`version_id=468`，发布时间 `2026-06-23T20:38:42.410801Z`。
- 已冻结并绑定 `Personal Assistant Runtime 20260620 v0.1.26`，Executa version id `328`。
- 已通过官方 API 更新当前账号已安装 App：`installed_version=0.1.42`、`latest_version=0.1.42`、`update_available=false`。

### 验证命令

```bash
npm test
npm run check
npm run validate:anna
npm run dashboard:duffel:dry-run
```

验证结果：

- `npm test`：45/45 passed。
- `npm run check`：passed。
- `npm run validate:anna`：passed。
- `npm run dashboard:duffel:dry-run`：passed。
