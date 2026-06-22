# 隐私旅行代理 Anna App

将 `01-private-travel-booking-agent` 的隐私边界转换为 Anna App / Executa
结构：

- Anna App schema 2 manifest；
- bundled Node Executa，暴露单一 `travel_agent` tool；
- sandbox 查询和官方网页人工接管两种模式；
- 官方网页人工接管会返回真实平台的匿名搜索链接，但不会替用户处理验证码、登录、
  旅客身份、订单确认或付款；
- 旅客信息、订单确认、付款均为强制 human gate；
- PII key/value 拒绝、人数校验和不可跳跃状态机；
- SDK 不可用时可在浏览器 standalone 预览并实际操作完整状态流。

## 运行

```bash
npm run check
npm test
npm run serve
```

打开 `http://127.0.0.1:8804`。

如需在官方 Anna harness 中运行：

```bash
PATH="$HOME/.local/bin:$PATH" npx --yes @anna-ai/cli@0.1.30 dev --no-llm
```

如需自动 smoke：

```bash
npm run smoke:anna
```

该项目不会创建真实订单，也不会自动付款。真实平台接入必须使用官方或授权 API，
并另外取得用户对行程字段外传的明确同意。

已使用 `@anna-ai/cli@0.1.30` 通过 `anna-app validate --strict`，并通过
官方 `anna-app dev` harness smoke。
