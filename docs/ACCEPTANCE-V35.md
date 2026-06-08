# V35 验收记录

日期：2026-06-08

## 本轮目标

- 将客户积分/存酒核销码从普通 payload 二维码升级为可接入员工端小程序码的生产链路。
- 员工扫码打开小程序后自动识别待核销码。
- 保留“员工人工确认后才扣积分/扣存酒”的安全动作。

## 已完成

- `/api/verification-codes` 创建核销码时，在生产/沙箱链路使用 `pages/staff/staff` 小程序码，scene 使用 `verify:<codeId>`。
- 核销码输出新增 `qrProvider`、`miniProgramPage`、`miniProgramScene`。
- 开发态继续返回普通 payload 二维码，方便本地扫码/输入码值调试。
- 小程序 `app.js` 解析 `verify:` 启动 scene。
- 员工页进入后消费 `pendingVerificationScene`，自动调用扫码识别接口并展示待核销信息。
- 员工仍需点击确认按钮后才执行积分扣减或存酒扣减。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：169 项通过。
- 小程序结构与 API 调用校验：130 项通过。

新增覆盖：

- 开发态客户取积分二维码保留 payload 图片。
- 生产沙箱积分核销码返回员工端小程序码 dry-run 图片。
- 员工端可从小程序码 scene 识别积分核销码。
- 小程序启动时解析核销小程序码 scene。
- 员工页消费核销小程序码 scene。

## 剩余上线风险

- 正式微信小程序码仍需使用真实 AppID、AppSecret、已发布/体验版路径和微信开发者工具/真机扫码回归。
- 当前仍是单机 JSON Store 作为开发/沙箱持久化，生产环境需要接入正式数据库。
