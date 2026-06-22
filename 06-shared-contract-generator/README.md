# Shared Contract Generator

从一份结构化 JSON contract 生成：

- Node / TypeScript 类型；
- Python `TypedDict`；
- Go struct；
- JSONL happy-path fixtures；
- 浏览器 UI mock；
- 精简 contract manifest。

`check` 命令会在临时目录重新生成并逐文件比较，任何 SDK、fixture 或 mock 漂移都会
返回非零退出码。

```bash
npm run generate
npm run check
npm test
```

默认示例是 `04-travel-agent-anna-app` 的 `travel_agent` 契约。
