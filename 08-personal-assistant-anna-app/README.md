# Anna 个人助理模式

这是一个在 Codex 中运行的 Anna App 实验，目标是验证四层结构：

1. 与 Anna 当前界面语言相符的前端。
2. 根据任务所需能力和文本任务类型进行模型路由，而不是写死某一个模型。
3. 天气、空气质量和健康数据通过可审计工具提供。
4. 回复同时使用心理学、逻辑学和多个大模型集体思考原则，但不诊断、不操控、不制造依赖。

## 运行

```bash
npm run serve
```

打开 `http://127.0.0.1:8808`。

安全命令面板：

```text
http://127.0.0.1:8808/matrix
```

`/matrix` 只暴露本项目登记过的固定命令 ID，用于辅助启动受控后端、运行构建或配置检查；它不接受任意 shell 文本，不运行 `sudo`，也不绕过受控 Computer Agent 的 policy、approval、audit 边界。

如需在官方 Anna harness 中运行：

```bash
PATH="$HOME/.local/bin:$PATH" npx --yes @anna-ai/cli@0.1.30 dev --no-llm
```

如需自动 smoke：

```bash
npm run smoke:anna
npm run smoke:learning
```

如需执行真实外站 handoff smoke（会联网访问默认 Expedia Flights、Booking.com 匿名搜索
链接，并探测用户可选 Trip.com 官方入口，但不会绕过验证码、登录、旅客身份、订单确认或付款）：

```bash
npm run smoke:real
npm run smoke:healthkit-bridge
npm run smoke:browser-handoff
```

如需把同一次真实 smoke 写成中文报告：

```bash
npm run smoke:ui:report
npm run smoke:learning:report
npm run healthkit:doctor:report
npm run smoke:healthkit-bridge:report
npm run smoke:real:report
npm run smoke:browser-handoff:report
```

## 验证

```bash
npm run check
npm test
npm run doctor:anna-guide
npm run validate:anna
npm run smoke:anna
```

`npm run check` 会同时执行 iOS HealthKit companion 静态检查，以及 Anna 新手指南合规检查：
确认 `app.json`、`manifest.json`、`bundle/`、`executas/`、`anna-tool-ids.js`、host API
声明和前端 runtime 使用点保持一致。

`npm run doctor:anna-guide` 对照官方新手指南检查本机开发环境：Node.js 22+、npm、
`uv`，以及通过全局 `anna-app` 或本项目固定的 `npx @anna-ai/cli@0.1.30` fallback
执行 `anna-app doctor`。

另已使用 `@anna-ai/cli@0.1.30` 通过 `anna-app validate --strict`，并通过官方 harness smoke。

## 当前实验能力

