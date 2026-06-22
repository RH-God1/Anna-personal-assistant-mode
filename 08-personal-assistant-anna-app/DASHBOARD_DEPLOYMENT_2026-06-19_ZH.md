# Anna Dashboard 投放记录

生成时间：2026-06-19 23:14:41 CST

## 范围

- 投放目标：`https://anna.partners/dashboard` 中的 `personal-assistant-mode`
  / `Anna 个人助理模式`。
- App ID：`24`。
- 本次只投放个人助理模式，以及个人助理内的机票/酒店匿名接管能力。
- 明确未投放：`02-bilingual-focus-flow` / `双语 Focus Flow`。

## 已完成

- 使用 `@anna-ai/cli@0.1.30` 将 `08-personal-assistant-anna-app` 推送到
  `https://anna.partners`。
- 远端已切出不可变版本 `v0.1.4`，`version_id=135`。
- 已在 Chrome / Anna Developer Console 点击安装 `Anna個人助理模式` 草稿；
  Dashboard 提示：`已安裝「Anna個人助理模式」(v0.1.4) — 現在可以在聊天中使用`。
- 已在 `https://anna.partners/dashboard` 中以 `1 Agent` 运行实际测试请求：
  上海到东京机票 + 东京酒店 2 晚，1 位成人，仅生成匿名候选和官方接管边界。
- Dashboard 实际回复包含“多模型集体思考”、匿名航班/酒店候选、隐私隔离、
  不填写姓名/证件/电话/邮箱、不确认订单、不付款的边界说明。
- 当前界面文案显示为 `运用多个大模型集体思考`。
- 已修复 `bundle/anna-tool-ids.js` 覆盖 Host 注入 tool id 的问题，使同一包可同时
  在 Anna Dashboard 使用 server tool id、在 Anna Local Host 使用本地注入 tool id。
- Bundled Executa 保持为个人助理工具：
  `tool-duasgfuygq36136-personal-assistant-rybf3xa9`。
- Dashboard 元数据已同步：
  - 名称：`Anna 个人助理模式`
  - 分类：`utilities`
  - tagline：`A multimodal, context-aware and privacy-first personal mode for Anna.`
  - description：`个人助理实验模式，包含模型能力路由、天气与空气质量、经同意的健康数据桥接，以及运用多个大模型集体思考的回复策略。`
- 本地 App 版本已同步到 `0.1.4`。

## 远端状态

- `apps status personal-assistant-mode`：
  - status：`pending_review`
  - latest：`v0.1.4 (id=135, published=—)`
  - versions：`5 total`
- `apps grants personal-assistant-mode`：
  - 当前安装版本：`0.1.4`
  - latest_version：`0.1.4`
  - update_available：`false`
- App 仍处于 `pending_review`，尚未公开 release/go live；但开发者账号已安装
  `0.1.4`，可在 Dashboard 聊天中实际运行测试。

## 验证

- `npm run verify`：通过。
- `npm run check`：通过。
- `npm test`：34 项通过。
- `npm run validate:anna`：通过。
- `npm run smoke:anna`：通过。
- `npm run smoke:personal:full:report`：通过，并生成
  `FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md`。
- Chrome / Dashboard 实测：通过。

完整 smoke 覆盖：

- 个人助理 UI。
- HealthKit 同意门与 companion 风格快照。
- 机票/酒店匿名字段包。
- Expedia Flights、Booking.com、Trip.com Hotels 人工接管。
- 自然语言“机票+酒店”组合请求。
- Host SDK、Executa、metadata-only 审计。

## 当前限制

- Anna 服务器尚未允许 `v0.1.4` 公开上线，因为 App 仍在 `pending_review`。
- Chrome Extension 可列出和打开标签页，但读取 Dashboard DOM/screenshot 不稳定；
  本次改用 Computer Use 完成 Developer Console 安装和 Dashboard 实际运行。
- 直接 `curl https://anna.partners/dashboard` 返回 `Could not validate credentials`，
  说明 Dashboard UI 操作需要浏览器登录态，不能用无凭证 HTTP 请求替代。
- Dashboard 主体运行测试时曾优先触发外部搜索型工具，最终仍正确停留在匿名候选与
  人工接管边界；不会替用户下单或付款。

## 下一步

1. 等待 Anna 远端审核通过，使 App 状态变为 `APPROVED` 或 `PUBLISHED`。
2. 审核通过后执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.4
```

3. release 成功后重新运行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
npm run smoke:personal:full:report
```
