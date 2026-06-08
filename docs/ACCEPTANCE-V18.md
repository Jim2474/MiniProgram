# V18 验收记录

日期：2026-06-08

## 本轮目标

- 给模拟微信登录、支付、退款增加生产模式护栏。
- 防止本地验收用的模拟能力在正式环境被误用。

## 已完成

- 新增运行模式读取：`APP_ENV` / `NODE_ENV`。
- 新增模拟微信开关：非生产环境默认允许，`APP_ENV=production` 默认禁止。
- 可通过 `ALLOW_MOCK_WECHAT=true` 显式允许沙箱演示。
- `GET /api/health` 返回 `runtime`，包含 `appEnv`、`mockWechatEnabled`、`paymentProvider`。
- `GET /api/bootstrap` 返回同样的运行模式信息，便于小程序启动态识别。
- `/api/wechat/login` 在生产模式未显式允许时拒绝模拟登录。
- `/api/orders/:orderId/pay` 在生产模式未显式允许时拒绝模拟支付。
- `/api/admin/orders/:orderId/refund` 在生产模式未显式允许时拒绝模拟退款。
- 模拟登录、支付、退款成功时返回 `mock_wechat` provider 标记。
- 客户端开发态按钮继续显示“模拟微信支付”，避免把本地链路误认为真实支付。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：113 项通过。
- 小程序结构与 API 调用校验：109 项通过。

## 生产说明

- 正式环境应设置 `APP_ENV=production`。
- 未接入真实微信支付前，不要设置 `ALLOW_MOCK_WECHAT=true`。
- 后续仍需实现真实微信登录、手机号授权、预支付、支付回调验签、退款、数据库和鉴权会话。
