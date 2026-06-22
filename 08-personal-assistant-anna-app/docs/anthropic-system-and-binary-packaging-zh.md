# Anna 个人助理：Anthropic System 参数与 Tool 二进制打包说明

本文件记录两件事：

1. 机票/酒店预订行为规范应如何交给 Claude Code 或 Anthropic API。
2. 本项目做 Tool 二进制打包时，哈希、文件大小、入口文件等信息在哪里生成、在哪里填写。

这份说明不新增运行时代码，也不接入新的供应商。

## 预订行为规范的设计重点

本项目的预订流程以 `SKILL.md` 为行为契约，并同步到 `manifest.system_prompt_addendum`，避免只改文档但 Dashboard 运行时不遵守。

关键设计决策如下：

- “硬性限制”最关键：没有用户在同一轮对话中的明确 `yes`，绝不能调用 `open_booking_url`。这强制 Anna 先搜索、展示结果和汇总，用户确认后才打开浏览器。
- “汇总格式”固定为 `— Flight —` / `— Hotel —` / `— Total —`，让每次预订摘要都一致、清晰、便于用户在确认前快速审核。
- “错误处理”要求工具失败时如实降级，例如说明 `I wasn’t able to retrieve flight results right now.`，提供重试方案；`open_booking_url` 失败时提供原始 URL，不能沉默、不能编造、不能绕过用户完成预订。

## 作为 Anthropic API 的 system 参数

把 [SKILL.md](../SKILL.md) 的内容作为初始化 Anna 会话时 Anthropic API 调用的 `system` 参数。MCP 工具、后端、Amadeus 集成等能力放在这个 system 约束之下接入；它们不能覆盖 system 中的确认门、支付边界和错误处理规则。

示例：

```js
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const annaSystem = readFileSync(
  "08-personal-assistant-anna-app/SKILL.md",
  "utf8"
);

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 2000,
  system: annaSystem,
  messages: [
    {
      role: "user",
      content: "帮我订上海到东京的机票和酒店。"
    }
  ]
});
```

如果调用层使用结构化 system blocks，也应把同一份 `SKILL.md` 文本作为 system text block，而不是放进普通 user message。

## 二进制打包时哪些地方生成 hash 和 size

打包入口是 [scripts/build-local-executa-archive.mjs](../scripts/build-local-executa-archive.mjs)。

执行命令：

```bash
npm run build:executa-binary
```

脚本会做这些事：

- 从 `executas/personal-assistant-node/executa.json` 读取 `tool_id` 和 `version`。
- 创建 `dist-anna/archive-stage/`，复制 `personal_assistant_plugin.cjs`、`package.json` 和 `lib/`。
- 生成 `manifest.json` 和可执行入口 `bin/<tool_id>`。
- 用 `tar -czf` 生成 `dist-anna/<tool_id>-<platform>.tar.gz`。
- 默认复制同一个 archive 到 `bundle/executa/`，除非设置 `ANNA_EXECUTA_COPY_TO_BUNDLE=0`。
- 用 `fs.stat(archivePath)` 计算 `size`。
- 用 `sha256File(archivePath)` 计算 `sha256`。
- 在 stdout 打印 `archivePath`、`bundleArchivePath`、`archiveName`、`toolId`、`version`、`platform`、`size`、`sha256`、`entrypoint` 和 `format`。

关键代码位置：

- `archiveName` / `archivePath` / `bundleArchivePath`：`scripts/build-local-executa-archive.mjs`
- `entrypoint = bin/<tool_id>`：同一脚本
- `tar -czf` 生成 archive：同一脚本
- `const stat = await fs.stat(archivePath)` 生成 `size`
- `const sha256 = await sha256File(archivePath)` 生成 `sha256`
- `sha256File()` 使用 `createHash("sha256")`

## 二进制打包后哪些地方填写 hash 和 size

脚本只打印 hash 和 size，不会自动回写 `executa.json`。发布前需要把输出值填到：

[executas/personal-assistant-node/executa.json](../executas/personal-assistant-node/executa.json)

路径是：

```json
distribution.profiles.binary.binary_urls["darwin-arm64"]
```

当前字段包括：

```json
{
  "url": "https://anna.partners/anna-apps/duasgfuygq36136/personal-assistant-mode/0.1.32/executa/<archive>.tar.gz",
  "sha256": "<npm run build:executa-binary 输出的 sha256>",
  "size": 55130,
  "entrypoint": "bin/tool-duasgfuygq36136-personal-assistant-runtime-20260620-zju54b36",
  "format": "tar.gz"
}
```

需要同步检查的字段：

- `url`：托管下载地址，版本路径要和 app 版本一致，例如 `/personal-assistant-mode/0.1.32/executa/`。
- `sha256`：填打包脚本输出的 64 位十六进制 hash。
- `size`：填打包脚本输出的 archive 字节数。
- `entrypoint`：必须是 `bin/<tool_id>`。
- `format`：必须是 `tar.gz`。
- `package_name` 和 `executable_name`：应与 archive 文件名和 tool id 对齐。

本地开发 profile 在同一个 `executa.json` 的：

```json
distribution.profiles.local
```

其中 `package_name` 指向本机 local archive，主要用于开发 fallback；正式 Dashboard 安装使用 `distribution.active = "binary"` 和 `profiles.binary.binary_urls`。

## 校验点

[scripts/check-anna-guide.mjs](../scripts/check-anna-guide.mjs) 会检查：

- `distribution.active` 必须是 `binary`。
- `binary_urls.darwin-arm64.url` 必须指向当前 app 版本的 `/executa/` 托管路径。
- `entrypoint` 必须等于 `bin/<tool_id>`。
- `format` 必须是 `tar.gz`。
- `sha256` 必须是 64 位十六进制字符串。
- `size` 必须是正数。

因此每次重新打包或升级 app 版本后，必须重新核对 `executa.json` 中的 URL、hash 和 size，然后运行：

```bash
npm run check
npm test
npm run validate:anna
```
