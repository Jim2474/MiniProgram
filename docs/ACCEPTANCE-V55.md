# V55 验收记录

日期：2026-06-08

## 目标

把生产上线前的配置检查从文档说明推进为机器可读的健康检查结论，减少部署时误开 mock、dry-run 或缺微信/数据库配置的风险。

## 已完成

- `/api/health` 的 `runtime.deployment` 新增 `productionReady`。
- `/api/health` 的 `runtime.deployment` 新增 `productionBlockers`，返回未就绪原因列表。
- 就绪检查覆盖：
  - `APP_ENV=production`。
  - 后台/员工接口强制会话鉴权。
  - 模拟微信能力关闭。
  - 微信登录和微信支付必要环境变量齐全。
  - `DATABASE_URL` 已配置且当前支持。
  - 微信登录、手机号、二维码、支付 dry-run 均关闭。

## 自动验收

```bash
npm test
```

通过项：

- 后端业务自验收：187 项。
- 小程序结构与 API 调用校验：153 项。

## 剩余风险

- `productionReady=true` 只能说明配置项齐全且未使用 dry-run，仍需真机验证微信登录、手机号授权、支付、退款和小程序码。
- 当前数据库生产就绪只支持单节点 SQLite 配置检查；如后续接 PostgreSQL/MySQL，需要扩展 `DATABASE_URL` 适配和检查规则。
