# Anna 个人助理真实浏览器 Handoff Smoke 报告

生成时间：2026/06/23 04:29:47（Asia/Shanghai）
UTC：2026-06-22T20:29:47.135Z

## 结论

- 从 Anna 个人助理本地网页端实际点击 HealthKit 同意门、生成旅行候选，用户确认后再打开真实外部订票/订房网页。
- 每个外站打开后，本地 Anna run 均停在用户资料门；测试只模拟用户确认资料已填完，随后停在 `payment_handoff`。
- 真实外站如返回验证码、JS challenge 或反自动化页面，测试只记录分类并停在人工接管边界。

## 浏览器接管结果

| 场景 | 平台 | 行程 | 字段方式 | 目的地/城市 | 本地链接域名 | 外站域名 | 到达目标域 | 打开方式 | 外站打开后状态 | 测试终点 | 加载 | 分类 | challenge 信号 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flight-expedia-default | Expedia Flights | SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | NRT | www.expedia.com | www.expedia.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| hotel-booking-default | Booking.com | Tokyo · 2026-08-12 → 2026-08-13 · 1晚 · Anna预估 720 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | Tokyo | www.booking.com | www.booking.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| hotel-trip-selected | Trip.com Hotels | Tokyo · 2026-08-12 → 2026-08-13 · 1晚 · Anna预估 650 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 需要用户手动输入 | Tokyo | www.trip.com | www.trip.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| natural-language-bundle-flight | Expedia Flights | SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | NRT | www.expedia.com | www.expedia.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| natural-language-bundle-hotel | Booking.com | Tokyo · 2026-08-12 → 2026-08-14 · 2晚 · Anna预估 1440 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | Tokyo | www.booking.com | www.booking.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |

## 健康与边界

- 健康状态：已连接 · Companion
- 打开的是真实外部网页，但不绕过验证码或反自动化页面。
- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。
- 不确认订单、不付款、不保存页面文本、订单号或支付信息。
