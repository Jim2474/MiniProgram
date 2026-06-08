import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const required = [
  "miniprogram/project.config.json",
  "miniprogram/app.json",
  "miniprogram/app.js",
  "miniprogram/app.wxss",
  "miniprogram/sitemap.json",
  "miniprogram/utils/api.js",
  "miniprogram/pages/customer/customer.js",
  "miniprogram/pages/customer/customer.wxml",
  "miniprogram/pages/customer/customer.wxss",
  "miniprogram/pages/staff/staff.js",
  "miniprogram/pages/staff/staff.wxml",
  "miniprogram/pages/staff/staff.wxss",
  "miniprogram/pages/admin/admin.js",
  "miniprogram/pages/admin/admin.wxml",
  "miniprogram/pages/admin/admin.wxss",
  "miniprogram/pages/dealer/dealer.js",
  "miniprogram/pages/dealer/dealer.wxml",
  "miniprogram/pages/dealer/dealer.wxss",
];

const checks = [];
function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

for (const relative of required) {
  assert(existsSync(join(root, relative)), `${relative} exists`);
}

const appConfig = JSON.parse(await readFile(join(root, "miniprogram/app.json"), "utf8"));
const appSource = await readFile(join(root, "miniprogram/app.js"), "utf8");
assert(appConfig.pages.includes("pages/customer/customer"), "customer page registered");
assert(appConfig.pages.includes("pages/staff/staff"), "staff page registered");
assert(appConfig.pages.includes("pages/admin/admin"), "admin page registered");
assert(appConfig.pages.includes("pages/dealer/dealer"), "dealer page registered");
assert(appConfig.tabBar?.list?.length === 4, "four tabBar entries configured");

const projectConfig = JSON.parse(await readFile(join(root, "miniprogram/project.config.json"), "utf8"));
assert(projectConfig.setting?.urlCheck === false, "local API urlCheck disabled for devtools");
assert(projectConfig.miniprogramRoot === "./", "miniprogram root configured");
assert(appSource.includes("pendingEmployeeScene") && appSource.includes("decodeURIComponent") && appSource.includes("employee:"), "app parses employee mini program code scene");
assert(appSource.includes("pendingVerificationScene") && appSource.includes("verify:"), "app parses verification mini program code scene");

const apiSource = await readFile(join(root, "miniprogram/utils/api.js"), "utf8");
assert(apiSource.includes("http://localhost:3000"), "api util points to local backend");
assert(apiSource.includes("wx.request"), "api util uses wx.request");
assert(apiSource.includes("x-staff-session") && apiSource.includes("staffSessionId"), "api util sends staff session header");
assert(apiSource.includes("wx.uploadFile") && apiSource.includes("uploadFile"), "api util supports file upload");

for (const page of ["customer", "staff", "admin", "dealer"]) {
  const js = await readFile(join(root, `miniprogram/pages/${page}/${page}.js`), "utf8");
  const wxml = await readFile(join(root, `miniprogram/pages/${page}/${page}.wxml`), "utf8");
  assert(js.includes("Page({"), `${page} page declares Page`);
  assert(wxml.length > 200, `${page} wxml has meaningful markup`);
}