- 进入个人助理模式时触发 `preflight`：Anna 主体主动问候、做基础状态问询、汇报天气与空气，并在首次使用时申请健康连接。
- 新增 `learning_status` / `learning_cycle` 强化学习记忆：当用户明确发出“强化学习 / 自主学习 / 学习复盘 / 训练”等指令时，Anna 主体会先完成 5 本心理学、5 本逻辑学和 5 本用户回复能力书目的书目级学习，再根据学习原则对个人助理模式本身进行自测、复盘、修正规则生成和记忆强化。
- 普通 `assist` 回复不会冒充新一轮学习；它只会读取已经沉淀的强化规则并在相关场景中应用。学习记忆会记录每次学习进度、复盘总结和强化经验，默认写入本地 JSON 记忆文件，也可通过 `ANNA_LEARNING_MEMORY_PATH` 指定路径。
- 上下文记忆能力已导入 GitHub 上的结构化记忆思路：用可重建的进度、复盘、经验和规则记录增强后续上下文，而不是保存原始私人对话或复制受版权保护的书籍正文。本项目不声称已经微调 Anna 主机底层模型。
- 运行架构已整理到 `docs/personal-assistant-runtime-architecture-zh.md`：覆盖 Dashboard 用户入口、Executa JSON-RPC 握手、后端模块分发、强化学习记忆链路、运行检查和 Dashboard 版本状态判断。
- 根目录 `SKILL.md` 是 Anna 主体个人助理模式的行为契约：规范前置问候、机票/酒店 Duffel-only 与官方 handoff、人类确认门、学习/训练触发顺序、模型能力路由和多模型总思考；不引入双语 Focus Flow 项目。
- `docs/anthropic-system-and-binary-packaging-zh.md` 记录如何把 `SKILL.md` 作为 Anthropic API 初始化 Anna 会话时的 `system` 参数，以及 Tool 二进制打包时 `sha256`、`size`、`entrypoint`、`format` 在哪里生成、哪里填写；二进制打包说明是发布元数据问题，不接入本次预订行为逻辑。
- 在 Anna 主机环境中，前置问候会通过 `chat.write_message` 作为 assistant 消息自动写入一次；用户重新前置问候或健康连接成功时会同步最新问候。
- 真实调用 Open-Meteo 天气与空气质量 API。
- 浏览器定位需要用户主动点击授权；未授权或未手动填写坐标时，Anna 只请求位置，不把示例城市当作用户当地天气。
- 首次使用状态使用当前进程内的匿名 `user_key` 内存记录，不写入服务端持久化存储。
- 自然语言机票/酒店请求默认走 Duffel 结构化搜索与预确认，例如“帮我订上海到东京机票和东京酒店，2026-08-12，住2晚，1人”会生成 Duffel 机票+酒店推荐方案；不会默认打开 Expedia、Trip.com、Booking.com 或其它外站。
- 官方网页 handoff 仍保留为显式能力：只有用户明确要求“打开官方网页 / 官网接管 / 浏览器接管”时，才会按产品选择官方平台；有可靠深链的平台会生成匿名搜索 URL，其余平台只打开官方入口，由用户根据网页端匿名字段包手动输入行程字段。
- 官方网页接管新增确认与授权循环：Anna 先发送候选、预估价与预算是否匹配，等待用户回复“是/否”；“是”后还需要用户授权订购接管，Anna 才能打开官方页面。外站中的姓名、证件、电话、邮箱、已保存旅客/住客资料选择和付款都由用户本人完成，Anna 只监测到付款前并交还。
- 健康层已抽象为 `health_connect` / `connectHealthKit`，仅允许 iPhone 与 Apple Watch 的 HealthKit companion 路径。
- 实验默认使用内存中的 demo provider，验证授权后的今日步数、最近心率和睡眠数据流；真实接入时替换 provider 的 `readSnapshot` 即可刷新实时快照。
- `ios-companion/AnnaHealthCompanion.xcodeproj` 已提供最小 iOS HealthKit companion 工程骨架，并通过静态检查确认 HealthKit 授权、今日步数/最近心率/睡眠读取、entitlements、前台实时同步循环和 Anna bridge payload 字段。真机运行仍需在 Xcode target 中启用 HealthKit Capability，并保留 `Info.plist` 的健康读取用途说明。
- 用户同意健康连接后，Anna 会继续给出非医疗性的问候、饮食和注意事项建议；拒绝后不再读取健康数据。
- 机票与酒店规划已融入个人助理工具：支持匿名搜索、sandbox 预览和官方网页人工接管。
- 网页端提供“机票酒店接管”面板，可从 Anna 个人助理模式直接生成官方 handoff。
- 官方网页人工接管会为机票/酒店生成真实平台的匿名搜索链接；只有用户确认候选并授权订购接管后才打开外站，外站验证码、登录、
  旅客身份信息、已保存资料选择、订单确认与付款仍由用户本人完成。
- `npm run smoke:real` 会串起 preflight、HealthKit 桥接、机票/酒店官方 handoff，
  并把 Expedia / Booking 的反自动化页面识别为 `human_challenge`。
- `npm run smoke:healthkit-bridge:report` 会向 `/api/healthkit/snapshot` 推送
  iOS/watchOS Companion 风格快照，再从网页端连接健康同意门，生成
  `HEALTHKIT_BRIDGE_SMOKE_ZH.md`。
- `npm run healthkit:doctor:report` 会生成 `HEALTHKIT_DOCTOR_ZH.md`，记录 iOS
  Companion 工程、HealthKit entitlement、本地网络权限、LAN 地址，以及当前 Mac 是否具备
  Full Xcode、iOS toolchain 和 Apple Development 签名身份。
- `npm run smoke:real:report` 会生成 `REAL_HANDOFF_SMOKE_ZH.md`，便于留存本次
  真实 handoff 结果和人工接管边界。
- `npm run smoke:browser-handoff:report` 会从网页端确认 Anna 候选、授权订购接管后点击真实外站链接，并覆盖自然语言
  机票+酒店组合请求中的机票和酒店两项，验证官方域名、新页打开方式、用户资料门和 `payment_handoff`。
- `npm run smoke:ui:report` 会生成 `UI_SMOKE_ZH.md`，记录网页端 HealthKit 同意门、
  旅行 handoff 控件、自然语言旅行请求到 handoff、桌面端链接和移动端布局检查结果。
