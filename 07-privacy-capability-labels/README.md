# Privacy Capability Labels

为 Anna / MCP 工具声明并验证：

- `reads_pii`
- `writes_external`
- `requires_human_confirmation`
- `human_gates`
- `data_classes`
- `retention`
- `external_domains`

生成物包括面向用户的中文隐私报告，以及可供 UI / MCP 使用的 risk、badges、
consent 和 annotations。

校验会拒绝常见矛盾，例如：

- `writes_external: false` 但仍声明外部域名；
- 要求人工确认但没有 gate；
- 不要求人工确认但仍配置 gate；
- 读取 PII 却没有明确数据类别；
- 外部写入却没有列出目标域名。

```bash
npm run generate
npm run check
npm test
```
