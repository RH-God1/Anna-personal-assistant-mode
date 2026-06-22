# anna-executa-examples 审查与中文化实测

审查日期：2026-06-12  
上游仓库：https://github.com/whtcjdtc2007/anna-executa-examples  
审查提交：`ca45136520f98b638dc50cc80e4cfc703c16163e`（2026-06-11）

## 结论

`anna-executa-examples` 不是当前工作区旅行代理的另一个版本。它是 Anna 的
Executa SDK、跨语言工具示例和 Anna App 示例集合。最完整的前端是
`examples/anna-app-focus-flow`。

Focus Flow 的视觉设计和 Executa 架构值得复用，但当前 `main` 存在启动阻断、
两组失败测试、无真正国际化、最小窗口裁切、运行时 RPC 过密，以及文档和元数据
漂移。它目前更适合作为协议实验场，不适合直接当作稳定中文产品模板。

## 已复现问题

### P1：官方开发命令无法直接启动完整 Focus Flow

运行：

```bash
pnpm install
pnpm dev -- --no-llm
```

`app.json` 将 `focus-coach` 声明为 bundled Executa，但它是 declarative skill，
没有 `tool_id` 和可启动进程。CLI 跳过该目录后又要求解析
`bundled:focus-coach`，最终以 `unresolved bundled handle` 退出。

需要在 CLI 和示例之间确定一种契约：

- dev harness 为 declarative skill 分配临时 ID；
- dev 模式只校验 skill 元数据，不尝试启动；
- 或 manifest 在 dev 时允许 skill 作为非运行时依赖存在。

### P1：上游 CI 已连续失败

工作流：
https://github.com/whtcjdtc2007/anna-executa-examples/actions/runs/27056159397

本地复现结果：

- `pnpm test`：失败。测试硬编码
  `tool-test-focus-session-12345678`，manifest 已迁移到
  `bundled:focus-session`，ACL 拒绝调用。
- `uv run pytest ../../tests/plugin -v`：失败。插件已删除
  `MANIFEST.name`，测试仍执行 `info["name"]`。
- `anna-app validate --strict`：通过。
- fixture verify：通过。

这说明 schema 校验通过不等于应用、工具和测试之间的运行时契约一致。

### P1：中文化后最小窗口不可用

manifest 声明最小窗口为 `360×520`。实测把 UI 完整翻译为中文后：

- “15/25/45/60 分钟”从一行变成两行；
- `今日专注` 卡片和底部连接状态被完全裁掉；
- `html, body` 使用 `overflow: hidden`，用户无法滚动找回内容。

建议：

- 允许纵向滚动，或只让历史列表滚动；
- 在 `max-height: 560px` 时缩小圆环、间距和卡片 padding；
- 时长按钮使用 `15 分`，并在窄窗口采用 2×2 grid；
- 为 `360×520`、`480×640`、`720×960` 增加视觉回归测试。

### P1：没有真正的 i18n 层

中文 README 所说的“语言无关”只适用于协议和后端实现，不适用于 UI。英文分散在：

- `bundle/index.html` 的标签、placeholder、ARIA、title；
- `bundle/app.js` 的状态、错误、统计、历史记录；
- 发给 `chat.write_message` 的消息；
- `window.set_title`；
- manifest 的标题、prompt、message prefix；
- Focus Coach 的 SKILL.md。

只翻译 HTML 会在点击 Start/Pause/Resume 后重新出现英文。只翻译 UI 但不翻译聊天
消息和 Skill，Agent 的回答语言也可能漂移。

建议建立：

```text
bundle/locales/en.json
bundle/locales/zh-CN.json
bundle/i18n.js
```

locale 来源优先级建议为：

1. Anna host 提供的用户 locale；
2. 应用内用户选择；
3. `navigator.language`；
4. `en` fallback。

数字、复数和时间使用 `Intl.NumberFormat`、`Intl.PluralRules` 和
`Intl.DateTimeFormat`。

