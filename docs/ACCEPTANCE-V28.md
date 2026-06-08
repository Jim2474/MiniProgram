# V28 验收记录

日期：2026-06-08

## 本轮目标

- 将微信支付回调从外部 `signatureVerified` 占位推进到后端自主验签和解密。
- 确保生产环境不能通过测试字段绕过微信支付回调验签。

## 已完成

- `/api/payments/wechat/notify` 使用微信支付 V3 请求头参与 RSA-SHA256 验签：
  - `Wechatpay-Timestamp`
  - `Wechatpay-Nonce`
  - `Wechatpay-Serial`
  - `Wechatpay-Signature`
- 回调验签使用 `WECHAT_PAY_PLATFORM_CERTIFICATE`，可选用 `WECHAT_PAY_PLATFORM_SERIAL_NO` 校验平台证书序列号。
- 使用 `WECHAT_PAY_API_V3_KEY` 对回调 `resource` 做 AES-256-GCM 解密。
- 从解密后的微信交易通知中读取 `out_trade_no`、`transaction_id`、`trade_state` 和分单位金额。
- `trade_state !== SUCCESS` 的通知会被安全忽略，不触发扣库存或赠积分。
- 生产环境不再接受 `signatureVerified` 测试字段绕过验签。
- dry-run/开发态仍保留测试字段入口，方便本地自动验收。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：147 项通过。
- 小程序结构与 API 调用校验：123 项通过。

新增覆盖：

- 生产环境未携带微信支付验签请求头时拒绝处理。
- 生产环境不允许 `signatureVerified` 绕过回调验签。
- 测试平台私钥签名 + AES-GCM 加密资源可被后端验签和解密。
- 回调确认后记录 `notifyVerifiedBy=wechat_pay_v3`，并写入微信交易号。

## 剩余上线风险

- 平台证书下载、证书轮换和多证书缓存仍需生产化；当前版本依赖环境变量注入当前平台证书。
- 真实退款链路仍处于 mock/待接入阶段。
- 生产数据库仍未落地，当前 JSON Store 只适合演示和单机验收。
