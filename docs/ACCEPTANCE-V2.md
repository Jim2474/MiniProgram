# V2 自验收记录

验收时间：2026-06-08

## 目标

V2 将 V1 Web 原型升级为：

- `backend/` 独立后端 API。
- `miniprogram/` 微信小程序原生前端。
- 根目录提供统一测试命令。
- 小程序调用本地后端 `http://localhost:3000`。

## 自动验收

命令：

```bash
npm test
```

结果：通过。

### 后端验收

命令：

```bash
npm --prefix backend test
```

结果：通过，26 项检查。

覆盖内容：

- 种子会员与 SKU。
- 员工二维码订单归属。
- 购物车创建订单。
- 模拟支付后订单进入待处理。
- 支付后库存扣减。
- 支付后积分赠送。
- 后台看板统计订单、营收、员工业绩。
- 订单转存生成客户存酒。
- 客户提交取酒申请。
- 员工确认取酒后扣减客户存酒。
- 客户提交桌位预约。
- 后台确认预约后桌位变为预订。
- 荷官创建升盲游戏。
- 升盲、淘汰动作正确。
- 库存不足被拦截。
- 管理员退款。
- 退款后库存恢复。
- 退款后积分扣回。
- 关键业务操作写入操作日志。

### 小程序结构与调用验收

命令：

```bash
node scripts/validate-miniprogram.mjs
```

结果：通过，48 项检查。

覆盖内容：

- `project.config.json`、`app.json`、`app.js`、`app.wxss`、`sitemap.json` 存在。
- `utils/api.js` 存在，使用 `wx.request` 调用 `http://localhost:3000`。
- 客户、员工、商家后台、荷官四个页面文件完整。
- 四个页面均注册到 `app.json` 和 tabBar。
- 四个页面均声明 `Page({ ... })`。
- 页面 WXML 有实际内容。
- 客户页调用购物车、订单支付、取酒申请、预约 API。
- 员工页调用新增存酒、确认取酒、积分调整 API。
- 后台页调用看板、退款、订单转存、库存调整 API。
- 荷官页调用升盲 API，并支持升盲动作。

## 本地后端运行验证

启动命令：

```bash
npm --prefix backend start
```

验证结果：

- `GET http://localhost:3000/api/health` 返回成功。
- `GET http://localhost:3000/api/products` 返回商品数据。

## 微信开发者工具验证

已找到微信开发者工具：

```text
G:\wechatdevtools\微信开发者工具.exe
G:\wechatdevtools\cli.bat
```

已尝试命令：

```bash
G:\wechatdevtools\cli.bat open --project G:\AI_Projects\Miniprogram\miniprogram --port 9420 --lang zh --disable-gpu
G:\wechatdevtools\cli.bat auto --project G:\AI_Projects\Miniprogram\miniprogram --port 9420 --lang zh --disable-gpu
G:\wechatdevtools\cli.bat preview --project G:\AI_Projects\Miniprogram\miniprogram --qr-format terminal --info-output docs\wechat-preview-info.json --qr-output docs\wechat-preview-qr.txt --port 9420 --lang zh --disable-gpu
```

结果：

- 微信开发者工具主进程已启动。
- `wechatdevtools.exe`、`微信开发者工具.exe`、`WeChatAppEx.exe`、工具内 `node.exe` 进程均存在。
- CLI `open`、`auto`、`preview` 命令在当前环境中未返回成功结果，均超时。
- 未生成 `docs/wechat-preview-info.json` 或 `docs/wechat-preview-qr.txt`。

结论：

- 代码层面已经生成标准微信小程序项目，可直接用微信开发者工具导入 `miniprogram/`。
- 当前自动化 CLI 没有给出可机器读取的模拟器编译结果，因此模拟器 GUI 画面的最终确认需要在已打开的微信开发者工具中人工查看。
- 自动测试和小程序文件/API 调用校验已通过，未跳过后端业务验收。

## 运行方式

后端：

```bash
npm --prefix backend start
```

小程序：

1. 打开微信开发者工具。
2. 导入项目目录：`G:\AI_Projects\Miniprogram\miniprogram`
3. 使用测试号或 touristappid。
4. 确认“详情/本地设置”中不校验合法域名，或者使用 `project.config.json` 中的 `urlCheck: false`。
5. 确保后端 `http://localhost:3000` 正在运行。
6. 在模拟器中测试四个 tab。

## 已知边界

- 微信登录、手机号授权、微信支付和退款仍为本地模拟。
- 数据仍使用 JSON 文件持久化。
- PC Web V1 原型保留在 `legacy-web/`，V2 主前端为 `miniprogram/`。
