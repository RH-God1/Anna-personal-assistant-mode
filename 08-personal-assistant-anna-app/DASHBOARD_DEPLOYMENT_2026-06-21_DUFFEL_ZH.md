# Anna Dashboard Duffel 接入部署准备记录

生成时间：2026-06-21 CST

## 范围

- 投放目标：`https://anna.partners/dashboard` 中的 `personal-assistant-mode`
  / `Anna 个人助理模式`。
- App ID：`24`。
- 本地候选 App 版本：`0.1.19`。
- 本地候选 Executa 版本：`0.1.7`。
- 本次新增重点：旅行预订后端改为 Duffel-only，加入供应商无结果语义、prepare/confirm 双阶段确认，以及 Duffel Stays 权限 gate。

## 本地变更摘要

- Anna / 前端不直接调用 Duffel。
- Duffel token 只从后端环境变量 `DUFFEL_ACCESS_TOKEN` 读取。
- 运行时旅行 provider registry 只启用 Duffel。
- Amadeus、Travelport、Hotelbeds 在 Anna app 运行时目录中仅保留 disabled future placeholder，不返回测试报价、不创建测试订单。
- 语言系统明确支持中文与英文；英文用户用英文回答，同时保留后端 result code 和固定 Duffel no-result 文案。
- Dashboard manifest system prompt 已加入 Duffel-only 约束：
  - 不使用 Amadeus、Travelport、Hotelbeds 或 fallback supplier。
  - Duffel no offers / no availability / unsupported route 不得表述为现实中没有航班或住宿。
  - 用户文案固定为：“当前通过 Duffel 没有查到可预订报价。”
  - 保留并解释 `supplier_no_result`、`invalid_search_params`、`route_maybe_unsupported`、`supplier_error`、`rate_limited`。
  - Chinese/English language system：英文用户用英文回答。

## 已通过验证

```bash
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
```

验证结果：

- `npm run check` 通过。
- `npm test` 通过：38 项测试全部通过。
- `npm run validate:anna` 通过：`validate --strict` passed。
- `npm run dashboard:duffel:dry-run` 会重新执行上述本地检查、根目录 Duffel 后端 smoke、远端只读状态查询，以及 CLI `executa publish` / `apps push` / `apps cut` 的 dry-run。
- 新增测试覆盖 Duffel 可能不覆盖路线时返回 `route_maybe_unsupported`，并确认不会推断为现实中没有航班。
- `npm run check` 现在会额外断言 Dashboard manifest 包含 Duffel-only 系统提示、固定 no-result 文案和五类供应商结果码；同时断言预订 UI 不暴露 Amadeus / Travelport / Hotelbeds 选项，运行时 provider registry 不加载非 Duffel provider，Duffel adapter 只读取 `DUFFEL_ACCESS_TOKEN`，非 Duffel provider 文件保持 disabled placeholder。

根目录受控旅行后端也已验证：

```bash
npm run build:api
npm run smoke:duffel-travel-api
```

`npm run smoke:duffel-travel-api` 覆盖：

- `POST /api/travel/flights/search`
- `GET /api/travel/flights/offers/:offerId`
- `POST /api/travel/flights/offers/:offerId/refresh`
- `POST /api/travel/flights/prepare`
- `POST /api/travel/flights/confirm`
- `GET /api/travel/flights/orders/:orderId`
- `POST /api/travel/flights/orders/pay-hold`
- `POST /api/travel/stays/search` 默认权限 gate
- `POST /api/travel/stays/prepare` / `POST /api/travel/stays/confirm` 已作为 Stays quote / booking 的 prepare-confirm 语义别名预留
- 幂等记录：重复 `prepare` 使用同一 idempotency key 返回同一 booking。
- 审计日志：验证 `booking.prepare`、`booking.user_confirm`、`booking.supplier_confirm`、`provider.*` 和 `provider_usage.record`。
- 错误审计：验证 supplier no-result / Stays permission gate 会写入 `provider.*.error` 审计日志，并在错误 response 中带回 idempotency key。
- rate limit buckets：验证 user、tenant、provider 三层 bucket 被实际写入。
- 用户确认记录：验证 confirm 写入 Duffel 用户确认记录。
- 支付确认记录：验证 pay-hold order 必须显式 `userConfirmed: true`，并写入 Duffel 用户确认记录。
- 订单状态记录：验证 confirm 写入 Duffel order status，pay-hold 写入付款状态记录。

结果：成功创建 Duffel test hold order 记录，`resultCode: ok`。

## 当前远端状态

只读检查命令：

```bash
npx --yes @anna-ai/cli@0.1.30 apps status personal-assistant-mode
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
```

结果：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.16 (id=259, published=—)
  versions  : 17 total
```

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

历史核对结果：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.17 (id=330, published=—)
  versions  : 18 total
```

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

最新核对结果：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.19 (id=332, published=—)
  versions  : 20 total
