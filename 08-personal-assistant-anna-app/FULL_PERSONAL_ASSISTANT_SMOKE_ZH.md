# Anna 个人助理完整 Smoke 总报告

生成时间：2026/06/23 03:10:57（Asia/Shanghai）
UTC：2026-06-22T19:10:57.222Z

## 总结

- 网页端 UI smoke 证明用户可以在 Anna 个人助理模式里实际点击 HealthKit 同意门、生成机票酒店候选、确认候选或否决后换平台。
- HealthKit doctor 报告证明 iOS Companion 工程、HealthKit entitlement、本地网络权限和本机 iPhone 安装条件已被逐项检查。
- HealthKit bridge smoke 证明 Anna 网页端可读取 companion 推送的 iPhone/Apple Watch 风格快照，而不是只显示默认模拟值。
- 真实外站 smoke 证明 Anna 主体可以生成 Expedia Flights 与 Booking.com 的匿名官方搜索链接，并支持用户选择 Trip.com 官方入口。
- 真实浏览器 handoff smoke 证明 Anna 会在用户确认候选并授权订购接管后，从网页端打开外部订票/订房网页，并在外站打开后停在用户资料门。
- Host smoke 证明同一套个人助理模式可在 Anna Local Host iframe 中通过 Host SDK、Executa、隐私审计和匿名字段包验证。
- service-level 外站探测会记录 human challenge；browser-level 测试会记录实际加载/超时状态。项目始终停在用户资料门或 `payment_handoff`，不绕过验证码、不提交个人信息、不确认订单、不付款。

## 报告文件

- `UI_SMOKE_ZH.md`：网页端本地 UI 操作、桌面与移动端布局。
- `HEALTHKIT_DOCTOR_ZH.md`：iOS Companion、HealthKit 权限声明、LAN 与本机 Xcode/签名准备度。
- `HEALTHKIT_BRIDGE_SMOKE_ZH.md`：Companion 风格 HealthKit 快照推送、网页端连接与健康边界。
- `REAL_HANDOFF_SMOKE_ZH.md`：真实外站可达性、challenge 分类与人工接管边界。
- `BROWSER_HANDOFF_SMOKE_ZH.md`：从 Anna 网页端打开真实外部网页的浏览器级接管证据。
- `10-anna-local-host-lab/HOST_PERSONAL_ASSISTANT_SMOKE_ZH.md`：Anna Host iframe 内个人助理主体、健康、旅行与审计证据。

## UI Smoke 摘要

生成时间：2026/06/23 03:10:07（Asia/Shanghai）
UTC：2026-06-22T19:10:07.381Z

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

## HealthKit Doctor 摘要

生成时间：2026/06/23 03:10:07（Asia/Shanghai）
UTC：2026-06-22T19:10:07.601Z

## 结论

- Anna 侧 HealthKit Companion 文件、权限声明与本地桥接预检已通过。
- 本报告只检查 Companion 工程、权限、LAN 与本机 iOS 构建条件，不读取真实 HealthKit 数据。
- 真实 iPhone/Apple Watch 数据读取仍必须由用户在 iOS HealthKit 系统弹窗中授权。

## 当前本机限制

- xcode app：no /Applications/Xcode.app or /Applications/Xcode-beta.app found
- xcode：/Library/Developer/CommandLineTools; full Xcode is required for iPhone install
- ios toolchain：xcrun simctl unavailable; full Xcode is required for iPhone build/install
- codesigning identity：0 valid identities found; iPhone install needs an Apple Development signing identity

## 检查明细

| 项目 | 状态 | 必需 | 结果 |
| --- | --- | --- | --- |
| xcode project | ok | yes | ios-companion/AnnaHealthCompanion.xcodeproj/project.pbxproj |
| shared scheme | ok | yes | ios-companion/AnnaHealthCompanion.xcodeproj/xcshareddata/xcschemes/AnnaHealthCompanion.xcscheme |
| healthkit entitlement | ok | yes | com.apple.developer.healthkit |
| local network usage description | ok | yes | NSLocalNetworkUsageDescription |
| local networking ATS exception | ok | yes | NSAllowsLocalNetworking |
| lan address | ok | yes | 192.168.1.82 (en0) |
| xcode app | warn | no | no /Applications/Xcode.app or /Applications/Xcode-beta.app found |
| xcode | warn | no | /Library/Developer/CommandLineTools; full Xcode is required for iPhone install |
| ios toolchain | warn | no | xcrun simctl unavailable; full Xcode is required for iPhone build/install |
| codesigning identity | warn | no | 0 valid identities found; iPhone install needs an Apple Development signing identity |

