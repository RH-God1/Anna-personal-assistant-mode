# Anna Dashboard 部署与试错记录

生成时间：2026-06-20 23:35 CST

## 范围

- 投放目标：`https://anna.partners/dashboard` 中的 `personal-assistant-mode`
  / `Anna 个人助理模式`。
- App ID：`24`。
- 最新 App 版本：`0.1.16`。
- 本次新增重点：个人助理模式运行架构整理、强化学习记忆 smoke、Dashboard 运行试错。

## 已完成的项目整理

- 新增运行架构文档：`docs/personal-assistant-runtime-architecture-zh.md`。
- 新增强化学习记忆验证脚本：`scripts/learning-memory-smoke.mjs`。
- 新增 npm 入口：
  - `npm run smoke:learning`
  - `npm run smoke:learning:report`
- 生成报告：`LEARNING_MEMORY_SMOKE_ZH.md`。
- README 已加入架构文档和强化学习 smoke 入口。

## 本地验证

以下命令均已通过：

```bash
npm run check
npm test
npm run validate:anna
npm run smoke:learning
npm run smoke:learning:report
```

验证结果：

- 37 项测试通过。
- `validate --strict` 通过。
- 强化学习 smoke 确认普通 `assist` 不会误触发学习。
- 用户明确强化学习指令会完成心理学、逻辑学、回复能力各 5 本的书目级学习记录。
- 自测、复盘、修正规则和记忆写入均通过。
- 服务重启后可读取同一份学习记忆，并在后续普通回复中应用强化规则。

## 已推送到 Anna 平台

```text
apps push
  revision: 12
  content_hash: 4a6d87272147daa8d47d18d8f6d6f9228cf0a34b75d9c1c038c789994d63e5c7
  bundle_status: ready
  status: pending_review

apps cut 0.1.16
  version_id: 259
  bundle_id: 256
  frozen_executa:
    tool_id: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
    executa_id: 1044
    executa_version_id: 152
    version: 0.1.6
```

平台当前状态：

```text
apps status personal-assistant-mode
  status: pending_review
  latest_version: 0.1.16
  published_at: null
  is_latest: false
  version_count: 17

apps grants personal-assistant-mode
  installed_version: 0.1.9
  latest_version: 0.1.9
  update_available: false
```

`apps release 0.1.16 --dry-run` 被平台拒绝：

```text
app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release
```

这说明 `0.1.16` 已作为远端候选版本存在，但生产安装授权仍停留在 `0.1.9`，需要平台审核通过后才能 release/go live。

## Executa 状态

本地 shim 已运行最新插件。当前 App `0.1.16` 绑定的新 tool id 为：

```text
tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
```

本地 shim：

```text
/Users/r/.anna/executa/bin/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 describe
  name: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
  version: 0.1.6
```

`initialize` 也返回同一个新 tool id：

```text
serverInfo.name: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
serverInfo.version: 0.1.6
```

已验证本地 shim 支持 Anna loader 需要的 JSON-RPC 握手：

- `initialize`
- `initialized`
- `describe`
- `health`
- `invoke`
- `shutdown`

并可直接执行：

- `learning_cycle`
- `learning_status`

此前旧 tool id 的远端 Executa 版本列表一直停留在 `0.1.3`。我已尝试：

- `executa publish` 发布 `0.1.5`
- 直接调用同一平台 API 同步 tool 元数据版本
- 重新 `apps push` / `apps cut`

旧记录在 `apps cut` 的 `frozen_executas` 中仍返回：

```text
tool_id: tool-duasgfuygq36136-personal-assistant-rybf3xa9
executa_version_id: 135
version: 0.1.3
```

为避免审核后线上版本继续拿到旧插件，本次创建了新的 app-bundled Executa：

```text
slug: personal-assistant-runtime-20260620
name: Personal Assistant Runtime 20260620
executa_id: 1044
tool_id: tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36
version_id: 152
version: 0.1.6
```

随后通过：

```bash
npx --yes @anna-ai/cli@0.1.30 apps push \
  --executa-id personal-assistant=tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36 \
  --skip-executa-publish
npx --yes @anna-ai/cli@0.1.30 apps cut 0.1.16
```

确认 `0.1.16` 的 `frozen_executas` 已正确指向新 Executa `0.1.6`。

## Chrome / Dashboard 试错

已用用户授权的 Google Chrome 登录态打开：

```text
https://anna.partners/dashboard
```

试错结果：

- 直接访问 `https://anna.partners/anna-apps/personal-assistant-mode/0.1.16/index.html/?vid=259`
  返回 `{"detail":"app not found"}`，与 App 仍处于 `pending_review`、未公开 release 的状态一致。
- 在 Dashboard 主魂聊天中发送强化学习指令后，页面加载了工具/技能文档并进入 running agent。
- 未再出现此前的握手错误：
  - `Plugin not found`
  - `describe returned no manifest`
- Dashboard 最终返回了强化学习运行总结。

## 当前结论

本次项目成果已经完成本地构建、架构整理、强化学习记忆验证、Anna 平台 push 和 cut。`0.1.16` 已解决旧 Executa 冻结问题，候选版本现在冻结到新 Executa `0.1.6`。

目前唯一不能完全完成的是生产安装版本更新：Anna 平台仍将 App 置于 `pending_review`，因此 `0.1.16` 不能 release，当前用户授权安装仍是 `0.1.9`。

审核通过后建议执行：

```bash
npx --yes @anna-ai/cli@0.1.30 apps release 0.1.16
npx --yes @anna-ai/cli@0.1.30 apps grants personal-assistant-mode
```

然后再次运行：

```bash
npm run check
npm test
npm run validate:anna
npm run smoke:learning
```
