# V34 验收记录

日期：2026-06-08

## 本轮目标

- 将员工专属点单码从普通 payload 二维码继续升级为可接入微信小程序码的生产链路。
- 客户从员工小程序码打开小程序后自动完成员工归属。
- 保留本地普通二维码和生产沙箱 dry-run，方便开发者工具调试。

## 已完成

- 后端新增 `wxa/getwxacodeunlimit` 小程序码生成链路，scene 使用 `employee:<employeeId>`。
- 员工点单码接口返回 `qrProvider`、`miniProgramPage`、`miniProgramScene`，可以区分 `payload_qr`、`wechat_qr_dry_run` 和正式微信小程序码。
- 新增 `WECHAT_QR_DRY_RUN` 和 `WECHAT_MINIPROGRAM_ENV_VERSION` 配置。
- `/api/scan/employee` 支持接收小程序码 scene，并兼容原始 `employee:<employeeId>` 二维码码值。
- 小程序 `app.js` 解析启动参数 `query.scene`。
- 客户页进入后消费 `pendingEmployeeScene`，自动调用扫码归属接口并刷新购物车归属。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：166 项通过。
- 小程序结构与 API 调用校验：128 项通过。

新增覆盖：

- 生产沙箱员工点单码返回微信小程序码 dry-run 图片。
- 客户通过小程序码 scene 自动归属员工。
- 小程序启动时解析员工小程序码 scene。
- 客户页消费员工小程序码 scene。

## 剩余上线风险

- 正式微信小程序码仍需使用真实 AppID、AppSecret、已发布/体验版路径和微信开发者工具/真机扫码回归。
- 客户积分/存酒核销码在 V34 仍是 payload 二维码；V35 已补充员工端小程序码 scene 识别链路。
- 当前仍是单机 JSON Store 作为开发/沙箱持久化，生产环境需要接入正式数据库。
