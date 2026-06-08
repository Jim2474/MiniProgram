# V36 验收记录

日期：2026-06-08

## 本轮目标

- 将生产数据层从“只有 JSON Store 防误上线护栏”推进到可运行的数据库持久化。
- 保持现有业务结构稳定，不一次性重写所有接口为关系型模型。

## 已完成

- 新增 `SQLiteStore`，当 `DATABASE_URL=sqlite://...` 时启用 SQLite 状态库。
- SQLite 使用 `app_state` 表保存当前业务状态，保留现有业务读写模型，降低改造风险。
- JSON Store 与 SQLite Store 共用数据归一化/旧字段迁移逻辑。
- 后端关闭服务时会关闭 SQLite 连接，避免数据库文件锁残留。
- `/api/health` 新增 `databaseProvider`，可返回 `json_store`、`sqlite` 或 `unsupported`。
- 生产环境仍默认拒绝无 `DATABASE_URL` 的 JSON Store；非 `sqlite://` URL 明确报未启用。
- `.env.example` 给出 `sqlite://./backend/data/store.sqlite` 示例。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：171 项通过。
- 小程序结构与 API 调用校验：130 项通过。

新增覆盖：

- 生产环境可使用 SQLite 数据库状态库启动。
- SQLite 数据库状态库重启后可读取持久化数据。
- 普通开发态 import 不触发 SQLite 实验特性加载。

## 剩余上线风险

- 当前 SQLite 是单节点状态库，不是多实例/高并发关系型 schema；多门店、多实例或云部署仍需 PostgreSQL/MySQL/云数据库适配。
- SQLite 来自当前 Node.js 的 `node:sqlite` 实验模块，部署环境需确认 Node 版本支持。
- 真实微信 AppID、商户号、平台证书轮换和微信开发者工具/真机回归仍需上线前验收。