- 根目录 `npm run smoke:personal:host:report` 会在 Anna Local Host iframe 中验证个人助理主体、Host SDK、Executa、Companion 风格健康快照、旅行字段包、自然语言机票+酒店组合接管、用户触发外站新页和 metadata-only 审计。
- 根目录 `npm run smoke:personal:full:report` 会串联 UI、HealthKit doctor、HealthKit bridge、真实外站、真实浏览器 handoff 与 Host smoke，并生成 `FULL_PERSONAL_ASSISTANT_SMOKE_ZH.md`。
- `DASHBOARD_DEPLOYMENT_2026-06-20_ZH.md` 记录了 `0.1.16` Dashboard push/cut、Chrome 试错、pending_review release 阻塞，以及新 app-bundled Executa `0.1.6` 的冻结结果。
- `DASHBOARD_DEPLOYMENT_2026-06-21_DUFFEL_ZH.md` 记录了 Duffel-only 旅行后端候选包、`0.1.7` Executa、Anna validate、`0.1.17`/`0.1.18` 旧 tool freeze 问题，以及 runtime tool 修正后的 `0.1.19` 真实 cut 结果。
- `DASHBOARD_DEPLOYMENT_2026-06-21_DUFFEL_ZH.md` 的 2026-06-22 追加记录包含 `0.1.25` / Executa `0.1.12` 发布、真实 Google Chrome Dashboard 机票测试，以及“不要打开浏览器，先走 Duffel”不再误触发官方外站接管的回归修复。
- 同一部署记录还包含 `0.1.26` 发布与 Dashboard 安装更新，以及 `Plugin not found` 根因：Executa 仍以 `local` shim 分发，真实用户安装后不会自动发现本机开发目录。
- `0.1.27` / Executa `0.1.13` 将运行时改为 `binary` 分发；`npm run build:executa-binary` 会生成 Anna 可安装的 `.tar.gz`，复制到 `bundle/executa/`，并在 `executa.json` 的 `binary_urls.darwin-arm64` 中记录托管下载 URL、sha256、size、entrypoint 和 `tar.gz` format。`0.1.28` 修复 Dashboard hash confirmation 页面先读托管 `/api` 导致 `HTTP 404` 的问题；`0.1.29` 进一步修复确认页跳转丢失 `?wid=...&t=...` 授权查询串的问题，生成确认页时保留 Anna Runtime 连接并直接调用 `booking_get_confirmation`。真实 Google Chrome Dashboard 已验证 v0.1.29：Duffel 机票+酒店搜索返回 4 个 sandbox/test 组合，确认页成功显示航班/酒店/总价/人工确认门；强化学习从已记忆 6 次更新到 7 次，自测 100 分。`0.1.30` 将最终确认页运行时连接规则同步进 `SKILL.md`、`manifest.system_prompt_addendum` 和 `check-anna-guide`，确保 Dashboard 确认页继续保留 `wid/runtime token` 并通过 `booking_get_confirmation` 读取记录。
- `npm run probe:ctrip` 会按用户提供的携程 TourAPI FAT/生产 BasicInfo 虚拟目录各尝试一次；如果两次都没有成功类 API 响应，则按项目规则放弃本次携程 API 接入，并保持结构化订票 provider 为 Duffel-only。
- `npm run dashboard:duffel:dry-run` 会串起本地检查、Duffel 后端 smoke、Dashboard 只读状态查询和 `publish/push/cut --dry-run`，不产生远端写入。
- 旅行能力拒绝旅客身份、联系方式、证件和支付字段；不会自动订购、确认订单或付款。
- 新增第一阶段 API Sandbox 预订台：支持 `flight`、`hotel`、`flight_hotel` 三种 `bookingType`，前端先搜索/比较，再统一调用 `POST /api/booking/prepare` 生成 15 分钟有效的人工确认记录。
- `/booking/confirm/:confirmationId` 是创建订单前的完整确认页：展示航班价格、起飞/到达时间、中转次数、行李信息、退改签提示、酒店价格、酒店位置、取消政策、乘客/住客脱敏信息、总价、付款政策和多个确认 checkbox。
- `POST /api/booking/confirm` 会再次确认价格和库存；价格变化返回 `PRICE_CHANGED`，库存不可用返回 `UNAVAILABLE`，通过后只创建 sandbox/test provider order，不接真实付款。
- 图片和音频在独立预览中只读取文件名、类型和大小，用于能力路由，不上传内容。
- 在 Anna 主机中可通过 Executa 获取结构化上下文，再由主机选择满足能力要求的模型。

## 旅行预订 API 设计

