# V30 验收记录

日期：2026-06-08

## 本轮目标

- 防止生产环境误用本地 JSON Store 作为正式数据库。
- 将生产数据库缺口从文档提示变成启动时硬护栏。

## 已完成

- `createApp` 在 `APP_ENV=production` 且没有 `DATABASE_URL` 时默认拒绝启动。
- 如仅做沙箱演示，必须显式设置 `ALLOW_JSON_STORE_IN_PRODUCTION=true` 才能继续使用 JSON Store。
- `/api/health` 的 `runtime.deployment` 新增 `jsonStoreAllowedInProduction` 标记。
- `.env.example` 补充 `ALLOW_JSON_STORE_IN_PRODUCTION=false`。
- README 增加生产 JSON Store 护栏说明。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：153 项通过。
- 小程序结构与 API 调用校验：123 项通过。

新增覆盖：

- 生产环境默认拒绝使用 JSON Store。
- 旧有生产鉴权、微信登录、支付、回调和退款 dry-run 验收在显式沙箱开关下仍可运行。

## 剩余上线风险

- 真实数据库适配层尚未实现；当前是“防误上线”护栏，不是数据库落地。
- 仍需为部署目标选择 PostgreSQL/MySQL/云开发数据库之一，并迁移当前 Store 数据模型。
