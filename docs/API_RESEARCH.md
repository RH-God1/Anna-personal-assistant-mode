# Travel and Payment API Research

本调研只采用官方文档/开发者门户作为主要依据。结论面向本项目的 Provider 架构：先用 mock provider 跑通本地闭环，再逐步接 sandbox，最后在完成商户/合作伙伴审核、风控和用户确认门后接真实订单。

## Summary

| API 名称 | 官方文档地址 | Sandbox | 真实下单 | 取消 / 退款 | Webhook | 审核 / 资格 | 认证方式 | 定位 | 推荐顺序 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Duffel API | <https://duffel.com/docs/api/overview/welcome> | 支持 test mode / test data | 支持 Orders，但生产需要账号和商业配置 | 支持 order cancellation；退款/航司规则依订单而定 | 支持 webhooks：<https://duffel.com/docs/api/webhooks/overview> | 需要 Duffel 账户；生产和支付/出票能力需要审核 | Bearer token | MVP 到生产候选，API 现代化 | 1 |
| Amadeus Flight APIs | <https://developers.amadeus.com/self-service/category/flights> | 支持 self-service test environment | Flight Create Orders 可创建订单；真实出票/生产能力受 API 套餐和资质限制 | 取消/改签能力不等同于所有 self-service API 都开放 | 部分 enterprise/notification 能力可用，self-service 以同步 API 为主 | 生产和 booking 能力通常需要应用审批/商业条件 | OAuth2 client credentials | MVP 搜索/定价优先，生产需评估 | 2 |
| Sabre APIs | <https://developer.sabre.com/> | 支持 certification / test 环境 | 支持航旅预订、PNR、出票相关 API | 支持取消/void/refund 等企业能力，依产品开通 | 支持部分通知/queue/workflow 集成 | GDS/旅行社/企业资质要求高 | OAuth / Sabre credentials | 企业上线 | 8 |
| Travelport TripServices Flights | <https://support.travelport.com/webhelp/jsonapis/airv11/> | 支持测试/认证环境 | 支持 Search、Price、Book、Ticket 等工作流 | 支持 cancel/void/exchange/refund 等，依配置 | 主要为企业工作流/通知能力 | 需要 Travelport 客户/代理资质 | OAuth / Travelport credentials | 企业上线 | 7 |
| Amadeus Hotel APIs | <https://developers.amadeus.com/self-service/category/hotels> | 支持 self-service test environment | Hotel Booking API 可创建酒店订单，生产受合作和库存限制 | Hotel Booking API/供应商规则决定取消能力 | self-service 以同步 API 为主 | 生产 booking 通常需要审核 | OAuth2 client credentials | MVP 搜索/酒店试点 | 3 |
| Expedia Rapid API | <https://developers.expediagroup.com/rapid/> | 支持 test booking / sandbox 流程 | 支持真实酒店 booking，生产需合作伙伴接入 | 支持 itinerary retrieve/cancel；退款按酒店和费率规则 | 支持 notifications/webhooks 能力 | 需要 Expedia Group partner 资格 | API key / signature headers | 强酒店供应，生产候选 | 4 |
| Hotelbeds / HBX Group Booking API | <https://developer.hotelbeds.com/documentation/hotels/booking-api/> | 支持 test environment | 支持 checkrates 和 bookings | 支持 cancellations；退款按合同/费率 | 文档包含 booking 相关 API，webhook/notification 视产品开通 | 需要 HBX/Hotelbeds 合作伙伴资质 | Api-key + X-Signature | 酒店企业上线候选 | 5 |
| Agoda Demand API | <https://developer.agoda.com/> | 合作伙伴 sandbox/测试能力 | 支持酒店搜索和订单，需 partner 接入 | 支持取消，按 Agoda/酒店规则 | webhook 能力需以合作伙伴文档/账号开通为准 | 需要 Agoda partner 资格 | Partner API key / credentials | 酒店分销合作 | 6 |
| Booking.com Demand API | <https://developers.booking.com/demand/docs/open-api/demand-api> | 支持 sandbox：<https://developers.booking.com/demand/docs/testing/sandbox> | 支持 orders endpoint；生产需合作伙伴资格 | 支持 order cancellation；退款按订单政策 | 官方 Demand API 以同步订单流为主，事件能力需单独确认 | 需要 Booking.com partner / Demand API access | Bearer token | 酒店生产候选 | 4 |
| Stripe PaymentIntents / SetupIntents / Webhooks | <https://docs.stripe.com/payments/payment-intents>, <https://docs.stripe.com/payments/setup-intents>, <https://docs.stripe.com/webhooks> | 支持 test mode | 支持真实扣款；本项目默认不真实扣款 | 支持 refunds：<https://docs.stripe.com/refunds> | 支持 webhook 和签名校验 | 需要 Stripe 商户账户；上线需 KYC | Secret key + webhook signing secret | MVP 支付首选 | 1 |
| Cybersource / Visa Acceptance Solutions | <https://developer.cybersource.com/api-reference-assets/index.html> | 支持 sandbox / apitest | 支持 payments、token management、payer authentication | 支持 refunds/voids，依交易状态 | 支持 Webhooks/Transaction events | 需要 Cybersource/Visa Acceptance merchant 账户 | HTTP Signature / key id / shared secret | 企业支付上线 | 9 |

## 接入建议

1. 本地：只启用 `MockFlightProvider`、`MockHotelProvider`、`MockPaymentProvider`，用内存 mock-db 完成搜索、定价、pending booking、用户确认、mock 支付、mock 供应商下单。
2. 首个真实航班 sandbox：Duffel。原因是 API 设计直接围绕 offer request、offer、order，测试环境对 MVP 更友好。
3. 首个真实酒店 sandbox：Amadeus Hotel 或 Booking.com Demand sandbox。Amadeus 适合快速验证搜索/booking API，Booking.com/Expedia 更接近酒店生产库存但需要 partner 资质。
4. 首个支付 sandbox：Stripe。先实现 PaymentIntents、SetupIntents、webhook signature verification 和 refund，再评估 Cybersource 的 enterprise 风控、tokenization 和 3-D Secure。
5. 企业级 GDS：Sabre 和 Travelport 放在后续阶段。它们适合正式旅行社/GDS 工作流，不适合没有资质时直接作为 MVP 首接。

## 安全结论

- Agent 永远不应直接调用真实 `book/order/charge`。后端必须持有 pending booking，并在用户确认后由服务层触发。
- 支付金额必须以后端 booking 记录为准，不能相信前端或 Agent 传入金额。
- 禁止保存 card number、CVV/CVC、短信验证码、3-D Secure 验证码。真实支付应使用 Stripe/Cybersource token、PaymentMethod 或 tokenized instrument。
- Webhook 必须校验签名后再改变订单/支付状态；当前 mock webhook 仅记录审计事件。
- 真实供应商 adapter 默认禁用，必须在 `.env` 配置凭据、完成合作资格审核，并增加显式生产开关后才能开启。

## 补充文档

- API Key / BYOK / 限流 / 成本控制架构：`docs/KEY_MANAGEMENT_RATE_LIMIT_COST_CONTROL.md`
- Travelport TripServices Flights v11 单独调研：`docs/TRAVELPORT_TRIPSERVICES_FLIGHTS_V11_RESEARCH.md`