第一阶段继续使用本项目稳定的 Node API routes 结构；路由命名保持 Next.js API routes 兼容，后续迁移到 Next.js 时可按同一路径落到 `app/api/**/route.ts`。

```text
POST /api/travel/flights/search
POST /api/travel/hotels/search
POST /api/travel/compare
POST /api/booking/prepare
POST /api/booking/confirmation
POST /api/booking/confirm
```

`POST /api/booking/prepare` 是 Anna 个人助理项目的统一预确认接口，不是 Duffel 官方接口。前端只调用这个统一接口；本阶段运行时只启用 Duffel provider，Amadeus、Travelport、Hotelbeds 只作为未来 fallback 目录占位，且占位 provider 不返回测试报价、不创建测试订单。携程 TourAPI 已按提供的 FAT/生产 BasicInfo 虚拟目录做两次连通探测，但都未返回成功类 API 响应；除非后续提供具体接口名、签名/鉴权、请求/响应 schema 和订单沙箱契约，否则 Anna 不启用 Ctrip provider，也不声称已创建携程 API 订单。

示例：

```json
{
  "bookingType": "flight_hotel",
  "items": [
    {
      "type": "flight",
      "provider": "duffel",
      "offerId": "duffel_flight_xxx_1",
      "criteria": {
        "origin": "SHA",
        "destination": "NRT",
        "departureDate": "2026-08-12",
        "returnDate": "2026-08-18",
        "passengers": { "adults": 1 },
        "cabinClass": "economy"
      }
    },
    {
      "type": "hotel",
      "provider": "duffel",
      "offerId": "duffel_stay_xxx_1",
      "criteria": {
        "destination": "Tokyo",
        "checkinDate": "2026-08-12",
        "nights": 2,
        "guests": { "adults": 1 },
        "hotelLocation": "Shinjuku"
      }
    }
  ],
  "travelers": [{ "displayName": "王小明", "type": "adult" }]
}
```

`prepare` 的目标只包括：

1. 重新确认 offer 是否有效。
2. 重新确认价格、库存、日期和人数。
3. 生成 `booking_confirmation`，状态为 `PENDING`。
4. 保存订单快照和脱敏后的 `traveler_snapshot`。
5. 返回 `confirmationId`，由前端打开 `/booking/confirm/:confirmationId`。

`POST /api/booking/confirm` 只接受 `confirmationId`。它会检查记录是否存在、是否过期、状态是否仍为 `PENDING`，然后再次调用 provider adapter 校验最新价格和库存。只有用户在完整确认页勾选所有确认项后，前端才会调用该接口。

## Provider Adapter

Provider adapter 位于：

```text
executas/personal-assistant-node/lib/providers/duffel.js
```

当前实现默认为 Duffel sandbox/test fixture，读取 `.env` 中的 `DUFFEL_ACCESS_TOKEN` 配置状态，但不把 token 写进代码。真实接入时保持 adapter 方法不变：

- `searchFlightOffers(criteria)`
- `getFlightOffer(offerId, criteria)`
- `searchHotelOffers(criteria)`
- `getHotelOffer(offerId, criteria)`
- `createOrder({ confirmationId, bookingType, items, travelers })`
- `payHoldOrder({ orderId })`

后端受控 Duffel API 还提供 `/api/travel/stays/prepare` 与 `/api/travel/stays/confirm` 作为 Stays quote / booking 的 prepare-confirm 语义别名；`payHoldOrder` 与 Stays booking 都要求显式用户确认，并写入用户确认记录和订单状态记录。

`.env.example` 已列出：

```text
DUFFEL_ACCESS_TOKEN=
DUFFEL_STAYS_ENABLED=false
```

本地启动时会读取项目根目录的 `.env`，只填充当前进程尚未设置的变量；真实部署仍建议用平台 secret/environment variables 注入。

当 Duffel 返回 no offers、no availability、unsupported route 或类似错误时，Anna 不会表述成“现实中没有航班/住宿”。后端返回 `supplier_no_result`、`invalid_search_params`、`route_maybe_unsupported`、`supplier_error` 或 `rate_limited`，并使用固定用户文案：“当前通过 Duffel 没有查到可预订报价。”

## 数据库表

SQL 草案在 `db/booking_confirmations.sql`。字段包括 `id`、`user_id`、`booking_type`、`flight_offer_id`、`hotel_offer_id`、`flight_snapshot`、`hotel_snapshot`、`traveler_snapshot`、`total_currency`、`total_amount`、`status`、`expires_at`、`created_at`，并额外预留 `provider_order_id` 和 `provider_booking_id`。