### P2：计时期间每秒发送一次 window RPC

本地 ticker 每秒调用 `syncWindowTitle()`，后者每秒执行
`anna.window.set_title()`。25 分钟会产生约 1500 次请求和 1500 次响应，还会让
harness RPC 日志几乎不可读。

建议只在以下情况更新标题：

- 分钟值变化；
- pause/resume/start/complete；
- topic 改变；
- 或最多每 10 至 15 秒一次。

### P2：分钟显示规则不一致

插件返回 `focused_minutes = round(seconds / 60, 1)`。实测完成 132 秒后：

- 今日统计：`2.2 分钟`
- 历史记录：`2 分钟`
- 完成聊天消息：`2 分钟`

建议 UI 全部基于 `focused_seconds`，并统一为整数分钟或统一保留一位小数。

### P2：独立预览降级逻辑不成立

README 表示可以在 `bundle/` 下运行 `python -m http.server`，并看到 SDK 不可用
提示。实际 `app.js` 顶层静态 import：

```js
import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
```

普通静态服务器没有该路径，模块在执行 `init()` 前就加载失败。页面能显示初始 HTML，
但按钮没有事件处理，也不会显示 “Standalone preview”。

建议：

- 提供 `preview-runtime.js` stub；
- 使用构建时 alias；
- 或把 SDK 动态 import 放入 `try/catch`。

### P2：版本、链接和文档漂移

- `package.json` 和 UI footer 为 `1.0.0`，`app.json` 为 `0.1.0`。
- README 示例仍是 schema 1 和 `*-CHANGEME-*`，实际 manifest 已是 schema 2
  和 `bundled:*`。
- app listing 图片仍指向 `example.com`。
- homepage/support/privacy 和多个插件 homepage 指向
  `github.com/openclaw/...`，与当前仓库 owner 不同。
- `@anna-ai/cli` 写成 `^0.1.22`，只有 pnpm lock 固定到 `0.1.22`；
  使用 npm 会安装更新版本，复现环境不一致。

### P2：开发依赖安全告警

`npm audit` 报告 5 个开发依赖问题，其中 Vitest `<3.2.6` 有一个 critical
advisory。当前脚本使用 `vitest run`，风险主要落在 Vitest UI/dev server，但仍应
升级并验证测试兼容性。

## 与当前 Codex 工作区项目的不同

| 维度 | 当前 `/Users/r/Documents/Anna` | anna-executa-examples |
| --- | --- | --- |
| 产品 | 隐私优先旅行预订代理 | Anna 插件 SDK 与示例应用 |
| 前端 | Chrome 扩展 popup、content panel、本地 API demo | Anna iframe/static SPA |
| 工具协议 | Chrome messaging + HTTP REST | JSON-RPC 2.0 over stdio |
| 执行单元 | content script、Node server、平台 adapter | Executa tool、Skill、Anna App |
| LLM | 后端 OpenAI Responses API，显式 consent | host-owned sampling/reverse RPC |
| 数据 | 本地状态和内存 run；拒绝 PII | host storage、文件、sampling、agent session |
| 安全边界 | 旅客信息与付款人工接管 | manifest ACL、capability、host dispatcher |
| 多语言实现 | UI 已以中文为主 | README 有中文，App UI 基本全英文 |
| 测试状态 | check、API、Chromium E2E 均通过 | validate 通过，bundle/plugin tests 失败 |

本地项目当前实测：

- `npm run check`：通过。
- `npm run test:api`：通过，最终状态 `post_payment`，PII 拒绝通过。
- `npm run test:browser`：通过。

## 与 Codex 扩展模型的不同

Codex 官方模型中：

- Skill 是 `SKILL.md` 加可选 scripts/references/assets 的可复用工作流；
- Plugin 是可安装分发单元，入口为 `.codex-plugin/plugin.json`；
- Plugin 可以打包 Skills、Apps、MCP servers、hooks 和 assets；
- 外部工具通常通过 Apps/Connectors 或 MCP 暴露。

