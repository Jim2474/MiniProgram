import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createApp } from "../src/server.mjs";

const rootDir = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dataFile = join(rootDir, "data", "test-store.json");

const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

async function request(baseUrl, path, options = {}) {
  const body = options.rawBody !== undefined ? options.rawBody : options.body ? JSON.stringify(options.body) : undefined;
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error || res.statusText}`);
  return data;
}

async function expectHttpError(baseUrl, path, options, status, message) {
  const body = options.rawBody !== undefined ? options.rawBody : options.body ? JSON.stringify(options.body) : undefined;
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body,
  });
  await res.json();
  assert(res.status === status, message);
}

function signWechatPayBody(privateKey, timestamp, nonce, rawBody) {
  const sign = createSign("RSA-SHA256");
  sign.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  sign.end();
  return sign.sign(privateKey, "base64");
}

function encryptWechatPayResource(apiKey, plaintext) {
  const nonce = randomBytes(12).toString("hex").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiKey), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: "AEAD_AES_256_GCM",
    associated_data: associatedData,
    nonce,
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
}

async function main() {
  await rm(dataFile, { force: true });
  const { server, store } = await createApp({ dataFile });
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const boot = await request(baseUrl, "/api/bootstrap");
    assert(boot.user.phone === "13800000000", "微信登录种子会员存在");
    assert(boot.employees.every((employee) => !("passwordHash" in employee)), "初始化数据不暴露员工密码字段");
    assert(store.data.employees.every((employee) => String(employee.passwordHash).startsWith("scrypt$") && employee.passwordHash !== "demo"), "初始化员工密码以强哈希形式存储");
    assert(boot.runtime.mockWechatEnabled === true && boot.runtime.paymentProvider === "mock_wechat", "开发环境显式标记模拟微信能力");
    assert(boot.runtime.deployment.missingWechatEnv.includes("WECHAT_APPID") && boot.runtime.deployment.usingJsonStore === true, "运行时返回微信和数据层部署检查");
    assert(boot.runtime.deployment.productionReady === false && boot.runtime.deployment.productionBlockers.includes("APP_ENV 不是 production"), "健康检查返回生产就绪阻塞项");

    const loggedInUser = await request(baseUrl, "/api/wechat/login", { method: "POST", body: { phone: "13700001111", nickname: "新会员" } });
    const newUserId = loggedInUser.user.userId;
    assert(loggedInUser.user.balance === 0 && loggedInUser.user.memberLevel === "普通会员", "微信登录新会员初始化余额和等级");
    assert(loggedInUser.authProvider === "mock_wechat", "模拟微信登录返回提供方标记");

    const staffLogin = await request(baseUrl, "/api/staff/login", { method: "POST", body: { account: "anna", password: "demo" } });
    assert(staffLogin.employee.employeeId === "emp_anna" && staffLogin.session.sessionId, "员工可用账号密码登录");
    assert(!("passwordHash" in staffLogin.employee), "员工登录结果不暴露密码字段");
    store.data.employees.push({ employeeId: "emp_legacy", merchantId: store.data.settings.merchantId, storeId: store.data.settings.storeId, name: "旧数据员工", phone: "13900000005", role: "staff", loginAccount: "legacy", passwordHash: "legacy-pass", commissionRate: 0.01, status: "active", createdAt: new Date().toISOString() });
    const legacyLogin = await request(baseUrl, "/api/staff/login", { method: "POST", body: { account: "legacy", password: "legacy-pass" } });
    const migratedEmployee = store.data.employees.find((item) => item.employeeId === legacyLogin.employee.employeeId);
    assert(migratedEmployee.passwordHash.startsWith("scrypt$") && migratedEmployee.passwordHash !== "legacy-pass", "旧明文员工密码登录后自动迁移为强哈希");
    const staffOrderQr = await request(baseUrl, "/api/staff/employees/emp_anna/order-qr");
    assert(staffOrderQr.qr.qrPayload === "employee:emp_anna" && staffOrderQr.qr.scene === "employee_qr", "员工端可获取专属点单二维码码值");
    assert(staffOrderQr.qr.qrImageUrl.startsWith("data:image/"), "员工专属点单二维码返回可展示图片");
    assert(!("passwordHash" in staffOrderQr.qr.employee), "员工专属点单二维码接口不暴露密码字段");

    const productsBefore = await request(baseUrl, "/api/products");
    const bud = productsBefore.products.find((item) => item.skuId === "sku_bud");
    const whisky = productsBefore.products.find((item) => item.skuId === "sku_whisky");
    assert(bud.stockQty === 60, "初始 SKU 库存正确");

    await request(baseUrl, "/api/cart/items", {
      method: "POST",
      body: { userId: newUserId, skuId: "sku_bud", quantity: 1 },
    });
    const naturalOrder = await request(baseUrl, "/api/orders", { method: "POST", body: { userId: newUserId } });
    assert(!naturalOrder.order.employee && naturalOrder.order.source === "natural", "未扫码员工二维码时订单不归属员工");

    const scanBeforeOrder = await request(baseUrl, "/api/scan/employee", { method: "POST", body: { userId: "user_demo", employeeId: "emp_anna", rawCode: staffOrderQr.qr.qrPayload } });
    assert(scanBeforeOrder.employee.employeeId === "emp_anna" && scanBeforeOrder.record.scene === "employee_qr", "客户先扫码员工二维码建立归属");

    await request(baseUrl, "/api/cart/items", {
      method: "POST",
      body: { userId: "user_demo", employeeId: "emp_anna", skuId: "sku_bud", quantity: 2 },
    });
    await request(baseUrl, "/api/cart/items", {
      method: "POST",
      body: { userId: "user_demo", employeeId: "emp_anna", skuId: "sku_whisky", quantity: 1 },
    });
    const orderData = await request(baseUrl, "/api/orders", { method: "POST", body: { userId: "user_demo" } });
    assert(orderData.order.employee.employeeId === "emp_anna", "订单按员工二维码归属");
    assert(!("passwordHash" in orderData.order.employee), "订单归属员工信息不暴露密码字段");
    assert(orderData.order.amount === bud.price * 2 + whisky.price, "订单金额按购物车明细计算");
    assert(store.data.payments.some((payment) => payment.orderId === orderData.order.orderId && payment.status === "created"), "创建订单同步生成待支付记录");

    const paid = await request(baseUrl, `/api/orders/${orderData.order.orderId}/pay`, { method: "POST" });
    assert(paid.order.payStatus === "paid" && paid.order.orderStatus === "pending", "模拟微信支付后订单进入待处理");
    assert(paid.paymentProvider === "mock_wechat" && paid.payment.status === "paid", "模拟微信支付返回支付记录和提供方标记");
    assert(paid.order.pointsAwarded === paid.order.amount, "支付后按每元一积分赠送");

    const productsAfterPay = await request(baseUrl, "/api/products");
    const budAfterPay = productsAfterPay.products.find((item) => item.skuId === "sku_bud");
    const whiskyAfterPay = productsAfterPay.products.find((item) => item.skuId === "sku_whisky");
    assert(budAfterPay.stockQty === bud.stockQty - 2, "支付后啤酒库存扣减");
    assert(whiskyAfterPay.stockQty === whisky.stockQty - 1, "支付后威士忌库存扣减");

    const pointsAfterPay = await request(baseUrl, "/api/points?userId=user_demo");
    assert(pointsAfterPay.balance === 120 + paid.order.pointsAwarded, "支付后客户积分余额增加");
    const paidAgain = await request(baseUrl, `/api/orders/${orderData.order.orderId}/pay`, { method: "POST" });
    const productsAfterSecondPay = await request(baseUrl, "/api/products");
    const pointsAfterSecondPay = await request(baseUrl, "/api/points?userId=user_demo");
    assert(paidAgain.idempotent === true && productsAfterSecondPay.products.find((item) => item.skuId === "sku_bud").stockQty === budAfterPay.stockQty && pointsAfterSecondPay.balance === pointsAfterPay.balance, "重复支付请求幂等且不重复扣库存或赠积分");

    const dashboard = await request(baseUrl, "/api/admin/dashboard");
    assert(dashboard.todayOrderCount >= 1 && dashboard.todayRevenue >= paid.order.amount, "后台看板统计订单和营收");
    assert(typeof dashboard.revenueDelta === "number" && typeof dashboard.orderCountDelta === "number" && typeof dashboard.newMemberDelta === "number", "后台看板返回较昨日对比数据");
    assert(dashboard.staffSales.some((item) => item.employeeId === "emp_anna" && item.sales >= paid.order.amount), "后台员工业绩统计正确");
    assert(dashboard.staffSales.some((item) => item.employeeId === "emp_anna" && item.commissionRate === 0.08 && item.commissionAmount > 0), "后台员工业绩统计提成金额");
    const monthlyPerformance = await request(baseUrl, "/api/staff/performance/monthly?employeeId=emp_anna&months=6");
    assert(monthlyPerformance.rows.length === 6 && monthlyPerformance.rows[0].sales >= paid.order.amount, "员工端返回最近六个月业绩");
    assert(monthlyPerformance.rows[0].commissionRate === 0.08 && monthlyPerformance.rows[0].commissionAmount > 0, "员工端返回近六月提成金额");
    assert(!("passwordHash" in monthlyPerformance.employee), "员工业绩接口不暴露密码字段");
    const dailyPerformance = await request(baseUrl, "/api/staff/performance/daily?employeeId=emp_anna");
    const todayPerformance = dailyPerformance.rows.find((row) => row.date === new Date().toISOString().slice(0, 10));
    assert(todayPerformance && todayPerformance.sales >= paid.order.amount && todayPerformance.orderCount >= 1, "员工端返回当月每日业绩");
    assert(dailyPerformance.totalCommission > 0 && dailyPerformance.totalOrders >= 1, "员工端返回当月每日提成合计");

    const transfer = await request(baseUrl, `/api/admin/orders/${orderData.order.orderId}/transfer-storage`, {
      method: "POST",
      body: { skuId: "sku_whisky", quantity: 1, operatorId: "emp_admin" },
    });
    assert(transfer.storage.quantity === 1 && transfer.storage.status === "available", "订单转存生成客户存酒");
    assert(transfer.transferableQtyAfter === 0, "订单转存返回当前 SKU 剩余可转存数量");
    const storageLedgerAfterTransfer = await request(baseUrl, `/api/admin/storage-ledgers?storageId=${transfer.storage.storageId}`);
    assert(storageLedgerAfterTransfer.ledgers.some((ledger) => ledger.actionType === "from_order" && ledger.product.skuId === "sku_whisky" && ledger.user.userId === "user_demo" && ledger.sourceId === orderData.order.orderId), "客户存酒账记录订单转存入账并绑定来源订单");
    const orderAfterTransfer = await request(baseUrl, `/api/orders?userId=user_demo`);
    const transferredOrder = orderAfterTransfer.orders.find((order) => order.orderId === orderData.order.orderId);
    assert(transferredOrder.transferableItems.some((item) => item.skuId === "sku_whisky" && item.transferableQty === 0 && item.transferredQty === 1), "订单详情返回 SKU 已转存和剩余可转存数量");
    await expectHttpError(baseUrl, `/api/admin/orders/${orderData.order.orderId}/transfer-storage`, { method: "POST", body: { skuId: "sku_whisky", quantity: 1, operatorId: "emp_admin" } }, 409, "订单同一 SKU 超额转存被拦截");
    await expectHttpError(baseUrl, `/api/admin/orders/${orderData.order.orderId}/transfer-storage`, { method: "POST", body: { skuId: "sku_fries", quantity: 1, operatorId: "emp_admin" } }, 400, "订单外 SKU 不能转存客户存酒");

    const pickup = await request(baseUrl, `/api/storage/${transfer.storage.storageId}/pickup-requests`, {
      method: "POST",
      body: { quantity: 1 },
    });
    assert(pickup.request.status === "pending", "客户可提交取酒申请");

    const confirmedPickup = await request(baseUrl, `/api/staff/storage/pickup-requests/${pickup.request.requestId}/confirm`, {
      method: "POST",
      body: { operatorId: "emp_anna" },
    });
    assert(confirmedPickup.storage.quantity === 0 && confirmedPickup.storage.status === "empty", "员工确认取酒后扣减客户存酒");
    const storageLedgerAfterPickup = await request(baseUrl, `/api/admin/storage-ledgers?storageId=${transfer.storage.storageId}&actionType=pickup_confirm`);
    assert(storageLedgerAfterPickup.ledgers.length === 1 && storageLedgerAfterPickup.ledgers[0].quantityAfter === 0, "客户存酒账记录取酒确认出账");
    const customerStorageRecords = await request(baseUrl, "/api/storage-records?userId=user_demo");
    assert(customerStorageRecords.ledgers.some((ledger) => ledger.actionType === "from_order") && customerStorageRecords.ledgers.some((ledger) => ledger.actionType === "pickup_confirm"), "客户可查询历史存取酒流水");
    assert(customerStorageRecords.pickupRequests.some((request) => request.status === "completed"), "客户可查询历史取酒申请状态");
    assert(customerStorageRecords.pickupRequests.some((request) => request.product?.skuId === "sku_whisky" && request.user?.userId === "user_demo" && request.storage?.storageId === transfer.storage.storageId), "取酒申请返回客户、商品和存酒上下文");
    const multiStorage = await request(baseUrl, "/api/staff/storage", {
      method: "POST",
      body: { operatorId: "emp_anna", customerName: "王先生", phone: "13800000000", skuId: "sku_bud", quantity: 3, agreementAccepted: true },
    });
    assert(multiStorage.user.nickname === "王先生", "员工新增存酒可记录客户姓名");
    await expectHttpError(baseUrl, "/api/staff/storage", { method: "POST", body: { operatorId: "emp_anna", customerName: "李女士", phone: "13800000001", skuId: "sku_bud", quantity: 1, agreementAccepted: false } }, 400, "员工新增存酒必须勾选寄存协议");
    const multiPickup = await request(baseUrl, `/api/storage/${multiStorage.storage.storageId}/pickup-requests`, {
      method: "POST",
      body: { quantity: 2 },
    });
    assert(multiPickup.request.quantity === 2, "客户可按数量提交取酒申请");
    const confirmedMultiPickup = await request(baseUrl, `/api/staff/storage/pickup-requests/${multiPickup.request.requestId}/confirm`, {
      method: "POST",
      body: { operatorId: "emp_anna" },
    });
    assert(confirmedMultiPickup.storage.quantity === 1 && confirmedMultiPickup.storage.status === "available", "员工确认多瓶取酒后保留剩余存酒");

    const reservation = await request(baseUrl, "/api/reservations", {
      method: "POST",
      body: { userId: "user_demo", tableId: "table_a1", reservationTime: new Date().toISOString(), partySize: 2, contactPhone: "13800000000", remark: "靠近吧台" },
    });
    assert(reservation.reservation.status === "pending", "客户可提交桌位预约");
    assert(reservation.reservation.partySize === 2 && reservation.reservation.remark === "靠近吧台" && reservation.reservation.contactPhone === "13800000000", "客户预约保存人数、联系方式和备注");
    const publicTables = await request(baseUrl, "/api/tables");
    assert(publicTables.tables.every((item) => item.capacity >= 1 && item.imageUrl), "客户预约页可获取桌台人数和非空图片字段");
    await expectHttpError(baseUrl, "/api/reservations", { method: "POST", body: { userId: "user_demo", tableId: "table_a1", partySize: 99 } }, 400, "预约人数超过桌台容量");
    const confirmedReservation = await request(baseUrl, `/api/admin/reservations/${reservation.reservation.reservationId}`, {
      method: "PATCH",
      body: { status: "confirmed", operatorId: "emp_admin" },
    });
    assert(confirmedReservation.reservation.status === "confirmed", "后台可确认预约");
    assert(confirmedReservation.table.status === "reserved", "确认预约后桌位变为预订");
    const adminCancelledReservation = await request(baseUrl, `/api/admin/reservations/${reservation.reservation.reservationId}`, {
      method: "PATCH",
      body: { status: "cancelled", operatorId: "emp_admin", reason: "客户电话取消" },
    });
    assert(adminCancelledReservation.reservation.status === "cancelled" && adminCancelledReservation.table.status === "available", "后台可取消已确认预约并释放桌台");
    const cancelReservation = await request(baseUrl, "/api/reservations", {
      method: "POST",
      body: { userId: "user_demo", tableId: "table_vip", reservationTime: new Date().toISOString() },
    });
    const cancelledReservation = await request(baseUrl, `/api/reservations/${cancelReservation.reservation.reservationId}/cancel`, {
      method: "POST",
      body: { reason: "客户临时取消" },
    });
    assert(cancelledReservation.reservation.status === "cancelled", "客户可取消预约");
    const expireReservation = await request(baseUrl, "/api/reservations", {
      method: "POST",
      body: { userId: "user_demo", tableId: "table_vip", reservationTime: new Date().toISOString() },
    });
    const expiredReservation = await request(baseUrl, `/api/admin/reservations/${expireReservation.reservation.reservationId}`, {
      method: "PATCH",
      body: { status: "expired", operatorId: "emp_admin", reason: "超时未到店" },
    });
    assert(expiredReservation.reservation.status === "expired", "后台可将预约标记失效");

    const game = await request(baseUrl, "/api/staff/blind-games", {
      method: "POST",
      body: { operatorId: "emp_dealer", smallBlind: 1, bigBlind: 2, intervalMinutes: 10, initialPlayers: 9, buyinAmount: 100 },
    });
    assert(game.game.status === "running" && game.game.currentPlayers === 9, "荷官可创建升盲游戏");
    const nextLevel = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "next_level", operatorId: "emp_dealer" },
    });
    assert(nextLevel.game.level === 2 && nextLevel.game.smallBlind === 2 && nextLevel.game.bigBlind === 4, "升盲动作更新级别和盲注");
    const eliminated = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "eliminate", operatorId: "emp_dealer" },
    });
    assert(eliminated.game.currentPlayers === 8, "淘汰动作减少在桌人数");
    const seatEliminatedByDealer = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "eliminate", operatorId: "emp_dealer", seatNo: 4 },
    });
    assert(seatEliminatedByDealer.game.currentPlayers === 7, "荷官可按座位号淘汰玩家");
    const seatRestoredByDealer = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "restore", operatorId: "emp_dealer", seatNo: 4 },
    });
    assert(seatRestoredByDealer.game.currentPlayers === 8, "荷官可按座位号恢复玩家");
    const headsUpGame = await request(baseUrl, "/api/staff/blind-games", {
      method: "POST",
      body: { operatorId: "emp_dealer", initialPlayers: 3, smallBlind: 1, bigBlind: 2 },
    });
    await request(baseUrl, `/api/staff/blind-games/${headsUpGame.game.gameId}`, {
      method: "PATCH",
      body: { action: "eliminate", operatorId: "emp_dealer" },
    });
    const headsUpTimer = await request(baseUrl, `/api/staff/blind-games/${headsUpGame.game.gameId}/timer`);
    assert(headsUpTimer.timer.latestEvents.some((event) => event.eventType === "heads_up" && event.message.includes("单挑阶段")), "荷官淘汰到剩余2人时提示单挑阶段");
    const buyinAdded = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "buyin", operatorId: "emp_dealer", count: 2 },
    });
    const buyinMinus = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "buyin_minus", operatorId: "emp_dealer" },
    });
    assert(buyinAdded.game.buyinCount === 2 && buyinMinus.game.buyinCount === 1, "荷官可增减代入手数");
    const buyinAmountChanged = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}`, {
      method: "PATCH",
      body: { action: "set_buyin_amount", operatorId: "emp_dealer", buyinAmount: 150 },
    });
    assert(buyinAmountChanged.game.buyinAmount === 150, "荷官可手动调整单手买入金额");
    const timer = await request(baseUrl, `/api/staff/blind-games/${game.game.gameId}/timer`);
    assert(typeof timer.timer.remainingSeconds === "number" && Array.isArray(timer.timer.latestEvents), "荷官升盲计时器返回剩余时间和语音事件");

    let stockError = "";
    try {
      await request(baseUrl, "/api/cart/items", {
        method: "POST",
        body: { userId: "user_demo", employeeId: "emp_anna", skuId: "sku_whisky", quantity: 999 },
      });
    } catch (error) {
      stockError = error.message;
    }
    assert(stockError.includes("库存不足"), "库存不足不可加入购物车/下单");

    await expectHttpError(baseUrl, `/api/admin/orders/${orderData.order.orderId}/refund`, { method: "POST", body: { operatorId: "emp_admin", reason: "已转存后误退款" } }, 409, "已转存客户存酒的订单退款前需人工处理存酒");
    await request(baseUrl, "/api/cart/items", {
      method: "POST",
      body: { userId: "user_demo", employeeId: "emp_anna", skuId: "sku_bud", quantity: 1 },
    });
    const refundOrderData = await request(baseUrl, "/api/orders", { method: "POST", body: { userId: "user_demo" } });
    await request(baseUrl, `/api/orders/${refundOrderData.order.orderId}/pay`, { method: "POST" });
    const refunded = await request(baseUrl, `/api/admin/orders/${refundOrderData.order.orderId}/refund`, {
      method: "POST",
      body: { operatorId: "emp_admin", reason: "自验收退款" },
    });
    assert(refunded.order.payStatus === "refunded" && refunded.order.orderStatus === "refunded", "管理员可退款");
    assert(refunded.refundProvider === "mock_wechat", "模拟微信退款返回提供方标记");
    const productsAfterRefund = await request(baseUrl, "/api/products");
    assert(productsAfterRefund.products.find((item) => item.skuId === "sku_bud").stockQty === bud.stockQty - 2, "退款后啤酒库存恢复且保留未退款已支付订单扣减");
    assert(productsAfterRefund.products.find((item) => item.skuId === "sku_whisky").stockQty === whisky.stockQty - 1, "已转存订单未退款时威士忌库存不被恢复");
    const pointsAfterRefund = await request(baseUrl, "/api/points?userId=user_demo");
    assert(pointsAfterRefund.balance === 120 + paid.order.pointsAwarded, "退款后仅扣回被退款订单积分");

    const logs = await request(baseUrl, "/api/admin/operation-logs");
    assert(logs.logs.length >= 8, "关键业务操作写入操作日志");
    assert(logs.logs.some((log) => log.operatorId === "emp_admin" && log.operatorName === log.operator?.name), "操作日志返回操作人姓名");
    assert(logs.logs.every((log) => !log.operator || !("passwordHash" in log.operator)), "操作日志操作人不暴露密码字段");

    const profile = await request(baseUrl, "/api/user/profile?userId=user_demo");
    assert(profile.user.phone === "13800000000" && profile.level.name, "个人中心聚合会员与等级");

    const checkin = await request(baseUrl, "/api/checkin", { method: "POST", body: { userId: "user_demo" } });
    assert(checkin.record.points === 10, "签到送积分");
    const checkinState = await request(baseUrl, "/api/checkin?userId=user_demo");
    assert(checkinState.calendar.length >= 28 && checkinState.calendar.some((day) => day.isToday && day.signed), "签到页面返回本月日历并标记今日已签到");
    let duplicateCheckin = "";
    try {
      await request(baseUrl, "/api/checkin", { method: "POST", body: { userId: "user_demo" } });
    } catch (error) {
      duplicateCheckin = error.message;
    }
    assert(duplicateCheckin.includes("今日已签到"), "同日重复签到被拦截");

    let rechargeError = "";
    try {
      await request(baseUrl, "/api/recharge", { method: "POST", body: { userId: "user_demo", amount: 300, giftAmount: 30 } });
    } catch (error) {
      rechargeError = error.message;
    }
    assert(rechargeError.includes("余额充值暂未开放"), "客户余额充值入口暂不开放");
    const rechargeRecords = await request(baseUrl, "/api/recharge-records?userId=user_demo");
    assert(rechargeRecords.records.length === 0 && rechargeRecords.configs.length === 0 && rechargeRecords.featureEnabled === false, "充值中心不返回可用充值配置");

    const leaderboard = await request(baseUrl, "/api/leaderboard/points?userId=user_demo");
    assert(leaderboard.featureEnabled === false && leaderboard.top10.length === 0, "积分排行榜暂不开放");
    let couponExchangeError = "";
    try {
      await request(baseUrl, "/api/coupons/exchange", { method: "POST", body: { userId: "user_demo", count: 1, skuId: "sku_bud" } });
    } catch (error) {
      couponExchangeError = error.message;
    }
    assert(couponExchangeError.includes("积分兑换酒水券暂未开放"), "积分兑换酒水券暂不开放");
    const legacyCoupon = { couponId: "coupon_legacy", userId: "user_demo", skuId: "sku_bud", status: "available", createdAt: new Date().toISOString(), completedAt: null };
    store.data.coupons.unshift(legacyCoupon);
    await expectHttpError(baseUrl, `/api/coupons/${legacyCoupon.couponId}/redeem-request`, { method: "POST", body: { userId: "user_demo" } }, 400, "旧酒水券客户兑换申请被服务端硬拦截");
    assert(legacyCoupon.status === "available" && store.data.couponRecords.every((record) => record.couponId !== legacyCoupon.couponId), "旧酒水券兑换申请不会改写状态或流水");
    legacyCoupon.status = "pending";
    await expectHttpError(baseUrl, `/api/staff/coupons/${legacyCoupon.couponId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } }, 400, "旧酒水券员工核销被服务端硬拦截");
    assert(legacyCoupon.status === "pending" && legacyCoupon.completedAt === null, "旧酒水券员工核销不会完成券");
    const legacyCouponCode = { codeId: "verify_coupon_legacy", qrPayload: "verify:coupon_legacy", userId: "user_demo", type: "coupon", status: "active", storageId: null, couponId: legacyCoupon.couponId, lotteryRecordId: null, pointsAmount: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: null, usedBy: null, qrProvider: "payload_qr", miniProgramPage: "", miniProgramScene: "verify:coupon_legacy" };
    store.data.verificationCodes.unshift(legacyCouponCode);
    await expectHttpError(baseUrl, `/api/staff/verification-codes/${legacyCouponCode.codeId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } }, 400, "旧酒水券二维码核销被服务端硬拦截");
    assert(legacyCouponCode.status === "active" && legacyCoupon.status === "pending", "旧酒水券二维码核销不会使用二维码或完成券");
    let lotteryError = "";
    try {
      await request(baseUrl, "/api/lottery/draw", { method: "POST", body: { userId: "user_demo" } });
    } catch (error) {
      lotteryError = error.message;
    }
    assert(lotteryError.includes("积分抽奖暂未开放"), "积分抽奖暂不开放");
    const legacyLotteryRecord = { recordId: "lottery_legacy", userId: "user_demo", prizeId: "prize_legacy", prizeName: "历史中奖", costPoints: 0, status: "won", redeemedBy: null, redeemedAt: null, createdAt: new Date().toISOString() };
    store.data.lotteryRecords.unshift(legacyLotteryRecord);
    await expectHttpError(baseUrl, `/api/lottery/records/${legacyLotteryRecord.recordId}/redeem-request`, { method: "POST", body: { userId: "user_demo" } }, 400, "旧中奖记录客户核销申请被服务端硬拦截");
    assert(legacyLotteryRecord.status === "won" && legacyLotteryRecord.redeemedAt === null, "旧中奖记录客户核销申请不会改写状态");
    await expectHttpError(baseUrl, `/api/staff/lottery-records/${legacyLotteryRecord.recordId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } }, 400, "旧中奖记录员工核销被服务端硬拦截");
    assert(legacyLotteryRecord.status === "won" && legacyLotteryRecord.redeemedBy === null, "旧中奖记录员工核销不会完成记录");
    const legacyLotteryCode = { codeId: "verify_lottery_legacy", qrPayload: "verify:lottery_legacy", userId: "user_demo", type: "lottery", status: "active", storageId: null, couponId: null, lotteryRecordId: legacyLotteryRecord.recordId, pointsAmount: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: null, usedBy: null, qrProvider: "payload_qr", miniProgramPage: "", miniProgramScene: "verify:lottery_legacy" };
    store.data.verificationCodes.unshift(legacyLotteryCode);
    await expectHttpError(baseUrl, `/api/staff/verification-codes/${legacyLotteryCode.codeId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } }, 400, "旧中奖二维码核销被服务端硬拦截");
    assert(legacyLotteryCode.status === "active" && legacyLotteryRecord.status === "won", "旧中奖二维码核销不会使用二维码或完成记录");

    const finance = await request(baseUrl, "/api/admin/finance/overview");
    assert(typeof finance.todayRevenue === "number" && Array.isArray(finance.trend), "财务概览返回营收和趋势");
    const businessDetails = await request(baseUrl, "/api/admin/business-details");
    assert(Array.isArray(businessDetails.details), "营业明细可查询");
    const consumptionRecords = await request(baseUrl, "/api/admin/consumption-records?userId=user_demo");
    assert(Array.isArray(consumptionRecords.records), "会员消费记录可查询");

    const level = await request(baseUrl, "/api/admin/member-levels", { method: "POST", body: { name: "黑金会员", minPoints: 2000 } });
    assert(level.level.name === "黑金会员", "后台可新增会员等级");
    const updatedLevel = await request(baseUrl, `/api/admin/member-levels/${level.level.levelId}`, { method: "PATCH", body: { minPoints: 1800, status: "disabled" } });
    assert(updatedLevel.level.minPoints === 1800 && updatedLevel.level.status === "disabled", "后台可编辑会员等级");

    const category = await request(baseUrl, "/api/admin/categories", { method: "POST", body: { name: "软饮", sortOrder: 4 } });
    assert(category.category.name === "软饮", "后台可新增商品分类");
    const disabledCategory = await request(baseUrl, `/api/admin/categories/${category.category.categoryId}`, { method: "PATCH", body: { status: "disabled" } });
    assert(disabledCategory.category.status === "disabled", "后台可停用商品分类");
    const activeCategory = await request(baseUrl, `/api/admin/categories/${category.category.categoryId}`, { method: "PATCH", body: { status: "active" } });
    assert(activeCategory.category.status === "active", "后台可重新启用商品分类");
    const product = await request(baseUrl, "/api/admin/products", {
      method: "POST",
      body: { categoryId: category.category.categoryId, name: "苏打水", spec: "330ml", unit: "瓶", price: 18, costPrice: 7, supplierName: "软饮供应商", stockQty: 6, warningQty: 2, storageDays: 15 },
    });
    assert(product.product.name === "苏打水" && product.product.stockQty === 6 && product.product.warningQty === 2 && product.product.storageDays === 15 && product.product.costPrice === 7 && product.product.supplierName === "软饮供应商", "后台可新增 SKU 并配置预警库存、成本、供应商和存酒有效期");
    assert(product.product.createdAt && product.product.updatedAt, "后台新增 SKU 记录创建和更新时间");
    const disabledProduct = await request(baseUrl, `/api/admin/products/${product.product.skuId}`, { method: "PATCH", body: { status: "disabled", price: 20, costPrice: 8, supplierName: "新软饮供应商", warningQty: 3, storageDays: 30 } });
    assert(disabledProduct.product.status === "disabled" && disabledProduct.product.price === 20 && disabledProduct.product.costPrice === 8 && disabledProduct.product.supplierName === "新软饮供应商" && disabledProduct.product.warningQty === 3 && disabledProduct.product.storageDays === 30, "后台可编辑并下架 SKU 且更新成本、供应商和有效期配置");
    assert(disabledProduct.product.updatedAt >= product.product.createdAt, "后台编辑 SKU 更新更新时间");
    const activeProduct = await request(baseUrl, `/api/admin/products/${product.product.skuId}`, { method: "PATCH", body: { status: "active" } });
    assert(activeProduct.product.status === "active", "后台可重新上架 SKU");
    const filteredProducts = await request(baseUrl, `/api/products?categoryId=${category.category.categoryId}&keyword=${encodeURIComponent("苏打")}`);
    assert(filteredProducts.products.length === 1 && filteredProducts.products[0].skuId === product.product.skuId, "商品列表支持分类与关键词筛选");
    const stockInRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "in", quantity: 4, operatorId: "emp_admin" } });
    assert(stockInRequest.request.status === "pending" && stockInRequest.request.direction === "in", "后台可提交入库申请");
    const stockInConfirm = await request(baseUrl, `/api/admin/stock-requests/${stockInRequest.request.requestId}/confirm`, { method: "POST", body: { operatorId: "emp_admin" } });
    assert(stockInConfirm.product.stockQty === 10 && stockInConfirm.request.status === "completed", "确认入库后写入库存账");
    const stockOutRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "out", quantity: 2, operatorId: "emp_admin" } });
    const stockOutConfirm = await request(baseUrl, `/api/admin/stock-requests/${stockOutRequest.request.requestId}/confirm`, { method: "POST", body: { operatorId: "emp_admin" } });
    assert(stockOutConfirm.product.stockQty === 8 && stockOutConfirm.ledger.changeType === "stock_out", "确认出库后写入库存账");
    const stockCount = await request(baseUrl, "/api/admin/stock-counts", { method: "POST", body: { skuId: product.product.skuId, countedQty: 7, operatorId: "emp_admin", reason: "闭店盘点" } });
    assert(stockCount.count.bookQty === 8 && stockCount.count.countedQty === 7 && stockCount.count.differenceQty === -1 && stockCount.product.stockQty === 7 && stockCount.ledger.changeType === "stock_count_loss", "后台可创建 SKU 盘点单并写入盘亏流水");
    const stockCounts = await request(baseUrl, "/api/admin/stock-counts");
    assert(stockCounts.counts.some((count) => count.countId === stockCount.count.countId && count.product.skuId === product.product.skuId), "后台可查询库存盘点单");
    const stockLedgerQuery = await request(baseUrl, "/api/admin/stock-ledgers");
    const storageLedgerQuery = await request(baseUrl, "/api/admin/storage-ledgers");
    assert(stockLedgerQuery.ledgers.some((ledger) => ledger.changeType === "stock_out") && storageLedgerQuery.ledgers.some((ledger) => ledger.actionType === "pickup_confirm"), "后台可分别查询商家库存账和客户存酒账");
    const rejectRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "in", quantity: 1, operatorId: "emp_admin" } });
    const rejectedRequest = await request(baseUrl, `/api/admin/stock-requests/${rejectRequest.request.requestId}/reject`, { method: "POST", body: { operatorId: "emp_admin", reason: "单据错误" } });
    assert(rejectedRequest.request.status === "rejected", "出入库申请可驳回");
    const cancelRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "out", quantity: 1, operatorId: "emp_admin" } });
    const stockBeforeCancel = store.getSku(product.product.skuId).stockQty;
    const cancelledRequest = await request(baseUrl, `/api/admin/stock-requests/${cancelRequest.request.requestId}/cancel`, { method: "POST", body: { operatorId: "emp_admin", reason: "暂不出库" } });
    assert(cancelledRequest.request.status === "cancelled" && store.getSku(product.product.skuId).stockQty === stockBeforeCancel, "出入库申请可取消且不改变库存");

    const raceProduct = await request(baseUrl, "/api/admin/products", {
      method: "POST",
      body: { categoryId: "cat_beer", name: "并发测试 SKU", spec: "1 件", unit: "件", price: 1, stockQty: 1, warningQty: 0 },
    });
    const raceAttempts = await Promise.allSettled([
      request(baseUrl, "/api/cart/items", { method: "POST", body: { userId: "user_demo", skuId: raceProduct.product.skuId, quantity: 1 } }),
      request(baseUrl, "/api/cart/items", { method: "POST", body: { userId: "user_demo", skuId: raceProduct.product.skuId, quantity: 1 } }),
    ]);
    const raceSuccesses = raceAttempts.filter((item) => item.status === "fulfilled").length;
    const raceFailures = raceAttempts.filter((item) => item.status === "rejected" && item.reason.message.includes("库存不足")).length;
    assert(raceSuccesses === 1 && raceFailures === 1, "并发加购同一低库存 SKU 时只允许一个请求成功");

    const pointsConfig = await request(baseUrl, "/api/admin/points-config", { method: "PATCH", body: { checkinPoints: 12, pointExpireDays: 180, pointsVisible: true } });
    assert(pointsConfig.config.checkinPoints === 12 && pointsConfig.config.pointExpireDays === 180 && pointsConfig.config.pointsVisible === true, "后台可配置积分明细显示和有效期规则");
    const phonePointAdjust = await request(baseUrl, "/api/staff/points/adjust", { method: "POST", body: { operatorId: "emp_anna", phone: "13800000000", amount: 5, reason: "按手机号补积分" } });
    assert(phonePointAdjust.user.userId === "user_demo" && phonePointAdjust.ledger.reason === "按手机号补积分", "员工可按手机号手动调整客户积分");
    const adminPointsLedgers = await request(baseUrl, "/api/admin/points-ledgers");
    assert(adminPointsLedgers.ledgers.some((ledger) => ledger.reason === "消费赠送积分" && ledger.sourceOrder?.orderId === orderData.order.orderId && ledger.serviceEmployee?.employeeId === "emp_anna"), "后台积分明细中消费赠分显示订单服务员工");
    assert(adminPointsLedgers.ledgers.some((ledger) => ledger.reason === "按手机号补积分" && ledger.operator?.employeeId === "emp_anna" && ledger.serviceEmployee?.employeeId === "emp_anna"), "后台积分明细中手动增减显示操作员工");

    const expiredStorage = await request(baseUrl, "/api/staff/storage", {
      method: "POST",
      body: { operatorId: "emp_anna", phone: "13800000000", skuId: "sku_bud", quantity: 1, agreementAccepted: true, expireAt: "2000-01-01T00:00:00.000Z" },
    });
    let expiredPickupError = "";
    try {
      await request(baseUrl, `/api/storage/${expiredStorage.storage.storageId}/pickup-requests`, { method: "POST", body: { quantity: 1 } });
    } catch (error) {
      expiredPickupError = error.message;
    }
    assert(expiredPickupError.includes("存酒已过期"), "过期存酒取酒前进入人工处理");
    const handledExpiredStorage = await request(baseUrl, `/api/admin/storage/${expiredStorage.storage.storageId}/expire-handle`, {
      method: "POST",
      body: { operatorId: "emp_admin", action: "dispose", note: "过期人工确认作废" },
    });
    assert(handledExpiredStorage.storage.status === "disposed" && handledExpiredStorage.storage.quantity === 0, "后台可人工确认处理过期存酒");
    const storageLedgerAfterExpired = await request(baseUrl, `/api/admin/storage-ledgers?storageId=${expiredStorage.storage.storageId}&actionType=expired_dispose`);
    assert(storageLedgerAfterExpired.ledgers.length === 1 && storageLedgerAfterExpired.ledgers[0].reason.includes("过期人工确认"), "客户存酒账记录过期人工处理");

    const employee = await request(baseUrl, "/api/admin/employees", { method: "POST", body: { name: "新员工", phone: "13900009999", role: "staff", commissionRate: 0.06 } });
    assert(employee.employee.status === "active" && employee.employee.commissionRate === 0.06 && !("passwordHash" in employee.employee), "后台可新增工作人员并配置提成且不返回密码字段");
    assert(store.data.employees.find((item) => item.employeeId === employee.employee.employeeId).passwordHash.startsWith("scrypt$"), "后台新增员工密码以强哈希形式保存");
    const employeesList = await request(baseUrl, "/api/admin/employees");
    assert(employeesList.employees.every((item) => !("passwordHash" in item)), "后台人员列表不暴露密码字段");
    const disabledEmployee = await request(baseUrl, `/api/admin/employees/${employee.employee.employeeId}`, { method: "PATCH", body: { status: "disabled", resetPassword: "123456", passwordHash: "malicious-raw" } });
    assert(disabledEmployee.employee.status === "disabled" && !("passwordHash" in disabledEmployee.employee), "后台可禁用员工并重置密码但不返回密码字段");
    const disabledStoredEmployee = store.data.employees.find((item) => item.employeeId === employee.employee.employeeId);
    assert(disabledStoredEmployee.passwordHash.startsWith("scrypt$") && disabledStoredEmployee.passwordHash !== "123456" && disabledStoredEmployee.passwordHash !== "malicious-raw", "后台重置密码不会保存明文或接受 passwordHash 覆盖");
    const deletableEmployee = await request(baseUrl, "/api/admin/employees", { method: "POST", body: { name: "待删除员工", phone: "13900008888", role: "staff", operatorId: "emp_admin" } });
    const deletedEmployee = await request(baseUrl, `/api/admin/employees/${deletableEmployee.employee.employeeId}`, { method: "DELETE", body: { operatorId: "emp_admin", reason: "验收删除工作人员" } });
    assert(deletedEmployee.employee.status === "disabled" && deletedEmployee.employee.deletedAt && !("passwordHash" in deletedEmployee.employee), "后台可软删除工作人员并脱敏返回");
    assert(store.data.operationLogs.some((log) => log.action === "delete_employee" && log.targetId === deletableEmployee.employee.employeeId && !log.beforeJson.includes("passwordHash") && !log.afterJson.includes("passwordHash")), "删除工作人员写入脱敏操作日志");
    await expectHttpError(baseUrl, "/api/admin/employees/emp_admin", { method: "DELETE", body: { operatorId: "emp_admin" } }, 400, "管理员账号不能被删除");
    const password = await request(baseUrl, "/api/staff/password", { method: "POST", body: { operatorId: "emp_anna", newPassword: "new-demo" } });
    assert(password.employee.passwordChangedAt && !("passwordHash" in password.employee), "员工可修改密码且不返回密码字段");
    const annaAfterPasswordChange = store.data.employees.find((item) => item.employeeId === "emp_anna");
    assert(annaAfterPasswordChange.passwordHash.startsWith("scrypt$") && annaAfterPasswordChange.passwordHash !== "new-demo", "员工改密后仅保存强哈希");
    const safeLogs = await request(baseUrl, "/api/admin/operation-logs");
    assert(safeLogs.logs.filter((log) => log.targetType === "Employee").every((log) => !log.beforeJson.includes("passwordHash") && !log.afterJson.includes("passwordHash")), "员工操作日志不记录密码字段");

    const verifyCode = await request(baseUrl, "/api/staff/verify-code", { method: "POST", body: { userId: "user_demo" } });
    assert(verifyCode.pointsBalance >= 0 && Array.isArray(verifyCode.coupons), "员工核销码可查询客户积分存酒券");
    const phoneVerifyCode = await request(baseUrl, "/api/staff/verify-code", { method: "POST", body: { phone: "13800000000" } });
    assert(phoneVerifyCode.user.userId === "user_demo" && Array.isArray(phoneVerifyCode.storage), "员工可按手机号查询客户积分存酒券");

    const pointsQr = await request(baseUrl, "/api/verification-codes", { method: "POST", body: { userId: "user_demo", type: "points", pointsAmount: 5 } });
    assert(pointsQr.code.qrPayload.startsWith("verify:"), "客户可生成取积分二维码");
    assert(pointsQr.code.qrImageUrl.startsWith("data:image/"), "客户取积分二维码返回可展示图片");
    assert(pointsQr.code.qrProvider === "payload_qr" && pointsQr.code.miniProgramScene === pointsQr.code.qrPayload, "开发态客户取积分二维码保留 payload 图片");
    const scannedPointsQr = await request(baseUrl, "/api/staff/verification-codes/scan", { method: "POST", body: { operatorId: "emp_anna", qrPayload: pointsQr.code.qrPayload } });
    assert(scannedPointsQr.code.type === "points", "员工可扫码查看积分二维码");
    const confirmedPointsQr = await request(baseUrl, `/api/staff/verification-codes/${pointsQr.code.codeId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } });
    assert(confirmedPointsQr.code.status === "used" && confirmedPointsQr.result.ledger.changeAmount === -5, "员工可扫码核销取积分");

    const qrStorage = await request(baseUrl, "/api/staff/storage", {
      method: "POST",
      body: { operatorId: "emp_anna", phone: "13800000000", skuId: "sku_bud", quantity: 3, agreementAccepted: true },
    });
    const storageQr = await request(baseUrl, "/api/verification-codes", { method: "POST", body: { userId: "user_demo", type: "storage", storageId: qrStorage.storage.storageId } });
    assert(storageQr.code.qrImageUrl.startsWith("data:image/"), "客户取酒二维码返回可展示图片");
    await expectHttpError(baseUrl, `/api/staff/verification-codes/${storageQr.code.codeId}/confirm`, { method: "POST", body: { operatorId: "emp_anna", quantity: 0 } }, 400, "二维码取酒数量必须大于 0");
    const confirmedStorageQr = await request(baseUrl, `/api/staff/verification-codes/${storageQr.code.codeId}/confirm`, { method: "POST", body: { operatorId: "emp_anna", quantity: 2 } });
    assert(confirmedStorageQr.result.storage.status === "available" && confirmedStorageQr.result.storage.quantity === 1, "员工可按数量扫码核销取酒二维码");

    const scanRecords = await request(baseUrl, "/api/admin/scan-records");
    assert(scanRecords.records.some((record) => record.employeeId === "emp_anna"), "后台可查看扫码归属记录");

    const seatSit = await request(baseUrl, "/api/staff/seats/3/sit", { method: "POST", body: { userId: "user_demo", operatorId: "emp_anna" } });
    assert(seatSit.seat.status === "occupied", "员工可确认座位入座");
    const phoneSeatSit = await request(baseUrl, "/api/staff/seats/4/sit", { method: "POST", body: { phone: "13800000000", operatorId: "emp_anna" } });
    assert(phoneSeatSit.seat.status === "occupied" && phoneSeatSit.seat.userId === "user_demo", "员工可按手机号确认客户入座");
    const seatEliminate = await request(baseUrl, "/api/staff/seats/3/eliminate", { method: "POST", body: { operatorId: "emp_anna" } });
    assert(seatEliminate.seat.eliminated === true, "员工可淘汰座位");
    const seatRestore = await request(baseUrl, "/api/staff/seats/3/restore", { method: "POST", body: { operatorId: "emp_anna" } });
    assert(seatRestore.seat.eliminated === false && seatRestore.seat.status === "occupied", "员工可恢复座位");

    const tableType = await request(baseUrl, "/api/admin/table-types", { method: "POST", body: { name: "超级VIP卡", capacity: 9 } });
    assert(tableType.type.name === "超级VIP卡", "后台可新增咖位类型");
    const table = await request(baseUrl, "/api/admin/tables", { method: "POST", body: { name: "B2 超级桌", type: "超级VIP卡", capacity: 9 } });
    assert(table.table.name === "B2 超级桌", "后台可新增座台信息");
    const occupiedTable = await request(baseUrl, `/api/admin/tables/${table.table.tableId}`, {
      method: "PATCH",
      body: { status: "occupied", consumptionAmount: 688, reason: "开台占用" },
    });
    assert(occupiedTable.table.status === "occupied" && occupiedTable.table.occupiedStartedAt && occupiedTable.table.consumptionAmount === 688, "后台可设置座台占用与消费金额");
    const filteredTables = await request(baseUrl, `/api/admin/tables?keyword=${encodeURIComponent("超级")}&status=occupied&page=1&pageSize=1`);
    assert(filteredTables.tables.length === 1 && filteredTables.tables[0].tableId === occupiedTable.table.tableId, "后台咖位列表支持关键词、状态筛选和分页");
    assert(filteredTables.pagination.total >= 1 && filteredTables.pagination.pageSize === 1 && filteredTables.summary.occupied >= 1, "后台咖位列表返回分页信息和状态汇总");
    const deletableTable = await request(baseUrl, "/api/admin/tables", { method: "POST", body: { name: "C3 临时桌", type: "普通卡座", capacity: 6 } });
    const deletedTable = await request(baseUrl, `/api/admin/tables/${deletableTable.table.tableId}`, { method: "DELETE", body: { operatorId: "emp_admin", reason: "验收删除座台" } });
    assert(deletedTable.table.status === "disabled" && deletedTable.table.deletedAt, "后台可删除座台并软禁用保留历史");
    const adminUsers = await request(baseUrl, "/api/admin/users");
    assert(adminUsers.users.some((user) => user.userId === "user_demo" && typeof user.hasStorage === "boolean" && typeof user.totalSpend === "number" && typeof user.orderCount === "number"), "后台会员列表展示积分、存酒和消费汇总");

    const blindSettings = await request(baseUrl, "/api/admin/blind-settings", {
      method: "PATCH",
      body: {
        theme: "neon",
        backgroundImage: "https://example.com/bg.png",
        logo: "https://example.com/logo.png",
        fontColor: "#00FFAA",
        timerColor: "#FFEE00",
        breakColor: "#00AAFF",
        dialogColor: "#111111",
        fontSize: 56,
        fontFamily: "DIN",
        registrationStatus: "stopped",
        championBackgroundImage: "https://example.com/champion.png",
        voiceType: "custom",
        voiceStartText: "比赛开始",
        voiceEndText: "本局结束",
        entrants: 18,
        totalBuyins: 23,
        showBeijingTime: false,
        showRegistrationCountdown: false,
        autoStartAfterCountdown: true,
        blindLevels: [
          { level: 1, smallBlind: 1, bigBlind: 2, ante: 0 },
          { level: 2, smallBlind: 3, bigBlind: 6, ante: 1 },
        ],
        titleMap: { level: "级别", entrants: "参赛人数", blinds: "盲注" },
        voiceTerms: { smallBlind: "小盲位", bigBlind: "大盲位", ante: "前注" },
      },
    });
    assert(blindSettings.settings.theme === "neon" && blindSettings.settings.registrationStatus === "stopped" && blindSettings.settings.fontColor === "#00FFAA", "后台可配置升盲样式和报名状态");
    assert(blindSettings.settings.backgroundImage && blindSettings.settings.logo && blindSettings.settings.championBackgroundImage, "后台可配置升盲背景、Logo 和冠军背景");
    assert(blindSettings.settings.titleMap.level === "级别" && blindSettings.settings.titleMap.playerLeft === "PLAYER LEFT", "后台可局部配置升盲标题文案且保留未改标题");
    assert(blindSettings.settings.voiceType === "custom" && blindSettings.settings.voiceStartText === "比赛开始" && blindSettings.settings.voiceTerms.smallBlind === "小盲位", "后台可配置升盲语音和术语");
    assert(blindSettings.settings.entrants === 18 && blindSettings.settings.totalBuyins === 23 && blindSettings.settings.autoStartAfterCountdown === true, "后台可配置参赛人数、总买入和倒计时行为");
    assert(blindSettings.settings.blindLevels[1].smallBlind === 3 && blindSettings.settings.blindLevels[1].ante === 1, "后台可配置自定义升盲规则序列");
    const staffBlindSettings = await request(baseUrl, "/api/staff/blind-settings");
    assert(staffBlindSettings.settings.blindLevels[1].bigBlind === 6, "荷官端可读取员工升盲设置接口");
    const customGame = await request(baseUrl, "/api/staff/blind-games", {
      method: "POST",
      body: { operatorId: "emp_dealer", intervalMinutes: 10, initialPlayers: 9, buyinAmount: 100 },
    });
    const customNext = await request(baseUrl, `/api/staff/blind-games/${customGame.game.gameId}`, { method: "PATCH", body: { action: "next_level", operatorId: "emp_dealer" } });
    assert(customNext.game.smallBlind === 3 && customNext.game.bigBlind === 6 && customNext.game.ante === 1, "荷官升盲按后台自定义规则序列推进");

    const systemSettings = await request(baseUrl, "/api/admin/system-settings", {
      method: "PATCH",
      body: { pointsVisible: false, supportPhone: "400-000-0000", location: { latitude: 31.2, longitude: 121.5, address: "上海市黄浦区测试路 1 号" } },
    });
    assert(systemSettings.settings.pointsVisible === false && systemSettings.settings.supportPhone === "400-000-0000" && systemSettings.settings.location.address.includes("黄浦区"), "后台可配置系统设置");

    const location = await request(baseUrl, "/api/store/location");
    assert(location.location.address.includes("黄浦区") && location.location.latitude === 31.2, "门店位置可查询");
    const support = await request(baseUrl, "/api/support/contact");
    assert(support.phone === "400-000-0000", "客服电话可查询");

    const envSnapshot = {};
    for (const key of [
      "APP_ENV",
      "ALLOW_MOCK_WECHAT",
      "WECHAT_APPID",
      "WECHAT_APP_SECRET",
      "WECHAT_MCH_ID",
      "WECHAT_PAY_SERIAL_NO",
      "WECHAT_PAY_PRIVATE_KEY",
      "WECHAT_PAY_API_V3_KEY",
      "WECHAT_PAY_PLATFORM_CERTIFICATE",
      "WECHAT_PAY_PLATFORM_SERIAL_NO",
      "WECHAT_PAY_NOTIFY_URL",
      "WECHAT_LOGIN_DRY_RUN",
      "WECHAT_PHONE_DRY_RUN",
      "WECHAT_QR_DRY_RUN",
      "WECHAT_MINIPROGRAM_ENV_VERSION",
      "WECHAT_PAY_DRY_RUN",
      "ALLOW_JSON_STORE_IN_PRODUCTION",
      "DATABASE_URL",
    ]) {
      envSnapshot[key] = process.env[key];
    }
    process.env.APP_ENV = "production";
    delete process.env.ALLOW_MOCK_WECHAT;
    delete process.env.DATABASE_URL;
    try {
      let productionStoreError = "";
      try {
        await createApp({ dataFile: join(rootDir, "data", "test-store-prod-forbidden.json") });
      } catch (error) {
        productionStoreError = error.message;
      }
      assert(productionStoreError.includes("生产环境缺少 DATABASE_URL"), "生产环境默认拒绝使用 JSON Store");
      const sqliteDataFile = join(rootDir, "data", "test-store-prod.sqlite");
      await rm(sqliteDataFile, { force: true });
      process.env.DATABASE_URL = `sqlite://${sqliteDataFile}`;
      const { server: sqliteServer, store: sqliteStore } = await createApp();
      await new Promise((resolveListen) => sqliteServer.listen(0, resolveListen));
      const sqliteBaseUrl = `http://127.0.0.1:${sqliteServer.address().port}`;
      try {
        const sqliteHealth = await request(sqliteBaseUrl, "/api/health");
        assert(sqliteHealth.runtime.deployment.databaseProvider === "sqlite" && sqliteHealth.runtime.deployment.usingJsonStore === false, "生产环境可使用 SQLite 数据库状态库启动");
        await request(sqliteBaseUrl, "/api/staff/login", { method: "POST", body: { account: "anna", password: "demo" } });
      } finally {
        await new Promise((resolveClose) => sqliteServer.close(resolveClose));
        await sqliteStore.close();
      }
      const { server: sqliteRestartServer, store: sqliteRestartStore } = await createApp();
      await new Promise((resolveListen) => sqliteRestartServer.listen(0, resolveListen));
      const sqliteRestartBaseUrl = `http://127.0.0.1:${sqliteRestartServer.address().port}`;
      try {
        const sqliteBoot = await request(sqliteRestartBaseUrl, "/api/bootstrap");
        assert(sqliteBoot.runtime.deployment.databaseProvider === "sqlite" && sqliteBoot.runtime.deployment.databaseConfigured === true, "SQLite 数据库状态库重启后可读取持久化数据");
      } finally {
        await new Promise((resolveClose) => sqliteRestartServer.close(resolveClose));
        await sqliteRestartStore.close();
        await rm(sqliteDataFile, { force: true });
      }
      delete process.env.DATABASE_URL;
      process.env.ALLOW_JSON_STORE_IN_PRODUCTION = "true";
      const blockedDataFile = join(rootDir, "data", "test-store-prod-block.json");
      await rm(blockedDataFile, { force: true });
      const { server: blockedServer } = await createApp({ dataFile: blockedDataFile });
      await new Promise((resolveListen) => blockedServer.listen(0, resolveListen));
      const blockedBaseUrl = `http://127.0.0.1:${blockedServer.address().port}`;
      try {
        const blockedHealth = await request(blockedBaseUrl, "/api/health");
        assert(blockedHealth.runtime.mockWechatEnabled === false, "生产环境默认禁用模拟微信能力");
        assert(blockedHealth.runtime.deployment.wechatConfigured === false && blockedHealth.runtime.deployment.missingWechatEnv.includes("WECHAT_MCH_ID"), "生产环境健康检查暴露真实微信配置缺口");
        assert(blockedHealth.runtime.deployment.wechatLoginConfigured === false && blockedHealth.runtime.deployment.wechatPayConfigured === false, "生产环境健康检查拆分微信登录和支付配置状态");
        assert(blockedHealth.runtime.deployment.productionReady === false && blockedHealth.runtime.deployment.productionBlockers.some((item) => item.includes("缺少微信支付配置")), "生产环境健康检查返回未就绪原因");
        let prodLoginError = "";
        try {
          await request(blockedBaseUrl, "/api/wechat/login", { method: "POST", body: { phone: "13600000000" } });
        } catch (error) {
          prodLoginError = error.message;
        }
        assert(prodLoginError.includes("缺少微信登录 code"), "生产环境真实微信登录要求小程序 code");
        let prodPhoneError = "";
        try {
          await request(blockedBaseUrl, "/api/user/bind-phone", { method: "POST", body: { userId: "user_demo", phone: "13600000000" } });
        } catch (error) {
          prodPhoneError = error.message;
        }
        assert(prodPhoneError.includes("缺少微信手机号授权 code"), "生产环境手机号绑定要求微信授权 code");
        await request(blockedBaseUrl, "/api/cart/items", { method: "POST", body: { userId: "user_demo", skuId: "sku_bud", quantity: 1 } });
        const blockedOrder = await request(blockedBaseUrl, "/api/orders", { method: "POST", body: { userId: "user_demo" } });
        let prodPayError = "";
        try {
          await request(blockedBaseUrl, `/api/orders/${blockedOrder.order.orderId}/pay`, { method: "POST" });
        } catch (error) {
          prodPayError = error.message;
        }
        assert(prodPayError.includes("微信支付 JSAPI缺少配置") && prodPayError.includes("WECHAT_MCH_ID"), "生产环境支付缺配置时返回明确环境变量缺口");
        let notifyError = "";
        try {
          await request(blockedBaseUrl, "/api/payments/wechat/notify", { method: "POST", body: { orderId: blockedOrder.order.orderId, amount: blockedOrder.order.amount } });
        } catch (error) {
          notifyError = error.message;
        }
        assert(notifyError.includes("微信支付回调缺少验签请求头"), "微信支付回调未验签时拒绝处理");
        let unauthAdminError = "";
        try {
          await request(blockedBaseUrl, "/api/admin/dashboard");
        } catch (error) {
          unauthAdminError = error.message;
        }
        assert(unauthAdminError.includes("请先登录员工账号"), "生产环境后台接口要求员工会话");
        const staffSession = await request(blockedBaseUrl, "/api/staff/login", { method: "POST", body: { account: "anna", password: "demo" } });
        let forbiddenAdminError = "";
        try {
          await request(blockedBaseUrl, "/api/admin/dashboard", { headers: { "x-staff-session": staffSession.session.sessionId } });
        } catch (error) {
          forbiddenAdminError = error.message;
        }
        assert(forbiddenAdminError.includes("无权限"), "普通员工会话不能访问后台接口");
        const warehouseSession = await request(blockedBaseUrl, "/api/staff/login", { method: "POST", body: { account: "bar", password: "demo" } });
        const warehouseStockRequests = await request(blockedBaseUrl, "/api/admin/stock-requests", { headers: { "x-staff-session": warehouseSession.session.sessionId } });
        assert(Array.isArray(warehouseStockRequests.requests), "库房角色可访问出入库管理接口");
        let forbiddenWarehouseDashboard = "";
        try {
          await request(blockedBaseUrl, "/api/admin/dashboard", { headers: { "x-staff-session": warehouseSession.session.sessionId } });
        } catch (error) {
          forbiddenWarehouseDashboard = error.message;
        }
        assert(forbiddenWarehouseDashboard.includes("无权限"), "库房角色不能访问后台经营看板");
        const adminSession = await request(blockedBaseUrl, "/api/staff/login", { method: "POST", body: { account: "admin", password: "demo" } });
        const authedDashboard = await request(blockedBaseUrl, "/api/admin/dashboard", { headers: { "x-staff-session": adminSession.session.sessionId } });
        assert(typeof authedDashboard.todayRevenue === "number", "管理员会话可访问后台接口");
      } finally {
        await new Promise((resolveClose) => blockedServer.close(resolveClose));
        await rm(blockedDataFile, { force: true });
      }

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const { privateKey: platformPrivateKey, publicKey: platformPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const apiV3Key = "0123456789abcdef0123456789abcdef";
      process.env.WECHAT_APPID = "wx_dryrun_appid";
      process.env.WECHAT_APP_SECRET = "dryrun_secret";
      process.env.WECHAT_MCH_ID = "1900000001";
      process.env.WECHAT_PAY_SERIAL_NO = "DRYRUNSERIAL";
      process.env.WECHAT_PAY_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
      process.env.WECHAT_PAY_API_V3_KEY = apiV3Key;
      process.env.WECHAT_PAY_PLATFORM_CERTIFICATE = platformPublicKey.export({ type: "spki", format: "pem" });
      process.env.WECHAT_PAY_PLATFORM_SERIAL_NO = "PLATFORMSERIAL";
      process.env.WECHAT_PAY_NOTIFY_URL = "https://example.com/api/payments/wechat/notify";
      process.env.WECHAT_LOGIN_DRY_RUN = "true";
      process.env.WECHAT_PHONE_DRY_RUN = "true";
      process.env.WECHAT_QR_DRY_RUN = "true";
      process.env.WECHAT_PAY_DRY_RUN = "true";
      const dryRunDataFile = join(rootDir, "data", "test-store-prod-dryrun.sqlite");
      process.env.DATABASE_URL = `sqlite://${dryRunDataFile}`;
      await rm(dryRunDataFile, { force: true });
      const { server: dryRunServer } = await createApp();
      await new Promise((resolveListen) => dryRunServer.listen(0, resolveListen));
      const dryRunBaseUrl = `http://127.0.0.1:${dryRunServer.address().port}`;
      try {
        const dryRunHealth = await request(dryRunBaseUrl, "/api/health");
        assert(dryRunHealth.runtime.deployment.wechatLoginConfigured === true && dryRunHealth.runtime.deployment.wechatPayConfigured === true, "真实微信登录和支付配置齐全时健康检查通过");
        assert(dryRunHealth.runtime.deployment.wechatLoginDryRun === true && dryRunHealth.runtime.deployment.wechatPhoneDryRun === true && dryRunHealth.runtime.deployment.wechatQrDryRun === true && dryRunHealth.runtime.deployment.wechatPayDryRun === true, "健康检查暴露微信 dry-run 标记");
        const wxUser = await request(dryRunBaseUrl, "/api/wechat/login", { method: "POST", body: { code: "testcode", nickname: "真实微信会员" } });
        assert(wxUser.authProvider === "wechat_jscode2session_dry_run" && wxUser.user.openid === "dry_openid_testcode", "生产环境可通过微信 code 登录创建会员");
        const phoneBoundUser = await request(dryRunBaseUrl, "/api/user/bind-phone", { method: "POST", body: { userId: wxUser.user.userId, code: "phone-code-13512345678" } });
        assert(phoneBoundUser.phoneProvider === "wechat_phone_dry_run" && phoneBoundUser.user.phone === "13512345678", "生产环境可通过微信手机号授权 code 绑定手机号");
        const dryQrAdminSession = await request(dryRunBaseUrl, "/api/staff/login", { method: "POST", body: { account: "admin", password: "demo" } });
        const dryStaffOrderQr = await request(dryRunBaseUrl, "/api/staff/employees/emp_anna/order-qr", { headers: { "x-staff-session": dryQrAdminSession.session.sessionId } });
        assert(dryStaffOrderQr.qr.qrProvider === "wechat_qr_dry_run" && dryStaffOrderQr.qr.miniProgramScene === "employee:emp_anna", "生产沙箱员工点单码返回微信小程序码 dry-run 图片");
        const drySceneScan = await request(dryRunBaseUrl, "/api/scan/employee", { method: "POST", body: { userId: wxUser.user.userId, scene: "employee%3Aemp_anna" } });
        assert(drySceneScan.employee.employeeId === "emp_anna" && drySceneScan.record.rawCode === "employee:emp_anna", "客户通过小程序码 scene 自动归属员工");
        const dryPointsQr = await request(dryRunBaseUrl, "/api/verification-codes", { method: "POST", body: { userId: "user_demo", type: "points", pointsAmount: 1 } });
        assert(dryPointsQr.code.qrProvider === "wechat_qr_dry_run" && dryPointsQr.code.miniProgramPage === "pages/staff/staff" && dryPointsQr.code.miniProgramScene === dryPointsQr.code.qrPayload, "生产沙箱积分核销码返回员工端小程序码 dry-run 图片");
        const dryScannedPointsQr = await request(dryRunBaseUrl, "/api/staff/verification-codes/scan", { method: "POST", headers: { "x-staff-session": dryQrAdminSession.session.sessionId }, body: { operatorId: "emp_anna", qrPayload: dryPointsQr.code.miniProgramScene } });
        assert(dryScannedPointsQr.code.codeId === dryPointsQr.code.codeId, "员工端可从小程序码 scene 识别积分核销码");
        const dryProductsBefore = await request(dryRunBaseUrl, "/api/products");
        const dryBudBefore = dryProductsBefore.products.find((item) => item.skuId === "sku_bud");
        await request(dryRunBaseUrl, "/api/cart/items", { method: "POST", body: { userId: wxUser.user.userId, skuId: "sku_bud", quantity: 1 } });
        const dryOrder = await request(dryRunBaseUrl, "/api/orders", { method: "POST", body: { userId: wxUser.user.userId } });
        const prepay = await request(dryRunBaseUrl, `/api/orders/${dryOrder.order.orderId}/pay`, { method: "POST" });
        assert(prepay.paymentProvider === "wechat_pay_dry_run" && prepay.payment.status === "prepay_created", "配置齐全时生产支付生成微信 JSAPI 预支付记录");
        assert(prepay.prepay.package.startsWith("prepay_id=") && prepay.prepay.signType === "RSA" && prepay.prepay.paySign, "生产支付返回小程序 requestPayment 参数");
        assert(prepay.order.payStatus === "unpaid", "微信预支付不会提前标记订单已支付");
        const dryProductsAfterPrepay = await request(dryRunBaseUrl, "/api/products");
        assert(dryProductsAfterPrepay.products.find((item) => item.skuId === "sku_bud").stockQty === dryBudBefore.stockQty, "微信预支付不会提前扣减库存");
        const dryNotifyByFlag = await request(dryRunBaseUrl, "/api/payments/wechat/notify", {
          method: "POST",
          body: { signatureVerified: true, orderId: dryOrder.order.orderId, amount: dryOrder.order.amount, transactionId: "wx_dryrun_tx" },
        });
        assert(dryNotifyByFlag.order.payStatus === "paid" && dryNotifyByFlag.payment.notifyVerifiedBy === "trusted_test_flag", "dry-run 允许测试标记确认微信支付回调");
        const dryProductsAfterNotifyByFlag = await request(dryRunBaseUrl, "/api/products");
        assert(dryProductsAfterNotifyByFlag.products.find((item) => item.skuId === "sku_bud").stockQty === dryBudBefore.stockQty - 1, "dry-run 支付回调确认后扣减库存");

        delete process.env.WECHAT_PAY_DRY_RUN;
        await request(dryRunBaseUrl, "/api/cart/items", { method: "POST", body: { userId: wxUser.user.userId, skuId: "sku_bud", quantity: 1 } });
        const signedOrder = await request(dryRunBaseUrl, "/api/orders", { method: "POST", body: { userId: wxUser.user.userId } });
        let unverifiedNotifyError = "";
        try {
          await request(dryRunBaseUrl, "/api/payments/wechat/notify", {
            method: "POST",
            body: { signatureVerified: true, orderId: signedOrder.order.orderId, amount: signedOrder.order.amount, transactionId: "wx_unverified_tx" },
          });
        } catch (error) {
          unverifiedNotifyError = error.message;
        }
        assert(unverifiedNotifyError.includes("微信支付回调缺少验签请求头"), "生产环境不允许 signatureVerified 绕过微信支付回调验签");
        const notifyBody = {
          id: "notify_test",
          create_time: new Date().toISOString(),
          event_type: "TRANSACTION.SUCCESS",
          resource_type: "encrypt-resource",
          summary: "支付成功",
          resource: encryptWechatPayResource(apiV3Key, {
            out_trade_no: signedOrder.order.orderId,
            transaction_id: "wx_signed_tx",
            trade_state: "SUCCESS",
            amount: { total: Math.round(signedOrder.order.amount * 100), currency: "CNY" },
          }),
        };
        const rawNotifyBody = JSON.stringify(notifyBody);
        const notifyTimestamp = Math.floor(Date.now() / 1000).toString();
        const notifyNonce = "notify-nonce";
        const dryNotify = await request(dryRunBaseUrl, "/api/payments/wechat/notify", {
          method: "POST",
          rawBody: rawNotifyBody,
          headers: {
            "wechatpay-timestamp": notifyTimestamp,
            "wechatpay-nonce": notifyNonce,
            "wechatpay-serial": "PLATFORMSERIAL",
            "wechatpay-signature": signWechatPayBody(platformPrivateKey, notifyTimestamp, notifyNonce, rawNotifyBody),
          },
        });
        assert(dryNotify.order.payStatus === "paid" && dryNotify.payment.status === "paid", "微信支付回调确认后订单进入已支付");
        assert(dryNotify.payment.wxTransactionId === "wx_signed_tx" && dryNotify.payment.notifyVerifiedBy === "wechat_pay_v3", "微信支付回调通过平台证书验签和资源解密");

        delete process.env.WECHAT_LOGIN_DRY_RUN;
        delete process.env.WECHAT_PHONE_DRY_RUN;
        delete process.env.WECHAT_QR_DRY_RUN;
        const productionReadyHealth = await request(dryRunBaseUrl, "/api/health");
        assert(productionReadyHealth.runtime.deployment.productionReady === true && productionReadyHealth.runtime.deployment.productionBlockers.length === 0, "生产配置齐全且 dry-run 关闭时健康检查就绪");
        process.env.WECHAT_LOGIN_DRY_RUN = "true";
        process.env.WECHAT_PHONE_DRY_RUN = "true";
        process.env.WECHAT_QR_DRY_RUN = "true";
        process.env.WECHAT_PAY_DRY_RUN = "true";
        const dryAdminSession = await request(dryRunBaseUrl, "/api/staff/login", { method: "POST", body: { account: "admin", password: "demo" } });
        const dryAdminHeaders = { "x-staff-session": dryAdminSession.session.sessionId };
        const refundProductsBefore = await request(dryRunBaseUrl, "/api/products");
        const refundBudBefore = refundProductsBefore.products.find((item) => item.skuId === "sku_bud");
        const refundRequest = await request(dryRunBaseUrl, `/api/admin/orders/${signedOrder.order.orderId}/refund`, {
          method: "POST",
          headers: dryAdminHeaders,
          body: { operatorId: "emp_admin", reason: "生产 dry-run 退款" },
        });
        assert(refundRequest.refundProvider === "wechat_refund_dry_run" && refundRequest.refund.status === "processing", "生产环境配置齐全时创建微信退款申请");
        assert(refundRequest.order.payStatus === "paid", "微信退款申请中不会提前标记订单已退款");
        const refundProductsAfterRequest = await request(dryRunBaseUrl, "/api/products");
        assert(refundProductsAfterRequest.products.find((item) => item.skuId === "sku_bud").stockQty === refundBudBefore.stockQty, "微信退款申请中不会提前恢复库存");
        const refundConfirmed = await request(dryRunBaseUrl, `/api/admin/refunds/${refundRequest.refund.refundId}/confirm`, {
          method: "POST",
          headers: dryAdminHeaders,
          body: { operatorId: "emp_admin", confirmedByWechat: true, wxRefundId: "wx_refund_dryrun" },
        });
        assert(refundConfirmed.order.payStatus === "refunded" && refundConfirmed.refund.status === "refunded", "微信退款确认后订单进入已退款");
        const refundProductsAfterConfirm = await request(dryRunBaseUrl, "/api/products");
        assert(refundProductsAfterConfirm.products.find((item) => item.skuId === "sku_bud").stockQty === refundBudBefore.stockQty + 1, "微信退款确认后恢复库存");
      } finally {
        await new Promise((resolveClose) => dryRunServer.close(resolveClose));
        await rm(dryRunDataFile, { force: true });
      }
    } finally {
      for (const [key, value] of Object.entries(envSnapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const legacyDataFile = join(rootDir, "data", "legacy-password-store.json");
    try {
      const legacyData = JSON.parse(JSON.stringify(store.data));
      legacyData.employees = [{ ...store.data.employees[0], employeeId: "emp_file_legacy", loginAccount: "filelegacy", passwordHash: "file-pass" }];
      await writeFile(legacyDataFile, JSON.stringify(legacyData, null, 2), "utf8");
      const { store: legacyStore } = await createApp({ dataFile: legacyDataFile });
      const persistedLegacyData = JSON.parse(await readFile(legacyDataFile, "utf8"));
      assert(legacyStore.data.employees[0].passwordHash.startsWith("scrypt$") && persistedLegacyData.employees[0].passwordHash.startsWith("scrypt$"), "加载旧明文员工密码文件后自动迁移并写回磁盘");
    } finally {
      await rm(legacyDataFile, { force: true });
    }

    console.log(`Selftest passed: ${checks.length} checks`);
    for (const check of checks) console.log(`- ${check}`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(dataFile, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
