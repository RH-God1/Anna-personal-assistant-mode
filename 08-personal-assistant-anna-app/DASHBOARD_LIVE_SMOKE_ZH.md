# Anna Dashboard Live Smoke 报告

生成时间：2026/06/23 04:29:12（Asia/Shanghai）
UTC：2026-06-22T20:29:12.443Z

## 结论

- 线上 Anna Dashboard 可达，但未认证请求被正确挡在登录/凭据边界。
- 本检查不发送 cookie、token、密码或浏览器会话，不会登录，也不会触发订单、付款或发布。

## 结果

- 目标：https://anna.partners/dashboard
- 最终 URL：https://anna.partners/login?redirect=/dashboard
- HTTP：200
- 分类：auth_required
- 是否跳转：true
- 页面/接口信号：login_prompt_or_auth_page
- secret handling：no_credentials_sent
- 下一步：Review Dashboard UI state in an authenticated browser session before release.

## 边界

- 该 smoke 只验证线上入口可达性和未认证边界。
- 真实 Dashboard 订购测试仍需要用户在浏览器中完成登录、MFA 和任何最终确认。
