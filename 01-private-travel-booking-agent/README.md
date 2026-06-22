# Private Travel Booking Agent

本项目是一个本地优先的浏览器扩展原型，用来帮助用户在网页版出行平台上进行机票、高铁、酒店预订流程中的非敏感导航操作。遇到个人信息、行程信息确认、付款时，Agent 会暂停并提示用户自行处理。

## 核心边界

- 不代付：检测到付款、收银台、银行卡、钱包、验证码等页面或字段时，Agent 暂停。
- 不读取敏感输入值：Agent 只检测字段类型、标签和页面状态，不读取用户输入的姓名、身份证、护照、手机号、银行卡、验证码、支付密码等值。
- 不外传数据：扩展代码没有 `fetch` / XHR / 第三方 SDK，不会把身份信息、行程信息、付款信息发送到外部服务。
- 不保存 PII：本地存储只保存开关和粗粒度状态，例如 `running`、`payment_hold`，不保存 URL、订单号、姓名、证件号、银行卡号。
- 人工接管：用户信息输入、可能提交订单的确认动作、付款动作均由用户自己在网页中操作。

## 安装和运行

1. 打开 Chrome 或 Edge 的扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`/Users/r/Documents/Anna/01-private-travel-booking-agent`。
5. 打开网页旅行平台，点击浏览器工具栏里的 `Travel Agent` 图标，然后点击“启动”。

## 使用方式

1. 用户在出行平台页面发起搜索或进入预订流程。
2. Agent 自动执行安全的非敏感导航，例如搜索、继续、选择。
3. 如果页面出现旅客、联系人、证件、手机号等字段，Agent 高亮字段并暂停，用户自行输入。
4. 如果出现确认订单、提交订单、付款、收银台等动作，Agent 暂停，用户自行点击并付款。
5. 付款后，Agent 只识别“支付成功 / 预订成功 / 订单完成 / 出票中”等粗粒度完成状态，再进入后续状态。

## 生产化建议

扩展 manifest 当前只允许常见旅行站点，不再使用 `<all_urls>`。通用检测规则仍需在真正接入携程、飞猪、12306、Booking、酒店官网等平台时，为每个平台建立独立 adapter：

- 使用明确的域名白名单，替换当前 `manifest.json` 里的 `<all_urls>`。
- 为每个平台维护只读页面检测规则和安全点击规则。
- 对所有可能提交个人信息或订单的动作设置人工确认 gate。
- 增加本地审计日志，但日志只能记录状态名，不能记录页面文本、URL、订单号或输入值。
- 做安全评审，确认不会违反平台服务条款、当地法律和隐私法规。

## 开发检查

```bash
npm run check
```

## 浏览器自动化测试工具