因此没有 1:1 文件兼容：

| Anna | Codex 中较接近的映射 |
| --- | --- |
| `focus-coach/SKILL.md` | Codex Skill，可保留主体并调整 frontmatter/工具依赖 |
| Executa stdio tool | MCP server，或 Skill 调用的受控本地脚本 |
| `manifest.json` + `app.json` | `.codex-plugin/plugin.json` + skills/apps/MCP 配置 |
| `anna.tools.invoke` | MCP tool call / app connector tool |
| host reverse sampling/storage | MCP 服务或应用后端自行提供，不能直接照搬 Anna RPC |
| Anna App iframe UI | 独立 Web UI 或 Codex app/plugin 集成，需要重新设计边界 |

官方参考：

- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/plugins
- https://developers.openai.com/codex/plugins/build#plugin-structure

## 应向仓库作者提出的问题

1. Focus Flow 是否正式支持 `zh-CN`，还是中文 README 只覆盖开发文档？
2. locale 应由 Anna host 下发，还是每个 App 自己保存？
3. UI locale、聊天消息 locale 和 Skill 回复语言是否必须一致？
4. declarative bundled skill 在 `anna-app dev` 中应如何解析临时 ID？
5. 删除 `MANIFEST.name` 后，测试和 binary smoke test 的新身份来源是什么？
6. `app.json` 的 `0.1.0` 与 UI/package 的 `1.0.0` 哪个是发布真值？
7. `360×520` 是否真的是受支持尺寸？如果是，哪些区域必须始终可达？
8. 每秒更新宿主窗口标题是产品需求还是实现疏漏？
9. 今日总计希望显示整数分钟、1 位小数，还是时分格式？
10. 独立静态预览是否属于承诺能力？若是，SDK stub 放在哪里？
11. CI 已失败多次，是否应启用 required checks 阻止失败分支合并？
12. 示例中的 `openclaw`、`example.com` 和 schema 1 文档何时清理？

## 建议修复顺序

### 第一阶段：恢复可信基线

1. 修复 bundled skill 的 dev 解析。
2. 修复 bundle test 的 tool ID 和插件 test 的 `name` 断言。
3. 将 CI 设为合并前 required。
4. 统一版本号、仓库链接和 README schema 2 示例。
5. 升级 Vitest/Vite 并重新跑 CI。

### 第二阶段：正式中文化

1. 引入 locale catalog，不再散落硬编码字符串。
2. 同步翻译 UI、ARIA、聊天消息、窗口标题、manifest prompt 和 Skill。
3. 统一数字、分钟和时间格式。
4. 增加中文、英文和 pseudo-locale 测试。
5. 修复 `360×520` 响应式布局和滚动可达性。

### 第三阶段：可创造的新东西

1. **双语 Focus Flow**：支持中英切换、中文专注教练、中文复盘卡片。
2. **i18n QA harness**：自动把字符串扩张 30%，测试 min/default/max 三种窗口。
3. **Travel Agent Anna App**：把本地旅行代理的 PII/payment gate 与 Executa
   工具架构结合，平台 adapter 作为 Executa，UI 作为 Anna App。
4. **Executa-to-MCP Bridge**：把受信任 Executa stdio 工具转换为 Codex MCP
   tools，并保留 capability allowlist、超时和审计日志。
5. **共享契约生成器**：从一份 schema 生成 Python/Node/Go SDK 类型、fixture
   和 UI mock，减少当前这种 manifest/test/plugin 漂移。
6. **隐私能力标签**：为工具声明 `reads_pii`、`writes_external`、
   `requires_human_confirmation`，在 Anna 和 Codex 两端生成权限提示。

## 本次测试没有改动的内容

当前旅行代理源代码未修改。中文化和启动 workaround 只应用在
`/tmp/anna-executa-examples-review-20260612` 的临时审查副本。