```

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

说明：`0.1.17` 和 `0.1.18` 均已真实 cut，但平台输出显示它们都 freeze 到旧 tool id `tool-duasgfuygq36136-personal-assistant-rybf3xa9` 的 immutable Executa `v0.1.3`。该旧 tool id 已知会导致 Dashboard 使用旧插件。`0.1.19` 已真实 cut，并恢复绑定到已验证的 runtime tool id `tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36`，cut 输出确认 froze 到 `executa_version=152 (v0.1.6)`。生产安装授权仍停留在 `0.1.9`，平台状态仍是 `pending_review`。

## Dry-run 结果

未产生远端写入，只做预演。

一键预演入口：

```bash
npm run dashboard:duffel:dry-run
```

```bash
npx --yes @anna-ai/cli@0.1.30 apps push --dry-run
```

输出：

```text
using PAT from credentials (host=https://anna.partners)
  [dry-run] would publish bundled executa "personal-assistant" from ./executas/personal-assistant-node
[dry-run] app_id=24 slug=personal-assistant-mode; would PUT /working (content_hash=e8f78403d58c…) + stage working bundle from /Users/r/Documents/Anna/08-personal-assistant-anna-app/bundle
```

```bash
npx --yes @anna-ai/cli@0.1.30 executa publish --dry-run
```

输出：

```text
using PAT from credentials (host=https://anna.partners)
[dry-run] resolved executa_id=1044 tool_id=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36; would PUT metadata + POST version 0.1.7
```

```bash
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.19 --dry-run
```

输出：

```text
[dry-run] would cut version 0.1.19 for apps/personal-assistant-mode (app_id=24)
```

最新 `0.1.19` dry-run 结果：

```text
Anna app static and guide checks: passed
Anna app tests: 38 passed
Anna strict validation: passed
Duffel travel backend smoke: passed
executa publish --dry-run: would use executa_id=1044, tool_id=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
apps push --dry-run: would PUT /working (content_hash=22d204794563…)
apps cut 0.1.19 --dry-run: would cut version 0.1.19
```

## 需要用户确认的外部写入

`0.1.17` 的真实写入已经执行：

```text
apps push: working draft updated (rev 13), working bundle ready
apps cut 0.1.17: cut immutable version 0.1.17 (version_id=330)
```

随后为修正 app-bundled Executa freeze 顺序，已执行真实：

```text
executa publish: executas/personal-assistant version 0.1.7 frozen
apps push: working draft unchanged (rev 13), bundled executa v0.1.7 unchanged
apps push: working draft updated (rev 14), working bundle ready
apps cut 0.1.18: cut immutable version 0.1.18 (version_id=331), but froze old executa v0.1.3
apps push: working draft updated (rev 15), runtime tool override applied
apps cut 0.1.19: cut immutable version 0.1.19 (version_id=332), froze runtime executa v0.1.6
```

平台拒绝重复 cut `0.1.17`：

```text
version 0.1.17 already cut for apps/personal-assistant-mode; choose a higher SemVer
```

因此修正版本为 `0.1.19`，并显式绑定 runtime tool。以下命令已经真实执行：

```bash
cd /Users/r/Documents/Anna/08-personal-assistant-anna-app
npx --yes @anna-ai/cli@0.1.30 apps push --executa-id personal-assistant=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.19
```

如果平台仍保持 `pending_review`，即使 `0.1.19` cut 成功，也可能仍不能 release/go live。审核通过后再执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.19
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
```

## 当前结论

本地 Duffel-only 接入、Anna App manifest、Executa 版本、英文语言系统支持和 Dashboard 候选包均已准备好。`apps push` 和 `apps cut 0.1.19` 已真实执行成功。

`0.1.17` 和 `0.1.18` 已真实写入，但均 freeze 到旧 Executa `v0.1.3`。`0.1.19` 已用 runtime tool 绑定重新 cut，远端 latest 已更新为 `v0.1.19 (id=332)`。剩余限制是平台 `pending_review`，导致生产安装授权仍停留在 `0.1.9`；审核通过后才能 release/go live。

## 2026-06-21 追加：Skill 规范与 release 尝试

本次已新增 Anna 主体个人助理模式根目录 `SKILL.md`，作为本项目行为契约，覆盖：

- 个人助理入口、前置问候、天气、HealthKit、旅行、预订确认和学习记忆的工具调用顺序。
- Duffel-only 机票/酒店结构化供应商约束、官方网页人工接管、人类确认门和固定 no-result 文案。
- 用户表达“学习 / 训练 / 强化学习 / 自主学习 / 学习复盘”时先执行 `learning_cycle`，再输出总结和后续规则。
- 工具/视觉/音频交给 `anna-auto`，纯文本任务按实验模型路由建议，最后综合为一个最终回复。
- 明确排除 `02-bilingual-focus-flow` 的 Focus 计时和双语教练行为。

新增校验：

```bash
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
npm run smoke:personal:full:report
```

结果：

- `npm run check` 通过，且 `check-anna-guide` 已检查 `SKILL.md` 的核心规则。
- `npm test` 通过：38 项测试全部通过。
- `npm run validate:anna` 通过：`validate --strict` passed。
- `npm run dashboard:duffel:dry-run` 通过，包含根目录 Duffel 后端 smoke。
- `npm run smoke:personal:full:report` 通过，并生成 `FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md`；覆盖 UI、HealthKit doctor、HealthKit bridge、真实外站 handoff、真实浏览器 handoff 和 Anna Local Host iframe。

真实 release 命令已执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.19
```

平台返回：

```text
✗ app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release
```

随后只读复查：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.19 (id=332, published=—)
  versions  : 20 total
```

授权仍显示：

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

结论：本地项目、候选版本和完整 smoke 已跑通；真实 `apps release 0.1.19` 被 Anna 平台审核状态阻止。上线条件仍是平台将 App 状态从 `pending_review` 改为 `APPROVED` 或 `PUBLISHED`，之后重新执行 `apps release 0.1.19` 与 grants/status 复查。

## 2026-06-21 追加：运行时 Prompt 同步复核

复核发现：仅新增本地 `SKILL.md` 不足以证明 Dashboard 运行时一定加载该规范。因此已将 `SKILL.md` 中影响 Anna 主体个人助理行为的关键规则同步进 `manifest.system_prompt_addendum`，并保持在 Anna schema 允许的 4000 字符以内。

已同步到运行时 prompt 的规则包括：

- 绑定 `project SKILL.md behavior contract`，并明确不导入归档的 bilingual Focus Flow 行为。
- Duffel-only、固定 no-result 文案、五类供应商结果码和不得推断现实世界无票/无房。
- “帮我订 / 预订 / book”只作为搜索、比较、预确认和用户确认 handoff，不自动下单或付款。
- 拒绝或延后旅客身份、证件、联系方式、支付卡、验证码、登录、最终订单确认和付款。
- “学习 / 训练 / 强化学习”先执行 `learning_cycle`，再输出复盘和后续强化规则。
- 工具、图片、音频、多模态和能力不匹配场景交给 host capability selection；纯文本模型按任务类型给出实验路由建议。
- “all available models / 总思考”时编译模型中立上下文、按能力分路、比较 claims/tradeoffs，并综合成一个最终回复，不暴露 hidden chain-of-thought。

新增 `check-anna-guide` 断言会同时检查 `SKILL.md` 和 `manifest.system_prompt_addendum`，避免后续只改文档、不进运行时 prompt。

复核命令：

```bash
node -e "const m=require('./manifest.json'); console.log(m.system_prompt_addendum.length)"
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.19
```

结果：

- `system_prompt_addendum.length`：3343。
- `npm run check` 通过。
- `npm test` 通过：38 项测试全部通过。
- `npm run validate:anna` 通过。
- `npm run dashboard:duffel:dry-run` 通过，新的 working content hash 为 `3b3c011e5283…`。
- 第二次真实 `apps release 0.1.19` 仍被平台拒绝：

```text
✗ app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release
```

当前阻塞未变：远端 `personal-assistant-mode` 仍处于 `pending_review`，latest cut 仍为 `v0.1.19 (id=332, published=—)`，生产安装授权仍停在 `0.1.9`。

## 2026-06-21 追加：Working Draft 推送

为避免本地 `SKILL.md` / manifest prompt 补强只停留在本地，已将当前工作树推送为 Anna 平台 working draft，并显式绑定已验证 runtime tool：

```bash
npx --yes @anna-ai/cli@0.1.30 apps push --executa-id personal-assistant=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

平台返回：

```text
bundled:personal-assistant → tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 (override)
working bundle staged (8 files, status=ready)
apps/personal-assistant-mode: working draft updated (rev 16)
status: pending_review
(uncommitted changes vs latest cut version)
```

随后按目标重试：

```bash
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.19
```

平台返回：

```text
✗ version 0.1.19 already cut for apps/personal-assistant-mode; choose a higher SemVer (e.g. bump patch/minor) and retry
```

再次执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.19
```

平台仍返回：

```text
✗ app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release
```

复查结果：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.19 (id=332, published=—)
  versions  : 20 total
```

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

结论：当前最新规范已经进入平台 working draft rev 16，但无法写回不可变的 `0.1.19` cut；真实上线仍受两个平台条件限制：App 需先从 `pending_review` 变为 `APPROVED` 或 `PUBLISHED`，并且当前 working draft 如需成为不可变发布包，需要使用高于 `0.1.19` 的 SemVer 重新 cut。

## 2026-06-21 追加：第三轮发布阻塞审计

第三轮继续核验当前账号可用的 Anna CLI 生命周期命令：

```text
apps list
apps publish
apps push
apps cut
apps release
apps sync-meta
apps submit-review
apps status
apps versions
apps grants
apps unpublish/archive/delete
```

`submit-review` 的 CLI 帮助说明只支持 `DRAFT/REJECTED → PENDING_REVIEW`。当前 App 已经是 `pending_review`，实际执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps submit-review personal-assistant-mode
```

平台返回：

```text
✗ request failed (400): App 状态不允许提交审核: pending_review
```

当前账号：

```text
host: https://anna.partners
scopes: aps:dev
```

再次执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.19
```

平台仍返回：

```text
✗ app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release
```

远端状态仍为：

```text
apps/personal-assistant-mode
  status    : pending_review
  latest    : v0.1.19 (id=332, published=—)
  versions  : 20 total
```

授权仍为：

```text
installed_version: 0.1.9
latest_version: 0.1.9
update_available: false
```

结论：同一平台审核门已连续多轮阻止真实 `apps release 0.1.19` 和上线。当前开发者账号可完成本地修复、验证、working draft 推送，但不能把 `pending_review` 改为 `APPROVED` / `PUBLISHED`，也不能 release 未审核通过的 `0.1.19`。需要 Anna 平台审核状态变化或具备审核/发布权限的外部动作后，才能继续完成最终上线。

## 2026-06-21 追加：待用户审核交付状态

根据“如果碰到需要等待审核，则先跑通测试、修改查漏补缺，最后等用户审核”的要求，当前已完成可由 Codex 执行的全部本地与平台工作：

- `SKILL.md` 已放入 `08-personal-assistant-anna-app` 根目录，明确排除 `02-bilingual-focus-flow`，并规范个人助理模式、机票酒店、学习/训练、多模型总思考。
- `manifest.system_prompt_addendum` 已同步关键 Skill 规则，当前长度 3343，低于 Anna schema 的 4000 字符限制。
- `check-anna-guide` 已新增断言，确认 `SKILL.md` 和运行时 prompt 均包含核心规则。
- 最新工作树已推送至 Anna 平台 working draft `rev 16`，并显式绑定 runtime tool `tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36`。
- `0.1.19` 已存在 immutable cut，不能以同一 SemVer 重切；如要把 working draft `rev 16` 变成新的不可变发布包，需要高于 `0.1.19` 的版本号。

最终复核命令：

```bash
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
npx --yes @anna-ai/cli@0.1.30 apps status personal-assistant-mode
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
npx --yes @anna-ai/cli@0.1.30 apps versions personal-assistant-mode
```

最终复核结果：

- `npm run check` 通过。
- `npm test` 通过：38 项测试全部通过。
- `npm run validate:anna` 通过。
- `npm run dashboard:duffel:dry-run` 通过，包含 Duffel travel backend smoke，`supplier: duffel`，`resultCode` 相关路径与审计路径均通过。
- `FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md` 已生成，覆盖 UI、HealthKit doctor、HealthKit bridge、真实外站 handoff、真实浏览器 handoff 和 Anna Local Host iframe。
- 远端状态仍为 `pending_review`。
- 远端 latest cut 仍为 `v0.1.19 (id=332, published=—)`。
- 生产安装授权仍为 `installed_version: 0.1.9`，`latest_version: 0.1.9`。

待用户/平台审核事项：

1. 由用户或 Anna 平台审核方将 App 状态从 `pending_review` 改为 `APPROVED` 或 `PUBLISHED`。
2. 审核通过后，如目标仍是发布既有不可变版本，执行 `apps release 0.1.19` 并复查 grants。
3. 如需要发布已包含最新 `SKILL.md` / manifest prompt 的 working draft `rev 16`，先切高于 `0.1.19` 的新 SemVer，再 release 新版本。

## 2026-06-22 追加：0.1.25 真实 Dashboard 修复与发布记录

### 根因

本次复现到的核心问题不是 Duffel provider 缺失，而是自然语言路由误判：

- 用户输入“不要打开浏览器，先走 Duffel”时，旧逻辑只看到“打开浏览器”关键词，就把请求错误路由到 `official-handoff`。
- 该路径会生成 Expedia / Trip.com / Booking.com 等外站链接，继而触发外部页面、WhaleGuard block 或 Chrome for Testing 旧测试残留的混淆。
- 正确行为应是：自然语言“订购/预订机票”默认走 Duffel 结构化 search / compare / `booking_prepare` 前预确认，除非用户明确要求官方网页接管。

### 代码修复

已修改 `executas/personal-assistant-node/lib/service.js`：

- `explicitOfficialHandoffRequested(message)` 在判断官方网页接管前，先检查 Duffel-first 和官方接管否定语义。
- 新增 `explicitDuffelFirstRequested(text)`：识别“先/默认/优先/只/使用/走/通过/用 Duffel”与 “Duffel 先/默认/优先/搜索/查询/预确认/prepare”。
- 新增 `officialHandoffNegated(text)`：识别“不要/别/不需要/无需/不用/禁止/先不要 打开浏览器/网页/外站/官网/Expedia/Trip.com/携程/Booking.com”等否定表达。

新增回归覆盖：

- `tests/core.test.js`：断言“请不要打开浏览器，先走Duffel”必须得到 `duffel_booking_compare`，`provider: duffel`，`opens_external_browser: false`，且输出中不得包含 Expedia / Trip.com / Booking.com / `Flights-Search`。
- `tests/plugin.test.js`：在真实 Executa RPC 层重复上述断言，避免只在 service 单元层通过。

版本更新：

- Anna App：`0.1.24` -> `0.1.25`
- Personal assistant Executa：`0.1.11` -> `0.1.12`

### 本地验证

已通过：

```bash
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
```

结果：

- `npm test` 通过：40 项测试全部通过。
- `dashboard:duffel:dry-run` 通过，包含 `smoke:ui` 与 `smoke:learning`。
- `smoke:learning` 验证 5 本心理学、5 本逻辑学、5 本用户回复能力书目级学习，总计 15 本；普通 assist 不触发训练，明确 learning 指令会写入记忆，并在重启后恢复学习规则。

直接 RPC 复核：

- 输入：“我需要订购一张2026-08-12从上海到东京的机票，1位成人，经济舱。请不要打开浏览器，先走Duffel。”
- 输出：`route.intent: travel`，`context.travel: null`，`context.booking.mode: duffel_booking_compare`，`provider: duffel`，`opens_external_browser: false`。
- 回复包含 Duffel 与 `booking_prepare`，未包含 Expedia / Trip.com / Booking.com / `Flights-Search` 外站链接。

### 远端发布

真实执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps push
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.25
```

结果：

- Working draft：`rev 22`
- App version：`0.1.25`
- Version id：`363`
- Frozen Executa：`tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36`
- Executa version：`0.1.12`
- Executa version id：`213`

`apps release 0.1.25` 暴露 CLI 本地大小写 bug：服务端返回 `published`，CLI status guard 只接受 `APPROVED` / `PUBLISHED`。已检查 CLI 本地源码确认原因，并使用同一 CLI 内部 `publishVersion` 客户端方法发布，未打印或暴露 token。

发布结果：

```json
{
  "host": "https://anna.partners",
  "app_id": 24,
  "slug": "personal-assistant-mode",
  "released_version": "0.1.25",
  "version_id": 363,
  "is_latest": true,
  "published_at": "2026-06-21T16:53:45.359793",
  "status": "published"
}
```

授权安装复核：

```text
installed_version: 0.1.25
latest_version: 0.1.25
update_available: false
```

### 真实 Google Chrome Dashboard 机票测试

已在 `/Applications/Google Chrome.app` 真实 Chrome 中打开 `https://anna.partners/dashboard`，并在开发者页面重新安装 `Anna 个人助理模式` v0.1.25。页面提示：

```text
已安裝「Anna個人助理模式」(v0.1.25) — 現在可以在聊天中使用
```

Dashboard 中可见：

- 已安装应用列表包含 `Anna 个人助理模式`。
- App iframe token 为 `vid=363`，对应 `0.1.25`。
- 主对话显示 `1 Agent`。

真实测试输入：

```text
请使用 Anna 个人助理模式实际测试：我需要订购一张2026-08-12从上海到东京的机票，1位成人，经济舱。不要打开浏览器，不要官方外站接管，不要下单或付款；请先走 Duffel 结构化搜索/compare/booking_prepare 前的预确认，并告诉我是否打开了外部浏览器。
```

Dashboard 返回要点：

- 明确说明未打开浏览器、未引导官方外站接管、未下单、未付款。
- 使用后台 NATS 与 Duffel 包装 API 交互。
- 返回 Duffel 沙箱候选：
  - `AN218`，SHA -> TYO，2026-08-12，直飞，CNY 1,460。
  - `AN426`，SHA -> TYO，2026-08-12，1 stop，CNY 1,715。
- 生成 `booking_prepare` 预确认：
  - `bc_b5e9a55a36eb428cb5ac28cd42f7c7cf`
  - `status: PENDING`
  - locked amount：CNY 1,460。
- 隐私与资金边界：
  - 未提交护照、身份证件、手机号或真实姓名。
  - 未自动扣款，未要求信用卡或支付信息。

测试期间没有新打开 Expedia / Trip.com / Booking.com / Ctrip 外站，也没有触发 WhaleGuard block。

### Dashboard 学习功能状态

代码与本地真实 Executa RPC 已验证 `learning_cycle`：

- `learning_status` / `learning_cycle` 已包含在运行时工具。
- `SKILL.md` 和 `manifest.system_prompt_addendum` 都要求用户明确说“学习 / 训练 / 强化学习 / 自主学习 / 学习复盘”等时先运行 `learning_cycle`。
- `npm run smoke:learning` 与 `npm run dashboard:duffel:dry-run` 中的 learning smoke 已通过。

Dashboard 页面级学习测试已开始，但未完成最终可视化响应判定，原因是当前 Mac 屏幕进入锁屏/时钟界面，`Computer Use` 返回 `cgWindowNotFound`；Chrome 真实标签页仍存在，但 Chrome 未开启“允许 Apple 事件中的 JavaScript”，因此无法用 AppleScript 继续 DOM 操作。已确认这不是 Anna App 版本、授权或安装问题：

```text
installed_version: 0.1.25
latest_version: 0.1.25
update_available: false
```

待屏幕解锁后，需要在真实 Dashboard 主对话继续发送：

```text
Use the installed Anna Personal Assistant Mode. Run the personal_assistant tool with action=learning_cycle. Do Anna self-learning and reinforce the learning memory. Only run learning_cycle from personal assistant mode. Do not write math exercises, do not open any browser or external website, and do not save raw private conversations. Summarize the title-level learning results for 5 psychology books, 5 logic books, and 5 user-response-craft books, including self-test, review, and memory reinforcement.
```

预期成功标准：

- 主对话调用 `personal_assistant` / `learning_cycle`。
- 回复包含 5 psychology + 5 logic + 5 user-response-craft，总计 15 本标题级学习。
- 回复包含自测、复盘、记忆强化。
- 不生成数学题。
- 不打开浏览器或外站。
- 不保存原始私人对话。

### 2026-06-22 01:11 CST 追加：真实 Chrome 锁屏恢复尝试

重新复核：

```bash
npm run check
npx --yes @anna-ai/cli@0.1.30 apps status personal-assistant-mode
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
```

结果仍为：

- 本地 `check` 通过。
- 远端 `status: published`。
- latest：`v0.1.25 (id=363, published=2026-06-21T16:53:45.359793)`。
- grants：`installed_version: 0.1.25`，`latest_version: 0.1.25`，`update_available: false`。

真实 Google Chrome 当前打开的 Dashboard 标签仍存在：

```text
https://anna.partners/dashboard
```

通过 Codex Chrome Extension 进行恢复：

- `openTabs()` 能列出真实 Chrome 中的 Dashboard 标签。
- 已确认最近的 Dashboard 标签标题为 `儀表板 - 安娜`，URL 为 `https://anna.partners/dashboard`。
- 关闭了恢复过程中产生的 `about:blank` 测试标签，未留下额外空白页。
- 但在 macOS 锁屏/时钟界面下，Dashboard 页面级 `claimTab` / `goto` / `domSnapshot` 会超时并重置控制会话。

因此当前唯一未完成项仍是：解锁屏幕后，在真实 Dashboard 主对话完成 `learning_cycle` 页面级响应验证。代码层、Executa RPC、本地 learning smoke、完整 `dashboard:duffel:dry-run` 与远端发布/安装状态均已通过。

### 2026-06-22 01:19 CST 追加：第三次锁屏阻塞审计

再次复核：

```bash
npm test
npx --yes @anna-ai/cli@0.1.30 apps status personal-assistant-mode
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
```

结果仍为：

- `npm test` 通过：40 项测试全部通过。
- 远端 `status: published`。
- latest：`v0.1.25 (id=363, published=2026-06-21T16:53:45.359793)`。
- grants：`installed_version: 0.1.25`，`latest_version: 0.1.25`，`update_available: false`。

真实 Chrome 审计：

- macOS 截图仍显示锁屏/时钟界面。
- Codex Chrome Extension 可以列出真实 Dashboard 标签，最近标签仍为：

```text
title: 儀表板 - 安娜
url: https://anna.partners/dashboard
```

- `claimTab` 可以读取标签标题和 URL。
- 但 Dashboard 页面级 `domSnapshot()` 超时。
- Dashboard 页面级 `screenshot()` 也超时。

结论：同一个外部状态阻塞已连续出现三次 goal 运行。当前无法在不解锁 Mac 的情况下完成用户要求的真实 Dashboard `learning_cycle` 页面级响应验证；继续重试只会重复同一失败。待用户解锁 Mac 后，应继续同一个 Dashboard 标签并发送上一节列出的 `learning_cycle` 测试指令。

### 2026-06-22 追加：携程 TourAPI 两次接入尝试与放弃记录

用户新增要求：测试并开发接入携程 TourAPI；若不成功或连接两次以上接入不成功，则放弃本次接入。

提供的地址：

- 测试环境：`https://tourapi-fat.ctripqa.com/api`
- 线上环境：`http://tourapi.ctrip.com/api`
- 基础信息接口虚拟目录：`/api/BasicInfo/接口名`
- 跟团产品接口和订单接口虚拟目录：`/api/接口名`
- 景酒产品接口虚拟目录：`/api/SceneHotel/接口名`

实际执行两次无敏感信息探测：

```bash
curl -sS -L -m 12 https://tourapi-fat.ctripqa.com/api/BasicInfo/
curl -sS -L -m 12 http://tourapi.ctrip.com/api/BasicInfo/
npm run probe:ctrip
```

结果：

- FAT BasicInfo category root：HTTP `404`，返回 JSON `Not Found`，path `/api/BasicInfo/`。
- Production BasicInfo category root：HTTP `404`，返回携程 404 HTML 页面。
- 未提交旅客姓名、证件、电话、邮箱、登录、订单或支付信息。
- 未拿到可用接口名、签名/鉴权、请求/响应 schema、沙箱订单契约或可预订报价契约。

结论：

- 这不是可安全启用的 Ctrip provider 接入。
- 按用户“两次不成功则放弃”的规则，本次携程 API 接入已放弃。
- 运行时仍保持结构化旅行 provider 为 Duffel-only。
- `SKILL.md` 和 `manifest.system_prompt_addendum` 已新增边界：不得声称 Ctrip API search / order / payment；用户显式要求携程时只能走官方网页人工接管，并且仍不得自动提交身份信息、最终订单或付款。
- 新增 `scripts/ctrip-api-probe.mjs` 与 `npm run probe:ctrip`，后续若获得具体接口名、鉴权/签名和沙箱订单契约，可重新运行并改造为真实 provider。

### 2026-06-22 07:08 CST 追加：0.1.26 发布、安装与 Dashboard 插件加载状态

本轮新增携程 TourAPI 边界后已完成：

```bash
npm run probe:ctrip
npm run probe:ctrip:report
npm run check
npm test
npm run validate:anna
npm run dashboard:duffel:dry-run
npx --yes @anna-ai/cli@0.1.30 apps push
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.26
```

由于 `apps release 0.1.26` 仍触发 CLI 文案/状态判断问题，沿用此前内部 `publishVersion` workaround 发布成功：

```json
{
  "app_id": 24,
  "slug": "personal-assistant-mode",
  "released_version": "0.1.26",
  "version_id": 380,
  "is_latest": true,
  "published_at": "2026-06-21T22:54:02.297159",
  "status": "published"
}
```

远端发布状态：

```text
latest_version: 0.1.26
version_id: 380
published_at: 2026-06-21T22:54:02.297159
frozen_executa: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
executa_version: 0.1.12
executa_version_id: 213
```

真实 Google Chrome / Dashboard 更新：

- 已在 `https://anna.partners/apps/installed` 点击 `Anna 个人助理模式` 的 `Update`。
- Dashboard 确认更新成功，页面显示 `Anna 个人助理模式 v0.1.26 ENABLED`。
- CLI grants 已确认：

```text
installed_version: 0.1.26
latest_version: 0.1.26
update_available: false
```

重新打开 Anna 个人助理模式后，iframe URL 已正确变为：

```text
https://anna.partners/anna-apps/duasgfuygq36136/personal-assistant-mode/0.1.26/index.html
vid=380
```

但 Dashboard 内嵌窗口仍出现一次工具加载错误：

```text
Plugin not found: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

已执行本地 shim 强制重装：

```bash
cd /Users/r/Documents/Anna/08-personal-assistant-anna-app/executas/personal-assistant-node
npx --yes @anna-ai/cli@0.1.30 executa install --force --tool-id tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

CLI 输出确认 shim 位置与命令：

```text
shim: /Users/r/.anna/executa/bin/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
command: env ANNA_EXECUTA_TOOL_ID=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 node personal_assistant_plugin.cjs
```

随后 Dashboard 应用窗口曾从 `Plugin not found` 进入 `Anna 正在前置问候`，说明主机开始尝试调用该工具；但在页面稳定后仍回到 `Plugin not found`，表示还需要按 CLI 提示在 Agent/Plugin Details 中执行：

```text
Rediscover Local
```

恢复步骤：

1. 解锁 Mac。
2. 在真实 Google Chrome 打开 `https://anna.partners/executa`。
3. 进入 `我的工具`，找到 `tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36` 或对应的 Personal Assistant Runtime 工具详情。
4. 点击 `Rediscover Local`。
5. 回到 `https://anna.partners/dashboard`，关闭旧的 Anna 个人助理模式窗口，重新从已安装应用启动。
6. 确认窗口状态不再显示 `Plugin not found`，而是 `待命` / `能力路由尚未启动` / preflight 完成状态。
7. 继续发送订票测试，要求 Duffel-first、不打开外站、不提交旅客身份/付款。

当前未完成项：Mac 在 07:08 CST 再次进入锁屏，无法继续真实 Dashboard 点击与订票响应验证。

### 2026-06-22 追加：0.1.27 Binary Executa 分发修复

`0.1.26` 的 `Plugin not found` 根因已定位：`executas/personal-assistant-node/executa.json` 仍发布 `distribution.type = local`。这只适合开发机 shim / Rediscover Local，不适合用户从 Dashboard 安装 Anna App 后自动获得运行时工具。

本次修复：

- Anna App：`0.1.26` -> `0.1.27`
- Personal assistant Executa：`0.1.12` -> `0.1.13`
- `executa.json` 改为 switchable distribution profiles，并将 `active` 设为 `binary`。
- 保留 `local` profile 作为开发回退，不再把它作为发布 profile。
- 新增 `npm run build:executa-binary`，生成 Anna binary installer 可识别的 archive，并复制到 `bundle/executa/`。
- `binary_urls.darwin-arm64` 指向：

```text
https://anna.partners/anna-apps/duasgfuygq36136/personal-assistant-mode/0.1.27/executa/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36-darwin-arm64.tar.gz
```

构建产物：

```text
archive: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36-darwin-arm64.tar.gz
size: 50758
sha256: c5d1af4072a1509f1e6ed4b99f91f607a3f6a289a99a368f507ca0ecd442d773
entrypoint: bin/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
format: tar.gz
```

本地 archive 验证：

- `dist-anna/` 与 `bundle/executa/` 中的 archive sha256 完全一致。
- `tar tzf` 确认包含 `manifest.json`、`bin/<tool_id>`、`personal_assistant_plugin.cjs`、`package.json`、`lib/`。
- 解包后直接运行 `bin/<tool_id> describe` 成功，运行时 manifest 版本返回 `0.1.13`。

发布后需要验证：

1. `apps push` / `apps cut 0.1.27` / release。
2. 在真实 Google Chrome 的 `https://anna.partners/apps/installed` 更新到 `0.1.27`。
3. 打开 Dashboard 中的 Anna 个人助理模式，确认不再出现 `Plugin not found`。
4. 再执行 Duffel-first 订票测试和 `learning_cycle` 学习测试。

### 2026-06-22 追加：0.1.28 / 0.1.29 确认页修复与真实 Dashboard 完成验证

0.1.27 解决了 binary Executa 分发和 `Plugin not found`，但真实 Dashboard 订票测试继续暴露了确认页读取问题：

- 点击 `确认生成页` 后，确认页先于 Anna Runtime 连接执行，导致 iframe 尝试读取托管静态 `/api/booking/confirmation`，返回 `HTTP 404`。
- 0.1.28 修复为：应用启动时先 `connectAnna()`，再处理 `#/booking/confirm/:confirmationId` hash route。
- 真实 Dashboard 再测后仍出现 `HTTP 404`，根因是跳转确认页时使用 `window.location.pathname` 丢掉了 Dashboard 注入的 `?wid=...&t=...` 运行时查询串。
- 0.1.29 修复为：生成确认页时使用 `window.history.pushState` 保留 `window.location.search`，并直接调用 `renderBookingConfirmationPage(response.confirmationId)`，避免丢失 Anna Runtime 连接。

0.1.29 发布状态：

```text
app version: 0.1.29
version_id: 383
published_at: 2026-06-21T23:45:24.880011
latest: true
Dashboard installed app: Anna personal assistant v0.1.29 ENABLED
```

真实 Google Chrome / `https://anna.partners/dashboard` 验证：

- 应用 iframe URL 为 `/personal-assistant-mode/0.1.29/index.html?wid=...&t=...`，状态显示 `已连接 Anna` / `本地优先`。
- 预订区默认 `SHA -> NRT`、`2026-08-12`、`1` 位成人、经济舱、机票+酒店，provider 显示 Duffel Flights / Duffel Stays。
- 点击 `搜索并比较` 后，状态显示 `预订方案已比较 4 个 sandbox/test 方案可确认`。
- 结果为 Duffel-only，不打开外站，也未出现 WhaleGuard：
  - `duffel SHA-NRT 2716.00 CNY + duffel Duffel Test Stay Central 1320.00 CNY`，总价 `4036.00 CNY`。
  - `duffel SHA-NRT 2716.00 CNY + duffel Duffel Test Stay Riverside 1640.00 CNY`，总价 `4356.00 CNY`。
  - `duffel SHA-NRT 3190.00 CNY + duffel Duffel Test Stay Central 1320.00 CNY`，总价 `4510.00 CNY`。
- 点击 `确认生成页` 后，确认页 URL 保留 `?wid=...&t=...#/booking/confirm/bc_...`，并成功显示：
  - 航班详情：`2716.00 CNY`，`SHA -> NRT`，`08/12 17:20` 起飞，`08/12 20:26` 到达，中转 `0`，provider `duffel`。
  - 酒店详情：`Duffel Test Stay Central`，`Tokyo / Central`，入住 `2026-08-12`，退房 `2026-08-14`，2 晚，provider `duffel`。
  - 乘客/住客信息：人数 `1`，证件保存 `未保存`，银行卡保存 `未保存`。
  - 总价与付款政策：`4036.00 CNY`，状态 `PENDING`，自动付款 `禁止`。
  - 人工确认门：四个 checkbox 均未勾选，`确认创建订单` 按钮保持 disabled。
- 按安全边界没有勾选人工确认项，也没有创建最终订单或付款。

学习功能真实 Dashboard 验证：

- 重新打开 `Anna 个人助理模式` v0.1.29 后仍显示 `已连接 Anna` / `本地优先`。
- 点击 `开始本次强化学习` 后，状态从 `正在进行强化学习` 变为 `强化学习已完成 本轮自测 100 分，经验已写入记忆`。
- 学习模块从 `已记忆6次` 更新为 `已记忆7次`，自测分数从 `0` 更新为 `100`。
- 页面显示 15 本书目级学习仍完整存在：心理学 5 本、逻辑学 5 本、用户回复能力 5 本。
- 本轮复盘更新为：Anna 的回复结构满足核心检查，并已把成功经验强化为后续回复规则。

最终结论：

- Dashboard 使用真实 Google Chrome，而不是 Google Chrome for Testing。
- 订票路径走 Duffel structured provider / Anna Runtime tool，不走外站浏览器，不触发 WhaleGuard。
- 确认页 404 已修复，确认页保留 Dashboard runtime token 并通过 `booking_get_confirmation` 读取记录。
- 学习功能已在真实 Dashboard 中完成一次更新，记忆计数和自测结果均落地。

### 2026-06-22 追加：0.1.30 SKILL / manifest 同步补丁

为确保最终 `SKILL.md` 规则不只停留在本地文档，已将确认页运行时连接规则同步到运行时 manifest：

- `SKILL.md` 新增：Dashboard 内的 booking confirmation page 必须保留 app window query string，也就是 `wid` 和 runtime token，并通过 `booking_get_confirmation` 读取记录。
- `manifest.system_prompt_addendum` 新增同义约束：`Dashboard confirmation pages must preserve wid/runtime token and read records through booking_get_confirmation.`
- `scripts/check-anna-guide.mjs` 新增断言，防止后续删除该 SKILL 规则。
- App 版本提升为 `0.1.30`，binary archive URL 指向 `/personal-assistant-mode/0.1.30/executa/`。

0.1.30 发布与安装：

```text
apps push: working draft rev 27
apps cut 0.1.30: version_id=384, executa_version=236 (v0.1.16)
released_version: 0.1.30
published_at: 2026-06-21T23:56:15.953734
Chrome installed app: v0.1.30 enabled
CLI grants: installed_version 0.1.30, update_available false
```

0.1.30 真实 Dashboard 复测：

- 关闭旧 `0.1.29` iframe 后，从 Dashboard 已安装应用栏重新启动，iframe URL 为 `/personal-assistant-mode/0.1.30/index.html?wid=...&t=...`，状态为 `已连接 Anna` / `本地优先`。
- 学习模块仍保留真实学习结果：`已记忆7次`、自测 `100`、15 本书目级学习与本轮复盘均可见。
- 再次点击 `搜索并比较`，返回 `4` 个 Duffel sandbox/test 机票+酒店组合，没有打开外站，也没有出现 WhaleGuard。
- 点击 `确认生成页` 后，URL 保留 `/0.1.30/index.html?wid=...&t=...#/booking/confirm/bc_...`，确认页成功显示航班、酒店、乘客/住客、总价与付款政策、人工确认 checkbox。
- `确认创建订单` 按钮保持 disabled；未勾选最终确认项，未创建订单，未付款。
