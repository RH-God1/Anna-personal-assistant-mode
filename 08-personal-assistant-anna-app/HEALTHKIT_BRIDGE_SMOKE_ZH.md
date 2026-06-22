# Anna HealthKit Companion Bridge Smoke 报告

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
