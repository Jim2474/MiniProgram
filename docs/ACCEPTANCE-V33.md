# V33 验收记录

日期：2026-06-08

## 本轮目标

- 将客户手机号绑定从纯手填/模拟绑定升级为微信手机号授权 code 绑定。
- 开发态保留手填绑定，方便本地调试。
- 生产态要求微信手机号授权 code，避免绕过微信授权直接写手机号。

## 已完成

- 客户小程序新增 `open-type="getPhoneNumber"` 按钮，并通过 `bindgetphonenumber` 获取一次性授权 `code`。
- 客户端调用 `/api/user/bind-phone` 时支持提交手机号授权 `code`。
- 后端新增微信 access token 获取和 `wxa/business/getuserphonenumber` 调用链路。
- `/api/user/bind-phone` 开发态仍支持手填手机号；生产态没有 code 时拒绝绑定。
- 新增 `WECHAT_PHONE_DRY_RUN`，用于生产沙箱自动验收手机号授权绑定链路。
- 健康检查新增 `wechatPhoneDryRun` 标记。

## 自动验收

```bash
npm test
```

结果：

- 后端业务自验收：164 项通过。
- 小程序结构与 API 调用校验：126 项通过。

新增覆盖：

- 生产环境手机号绑定要求微信授权 code。
- 生产环境可通过微信手机号授权 code 绑定手机号。
- 小程序客户页支持微信手机号授权 code。

## 剩余上线风险

- 微信手机号授权真实接口仍需使用正式小程序 AppID、AppSecret 和微信开发者工具/真机回归。
- 当前仍是单机 JSON Store 作为开发/沙箱持久化，生产环境需要接入正式数据库。
- 员工点单码在 V33 仍是 payload 二维码；V34 已补充微信小程序码生成和 scene 自动归属链路。
