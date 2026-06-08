# V5 Excel 状态流补齐验收记录

验收时间：2026-06-08

## 本轮新增范围

### 客户端

- 预约列表展示。
- 客户可取消待处理或已确认预约。
- 积分兑换酒水券，按后台配置扣减积分。

### 员工端

- 员工账号密码登录。
- 登录成功后返回员工身份与会话。

### 商家后台

- 预约可标记失效。
- 过期存酒人工确认处理，可作废并写入存酒流水。
- 咖位管理新增座台。
- 咖位可设置占用/维护，记录占用开始时间与消费金额。

### 荷官升盲

- 升盲游戏返回计时器状态。
- 计时器接口生成 30 秒、10 秒、升盲语音提醒事件。
- 荷官页显示剩余时间与最近语音播报文本。

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

结果：通过，73 项检查。

本轮新增覆盖：

- 员工可用账号密码登录。
- 客户可取消预约。
- 后台可将预约标记失效。
- 荷官升盲计时器返回剩余时间和语音事件。
- 客户可用积分兑换酒水券。
- 过期存酒取酒前进入人工处理。
- 后台可人工确认处理过期存酒。
- 后台可新增座台信息。
- 后台可设置座台占用与消费金额。

### 小程序结构与 API 调用测试

命令：

```bash
node scripts/validate-miniprogram.mjs
```

结果：通过，82 项检查。

本轮新增覆盖：

- 客户页调用预约取消接口。
- 客户页调用积分兑换酒水券接口。
- 员工页调用账号密码登录接口。
- 后台页调用过期存酒人工处理接口。
- 后台页调用咖位管理接口。
- 荷官页调用升盲计时器接口。

## 本地运行验证

后端运行验证：

```text
GET http://localhost:3000/api/health -> {"ok":true}
```

## 微信开发者工具验证

微信开发者工具路径：

```text
G:\wechatdevtools\微信开发者工具.exe
G:\wechatdevtools\cli.bat
```

已尝试：

```bash
G:\wechatdevtools\cli.bat preview --project G:\AI_Projects\Miniprogram\miniprogram --qr-format terminal --info-output G:\AI_Projects\Miniprogram\docs\wechat-preview-v5-info.json --qr-output G:\AI_Projects\Miniprogram\docs\wechat-preview-v5-qr.txt --port 9420 --lang zh --disable-gpu
```

结果：

- `wechatdevtools.exe` 进程中存在窗口标题：`Miniprogram - 微信开发者工具 Stable v2.01.2510290`。
- `WeChatAppEx.exe` 模拟器运行时进程存在。
- CLI `preview` 命令 30 秒超时，未生成 `wechat-preview-v5-info.json` 或二维码文件。

结论：

- 微信开发者工具 GUI 已打开项目窗口。
- 当前机器上的 DevTools CLI 通道仍无法返回机器可读预览结果。
- 后端自测、小程序结构/API 调用验收和本地 API 健康检查均已通过。

## Excel 覆盖说明

V5 把以下 Excel 要求从“已有基础能力”推进为更明确的业务状态流：

- 预约：待处理、已确认、客户取消、后台失效。
- 员工端：账号密码登录。
- 积分：积分兑换酒水券。
- 存酒：过期后进入人工处理并留流水。
- 卡座房台：新增座台、占用、维护、消费金额。
- 升盲：计时器状态与语音提醒事件。

仍需生产环境接入：

- 真实微信登录/手机号授权。
- 真实微信支付、退款和支付回调。
- 真实二维码生成与服务端扫码参数签名。
- 真实图片上传、语音播放和地图定位权限配置。
