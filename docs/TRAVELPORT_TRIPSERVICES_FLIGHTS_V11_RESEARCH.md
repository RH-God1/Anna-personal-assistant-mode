# Travelport TripServices Flights API v11 调研

调研日期：2026-06-20。主要依据为 Travelport 官方 developer / support 文档。

## 官方资料

- Travelport Developer 首页：<https://developer.travelport.com/>
- Flights API v11 overview：<https://developer.travelport.com/docs/flights>
- Getting started：<https://developer.travelport.com/docs/getting-started>
- Authentication：<https://developer.travelport.com/docs/getting-started/authentication>
- Flights API endpoints：<https://developer.travelport.com/docs/flights/general/flights-api-endpoints>
- Required Full Workflow：<https://developer.travelport.com/docs/flights/workflows/end-to-end-flows/json-apis-required-full-workflow>
- Pay API v11 overview：<https://developer.travelport.com/docs/pay>
- API Reference：<https://developer.travelport.com/apis/flights>

## 能力确认

Travelport 官方开发者首页描述 TripServices Flights 支持端到端 air workflow，包括 search、price、book、ticket、cancel，以及 exchange/modify。Flights API v11 overview 说明这是 RESTful JSON API，用于搜索、预订和管理 air reservations。

能力匹配：

- 航班搜索：支持。官方 endpoints 包含 `POST catalog/search/catalogproductofferings`。
- 价格确认：支持。官方 endpoints 包含 `POST price/offers/buildfromcatalogproductofferings` 和 `POST price/offers/buildfromproducts`。
- 创建预订：支持。最小流程包含创建 workbench、添加 offer、添加 traveler、commit workbench 创建 reservation。
- 支付：支持。Flights ticketing endpoints 包含 add form of payment 和 add payment；TripServices Pay v11 也提供信用卡授权、地址验证和 reversal。
- 出票：支持。最小流程最后通过 commit post-commit workbench issue tickets；endpoint 表中 AirTicketing 包含 commit workbench and issue ticket。
- 取消/void/exchange：支持，但规则依 GDS/NDC、票规、账号权限和供应商配置。

## Provisioning 与 credentials

官方 Getting started 明确：Travelport 在 provisioning 时提供 TripServices API 所需 credentials。如果还不是 Travelport customer，需要联系销售。Authentication 文档说明 credentials 包括：

- `username`
- `password`
- `client_id`
- `client_secret`

这些 credentials 与 Travelport access group / PCC / point of sale / NDC 与 GDS 内容权限绑定。也就是说，Anna 后端不能只靠公开注册拿到完整生产出票能力；必须先完成 Travelport provisioning。

## OAuth 2.0 鉴权流程

官方 Authentication 文档说明 TripServices API 使用 OAuth 2.0，两腿 OAuth 流程，access token 有效期 24 小时，不应每次 API 调用都请求新 token。

当前端点：

- Pre-production token endpoint：`https://auth.pp.travelport.net/oauth/token`
- Production token endpoint：`https://auth.travelport.net/oauth/token`

Air API base paths：

- Pre-production：`https://api.pp.travelport.net/11/air/`
- Production：`https://api.travelport.net/11/air/`

Pay API base paths：

- Pre-production：`https://api.pp.travelport.net/11/payment/`
- Production：`https://api.travelport.net/11/payment/`

Node.js 后端封装建议：

1. `TravelportCredentialResolver` 从 KMS/Vault 解密 `username/password/client_id/client_secret`。
2. `TravelportOAuthClient` 缓存 token 到 `accessTokenExpiresAt - safetyWindow`。
3. 所有 Travelport API 请求统一加 `Authorization: Bearer <token>`。
4. token 请求本身要限流；官方文档标注 token requests 每 unique IP 每秒 50 次，并要求不要每次 API 调用都取 token。

## 最小出票流程

官方 Required Full Workflow 给出的最小出票路径：

1. Search for flights。
2. Price。部分 low-cost 和 NDC carrier 必需。
3. Create new workbench。
4. Add offer。
5. Add traveler/s。
6. Commit workbench，创建 reservation。
7. Create post-commit workbench。
8. Add form of payment。
9. Add payment。
10. Commit workbench，issue ticket/s。

可映射到 Anna 后端内部 workflow：

- `POST /api/flights/search` → Travelport Search。
- `POST /api/flights/price` → Travelport AirPrice。
- `POST /api/flights/book` → create workbench + add offer + add traveler + commit reservation。
- `POST /api/flights/pay` → create post-commit workbench + add form of payment + add payment。
- `POST /api/flights/ticket` → commit post-commit workbench and issue ticket。

注意：Anna Agent 不应直接调用 `/book`、`/pay`、`/ticket`。这些 endpoints 只能由后端在用户确认、人类输入旅客信息、支付授权和风控通过后调用。

## Sandbox / 测试环境与上线认证

Travelport 文档使用 pre-production base paths 和 developer toolkits/Postman collections 支持测试。完整生产上线通常需要：

- Travelport customer/provisioning。
- PCC/access group/point of sale 配置。
- NDC/GDS carrier entitlement。
- 测试与认证流程，特别是 booking、payment、ticketing、void/refund/exchange。
- 客服/队列/票务/财务运营能力，不只是 API 调通。

## Node.js 后端封装建议

内部 provider adapter：

```ts
class TravelportFlightProvider implements FlightProvider {
  searchFlights(input) // POST catalog/search/catalogproductofferings
  priceFlightOffer(input) // POST price/offers/buildfromcatalogproductofferings
  createFlightBooking(input) // workbench + offer + traveler + reservation commit
  addPayment(input) // post-commit workbench + FOP + payment
  issueTicket(input) // commit post-commit workbench
}
```

公开 API 建议仍保持 Anna 的安全分层：

- Agent-facing：`/api/travel/flights/search`、`/api/travel/flights/price`、`/api/travel/flights/prepare-booking`、status。
- Backend-internal：`/api/flights/book`、`/api/flights/pay`、`/api/flights/ticket`，必须加 service-to-service auth 和 user confirmation gate。

所有 Travelport credentials 只能在后端环境变量或 KMS/Vault/Secret Manager 中保存。不能暴露给 Anna 主体个人助理、浏览器前端、日志、prompt、tool result 或 analytics。

## 是否适合 Anna 第一阶段 MVP

结论：Travelport TripServices Flights v11 不适合第一阶段 MVP 的首个接入，更适合后期正式 OTA / 企业级旅行社阶段。

原因：

- 优点：能力完整，覆盖 search、price、book、payment、ticket、cancel/exchange，适合正式 air booking/ticketing。
- 成本：需要 Travelport provisioning、PCC/access group、carrier entitlement、测试认证和票务运营能力。
- 风险：出票、支付、void/refund/exchange 都是高风险生产流程，不适合个人助理 MVP 早期直接承担。
- MVP 替代：第一阶段建议继续 Duffel / Amadeus sandbox + mock provider，酒店侧用 Amadeus/Booking.com/Expedia sandbox，支付侧先 Stripe test mode。
- 后期路线：当 Anna 项目需要正式 OTA 能力、企业租户 BYOK、票务队列、退改签客服和财务对账时，再接 Travelport。
