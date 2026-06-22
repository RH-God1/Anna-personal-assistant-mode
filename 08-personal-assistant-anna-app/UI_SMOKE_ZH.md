# Anna 个人助理网页端 UI Smoke 报告

生成时间：2026/06/23 04:29:20（Asia/Shanghai）
UTC：2026-06-22T20:29:20.682Z

## 结论

- 网页端个人助理模式可完成 HealthKit 同意门、显式官方接管流程，以及自然语言订票默认 Duffel 结构化比价。
- 桌面端可见 Expedia Flights 官方候选并授权后生成链接，也可切换到 Trip.com Hotels 官方入口。
- 自然语言“帮我订机票/酒店”不会默认打开外站，会落到 Duffel booking_prepare 前的推荐方案。
- 移动端 390px 宽度下无横向溢出。

## 桌面端结果

- 连接状态：Codex 本地实验
- 健康状态：已连接 · Companion
- 旅行状态：等待外站接管
- 旅行平台：Expedia Flights
- 行程：SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认
- 链接域名：www.expedia.com
- 字段方式：已写入官方搜索链接
- 匿名字段：目的地 NRT，成人 1
- 机票平台选项：Expedia Flights / Trip.com Flights / 携程机票
- 酒店平台选项：Booking.com / Trip.com Hotels / 携程酒店 / Expedia Hotels
- 备用接管：Trip.com Hotels · www.trip.com · 需要用户手动输入
- 酒店匿名日期：入住 2026-08-12，退房 2026-08-13，1 晚
- 自然语言 Duffel 预订类型：flight_hotel
- 自然语言 Duffel 比价摘要：推荐方案flight_hotel · 4 个组合 · sandbox/test mode2780.00 CNYduffel SHA-NRT 1460.00 CNY + duffel Duffel Test Stay Central 1320.00 CNY航班：SHA → NRT · 起飞 08/12 17:20 · 到达 08/12 20:26 · 中转 …
- 模型选项数量：7

## 移动端结果

- viewport/client width：390
- scroll width：390
- 旅行结果可见：true
- 匿名字段包可见：true
- 链接文本：打开 Expedia Flights

## 边界

- 该 UI smoke 只打开本地 Anna 预览页。
- 不打开外部订票/订房网站。
- 不收集旅客身份、不确认订单、不付款。
