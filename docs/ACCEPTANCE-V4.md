# V4 Excel 闭环补齐验收记录

验收时间：2026-06-08

## 本轮新增范围

### 客户端

- 商品支持分类与关键词筛选接口。
- 客户端调用 `wx.scanCode`，扫码员工二维码后写入扫码归属记录。
- 充值中心读取后台充值配置，展示充值记录。
- 签到记录、积分明细、酒水券记录、中奖记录展示。
- 中奖后可申请奖品核销。
- 门店位置调用 `wx.openLocation`，客服调用 `wx.makePhoneCall`。

### 员工端

- 员工端读取中奖记录。
- 员工可确认核销中奖奖品。

### 商家后台

- 新增商品分类。
- 新增 SKU，并写入初始库存流水。
- 商品列表支持关键词筛选。
- 库存出入库申请、确认入账、驳回。
- 库存流水展示。
- 会员消费记录、充值记录、扫码归属记录展示。
- 抽奖记录展示。

## 自动验收

命令：

```bash
npm test
```

结果：通过。

### 后端测试

命令：

```bash
npm --prefix backend test
```

结果：通过，64 项检查。

本轮新增覆盖：

- 充值中心返回可选配置。
- 客户可申请中奖记录核销。
- 员工可确认核销中奖记录。
- 会员消费记录可查询。
- 后台可新增商品分类。
- 后台可新增 SKU。
- 商品列表支持分类与关键词筛选。
- 后台可提交入库申请。
- 确认入库后写入库存账。
- 确认出库后写入库存账。
- 出入库申请可驳回。
- 客户扫码员工二维码生成归属记录。
- 后台可查看扫码归属记录。

### 小程序结构与 API 调用测试

命令：

```bash
node scripts/validate-miniprogram.mjs
```

结果：通过，76 项检查。

本轮新增覆盖：

- 客户页调用 `wx.scanCode`、`wx.openLocation`、`wx.makePhoneCall`。
- 客户页调用员工扫码归属接口。
- 客户页调用中奖核销申请接口。
- 员工页调用中奖核销确认接口。
- 后台页调用出入库申请、库存流水、商品分类、SKU 新增、充值记录、消费记录、扫码记录接口。

## 微信开发者工具验证

微信开发者工具路径：

```text
G:\wechatdevtools\微信开发者工具.exe
G:\wechatdevtools\cli.bat
```

已尝试：

```bash
G:\wechatdevtools\cli.bat preview --project G:\AI_Projects\Miniprogram\miniprogram --qr-format terminal --info-output G:\AI_Projects\Miniprogram\docs\wechat-preview-v4-info.json --qr-output G:\AI_Projects\Miniprogram\docs\wechat-preview-v4-qr.txt --port 9420 --lang zh --disable-gpu
```

结果：

- `wechatdevtools.exe` 进程中存在窗口标题：`Miniprogram - 微信开发者工具 Stable v2.01.2510290`。
- `WeChatAppEx.exe` 模拟器运行时进程存在。
- CLI `preview` 命令 30 秒超时，未生成 `wechat-preview-v4-info.json` 或二维码文件。

结论：

- 微信开发者工具 GUI 已打开项目窗口。
- 当前机器上的 DevTools CLI 通道无法返回机器可读预览结果。
- 代码层面的后端自测、小程序结构/API 调用验收均已通过。

## Excel 覆盖说明

本轮把 V3 中偏模拟的部分推进为可操作闭环：

- 扫码点单：从“选择员工”升级为 `wx.scanCode` + 后端扫码归属记录，开发环境扫码失败时保留当前员工模拟码兜底。
- 门店服务：从数据展示升级为微信地图与电话能力调用。
- 积分抽奖：从中奖记录升级为客户申请核销、员工确认核销。
- 库存系统：从库存调整升级为出入库申请、确认入账、驳回、流水。
- 商品后台：从只看 SKU 升级为分类新增、SKU 新增、筛选。
- 会员经营：补齐消费记录、充值记录、扫码记录后台查看。

仍需真实生产环境接入：

- 真实微信登录/手机号授权。
- 真实微信支付、退款和支付回调。
- 真实二维码生成与服务端扫码参数签名。
- 真实图片上传、语音播放与地图定位权限配置。