## HealthKit Bridge Smoke 摘要

生成时间：2026/06/23 03:10:08（Asia/Shanghai）
UTC：2026-06-22T19:10:08.454Z

## 结论

- 本地 HealthKit bridge 接收 iOS/watchOS Companion 风格快照，并返回 `ios-watchos-companion` provider。
- Anna 网页端健康同意门连接后显示 `已连接 · Companion`，读取的是推送快照而不是默认模拟值。
- 健康数据只保存在当前 Node 进程内存，不做医疗诊断。

## 推送快照

- 设备：iphone / apple_watch
- 来源：Anna iOS HealthKit Companion smoke
- 今日步数：8320
- 心率：81 bpm
- 睡眠：410 分钟（Apple Watch）

## UI 结果

- 连接状态：Codex 本地实验
- 健康徽标：已连接 · Companion
- 今日步数显示：8320
- 心率显示：81
- 睡眠显示：6h 50m

## 边界

- 浏览器不直接读取 Apple Health。
- 真实设备需要 iOS/watchOS Companion App 和 HealthKit 授权。
- 不把步数、心率或睡眠快照解释为医疗诊断。
- 不持久化保存健康快照。

## 真实 Handoff Smoke 摘要

生成时间：2026/06/23 03:10:10（Asia/Shanghai）
UTC：2026-06-22T19:10:10.797Z

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

## 真实浏览器 Handoff Smoke 摘要

生成时间：2026/06/23 03:10:45（Asia/Shanghai）
UTC：2026-06-22T19:10:45.643Z

## 结论

- 从 Anna 个人助理本地网页端实际点击 HealthKit 同意门、生成旅行候选，用户确认后再打开真实外部订票/订房网页。
- 每个外站打开后，本地 Anna run 均停在用户资料门；测试只模拟用户确认资料已填完，随后停在 `payment_handoff`。
- 真实外站如返回验证码、JS challenge 或反自动化页面，测试只记录分类并停在人工接管边界。

## 浏览器接管结果

| 场景 | 平台 | 行程 | 字段方式 | 目的地/城市 | 本地链接域名 | 外站域名 | 到达目标域 | 打开方式 | 外站打开后状态 | 测试终点 | 加载 | 分类 | challenge 信号 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flight-expedia-default | Expedia Flights | SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | NRT | www.expedia.com | www.expedia.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| hotel-booking-default | Booking.com | Tokyo · 2026-08-12 → 2026-08-13 · 1晚 · Anna预估 720 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | Tokyo | www.booking.com | www.booking.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| hotel-trip-selected | Trip.com Hotels | Tokyo · 2026-08-12 → 2026-08-13 · 1晚 · Anna预估 650 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 需要用户手动输入 | Tokyo | www.trip.com | www.trip.com | yes | playwright_new_page_after_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| natural-language-bundle-flight | Expedia Flights | SHA → NRT · 2026-08-12 · Anna预估 1680 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | NRT | www.expedia.com | www.expedia.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |
| natural-language-bundle-hotel | Booking.com | Tokyo · 2026-08-12 → 2026-08-14 · 2晚 · Anna预估 1440 CNY · 未提供预算，官方最终价待用户接管页面确认 · Anna 预估，官方实时库存与最终价待页面确认 | 已写入官方搜索链接 | Tokyo | www.booking.com | www.booking.com | yes | browser_new_page_from_ui_click | 等待用户填写资料 | payment_handoff | domcontentloaded | browser_reached_external_site | none |

## 健康与边界

- 健康状态：已连接 · Companion
- 打开的是真实外部网页，但不绕过验证码或反自动化页面。
- 不提交姓名、证件、手机号、邮箱、银行卡、验证码或支付密码。
- 不确认订单、不付款、不保存页面文本、订单号或支付信息。

## Anna Host 个人助理 Smoke 摘要

生成时间：2026/06/23 03:10:57（Asia/Shanghai）
UTC：2026-06-22T19:10:57.165Z

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
- 助理回复摘要：ANNA 我已读取这次获授权的健康快照。 记录值为：今日步数 7340 步、最近心率 83 bpm、睡眠 6 小时 38 分钟。这些数值只用于日常提醒，单次读数不能说明健康状态。 已确认 数据时间：2026-06-22T19:10:46.333Z；数据源：Anna iOS HealthKit Companion host smoke 仍未知 真实设备趋势；测量上下文；临床意义 下一步 真实版只展示趋势，不自动诊断；明显不适时联系合格医疗专业人员 强化记忆 无
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
