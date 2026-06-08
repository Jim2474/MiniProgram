# V26 验收记录

日期：2026-06-08

## 本轮目标

- 补强上线前微信能力配置检查。
- 对当前本机微信开发者工具状态做 V25 后的重新验证记录。

## 已完成

- `/api/health` 和 `/api/bootstrap` 的 `runtime` 新增 `deployment` 字段。
- `deployment.missingWechatEnv` 机器可读列出缺失的真实微信登录/微信支付环境变量。
- `deployment.wechatConfigured` 明确真实微信能力是否配置齐备。
- `deployment.databaseConfigured` 和 `deployment.usingJsonStore` 明确当前是否仍使用 JSON Store。
- 新增 `.env.example`，列出生产环境必要变量。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：134 项通过。
- 小程序结构与 API 调用校验：121 项通过。

## 微信开发者工具验证

已确认本机存在：

```text
G:\wechatdevtools\微信开发者工具.exe
G:\wechatdevtools\cli.bat
```

已确认当前存在微信开发者工具窗口：

```text
Miniprogram - 微信开发者工具 Stable v2.01.2510290
```

本轮尝试：

```bash
G:\wechatdevtools\cli.bat open --project G:\AI_Projects\Miniprogram\miniprogram --port 9420 --lang zh --disable-gpu
```

结果：

- 后端 `/api/health` 返回 `ok:true`。
- 微信开发者工具 GUI 窗口存在。
- CLI `open` 仍在 60 秒内未返回，和早期验收记录一致。
- 未生成 preview 二维码文件。

结论：

- 项目文件和自动校验通过。
- CLI 自动预览在当前桌面环境仍不可作为可靠机器验收信号。
- 最终模拟器画面仍需在已经打开的微信开发者工具 GUI 中人工确认。
