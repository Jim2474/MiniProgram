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
assert(customerJs.includes("/api/user/bind-phone"), "customer page calls bind phone API");
assert(customerWxml.includes('open-type="getPhoneNumber"') && customerJs.includes("bindWechatPhone") && customerJs.includes("event.detail.code"), "customer page supports WeChat phone authorization code");
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
assert(staffJs.includes("/api/staff/points/adjust"), "staff page calls point adjust API");
assert(staffJs.includes("/api/staff/verify-code"), "staff page calls verify code API");
assert(staffJs.includes("/api/staff/verification-codes/scan"), "staff page calls QR scan verification API");
assert(staffJs.includes("/api/staff/verification-codes/") && staffJs.includes("/confirm"), "staff page calls QR confirm API");
assert(staffJs.includes("consumePendingVerificationScene") && staffJs.includes("pendingVerificationScene"), "staff page consumes verification mini program code scene");
assert(staffJs.includes("/api/staff/seats/"), "staff page calls seat API");
assert(staffJs.includes("/api/staff/password"), "staff page calls password API");
assert(!staffJs.includes("/api/staff/lottery-records/") && !staffJs.includes("/api/staff/coupons/"), "staff page hides coupon and lottery confirm flows");

const adminJs = await readFile(join(root, "miniprogram/pages/admin/admin.js"), "utf8");
const adminWxml = await readFile(join(root, "miniprogram/pages/admin/admin.wxml"), "utf8");
assert(adminJs.includes("/api/admin/dashboard"), "admin page calls dashboard API");
assert(adminJs.includes("/api/staff/login") && adminWxml.includes("管理员登录"), "admin page supports admin login");
assert(adminJs.includes("app.globalData.staffSessionId = data.session.sessionId"), "admin page stores admin session after login");
assert(adminJs.includes("staffSales") && adminWxml.includes("员工销售提成"), "admin page displays staff sales commissions");
assert(adminJs.includes("/refund"), "admin page calls refund API");
assert(adminJs.includes("/transfer-storage"), "admin page calls transfer storage API");
assert(adminJs.includes("/api/admin/stock-counts"), "admin page calls stock count API");
assert(adminJs.includes("/api/admin/stock-requests"), "admin page calls stock request workflow API");
assert(adminJs.includes("stockRequestForm") && adminJs.includes("onStockRequestQty") && adminWxml.includes("出入库数量") && adminWxml.includes("出入库原因") && !adminJs.includes("quantity: 3,"), "admin page supports real stock request input");
assert(adminJs.includes("/api/admin/storage/") && adminJs.includes("expire-handle"), "admin page calls expired storage handling API");
assert(adminJs.includes("/api/admin/stock-ledgers"), "admin page calls stock ledger API");
assert(adminJs.includes("/api/admin/storage-ledgers") && adminJs.includes("storageLedgers"), "admin page calls customer storage ledger API");
assert(adminJs.includes("/api/admin/categories"), "admin page calls category create API");
assert(adminJs.includes("/api/admin/categories/"), "admin page calls category update API");
assert(adminJs.includes("/api/admin/products") && adminJs.includes("createProduct"), "admin page supports product create API");
assert(adminJs.includes("/api/admin/products/"), "admin page calls product update API");
assert(adminJs.includes("storageDays") && adminJs.includes("warningQty"), "admin page supports SKU warning stock and storage days");
assert(adminJs.includes("costPrice") && adminJs.includes("supplierName") && adminWxml.includes("成本价") && adminWxml.includes("供应商"), "admin page supports SKU cost and supplier fields");
assert(adminJs.includes("/api/admin/stock-counts") && adminWxml.includes("库存盘点单"), "admin page supports stock count workflow");
assert(adminJs.includes("stockCountForm") && adminJs.includes("onStockCountQty") && adminWxml.includes("实盘库存") && adminWxml.includes("创建盘点单") && !adminWxml.includes("盘点 +10"), "admin page supports real stock count input");
assert(adminJs.includes("/api/admin/finance/overview"), "admin page calls finance API");
assert(!adminJs.includes("/api/admin/recharge-configs") && !adminWxml.includes("新增充值"), "admin page hides recharge config operations");
assert(adminJs.includes("/api/admin/consumption-records"), "admin page calls consumption records API");
assert(adminJs.includes("/api/admin/users") && adminWxml.includes("存酒 {{item.hasStorage") && adminWxml.includes("消费 {{item.totalSpendText"), "admin page displays member storage points and spend summary");
assert(adminJs.includes("/api/admin/member-levels"), "admin page calls member level API");
assert(adminJs.includes("/api/admin/member-levels/"), "admin page calls member level update API");
assert(adminJs.includes("/api/admin/points-config"), "admin page calls points config API");
assert(adminJs.includes("memberLevelForm") && adminJs.includes("pointsConfigForm") && adminJs.includes("onCheckinEnabledChange") && adminWxml.includes("会员等级表单") && adminWxml.includes("签到赠送积分") && !adminWxml.includes("新增黑金会员"), "admin page supports real member level and points config forms");
assert(!adminJs.includes("/api/admin/lottery/") && !adminWxml.includes("积分抽奖配置"), "admin page hides lottery admin flow");
assert(adminJs.includes("/api/admin/scan-records"), "admin page calls scan records API");
assert(adminJs.includes("/api/admin/tables"), "admin page calls table management API");
assert(adminJs.includes("tablePagination") && adminJs.includes("pageSize") && adminJs.includes("tableSummary"), "admin page supports table pagination and summary");
assert(adminJs.includes("tableStatusOptions") && adminJs.includes("onTableKeyword"), "admin page supports table status and keyword filtering");
assert(adminJs.includes("cancelAdminReservation") && adminWxml.includes("取消预约"), "admin page can cancel reservations");
assert(adminWxml.includes("partySize") && adminWxml.includes("无备注"), "admin page displays reservation party size and remark");
assert(adminJs.includes("onTableImage") && adminWxml.includes("桌台图片 URL"), "admin page supports table image URL input");
assert(adminJs.includes("deleteTable") && adminWxml.includes("删除/禁用"), "admin page can delete or disable tables");
assert(adminJs.includes("/api/admin/blind-settings"), "admin page calls blind settings API");
assert(adminJs.includes("blindForm") && adminJs.includes("onBlindField"), "admin page supports blind settings form");
assert(adminJs.includes("titleMap") && adminJs.includes("voiceTerms"), "admin page updates blind title map and voice terms");
assert(adminJs.includes("blindLevelsText") && adminWxml.includes("升盲规则"), "admin page supports blind level sequence configuration");
assert(adminJs.includes("autoStartAfterCountdown") && adminJs.includes("onBlindAutoStartChange") && adminWxml.includes("倒计时结束自动升盲") && adminWxml.includes("保存升盲设置") && !adminWxml.includes("更新升盲主题"), "admin page supports blind auto-start setting");
assert(adminJs.includes("/api/admin/system-settings"), "admin page calls system settings API");
assert(adminJs.includes("systemSettingsForm") && adminJs.includes("onSystemLocationAddress") && adminWxml.includes("保存系统设置") && adminWxml.includes("门店地址") && !adminWxml.includes("隐藏积分并改客服电话"), "admin page supports real system settings form");
assert(adminJs.includes("employeeForm") && adminJs.includes("onEmployeeCommissionRate") && adminWxml.includes("新增员工表单") && adminWxml.includes("提成率") && !adminWxml.includes("新增测试员工"), "admin page supports real employee create form");

const dealerJs = await readFile(join(root, "miniprogram/pages/dealer/dealer.js"), "utf8");
const dealerWxml = await readFile(join(root, "miniprogram/pages/dealer/dealer.wxml"), "utf8");
assert(dealerJs.includes("/api/staff/blind-games"), "dealer page calls blind game API");
assert(dealerJs.includes("/timer"), "dealer page calls blind timer API");
assert(dealerWxml.includes("next_level"), "dealer page supports next level action");
assert(dealerWxml.includes("buyin_minus"), "dealer page supports buyin decrement action");
assert(dealerWxml.includes("set_buyin_amount"), "dealer page supports buyin amount sync action");
assert(dealerWxml.includes("gameSeatAction"), "dealer page supports seat-specific game action");
assert(dealerJs.includes("/api/staff/blind-settings") && !dealerJs.includes("/api/admin/blind-settings"), "dealer page reads staff-safe blind settings API");
assert(dealerWxml.includes("championBackgroundImage") && dealerWxml.includes("voiceTerms") && dealerWxml.includes("blindLevelsText"), "dealer page displays advanced blind settings and blind sequence");

console.log(`Miniprogram validation passed: ${checks.length} checks`);
for (const check of checks) console.log(`- ${check}`);