当前本地预览使用内存存储，便于测试和避免误以为已经接入生产数据库。生产化时必须把证件号、护照号、银行卡号、CVV/CVC 和银行账户信息排除在普通数据库之外；本阶段接口会拒绝这些字段。

## 为什么不能直接用浏览器蓝牙读取 Apple Watch

Apple Health 数据由 HealthKit 的授权模型保护。真实实现需要一个 iOS/watchOS
Companion App 申请 HealthKit 读取权限，再通过用户明确同意的本地桥接向 Anna 提供最少
必要数据。普通网页或 macOS 蓝牙扫描不应绕过 HealthKit 直接读取今日步数、最近心率和睡眠。

实验版因此明确标记为 `healthkit-companion-bridge`，只保存在当前 Node 进程内存中；本地测试可使用 demo fixture，也可通过 `/api/healthkit/snapshot` 推送 companion 风格快照。
除非后续明确启用 backend sync，否则 HealthKit 数据不会上传到服务器。

## 模型路由边界

模型名称来自 2026-06-13 的 Anna 网页端实操观察。除文本能力外，本项目不声称具体
模型一定支持图像、音频或工具；这些能力必须由 Anna 主机的正式能力清单或握手结果
确认。`anna-auto` 代表“把能力要求交给主机”，不是一个虚构模型。

当前实验路由策略分两层：

- 需要 `tools`、`vision` 或 `audio` 时，一律回到 `anna-auto`，让 Anna 主机按实时能力握手决定。
- 纯文本任务时，实验版会给出更细的模型建议：
  - `Qwen3 Max`：复杂决策、逻辑比较、安全边界
  - `MiniMax M2.7`：情绪支持、沟通整理、语气敏感回复
  - `MiMo-V2-Flash`：头脑风暴、改写、命名和创意草稿
  - `Qwen Plus`：结构化写作、计划拆解、清单整理
  - `Gemini 3.1 Flash Lite 预览`：快速通用问答
  - `Gemma 4 E4B-it`：保守的纯文本整理兜底

这些建议只代表实验路由偏好；如果 Anna 主机基于实时能力、额度或负载做出不同选择，应以主机结果为准。

## 隐私边界

- 天气调用只发送近似坐标，应用不持久化位置。
- 健康数据连接必须显式同意，实验数据只在内存中存在。
- 健康数据不会发送给天气服务。
- 单次可穿戴设备读数不会被解释为诊断。
- 附件在独立预览中不上传内容。

## 后续真实接入

1. 用完整 Xcode 打开 `ios-companion/AnnaHealthCompanion.xcodeproj`。
2. iOS App 使用 HealthKit `HKHealthStore.requestAuthorization` 请求用户选择的数据读取权限。
3. watchOS/iPhone 通过 HealthKit 查询心率、呼吸和睡眠等最少必要快照，再发送给 Mac 局域网地址上的 `POST /api/healthkit/snapshot`；当前 companion 提供前台实时同步循环，后台长期同步需要 Apple 后台模式和额外审核设计。
4. 将真实 companion provider 接到 `connectHealthKit` 的 `readSnapshot({ observedAt, now, supportedDevices, sessionId? })` contract。
5. Anna Executa 只暴露明确授权的指标，并提供断开与删除。
6. Anna 主机返回当前模型能力，替换实验配置。
7. 机票/酒店真实平台接入只能使用官方或授权 API，并在官方页面或人类确认门完成身份信息、订单确认和付款。
8. 在 Anna 开发者环境完成发布、安装、`#` 调用和真实多模态测试。

真机局域网测试时，启动 Anna bridge：

```bash
npm run healthkit:bind
npm run healthkit:pairing
```

推荐先运行 `healthkit:bind`，它会串联 readiness 检查、bridge pairing 信息和真机安装阻塞项。
然后按脚本输出启动 bridge。iPhone companion 中填写脚本输出的
`http://你的Mac局域网IP:8808/api/healthkit/snapshot`，并填入同一个 token。

## 官方参考

- [Anna App 新手指南](https://forum.anna.partners/t/from-zero-to-your-first-anna-app-a-hands-on-beginners-guide/117)
- [Apple HealthKit 授权](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Apple Health & Fitness](https://developer.apple.com/health-fitness/)
- [HKHealthStore requestAuthorization](https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization%28toshare%3Aread%3Acompletion%3A%29)
- [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [Open-Meteo 天气 API](https://open-meteo.com/en/docs)
- [Open-Meteo 空气质量 API](https://open-meteo.com/en/docs/air-quality-api)