const customerJs = await readFile(join(root, "miniprogram/pages/customer/customer.js"), "utf8");
const customerWxml = await readFile(join(root, "miniprogram/pages/customer/customer.wxml"), "utf8");
const customerWxss = await readFile(join(root, "miniprogram/pages/customer/customer.wxss"), "utf8");
assert(customerJs.includes("/api/cart/items"), "customer page calls cart API");
assert(customerJs.includes("showProductDetail") && customerWxml.includes("查看详情"), "customer page supports product detail modal");
assert(customerJs.includes("/api/wechat/login"), "customer page calls WeChat login API");
assert(customerJs.includes("wx.login") && customerJs.includes("payload.code"), "customer page sends wx.login code when available");
assert(customerJs.includes("isLoggedIn") && customerJs.includes("customerLoggedIn") && customerWxml.includes("avatar-default") && customerWxml.includes("未登录，当前为本地演示会员") && customerWxss.includes(".profile-card"), "customer page displays login state and default avatar");
assert(customerJs.includes("/api/user/bind-phone"), "customer page calls bind phone API");
assert(customerWxml.includes('open-type="getPhoneNumber"') && customerJs.includes("bindWechatPhone") && customerJs.includes("event.detail.code"), "customer page supports WeChat phone authorization code");
assert(customerJs.includes("pointsVisible: profile.pointsVisible !== false") && customerWxml.includes('wx:if="{{pointsVisible}}"') && customerWxml.includes("<text wx:if=\"{{pointsVisible}}\">· 赠送"), "customer page respects backend points visibility setting");
assert(customerJs.includes("checkinEnabled: profile.pointsVisible !== false && checkin.settings?.enabled !== false") && customerWxml.includes('wx:if="{{checkinEnabled}}"') && customerWxml.includes("预计赠送 {{cartTotal}} 积分"), "customer page hides checkin and projected points when points are disabled");
assert(customerJs.includes("/api/orders") && customerJs.includes("/pay"), "customer page calls order pay API");
assert(customerJs.includes("wx.requestPayment") && customerJs.includes("data.prepay"), "customer page can invoke WeChat requestPayment from prepay params");
assert(customerWxml.includes("微信支付"), "customer page labels WeChat pay action");
assert(customerJs.includes("todayOrders") && customerJs.includes("historyOrders"), "customer page separates today and historical orders");
assert(customerJs.includes("pointsAwardedText") && customerWxml.includes("赠送 {{item.pointsAwardedText}}"), "customer orders display awarded points");
assert(customerJs.includes("/api/storage/") && customerJs.includes("pickup-requests"), "customer page calls pickup request API");
assert(customerJs.includes("pickupQty") && customerWxml.includes("onPickupQty") && customerWxml.includes("取酒数量"), "customer page supports pickup quantity input");
assert(customerJs.includes("/api/storage-records"), "customer page calls storage records API");
assert(customerJs.includes("/api/reservations"), "customer page calls reservation API");
assert(customerJs.includes("/cancel"), "customer page calls reservation cancel API");
assert(customerJs.includes("reservationPartySize") && customerJs.includes("onReservationRemark") && customerWxml.includes("预约申请信息"), "customer page supports reservation date, party size and remark form");
assert(customerWxml.includes("table-image") && customerWxml.includes("item.imageUrl"), "customer reservation list displays table image");
assert(customerJs.includes("/api/checkin"), "customer page calls checkin API");
assert(customerJs.includes("checkinCalendar") && customerWxml.includes("checkin-calendar") && customerWxss.includes(".checkin-day.signed"), "customer page displays checkin calendar");
assert(!customerJs.includes("/api/recharge") && !customerWxml.includes("微信支付充值"), "customer page hides balance recharge flow");
assert(!customerJs.includes("/api/lottery/draw") && !customerWxml.includes("积分抽奖"), "customer page hides lottery flow");
assert(!customerJs.includes("/api/leaderboard/points") && !customerWxml.includes("积分排行榜"), "customer page hides points leaderboard");
assert(!customerJs.includes("/api/coupons/exchange") && !customerWxml.includes("积分兑换酒水券"), "customer page hides points coupon exchange");
assert(customerJs.includes("/api/verification-codes"), "customer page calls verification code API");
assert(customerJs.includes("qrImageUrl") && customerWxml.includes("qr-image") && customerWxml.includes("qr-thumb"), "customer page displays verification QR images");
assert(customerJs.includes("pointsQrAmount") && customerJs.includes("onPointsQrAmount") && customerWxml.includes("取积分数量") && !customerJs.includes("pointsAmount = 5"), "customer page supports real points QR amount input");
assert(customerWxml.includes('data-id="{{item.storageId}}"') && customerJs.includes("item.storageId === event.currentTarget.dataset.id") && !customerJs.includes("this.data.storage.find((item) => item.status === \"available\""), "customer page creates storage QR for selected storage record");
assert(customerJs.includes("wx.scanCode"), "customer page uses WeChat scanCode");
assert(customerJs.includes("wx.openLocation"), "customer page uses WeChat openLocation");
assert(customerJs.includes("wx.makePhoneCall"), "customer page uses WeChat makePhoneCall");
assert(customerJs.includes("/api/scan/employee"), "customer page records employee QR scan");
assert(customerJs.includes("consumePendingEmployeeScene") && customerJs.includes("bindEmployeeScene"), "customer page consumes employee mini program code scene");
assert(!customerJs.includes("onEmployeeChange") && !customerWxml.includes('range="{{employees}}"'), "customer page does not manually select employees");
assert(!customerJs.includes("requestLotteryRedeem"), "customer page hides lottery redeem request");

