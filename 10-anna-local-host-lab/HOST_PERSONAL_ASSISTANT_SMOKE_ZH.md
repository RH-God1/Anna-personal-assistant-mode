# Anna Host 个人助理 Smoke 报告

生成时间：2026/06/23 04:30:02（Asia/Shanghai）
UTC：2026-06-22T20:30:02.460Z

## 结论

- Anna Local Host Lab 中的个人助理 App 可连接 Host SDK，并通过真实 Executa 触发 HealthKit 同意门与旅行 handoff。
- Host iframe 内可见匿名字段包；默认 Expedia Flights 深链和 Trip.com Hotels 入口型接管均可生成。
- Host iframe 内也可从自然语言请求生成机票+酒店组合候选，酒店项包含入住、退房和晚数，确认后才打开外站。
- Host 审计保持 metadata-only：记录工具调用键名，不记录行程字段值、页面文本、订单号或 PII。

## Host 运行结果

- Host privacy mode：strict
- 活跃 App：private-travel-agent / personal-assistant-mode
- 健康状态：已连接 · Companion
- Companion 快照：今日步数 7340，心率 83 bpm，睡眠 6h 38m
- Companion 来源：Anna iOS HealthKit Companion host smoke
- 助理回复摘要：ANNA 我已读取这次获授权的健康快照。 记录值为：今日步数 7340 步、最近心率 83 bpm、睡眠 6 小时 38 分钟。这些数值只用于日常提醒，单次读数不能说明健康状态。 已确认 数据时间：2026-06-22T20:29:47.869Z；数据源：Anna iOS HealthKit Companion host smoke 仍未知 真实设备趋势；测量上下文；临床意义 下一步 真实版只展示趋势，不自动诊断；明显不适时联系合格医疗专业人员 强化记忆 无
- personal-assistant 工具调用审计数：22
- 审计是否包含参数值：false

## 旅行接管

| 平台 | 行程 | 链接域名 | 字段方式 | 目的地/城市 | 成人 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Expedia Flights | SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | www.expedia.com | 已写入官方搜索链接 | NRT | 1 | 等待外站接管 |
| Trip.com Hotels | Tokyo · 2026-08-12 → 2026-08-13 · 1晚 · Anna预估 650 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | www.trip.com | 需要用户手动输入 | Tokyo | 1 | 等待外站接管 |

## 自然语言组合接管

- 状态：等待用户确认
- 主平台：Expedia Flights
- 主行程：SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认
- 酒店项：酒店 · Tokyo · 2026-08-12 → 2026-08-14 · 2晚 · Booking.com · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 · 确认酒店
- 组合项数量：2

## Host 外站打开

| 产品 | 平台 | 本地链接域名 | 外站域名 | 到达目标域 | 外站打开后状态 | 测试终点 | 加载 | 分类 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 机票 | Expedia Flights | www.expedia.com | www.expedia.com | yes | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site |
| 酒店 | Booking.com | www.booking.com | www.booking.com | yes | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site |

## 边界

- 该 smoke 在 Anna Host iframe 中验证个人助理主体、Host RPC、用户确认门和用户触发的外站新页。
- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。
- 不确认订单、不付款、不保存页面文本、订单号或支付信息。
