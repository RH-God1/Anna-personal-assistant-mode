# Anna HealthKit Doctor 报告

生成时间：2026/06/23 04:29:20（Asia/Shanghai）
UTC：2026-06-22T20:29:20.923Z

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