const staffJs = await readFile(join(root, "miniprogram/pages/staff/staff.js"), "utf8");
const staffWxml = await readFile(join(root, "miniprogram/pages/staff/staff.wxml"), "utf8");
assert(staffJs.includes("/api/staff/storage"), "staff page calls storage create API");
assert(staffJs.includes("storageCustomerName") && staffWxml.includes("客户姓名") && staffWxml.includes("checkbox-group") && staffJs.includes("storageAgreementAccepted") && !staffJs.includes("agreementAccepted: true"), "staff page uses real storage customer name and agreement input");
assert(staffJs.includes("storageReason") && staffJs.includes("onStorageReason") && staffWxml.includes("新增存酒原因") && !staffJs.includes("小程序员工端新增存酒"), "staff page supports real storage creation reason");
assert(staffJs.includes("/api/staff/login"), "staff page calls staff login API");
assert(staffJs.includes("app.globalData.staffSessionId = data.session.sessionId"), "staff page stores staff session after login");
assert(staffJs.includes("/api/staff/performance/monthly"), "staff page calls monthly performance API");
assert(staffJs.includes("/api/staff/performance/daily"), "staff page calls daily performance API");
assert(staffJs.includes("dailyPerformanceRows") && staffWxml.includes("当月每日业绩") && staffWxml.includes("dailyCommissionText"), "staff page displays current-month daily performance");
assert(staffJs.includes("commissionText") && staffWxml.includes("预估提成"), "staff page displays commission amount");
assert(staffJs.includes("/api/staff/employees/") && staffJs.includes("/order-qr"), "staff page calls employee order QR API");
assert(staffJs.includes("showOrderQr") && staffWxml.includes("orderQrPayload"), "staff page displays employee order QR payload");
assert(staffJs.includes("orderQrImageUrl") && staffWxml.includes("qr-image"), "staff page displays employee order QR image");
assert(staffJs.includes("/confirm"), "staff page calls pickup confirm API");
assert(staffJs.includes("productName") && staffJs.includes("userPhone") && staffJs.includes("storageQuantity") && staffWxml.includes("存酒余量"), "staff page displays pickup request customer product context");
assert(staffJs.includes("pickupRejectReason") && staffJs.includes("onPickupRejectReason") && staffWxml.includes("拒绝取酒原因") && !staffJs.includes("员工端拒绝取酒"), "staff page supports real pickup rejection reason");
assert(staffJs.includes("/api/staff/points/adjust"), "staff page calls point adjust API");
assert(staffJs.includes("pointPhone") && staffWxml.includes("客户手机号") && staffWxml.includes("调整客户积分") && !staffWxml.includes("调整示例客户积分"), "staff page adjusts customer points by phone");
assert(staffJs.includes("/api/staff/verify-code"), "staff page calls verify code API");
assert(staffJs.includes("verifyPhone") && staffWxml.includes("核销查询客户手机号") && staffWxml.includes("查询客户积分存酒") && !staffWxml.includes("扫码核销模拟"), "staff page verifies customer assets by phone");
assert(staffJs.includes("/api/staff/verification-codes/scan"), "staff page calls QR scan verification API");
assert(staffJs.includes("/api/staff/verification-codes/") && staffJs.includes("/confirm"), "staff page calls QR confirm API");
assert(staffJs.includes("verificationQty") && staffWxml.includes("二维码取酒数量") && !staffJs.includes("quantity: 1 }"), "staff page confirms storage QR with real quantity input");
assert(staffJs.includes("consumePendingVerificationScene") && staffJs.includes("pendingVerificationScene"), "staff page consumes verification mini program code scene");
assert(staffJs.includes("/api/staff/seats/"), "staff page calls seat API");
assert(staffJs.includes("seatPhone") && staffWxml.includes("入座客户手机号") && /if \(action === "sit"\) data\.phone = this\.data\.seatPhone/.test(staffJs), "staff page seats customers by phone");
assert(staffJs.includes("/api/staff/password"), "staff page calls password API");
assert(!staffJs.includes("/api/staff/lottery-records/") && !staffJs.includes("/api/staff/coupons/"), "staff page hides coupon and lottery confirm flows");

