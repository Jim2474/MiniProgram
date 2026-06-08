# V27 验收记录

日期：2026-06-08

## 本轮目标

- 将微信登录从纯 mock 拒绝推进到生产可配置的 `jscode2session` 链路。
- 将微信支付从“预支付待接入”推进到 JSAPI 预支付参数生成。
- 保持库存/积分状态机只在支付回调确认后入账。

## 已完成

- `/api/wechat/login` 在生产环境要求小程序 `wx.login` code，并通过微信 `jscode2session` 获取 openid。
- 开发环境继续保留手机号 mock 登录，避免本地微信开发者工具调试被真实 AppSecret 配置阻断。
- `/api/orders/:orderId/pay` 在生产环境配置齐全时创建 JSAPI 预支付单，并返回小程序 `wx.requestPayment` 参数。
- 预支付只写入 `prepay_created` 支付记录，不提前将订单标记为已支付，也不提前扣库存。
- `/api/payments/wechat/notify` 仍复用统一支付成功状态机：回调确认后才扣库存、赠积分、写流水。
- `/api/health` 的 `runtime.deployment` 拆分为微信登录配置、微信支付配置和 dry-run 标记。
- 客户小程序登录时会带上 `wx.login` code，支付时可调用 `wx.requestPayment`。
- `.env.example` 补充 `WECHAT_LOGIN_DRY_RUN`、`WECHAT_PAY_DRY_RUN` 沙箱验证开关。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：144 项通过。
- 小程序结构与 API 调用校验：123 项通过。

新增覆盖：

- 生产环境缺微信配置时返回明确环境变量缺口。
- 真实微信登录/支付配置齐全时健康检查通过。
- dry-run 生产模式可通过 code 创建会员 openid。
- dry-run 生产支付可生成 `requestPayment` 参数。
- 微信预支付不会提前扣库存。
- 支付回调确认后才扣库存并将订单置为已支付。

## 剩余上线风险

- 微信支付回调仍未完成平台证书验签和报文解密；当前接口仍要求可信验签结果，不能直接暴露给公网作为最终生产回调。
- 真实商户号、商户 API 证书、平台证书轮换、退款真实链路和数据库生产化仍需上线前专项验收。
