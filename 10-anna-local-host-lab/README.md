# Anna Local Host Lab

本项目在本机模拟 Anna App 的关键运行边界，用于在没有真实 Anna Host、账号和
服务端授权的情况下跑通现有 App，并执行协议、ACL 与隐私安全回归。

## 提供的能力

- 在 `/static/anna-apps/_sdk/latest/index.js` 提供兼容现有 App 的本地 SDK。
- 从活跃 App 的真实 `manifest.json` 读取 `ui.host_api`，逐次执行 RPC ACL。
- 为每个 App 窗口签发绑定 App 的 capability token。
- 长驻运行 Node Executa，执行 `initialize → describe → invoke` 生命周期。
- Executa 只继承 `PATH`、隔离 HOME/TMPDIR 等最小环境，不继承 API key。
- 聊天回写仅返回临时 ID，不持久化正文。
- 审计日志只记录 App、namespace、method、结果、参数键名和耗时。
- 默认阻止个人助理向外部天气服务发送坐标；每个窗口需单独授权。
- 个人助理 Host smoke 会通过 Host RPC 推送 Companion 风格 HealthKit 快照，再经用户同意门读取；审计只记录键名。
- App iframe 保持 sandbox 隔离，但允许用户触发的官方 handoff 新页；外站登录、验证码、身份信息、订单确认和付款仍由用户本人处理。
- 对敏感字段、手机号、银行卡、API key、Bearer token 和返回结果泄露执行拦截。

## 运行

```bash
npm start
```

打开 <http://127.0.0.1:8810>，可依次启动当前活跃 App：

- 隐私旅行代理
- Anna 个人助理模式

双语 Focus Flow 已取消，代码在根目录归档保留，但不再进入本地 Host 默认 catalog。

## 桌面独立界面

如果不想在 Chrome 或其他浏览器里打开 Anna，可以使用 Electron 桌面壳：

```bash
npm install
npm run desktop
```

桌面入口会启动同一个本地 Anna Host，但端口默认使用系统分配的随机 localhost
端口，并在独立的 Anna 窗口中加载界面。开发时可使用：

```bash
npm run desktop:dev
npm run desktop:smoke
```

如需固定端口，可设置 `ANNA_DESKTOP_PORT=8810 npm run desktop`。
如果 Electron 二进制下载超时，可使用
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install`。

## 测试

```bash
npm run check
npm test
npm run test:browser
```

测试覆盖：

- Host SDK、CSP 与安全响应头
- Executa 长驻复用和身份校验
- manifest ACL、跨 App 工具隔离、无效 token
- 旅行 PII、银行卡与付款状态跳跃
- 健康同意门和外部网络授权
- 个人助理自然语言机票+酒店组合接管，以及 Host iframe 内用户触发的官方外站新页
- 未声明 storage 权限的 App 会被拒绝访问本地存储
- 聊天与审计内容不落盘、不进入日志
- 非法 JSON、64 KiB 请求上限
- Chromium 中活跃 App 的完整交互流程

## 安全边界

这是开发测试 Host，不是生产 Anna 服务。它不实现真实账号、NATS、Nexus、
持久化 APS、LLM 计费或生产级 OS 网络沙箱。外部网络策略在 Host RPC 层执行；
不应运行来源不可信的任意 Executa 二进制。