const adminJs = await readFile(join(root, "miniprogram/pages/admin/admin.js"), "utf8");
const adminWxml = await readFile(join(root, "miniprogram/pages/admin/admin.wxml"), "utf8");
const adminWxss = await readFile(join(root, "miniprogram/pages/admin/admin.wxss"), "utf8");
assert(adminJs.includes("/api/admin/dashboard"), "admin page calls dashboard API");
assert(adminJs.includes("/api/staff/login") && adminWxml.includes("管理员登录"), "admin page supports admin login");
assert(adminJs.includes("app.globalData.staffSessionId = data.session.sessionId"), "admin page stores admin session after login");
assert(adminJs.includes("staffSales") && adminWxml.includes("员工销售提成"), "admin page displays staff sales commissions");
assert(adminJs.includes("/api/admin/operation-logs") && adminJs.includes("operatorText") && adminJs.includes("targetText") && adminWxml.includes("item.operatorText") && adminWxml.includes("item.targetText"), "admin page displays operation log operator and target context");
assert(adminJs.includes("/refund"), "admin page calls refund API");
assert(adminJs.includes("operationForm") && adminJs.includes("refundReason") && adminWxml.includes("退款原因") && !adminJs.includes("小程序后台退款"), "admin page supports real refund reason input");
assert(adminJs.includes("/transfer-storage"), "admin page calls transfer storage API");
assert(adminJs.includes("transferForm") && adminJs.includes("onTransferQty") && adminWxml.includes("订单转存表单") && adminWxml.includes("转存数量") && !adminWxml.includes("转存威士忌") && !/transferStorage[\s\S]*?sku_whisky[\s\S]*?quantity: 1/.test(adminJs), "admin page supports real order storage transfer input");
assert(adminJs.includes("transferableItems") && adminJs.includes("transferableText") && adminWxml.includes("可转存："), "admin page displays order storage transfer remaining quantity");
assert(adminJs.includes("/api/admin/stock-counts"), "admin page calls stock count API");
assert(adminJs.includes("/api/admin/stock-requests"), "admin page calls stock request workflow API");
assert(adminJs.includes("stockRequestForm") && adminJs.includes("onStockRequestQty") && adminWxml.includes("出入库数量") && adminWxml.includes("出入库原因") && !adminJs.includes("quantity: 3,"), "admin page supports real stock request input");
assert(adminJs.includes("cancelStockRequest") && adminJs.includes("/cancel") && adminWxml.includes("取消"), "admin page supports stock request cancellation");
assert(adminJs.includes("stockRejectReason") && adminJs.includes("stockCancelReason") && adminWxml.includes("驳回原因") && adminWxml.includes("取消原因") && !adminJs.includes("后台驳回") && !adminJs.includes("后台取消"), "admin page supports real stock request handling reasons");
assert(adminJs.includes("/api/admin/storage/") && adminJs.includes("expire-handle"), "admin page calls expired storage handling API");
assert(adminJs.includes("expiredStorageActionOptions") && adminJs.includes("expiredStorageExtendDays") && adminWxml.includes("过期存酒处理表单") && !adminJs.includes("后台人工确认过期作废"), "admin page supports real expired storage handling input");
assert(adminJs.includes("/api/admin/stock-ledgers"), "admin page calls stock ledger API");
assert(adminJs.includes("/api/admin/storage-ledgers") && adminJs.includes("storageLedgers"), "admin page calls customer storage ledger API");
assert(adminJs.includes("pickupRequests") && adminJs.includes("requestedAtText") && adminWxml.includes("取酒申请队列") && adminWxml.includes("存酒余量"), "admin page displays pickup request queue with customer product context");
assert(adminJs.includes("/api/admin/categories"), "admin page calls category create API");
assert(adminJs.includes("/api/admin/categories/"), "admin page calls category update API");
assert(adminJs.includes("categoryForm") && adminJs.includes("onCategorySortOrder") && adminWxml.includes("商品分类表单") && !adminJs.includes("新分类"), "admin page supports real category create form");
assert(adminJs.includes("/api/admin/products") && adminJs.includes("createProduct"), "admin page supports product create API");
assert(adminJs.includes("/api/admin/products/"), "admin page calls product update API");
assert(adminJs.includes("onProductImage") && adminJs.includes("chooseProductImage") && adminJs.includes('field: "productImage"') && adminWxml.includes("商品图片 URL") && adminWxml.includes("上传商品图片"), "admin page supports product image URL and upload");
assert(adminJs.includes("onProductSpec") && adminJs.includes("onProductUnit") && adminJs.includes("onProductDescription") && adminWxml.includes("商品描述") && !adminJs.includes("标准规格") && !adminJs.includes("后台新增 SKU"), "admin page supports full SKU create form");
assert(adminJs.includes("fillProductForm") && adminJs.includes("updateProduct") && adminWxml.includes("填入编辑") && adminWxml.includes("保存 SKU"), "admin page supports SKU edit form");
assert(!/async updateProduct\(\)[\s\S]*?stockQty[\s\S]*?async toggleProduct/.test(adminJs), "admin SKU edit form does not bypass stock ledger");
assert(adminJs.includes("storageDays") && adminJs.includes("warningQty"), "admin page supports SKU warning stock and storage days");
assert(adminJs.includes("costPrice") && adminJs.includes("supplierName") && adminWxml.includes("成本价") && adminWxml.includes("供应商"), "admin page supports SKU cost and supplier fields");
assert(adminJs.includes("createdDate") && adminJs.includes("statusText: statusText(item.status)") && adminWxml.includes("上架/创建") && adminWxml.includes("item.statusText"), "admin SKU list displays status and created date");
assert(adminJs.includes("/api/admin/stock-counts") && adminWxml.includes("库存盘点单"), "admin page supports stock count workflow");
assert(adminJs.includes("stockCountForm") && adminJs.includes("onStockCountQty") && adminWxml.includes("实盘库存") && adminWxml.includes("创建盘点单") && !adminWxml.includes("盘点 +10"), "admin page supports real stock count input");
assert(adminJs.includes("/api/admin/finance/overview"), "admin page calls finance API");
assert(adminJs.includes("/api/admin/business-details") && adminJs.includes("paymentPaidAt") && adminJs.includes("paymentMethodText") && adminJs.includes("itemSummary") && adminWxml.includes("支付时间") && adminWxml.includes("支付方式"), "admin page displays backend business detail payment fields");
assert(!adminJs.includes("/api/admin/recharge-configs") && !adminWxml.includes("新增充值"), "admin page hides recharge config operations");
assert(adminJs.includes("/api/admin/consumption-records"), "admin page calls consumption records API");
assert(adminJs.includes("/api/admin/users") && adminWxml.includes("存酒 {{item.hasStorage") && adminWxml.includes("消费 {{item.totalSpendText"), "admin page displays member storage points and spend summary");
assert(adminJs.includes("/api/admin/member-levels"), "admin page calls member level API");
assert(adminJs.includes("/api/admin/member-levels/"), "admin page calls member level update API");
assert(adminJs.includes("/api/admin/points-config"), "admin page calls points config API");
assert(adminJs.includes("memberLevelForm") && adminJs.includes("pointsConfigForm") && adminJs.includes("onCheckinEnabledChange") && adminWxml.includes("会员等级表单") && adminWxml.includes("签到赠送积分") && !adminWxml.includes("新增黑金会员"), "admin page supports real member level and points config forms");
assert(adminJs.includes("/api/admin/points-ledgers") && adminJs.includes("serviceEmployeeName") && adminWxml.includes("积分明细") && adminWxml.includes("服务人员"), "admin page displays points ledger service employee context");
assert(!adminJs.includes("/api/admin/lottery/") && !adminWxml.includes("积分抽奖配置"), "admin page hides lottery admin flow");
assert(adminJs.includes("/api/admin/scan-records"), "admin page calls scan records API");
assert(adminJs.includes("/api/admin/tables"), "admin page calls table management API");
assert(adminJs.includes("tablePagination") && adminJs.includes("pageSize") && adminJs.includes("tableSummary"), "admin page supports table pagination and summary");
assert(adminJs.includes("tableStatusOptions") && adminJs.includes("onTableKeyword"), "admin page supports table status and keyword filtering");
assert(adminJs.includes("/api/admin/table-types") && adminJs.includes("createTableType") && adminJs.includes("tableTypeForm") && adminWxml.includes("咖位类型表单") && adminWxml.includes("新增咖位类型"), "admin page supports table type configuration form");
assert(adminJs.includes("fillTableTypeForm") && adminJs.includes("updateTableType") && adminJs.includes("toggleTableType") && adminWxml.includes("保存咖位类型") && adminWxml.includes("启停类型"), "admin page supports table type edit and status toggle");
assert(adminJs.includes("onTableTypeChange") && adminJs.includes("tableForm.typeIndex") && adminWxml.includes("座台类型") && adminWxml.includes('range="{{tableTypes}}"'), "admin page selects configured table type when creating tables");
assert(adminJs.includes("cancelAdminReservation") && adminWxml.includes("取消预约"), "admin page can cancel reservations");
assert(adminJs.includes("reservationConfirmReason") && adminJs.includes("reservationCancelReason") && adminJs.includes("reservationExpireReason") && adminWxml.includes("预约处理原因") && !adminJs.includes("小程序后台确认预约") && !adminJs.includes("小程序后台取消预约") && !adminJs.includes("小程序后台标记失效"), "admin page supports real reservation handling reasons");
assert(adminWxml.includes("partySize") && adminWxml.includes("无备注"), "admin page displays reservation party size and remark");
assert(adminJs.includes("onTableImage") && adminWxml.includes("桌台图片 URL"), "admin page supports table image URL input");
assert(adminJs.includes("chooseTableImage") && adminJs.includes('field: "tableImage"') && adminWxml.includes("上传桌台图片"), "admin page supports uploading table images");
assert(adminJs.includes("tableOccupyForm") && adminJs.includes("onTableOccupyAmount") && adminWxml.includes("开台消费金额") && !adminJs.includes("consumptionAmount: 388"), "admin page supports real table occupancy input");
assert(adminJs.includes("occupiedStartedText") && adminWxml.includes("占用开始") && adminWxml.includes("item.occupiedStartedText"), "admin page displays occupied table start time");
assert(adminJs.includes("deleteTable") && adminWxml.includes("删除/禁用"), "admin page can delete or disable tables");
assert(adminJs.includes("tableMaintenanceReason") && adminJs.includes("tableDeleteReason") && adminWxml.includes("维护原因") && adminWxml.includes("删除/禁用原因") && !adminJs.includes("后台维护") && !adminJs.includes("小程序后台删除座台"), "admin page supports real table maintenance and disable reasons");
assert(adminJs.includes("/api/admin/blind-settings"), "admin page calls blind settings API");
assert(adminJs.includes("blindForm") && adminJs.includes("onBlindField"), "admin page supports blind settings form");
assert(adminJs.includes("blindThemeOptions") && adminJs.includes("broadcast") && adminJs.includes("onBlindThemeChange") && adminWxml.includes('range="{{blindThemeOptions}}"') && adminWxml.includes("主题风格"), "admin page uses four preset blind theme picker");
assert(adminJs.includes("blindBackgroundOptions") && adminJs.includes("blindBackgroundLibrary") && adminJs.includes("onBlindBackgroundChange") && adminWxml.includes('range="{{blindBackgroundOptions}}"') && adminWxml.includes("系统背景图库"), "admin page supports system blind background library picker");
assert(adminJs.includes("blindChampionBackgroundOptions") && adminJs.includes("blindChampionBackgroundLibrary") && adminJs.includes("onBlindChampionBackgroundChange") && adminWxml.includes('range="{{blindChampionBackgroundOptions}}"') && adminWxml.includes("冠军背景图库"), "admin page supports system champion background library picker");
assert(adminJs.includes("chooseBlindImage") && adminJs.includes("/api/admin/assets/upload") && adminJs.includes("wx.chooseMedia") && adminWxml.includes("上传背景图片") && adminWxml.includes("上传 Logo") && adminWxml.includes("上传冠军背景"), "admin page supports uploading blind display images");
assert(adminWxml.includes("blind-logo-preview") && adminWxml.includes("blindForm.logo") && adminWxss.includes("blind-logo-image"), "admin page previews blind timer logo");
assert(adminJs.includes("blindFontFamilyOptions") && adminJs.includes("Source Han Sans") && adminJs.includes("onBlindFontFamilyChange") && adminWxml.includes('range="{{blindFontFamilyOptions}}"') && adminWxml.includes("字体样式"), "admin page uses preset blind font family picker");
assert(adminJs.includes("blindColorPalettes") && adminJs.includes("onBlindColorChange") && adminWxml.includes('range="{{fontColorOptions}}"') && adminWxml.includes('range="{{timerColorOptions}}"') && adminWxml.includes('range="{{breakColorOptions}}"') && adminWxml.includes('range="{{dialogColorOptions}}"'), "admin page supports blind color palette pickers");
assert(adminJs.includes("blindVoiceTypeOptions") && adminJs.includes("onBlindVoiceTypeChange") && adminWxml.includes('range="{{blindVoiceTypeOptions}}"') && adminWxml.includes("语音类型"), "admin page uses controlled blind voice type picker");
assert(adminJs.includes("smallBlindTermOptions") && adminJs.includes("onSmallBlindTermChange") && adminWxml.includes('range="{{smallBlindTermOptions}}"'), "admin page uses small blind term picker");
assert(adminJs.includes("bigBlindTermOptions") && adminJs.includes("onBigBlindTermChange") && adminWxml.includes('range="{{bigBlindTermOptions}}"'), "admin page uses big blind term picker");
assert(adminJs.includes("anteTermOptions") && adminJs.includes("onAnteTermChange") && adminWxml.includes('range="{{anteTermOptions}}"'), "admin page uses ante term picker");
assert(adminJs.includes("titleMap") && adminJs.includes("voiceTerms"), "admin page updates blind title map and voice terms");
assert(adminJs.includes("defaultBlindTitleMap") && adminJs.includes("restoreBlindTitles") && adminWxml.includes("恢复默认标题") && adminWxml.includes("prizePlayerTitle") && adminWxml.includes("nextBreakTitle") && adminWxml.includes("totalChipsTitle"), "admin page supports full blind title map and restore defaults");
assert(adminJs.includes("blindLevelsText") && adminWxml.includes("升盲规则"), "admin page supports blind level sequence configuration");
assert(adminJs.includes("autoStartAfterCountdown") && adminJs.includes("onBlindAutoStartChange") && adminWxml.includes("倒计时结束自动升盲") && adminWxml.includes("保存升盲设置") && !adminWxml.includes("更新升盲主题"), "admin page supports blind auto-start setting");
assert(adminJs.includes("registrationStatusOptions") && adminJs.includes("onBlindRegistrationStatusChange") && adminWxml.includes('range="{{registrationStatusOptions}}"') && adminWxml.includes("报名状态"), "admin page uses controlled blind registration status picker");
assert(adminJs.includes("showBeijingTime") && adminJs.includes("onBlindBeijingTimeChange") && adminWxml.includes("显示北京时间"), "admin page supports blind Beijing time display switch");
assert(adminJs.includes("showRegistrationCountdown") && adminJs.includes("onBlindRegistrationCountdownChange") && adminWxml.includes("显示报名倒计时"), "admin page supports blind registration countdown switch");
assert(adminJs.includes("/api/admin/system-settings"), "admin page calls system settings API");
assert(adminJs.includes("systemSettingsForm") && adminJs.includes("onSystemLocationAddress") && adminWxml.includes("保存系统设置") && adminWxml.includes("门店地址") && !adminWxml.includes("隐藏积分并改客服电话"), "admin page supports real system settings form");
assert(adminJs.includes("employeeForm") && adminJs.includes("onEmployeeCommissionRate") && adminWxml.includes("新增员工表单") && adminWxml.includes("提成率") && !adminWxml.includes("新增测试员工"), "admin page supports real employee create form");
assert(adminJs.includes("employeeRoleOptions") && adminJs.includes("onEmployeeRoleChange") && adminWxml.includes('range="{{employeeRoleOptions}}"') && adminWxml.includes("岗位角色") && !adminWxml.includes("角色 staff/dealer/warehouse"), "admin employee creation uses controlled role picker");
assert(adminJs.includes("employeeRoleLabel") && adminWxml.includes("item.roleLabel"), "admin employee list displays readable role labels");
assert(adminJs.includes("/api/admin/employees") && adminJs.includes("employees.employees.map") && adminWxml.includes('wx:for="{{employees}}"'), "admin page displays employee management list");
assert(adminJs.includes("toggleEmployee") && adminJs.includes("resetEmployeePassword") && adminJs.includes("deleteEmployee") && adminWxml.includes("启停员工") && adminWxml.includes("按表单密码重置") && adminWxml.includes("删除操作人员"), "admin page supports employee enable reset and delete actions");
assert(adminJs.includes("employeeDeleteReason") && adminWxml.includes("删除/停用员工原因") && !adminJs.includes("passwordHash"), "admin employee management uses real delete reason and does not expose password hash");

