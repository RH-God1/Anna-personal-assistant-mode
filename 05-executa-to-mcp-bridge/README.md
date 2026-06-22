# Executa-to-MCP Bridge

把受信任的 Anna Executa stdio tool 暴露为 MCP server。实现当前
`initialize`、`ping`、`tools/list`、`tools/call` 形状，并使用
`2025-11-25` 协议版本。

安全边界：

- 每个 Executa 必须配置 `allowedTools`；
- 子进程只继承 `PATH`、`HOME` 和显式 `inheritEnv`；
- 每次调用有超时；
- MCP tool 名使用 `<executa-id>__<tool-name>`，避免冲突；
- audit log 只记录 tool、结果类型和耗时，不记录参数或返回值；
- privacy metadata 会进入 tool 描述与 MCP annotations。

## 运行

```bash
npm run check
npm test
npm run smoke
npm start
```

默认配置桥接 `04-travel-agent-anna-app` 的 `travel_agent` Executa。

## Codex MCP 配置

本项目适配的 Codex MCP server 名称为 `anna-executa`。本机可用以下命令注册：

```bash
codex mcp add anna-executa -- node /Users/r/Documents/Anna/05-executa-to-mcp-bridge/src/server.js /Users/r/Documents/Anna/05-executa-to-mcp-bridge/bridge.config.json
```

验证注册：

```bash
codex mcp get anna-executa
npm run mcp:smoke --prefix /Users/r/Documents/Anna
```

当前 smoke test 会覆盖 `initialize`、`ping`、`tools/list`、`tools/call` 和 PII 拦截。

参考：

- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
