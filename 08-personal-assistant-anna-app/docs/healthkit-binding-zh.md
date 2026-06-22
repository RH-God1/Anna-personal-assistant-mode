# Anna 个人助理 HealthKit 绑定路径

## 结论

Anna 不能通过网页、蓝牙扫描或 macOS 进程直接读取 iPhone / Apple Watch 的“健康”
App 数据。Apple 的正式路径是：

1. 构建并安装 iOS/watchOS Companion App。
2. App 启用 HealthKit entitlement。
3. 使用 `HKHealthStore.requestAuthorization` 请求用户授权读取指定数据类型。
4. 用户在系统 HealthKit 授权页确认。
5. App 通过 HealthKit query 读取最少必要快照。
6. App 将授权快照发送给本机 Anna bridge。
7. Anna 只读取 bridge 提供的本次会话快照，并允许断开。

当前 Node 实验版已经完成第 6-7 步的接口形状：

- `connectHealthKit` 接收一个
  `readSnapshot({ observedAt, now, supportedDevices, sessionId? })` provider。
- 本地预览服务器暴露 `POST /api/healthkit/snapshot`，用于接收 iPhone companion
  发来的授权快照。
- `ios-companion/AnnaHealthCompanion` 提供最小 SwiftUI + HealthKit companion
  源码骨架。
- `ios-companion/AnnaHealthCompanion.xcodeproj` 提供可直接用 Xcode 打开的工程骨架。
- iPhone 访问 Mac 上的 Anna bridge 时必须使用 Mac 的局域网 IP；iPhone 里的
  `127.0.0.1` 只代表手机自己。
- 如果 Anna bridge 监听局域网地址，必须设置 `HEALTHKIT_BRIDGE_TOKEN`，并在
  companion 中填入同一个 token。
- iPhone 第一次向 Mac bridge 发送快照时，系统可能弹出本地网络权限提示；需要允许。

## Anna 侧约束

- 只接受 `iphone` 和 `apple_watch` 设备类型。
- 不保存服务端持久健康数据。
- 不把健康数据发送给天气服务。
- 不从单次快照诊断疾病。
- 用户拒绝或断开后，不继续读取健康快照。

## 真实 Companion 需要读取的最少字段

- 今日步数：用于日常活动提醒，不做诊断。
- 最近心率：用于状态概览，不做诊断。
- 睡眠样本/昨夜睡眠分钟数：用于休息和饮食建议，不做诊断。

第一阶段只读取以上三类 HealthKit 数据，不写入 Apple Health。除非后续明确启用
backend sync，否则授权健康数据不上传服务器，只通过本地 bridge 进入当前 Anna 会话。

## 不能由 Anna 自动完成的部分

真机绑定必须在用户自己的 iPhone / Apple Watch 上完成系统授权。没有已安装并签名的
iOS/watchOS Companion App、HealthKit entitlement、以及用户在系统弹窗中的明确同意，
Anna 不能也不应该读取“健康”App。

当前机器只有 Command Line Tools，没有完整 Xcode，因此本仓库可以静态验证 companion
源码、Xcode 工程和 Anna bridge，但不能在这里直接编译安装到你的手机。真机运行前需要在
Xcode 的 target Signing & Capabilities 中确认 HealthKit Capability 已启用，并保留
`Info.plist` 中的 `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription`
用途说明。

## 局域网测试启动方式

先生成配对信息：

```bash
npm run healthkit:pairing
```

再检查本机环境：

```bash
npm run healthkit:doctor
```

`healthkit:doctor` 会检查 Xcode 工程、shared scheme、HealthKit entitlement、本地网络权限、
Mac 局域网地址，以及当前是否选择了完整 Xcode。

脚本会输出：

- Anna bridge 启动命令
- 可填入 iPhone companion 的 Mac 局域网 URL
- 本次测试使用的 Bridge Token

启动命令形如：

```bash
HOST=0.0.0.0 HEALTHKIT_BRIDGE_TOKEN=replace-with-a-long-random-token npm run serve
```

然后在 iPhone companion 中填写：

- Bridge URL：`http://你的Mac局域网IP:8808/api/healthkit/snapshot`
- Bridge Token：与 `HEALTHKIT_BRIDGE_TOKEN` 相同的值

Companion 的 `Info.plist` 已包含 `NSLocalNetworkUsageDescription` 和
`NSAllowsLocalNetworking`，用于开发期和同一局域网内的 Mac bridge 通信。

## 官方参考

- Apple HealthKit 授权：https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- `HKHealthStore.requestAuthorization`：https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization%28toshare%3Aread%3Acompletion%3A%29
- `HKStatisticsQuery`：https://developer.apple.com/documentation/healthkit/hkstatisticsquery
- `HKSampleQuery`：https://developer.apple.com/documentation/healthkit/hksamplequery