const dealerJs = await readFile(join(root, "miniprogram/pages/dealer/dealer.js"), "utf8");
const dealerWxml = await readFile(join(root, "miniprogram/pages/dealer/dealer.wxml"), "utf8");
const dealerWxss = await readFile(join(root, "miniprogram/pages/dealer/dealer.wxss"), "utf8");
assert(dealerJs.includes("/api/staff/blind-games"), "dealer page calls blind game API");
assert(dealerJs.includes("/timer"), "dealer page calls blind timer API");
assert(dealerJs.includes("intervalOptions: [5, 8, 10, 12, 15, 20]") && dealerJs.includes("onIntervalChange") && dealerWxml.includes('range="{{intervalOptions}}"'), "dealer page uses fixed blind interval picker");
assert(dealerJs.includes("voiceEnabled: true") && dealerJs.includes("onVoiceEnabledChange") && dealerWxml.includes("语音提醒"), "dealer page supports voice reminder switch");
assert(dealerWxml.includes("next_level"), "dealer page supports next level action");
assert(dealerWxml.includes("buyin_minus"), "dealer page supports buyin decrement action");
assert(dealerWxml.includes("set_buyin_amount"), "dealer page supports buyin amount sync action");
assert(dealerWxml.includes("gameSeatAction"), "dealer page supports seat-specific game action");
assert(dealerJs.includes("/api/staff/blind-settings") && !dealerJs.includes("/api/admin/blind-settings"), "dealer page reads staff-safe blind settings API");
assert(dealerWxml.includes("championBackgroundImage") && dealerWxml.includes("voiceTerms") && dealerWxml.includes("blindLevelsText"), "dealer page displays advanced blind settings and blind sequence");
assert(dealerWxml.includes("blindSettings.logo") && dealerWxml.includes("blind-logo") && dealerWxss.includes(".blind-logo"), "dealer page displays configured blind timer logo");
assert(dealerJs.includes("buildBlindDisplayStyles") && dealerJs.includes("blindDisplayStyle") && dealerJs.includes("blindTitleStyle") && dealerJs.includes("blindTimerStyle") && dealerWxml.includes('style="{{blindDisplayStyle}}"') && dealerWxml.includes('style="{{blindTimerStyle}}"') && dealerWxss.includes(".blind-stage"), "dealer page applies configured blind display styles");
assert(dealerJs.includes("beijingTimeText") && dealerJs.includes("updateClockText") && dealerJs.includes("setInterval") && dealerWxml.includes("北京时间 {{beijingTimeText}}"), "dealer page displays live Beijing time when enabled");
assert(dealerJs.includes("registrationCountdownText") && dealerWxml.includes("报名倒计时 {{registrationCountdownText}}") && dealerWxml.includes("showRegistrationCountdown"), "dealer page displays registration countdown when enabled");
assert(dealerWxss.includes("blind-live-meta") && dealerWxss.includes("blind-meta-item"), "dealer page styles blind live meta display");
assert(dealerWxml.includes("titleMap.prizePlayer") && dealerWxml.includes("titleMap.nextBreak") && dealerWxml.includes("titleMap.totalChips"), "dealer page displays full blind title map");
assert(dealerJs.includes("headsUpText") && dealerJs.includes("单挑阶段") && dealerWxml.includes("game.headsUpText"), "dealer page displays heads-up stage prompt");
assert(dealerJs.includes("championText") && dealerJs.includes("冠军产生") && dealerJs.includes("isChampion") && dealerWxml.includes("champion-panel") && dealerWxml.includes("blindSettings.championBackgroundImage"), "dealer page displays champion stage and champion background");

console.log(`Miniprogram validation passed: ${checks.length} checks`);
for (const check of checks) console.log(`- ${check}`);
