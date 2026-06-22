# Anna 个人助理真实 Handoff Smoke 报告

生成时间：2026/06/23 04:29:23（Asia/Shanghai）
UTC：2026-06-22T20:29:23.894Z

## 结论

- Anna 主体已完成 preflight、天气上下文、HealthKit 桥接、机票与酒店候选确认门和官方 handoff。
- 默认深链平台与用户选择的 Trip.com 酒店官方入口均可进入人工接管。
- 机票和酒店 run 均先经过用户确认门和订购接管授权；外站打开后停在用户填写资料门，模拟资料完成后停在 `payment_handoff`。
- 外站访问只做可达性与 challenge 分类；验证码、登录、旅客信息和支付仍由用户本人处理。

## 健康与前置问候

- 天气来源：Open-Meteo demo fixture
- 健康权限状态：requested
- 健康桥接：healthkit-companion-bridge / demo
- 存储边界：memory_only

## 旅行 Handoff

| 产品 | 平台 | 域名 | 匿名字段方式 | 外站打开后状态 | 测试终点 | HTTP | 分类 | challenge 信号 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flight | Expedia Flights | www.expedia.com | URL 匿名字段 | await_user_details | payment_handoff | 429 | human_challenge | anti_automation_challenge, captcha_pwa |
| hotel | Booking.com | www.booking.com | URL 匿名字段 | await_user_details | payment_handoff | 202 | human_challenge | anti_automation_challenge, challenge_js |
| hotel | Trip.com Hotels | www.trip.com | 手动输入匿名字段 | await_user_details | payment_handoff | 200 | human_challenge | anti_automation_challenge |

## 人工接管边界

- 不绕过验证码或反自动化页面。
- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。
- 不确认订单、不付款、不保存页面文本、订单号或支付信息。
