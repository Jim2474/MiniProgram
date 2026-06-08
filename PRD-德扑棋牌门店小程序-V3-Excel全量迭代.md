# 德扑棋牌门店小程序 V3 PRD：Excel 全量功能迭代

## 1. 目标

V3 的目标是让当前“后端 API + 微信小程序前端”继续向原始 Excel 需求全量靠拢。V2 已完成核心点单、库存、积分、存酒、预约、后台、荷官升盲；V3 重点补齐 Excel 中此前暂缓或未覆盖的营销、充值、排行榜、签到、酒水券、抽奖、会员等级、财务、人员、升盲配置和系统设置能力。

## 2. 范围原则

- 保持 `backend/` 和 `miniprogram/` 分离。
- 后端所有新增能力必须有自动测试。
- 小程序新增能力必须在页面中有入口，并通过 `wx.request` 调用后端。
- 对需要真实微信能力的功能使用本地模拟：扫码、支付、语音、上传图片、地图、客服。
- 不引入外部依赖，不接真实数据库。

## 3. Excel 覆盖矩阵

| Excel 模块 | V2 状态 | V3 处理 |
|---|---|---|
| 点单、品类、商品价格、详情 | 已覆盖 | 保留并扩展商品详情字段 |
| 积分 + 微信支付 + 余额充值 | 部分覆盖 | 新增余额账户、充值配置、充值记录、余额支付模拟 |
| 预约咖位 | 已覆盖 | 增加桌位占用开始时间、消费金额 |
| 积分排行榜 | 未覆盖 | 新增积分 Top10 与个人排行 |
| 个人中心登录信息 | 部分覆盖 | 增加个人中心聚合接口 |
| 存积分/取积分二维码 | 部分覆盖 | 新增积分二维码核销模拟 |
| 历史积分记录 | 已覆盖 | 保留 |
| 酒水券、历史存取记录 | 未覆盖 | 新增酒水券、领取/待确认/完成状态 |
| 门店位置 | 未覆盖 | 新增门店位置配置接口 |
| 今日/历史订单 | 已覆盖 | 保留 |
| 签到送积分 | 未覆盖 | 新增日历签到、签到配置 |
| 联系客服 | 未覆盖 | 新增客服电话配置 |
| 扫码点单 | 部分覆盖 | 新增扫码模拟接口 |
| 积分抽奖、中奖记录 | 未覆盖 | 新增奖品、中奖率、抽奖记录、核销 |
| 员工登录/修改密码 | 部分覆盖 | 新增修改密码接口 |
| 员工核销积分 | 部分覆盖 | 新增核销码查询/确认接口 |
| 员工确认入座 | 未覆盖 | 新增座位入座/淘汰状态 |
| 个人业绩统计 | 已覆盖基础 | 增加月度与 6 个月查询 |
| 后台首页 | 部分覆盖 | 增加昨日对比、近 7 日趋势 |
| 会员等级管理 | 未覆盖 | 新增等级规则与会员等级计算 |
| 充值配置/充值记录/消费记录 | 未覆盖 | 新增 |
| 积分配置 | 部分覆盖 | 增加有效期、兑换券配置、签到配置 |
| 卡座房台管理 | 部分覆盖 | 增加类型配置、启用禁用、搜索字段 |
| 财务管理 | 部分覆盖 | 新增财务概览、营业明细 |
| 出入库管理 | 部分覆盖 | 增加入库/出库状态待确认/已确认/取消 |
| 积分抽奖后台配置 | 未覆盖 | 新增抽奖概况、记录、奖品管理、设置 |
| 人员管理与操作记录 | 部分覆盖 | 增加新增/禁用/重置密码接口 |
| 员工销售管理 | 已覆盖基础 | 增加查询口径 |
| 升盲设置样式/背景/logo/字体/语音/名词 | 未覆盖 | 新增配置数据结构与页面入口 |
| 自动升盲荷官功能 | 部分覆盖 | 增加座位号淘汰、买入手数增减、休息/报名状态配置 |

## 4. V3 新增后端 API

### 4.1 客户端

- `GET /api/user/profile`
- `GET /api/leaderboard/points`
- `POST /api/checkin`
- `GET /api/checkin`
- `GET /api/coupons`
- `POST /api/coupons/:couponId/redeem-request`
- `POST /api/recharge`
- `GET /api/recharge-records`
- `POST /api/lottery/draw`
- `GET /api/lottery/records`
- `GET /api/store/location`
- `GET /api/support/contact`
- `POST /api/scan/employee`

### 4.2 员工端

- `POST /api/staff/password`
- `POST /api/staff/verify-code`
- `POST /api/staff/coupons/:couponId/confirm`
- `POST /api/staff/seats/:seatNo/sit`
- `POST /api/staff/seats/:seatNo/eliminate`
- `POST /api/staff/seats/:seatNo/restore`
- `GET /api/staff/performance/monthly`

### 4.3 后台

- `GET /api/admin/finance/overview`
- `GET /api/admin/business-details`
- `GET /api/admin/recharge-configs`
- `POST /api/admin/recharge-configs`
- `GET /api/admin/recharge-records`
- `GET /api/admin/member-levels`
- `POST /api/admin/member-levels`
- `GET /api/admin/lottery/overview`
- `GET /api/admin/lottery/prizes`
- `POST /api/admin/lottery/prizes`
- `PATCH /api/admin/lottery/settings`
- `GET /api/admin/table-types`
- `POST /api/admin/table-types`
- `PATCH /api/admin/employees/:employeeId`
- `POST /api/admin/employees`
- `GET /api/admin/blind-settings`
- `PATCH /api/admin/blind-settings`
- `GET /api/admin/system-settings`
- `PATCH /api/admin/system-settings`

## 5. 小程序页面调整

V3 不增加过多 tab，仍使用四个主 tab，但在页面内增加功能区：

- 客户点单：增加排行榜、签到、充值、酒水券、抽奖、门店位置、客服。
- 员工端：增加核销码、酒水券确认、座位入座/淘汰/恢复、修改密码。
- 商家后台：增加财务、充值配置、会员等级、抽奖配置、人员管理、升盲设置、系统设置。
- 荷官升盲：增加座位号状态、买入手数增减、休息/报名状态显示。

## 6. V3 验收标准

`npm test` 必须覆盖：

- V2 全部 26 项后端核心验收继续通过。
- 充值配置创建、客户充值、余额增加、充值记录存在。
- 积分排行榜返回 Top10 与个人排名。
- 签到增加积分，同日重复签到被拦截。
- 酒水券创建/领取/申请兑换/员工确认。
- 积分抽奖扣积分、生成中奖记录、后台概况更新。
- 会员等级规则创建，会员等级可计算。
- 财务概览返回今日/月度营收、营业明细。
- 员工修改密码、员工新增/禁用。
- 座位入座、淘汰、恢复。
- 升盲设置可读写。
- 系统设置可读写。
- 小程序校验必须检查新增功能入口和 API 调用。