本项目使用 [Playwright Test 官方网站](https://playwright.dev/) 作为浏览器自动化测试工具。它支持 macOS，并可自动化 Chromium、Firefox 和 WebKit；当前项目默认使用 Chromium。

首次安装浏览器：

```bash
npm run browser:install
```

运行无界面浏览器测试：

```bash
npm run test:browser
```

运行可见浏览器窗口测试：

```bash
npm run test:browser:headed
```

打开 Discord（DC）手动登录自动化测试：

```bash
npm run test:dc-login:ui
```

该测试通过 Google 搜索确认 Discord 官网，然后打开 Discord 官方登录页并定位邮箱、手机号和密码输入框。默认由用户在浏览器中手动输入凭据，测试不会自动提交登录表单。

Discord 登录测试使用 Playwright WebKit。只验证登录页和输入框是否可以正常加载：

```bash
npm run test:dc-login:check
```

使用本地账户和密码输入界面：

```bash
npm run dc:credentials
```

然后打开 `http://127.0.0.1:9333`。填写账户和密码后，Playwright 会打开 Discord 官方登录页并自动填入，但不会点击登录。凭据只在本机进程内存中使用，不会写入文件或日志。

通行密钥登录请点击页面中的“使用通行密钥登录”。该流程使用本机 Google Chrome，而不是 Playwright WebKit，以便调用 macOS 的 Touch ID、设备密码或其他系统通行密钥。浏览器配置保存在本地 `.playwright-profiles/discord-chrome`，该目录已被 Git 忽略，密码不会由脚本保存。

测试配置位于 `playwright.config.js`，示例测试位于 `tests/browser/api-demo.spec.js`。测试会自动启动本地 API 服务并走完 Agent 演示流程。

## 本地平台 API 网关

项目现在包含一个本地 API 网关，用来把 Agent 和各类平台 adapter 连接起来：

- `server/index.js`：本地 API 服务。
- `server/platforms/sandbox.js`：机票、高铁、巴士、酒店 sandbox adapter。
- `server/platforms/amadeus.js`：Amadeus 机票官方 API adapter。有密钥时可搜索机票，不创建订单、不收集旅客信息。
- `server/platforms/handoff.js`：12306、巴士等官方网页人工接管 adapter。
- `public/api-agent-demo.html`：API Agent 演示页。
- `tests/api-flow.js`：端到端实验脚本。

启动本地 API：

```bash
npm run serve:api
```

打开演示页：

```text
http://127.0.0.1:8787/demo
```

运行端到端实验：

```bash
npm run test:api
```

实验覆盖：

- 平台列表查询。
- sandbox 机票搜索。
- Agent 自动选择报价并建立 hold。
- 在旅客信息处进入 `await_traveler_info`。
- 用户确认输入后进入 `await_payment`。
- 用户确认付款后进入 `post_payment`。
- 如果请求体包含 `passengerName`、证件号、手机号、银行卡号等敏感数据，API 直接拒绝。

## API 端点

- `GET /health`
- `GET /api/platforms`
- `POST /api/search`
- `POST /api/holds`
- `POST /api/book-intents`
- `GET /api/llm/status`
- `POST /api/llm/recommend`
- `POST /api/agent/run`
- `POST /api/agent/runs/:id/continue`
- `POST /api/agent/runs/:id/llm-advice`
- `GET /api/agent/runs/:id`

示例：

```bash
curl -s http://127.0.0.1:8787/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "product": "flight",
    "provider": "sandbox-flight",
    "search": {
      "product": "flight",
      "origin": "SHA",
      "destination": "BJS",
      "departureDate": "2026-07-01",
      "passengers": { "adults": 1 }
    }
  }'
```

## 后端 LLM Adapter

项目包含一个后端-only 的 OpenAI LLM adapter：

- `server/llm/openai.js`：只在 Node 后端读取 `process.env.OPENAI_API_KEY`。
- 前端只调用本地 `/api/llm/status` 或 `/api/agent/runs/:id/llm-advice`。
- API 响应只暴露 `configured`、`mode`、`model` 等状态，不返回、打印或保存密钥。
- 没有配置 `OPENAI_API_KEY` 时自动使用 mock 建议，方便本地测试。
- 即使配置了密钥，如果请求没有 `consentToShareWithLLM: true`，也不会把非个人行程查询发送到 OpenAI。
- 姓名、证件、手机号、银行卡、验证码、支付密码等 PII 仍会被本地 API 拒绝。

配置方式：

```bash
export OPENAI_API_KEY='你的新密钥'
export OPENAI_LLM_MODEL='gpt-4.1-mini'
npm run serve:api
```

强制 mock 模式：

```bash
OPENAI_LLM_MODE=mock npm run serve:api
```

获取 LLM 状态：

```bash
curl -s http://127.0.0.1:8787/api/llm/status
```

给某个 Agent run 生成建议：

```bash
curl -s http://127.0.0.1:8787/api/agent/runs/RUN_ID/llm-advice \
  -H 'Content-Type: application/json' \
  -d '{ "consentToShareWithLLM": false }'
```

如果要允许后端把非个人行程查询发给 OpenAI：

```json
{
  "consentToShareWithLLM": true
}
```

## 真实平台接入

真实平台必须使用官方或授权 API。默认情况下，外部 API 调用关闭，防止行程信息外传。

Amadeus 机票搜索 adapter：

```bash
export AMADEUS_CLIENT_ID='...'
export AMADEUS_CLIENT_SECRET='...'
export ALLOW_EXTERNAL_TRAVEL_API=true
npm run serve:api
```

调用真实外部 API 时，请求体还必须包含：

```json
{
  "consentToShareItinerary": true
}
```

即使接入真实 API，本 Agent 仍不接收姓名、证件、手机号、银行卡、验证码、支付密码等数据，也不创建会导致付款或出票的自动订单。订单确认和付款必须由用户自己完成。
