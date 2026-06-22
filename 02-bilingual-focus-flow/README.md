# 双语 Focus Flow

这是从上游 MIT 示例重新整理的独立 Anna App 项目，修复了审查中记录的几个问题：

- `en` / `zh-CN` locale catalog 覆盖 UI、ARIA、聊天消息和窗口标题。
- SDK 改为动态导入；在普通静态服务器中会进入可操作的 standalone runtime。
- `360×520` 下允许纵向滚动，并将时长按钮改为 2×2。
- 所有分钟显示都由 `focused_seconds` 统一计算，保留最多一位小数。
- 窗口标题只在分钟变化或状态变化时更新，不再每秒 RPC。
- Node Executa 可用 `FOCUS_FLOW_STATE_FILE` 指定隔离测试状态。
- Focus Coach 规则已并入 `system_prompt_addendum`，保留 `docs/focus-coach/SKILL.md`
  作为开发说明，不再把 declarative skill 误声明为 bundled runtime Executa。

## 运行

```bash
npm run check
npm test
npm run serve
```

打开 `http://127.0.0.1:8802`。独立预览中的计时状态保存在浏览器
`localStorage`；Anna 内运行时使用 bundled `focus-session` Executa。

## 在官方 Anna Harness 中运行

先确保官方前置条件满足：

- Node 22+
- `uv`
- `anna-app doctor` 通过

然后在本目录运行：

```bash
PATH="$HOME/.local/bin:$PATH" npx --yes @anna-ai/cli@0.1.30 dev --no-llm
```

如果只想跑自动 smoke：

```bash
npm run smoke:anna
```

已使用 `@anna-ai/cli@0.1.30` 通过 `anna-app validate --strict`，并通过
官方 `anna-app dev` harness smoke。

上游参考：`whtcjdtc2007/anna-executa-examples`，提交
`ca45136520f98b638dc50cc80e4cfc703c16163e`。原项目使用 MIT License，
许可证见本目录 `LICENSE`。
