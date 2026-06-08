import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApp } from "../src/server.mjs";

const rootDir = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dataFile = join(rootDir, "data", "test-store.json");

const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

async function request(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error || res.statusText}`);
  return data;
}

async function main() {
  await rm(dataFile, { force: true });
  const { server } = await createApp({ dataFile });
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const boot = await request(baseUrl, "/api/bootstrap");
    assert(boot.user.phone === "13800000000", "微信登录种子会员存在");

    const staffLogin = await request(baseUrl, "/api/staff/login", { method: "POST", body: { account: "anna", password: "demo" } });
    assert(staffLogin.employee.employeeId === "emp_anna" && staffLogin.session.sessionId, "员工可用账号密码登录");

    const productsBefore = await request(baseUrl, "/api/products");
    const bud = productsBefore.products.find((item) => item.skuId === "sku_bud");
    const whisky = productsBefore.products.find((item) => item.skuId === "sku_whisky");
    assert(bud.stockQty === 60, "初始 SKU 库存正确");

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
    assert(orderData.order.amount === bud.price * 2 + whisky.price, "订单金额按购物车明细计算");

    const paid = await request(baseUrl, `/api/orders/${orderData.order.orderId}/pay`, { method: "POST" });
    assert(paid.order.payStatus === "paid" && paid.order.orderStatus === "pending", "模拟微信支付后订单进入待处理");
    assert(paid.order.pointsAwarded === paid.order.amount, "支付后按每元一积分赠送");

    const productsAfterPay = await request(baseUrl, "/api/products");
    const budAfterPay = productsAfterPay.products.find((item) => item.skuId === "sku_bud");
    const whiskyAfterPay = productsAfterPay.products.find((item) => item.skuId === "sku_whisky");
    assert(budAfterPay.stockQty === bud.stockQty - 2, "支付后啤酒库存扣减");
    assert(whiskyAfterPay.stockQty === whisky.stockQty - 1, "支付后威士忌库存扣减");

    const pointsAfterPay = await request(baseUrl, "/api/points?userId=user_demo");
    assert(pointsAfterPay.balance === 120 + paid.order.pointsAwarded, "支付后客户积分余额增加");

    const dashboard = await request(baseUrl, "/api/admin/dashboard");
    assert(dashboard.todayOrderCount >= 1 && dashboard.todayRevenue >= paid.order.amount, "后台看板统计订单和营收");
    assert(dashboard.staffSales.some((item) => item.employeeId === "emp_anna" && item.sales >= paid.order.amount), "后台员工业绩统计正确");

    const transfer = await request(baseUrl, `/api/admin/orders/${orderData.order.orderId}/transfer-storage`, {
      method: "POST",
      body: { skuId: "sku_whisky", quantity: 1, operatorId: "emp_admin" },
    });
    assert(transfer.storage.quantity === 1 && transfer.storage.status === "available", "订单转存生成客户存酒");

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

    const reservation = await request(baseUrl, "/api/reservations", {
      method: "POST",
      body: { userId: "user_demo", tableId: "table_a1", reservationTime: new Date().toISOString() },
    });
    assert(reservation.reservation.status === "pending", "客户可提交桌位预约");
    const confirmedReservation = await request(baseUrl, `/api/admin/reservations/${reservation.reservation.reservationId}`, {
      method: "PATCH",
      body: { status: "confirmed", operatorId: "emp_admin" },
    });
    assert(confirmedReservation.reservation.status === "confirmed", "后台可确认预约");
    assert(confirmedReservation.table.status === "reserved", "确认预约后桌位变为预订");
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

    const refunded = await request(baseUrl, `/api/admin/orders/${orderData.order.orderId}/refund`, {
      method: "POST",
      body: { operatorId: "emp_admin", reason: "自验收退款" },
    });
    assert(refunded.order.payStatus === "refunded" && refunded.order.orderStatus === "refunded", "管理员可退款");
    const productsAfterRefund = await request(baseUrl, "/api/products");
    assert(productsAfterRefund.products.find((item) => item.skuId === "sku_bud").stockQty === bud.stockQty, "退款后啤酒库存恢复");
    assert(productsAfterRefund.products.find((item) => item.skuId === "sku_whisky").stockQty === whisky.stockQty, "退款后威士忌库存恢复");
    const pointsAfterRefund = await request(baseUrl, "/api/points?userId=user_demo");
    assert(pointsAfterRefund.balance === 120, "退款后积分扣回");

    const logs = await request(baseUrl, "/api/admin/operation-logs");
    assert(logs.logs.length >= 8, "关键业务操作写入操作日志");

    const profile = await request(baseUrl, "/api/user/profile?userId=user_demo");
    assert(profile.user.phone === "13800000000" && profile.level.name, "个人中心聚合会员与等级");

    const leaderboard = await request(baseUrl, "/api/leaderboard/points?userId=user_demo");
    assert(leaderboard.top10.length >= 1 && leaderboard.mine.userId === "user_demo", "积分排行榜返回Top10和个人排行");

    const checkin = await request(baseUrl, "/api/checkin", { method: "POST", body: { userId: "user_demo" } });
    assert(checkin.record.points === 10, "签到送积分");
    let duplicateCheckin = "";
    try {
      await request(baseUrl, "/api/checkin", { method: "POST", body: { userId: "user_demo" } });
    } catch (error) {
      duplicateCheckin = error.message;
    }
    assert(duplicateCheckin.includes("今日已签到"), "同日重复签到被拦截");

    const rechargeConfig = await request(baseUrl, "/api/admin/recharge-configs", { method: "POST", body: { amount: 300, giftAmount: 30 } });
    const recharge = await request(baseUrl, "/api/recharge", { method: "POST", body: { userId: "user_demo", configId: rechargeConfig.config.configId } });
    assert(recharge.user.balance === 330, "客户充值后余额增加含赠送金额");
    const rechargeRecords = await request(baseUrl, "/api/recharge-records?userId=user_demo");
    assert(rechargeRecords.records.length === 1, "充值记录可查询");
    assert(rechargeRecords.configs.some((config) => config.configId === rechargeConfig.config.configId), "充值中心返回可选配置");

    const exchangedCoupons = await request(baseUrl, "/api/coupons/exchange", { method: "POST", body: { userId: "user_demo", count: 1, skuId: "sku_bud" } });
    assert(exchangedCoupons.coupons.length === 1 && exchangedCoupons.costPoints === 100, "客户可用积分兑换酒水券");

    const couponsBefore = await request(baseUrl, "/api/coupons?userId=user_demo");
    const coupon = couponsBefore.coupons.find((item) => item.status === "available");
    const couponRequest = await request(baseUrl, `/api/coupons/${coupon.couponId}/redeem-request`, { method: "POST", body: { userId: "user_demo" } });
    assert(couponRequest.coupon.status === "pending", "客户可发起酒水券兑换");
    const couponConfirm = await request(baseUrl, `/api/staff/coupons/${coupon.couponId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } });
    assert(couponConfirm.coupon.status === "completed", "员工可确认酒水券兑换");

    const lottery = await request(baseUrl, "/api/lottery/draw", { method: "POST", body: { userId: "user_demo" } });
    assert(lottery.record.status === "won" && lottery.record.costPoints === 20, "积分抽奖扣积分并生成中奖记录");
    const lotteryRedeemRequest = await request(baseUrl, `/api/lottery/records/${lottery.record.recordId}/redeem-request`, { method: "POST", body: { userId: "user_demo" } });
    assert(lotteryRedeemRequest.record.status === "redeeming", "客户可申请中奖记录核销");
    const lotteryRedeemConfirm = await request(baseUrl, `/api/staff/lottery-records/${lottery.record.recordId}/confirm`, { method: "POST", body: { operatorId: "emp_anna" } });
    assert(lotteryRedeemConfirm.record.status === "completed" && lotteryRedeemConfirm.record.redeemedBy === "emp_anna", "员工可确认核销中奖记录");
    const lotteryOverview = await request(baseUrl, "/api/admin/lottery/overview");
    assert(lotteryOverview.totalDraws >= 1 && lotteryOverview.todayCostPoints >= 20, "后台抽奖概况更新");

    const finance = await request(baseUrl, "/api/admin/finance/overview");
    assert(typeof finance.todayRevenue === "number" && Array.isArray(finance.trend), "财务概览返回营收和趋势");
    const businessDetails = await request(baseUrl, "/api/admin/business-details");
    assert(Array.isArray(businessDetails.details), "营业明细可查询");
    const consumptionRecords = await request(baseUrl, "/api/admin/consumption-records?userId=user_demo");
    assert(Array.isArray(consumptionRecords.records), "会员消费记录可查询");

    const level = await request(baseUrl, "/api/admin/member-levels", { method: "POST", body: { name: "黑金会员", minPoints: 2000 } });
    assert(level.level.name === "黑金会员", "后台可新增会员等级");

    const category = await request(baseUrl, "/api/admin/categories", { method: "POST", body: { name: "软饮", sortOrder: 4 } });
    assert(category.category.name === "软饮", "后台可新增商品分类");
    const product = await request(baseUrl, "/api/admin/products", {
      method: "POST",
      body: { categoryId: category.category.categoryId, name: "苏打水", spec: "330ml", unit: "瓶", price: 18, stockQty: 6, warningQty: 2, storageDays: 0 },
    });
    assert(product.product.name === "苏打水" && product.product.stockQty === 6, "后台可新增 SKU");
    const filteredProducts = await request(baseUrl, `/api/products?categoryId=${category.category.categoryId}&keyword=${encodeURIComponent("苏打")}`);
    assert(filteredProducts.products.length === 1 && filteredProducts.products[0].skuId === product.product.skuId, "商品列表支持分类与关键词筛选");
    const stockInRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "in", quantity: 4, operatorId: "emp_admin" } });
    assert(stockInRequest.request.status === "pending" && stockInRequest.request.direction === "in", "后台可提交入库申请");
    const stockInConfirm = await request(baseUrl, `/api/admin/stock-requests/${stockInRequest.request.requestId}/confirm`, { method: "POST", body: { operatorId: "emp_admin" } });
    assert(stockInConfirm.product.stockQty === 10 && stockInConfirm.request.status === "completed", "确认入库后写入库存账");
    const stockOutRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "out", quantity: 2, operatorId: "emp_admin" } });
    const stockOutConfirm = await request(baseUrl, `/api/admin/stock-requests/${stockOutRequest.request.requestId}/confirm`, { method: "POST", body: { operatorId: "emp_admin" } });
    assert(stockOutConfirm.product.stockQty === 8 && stockOutConfirm.ledger.changeType === "stock_out", "确认出库后写入库存账");
    const rejectRequest = await request(baseUrl, "/api/admin/stock-requests", { method: "POST", body: { skuId: product.product.skuId, direction: "in", quantity: 1, operatorId: "emp_admin" } });
    const rejectedRequest = await request(baseUrl, `/api/admin/stock-requests/${rejectRequest.request.requestId}/reject`, { method: "POST", body: { operatorId: "emp_admin", reason: "单据错误" } });
    assert(rejectedRequest.request.status === "rejected", "出入库申请可驳回");

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

    const employee = await request(baseUrl, "/api/admin/employees", { method: "POST", body: { name: "新员工", phone: "13900009999", role: "staff" } });
    assert(employee.employee.status === "active", "后台可新增工作人员");
    const disabledEmployee = await request(baseUrl, `/api/admin/employees/${employee.employee.employeeId}`, { method: "PATCH", body: { status: "disabled", resetPassword: "123456" } });
    assert(disabledEmployee.employee.status === "disabled" && disabledEmployee.employee.passwordHash === "123456", "后台可禁用员工并重置密码");
    const password = await request(baseUrl, "/api/staff/password", { method: "POST", body: { operatorId: "emp_anna", newPassword: "new-demo" } });
    assert(password.employee.passwordHash === "new-demo", "员工可修改密码");

    const verifyCode = await request(baseUrl, "/api/staff/verify-code", { method: "POST", body: { userId: "user_demo" } });
    assert(verifyCode.pointsBalance >= 0 && Array.isArray(verifyCode.coupons), "员工核销码可查询客户积分存酒券");

    const scan = await request(baseUrl, "/api/scan/employee", { method: "POST", body: { userId: "user_demo", employeeId: "emp_anna", rawCode: "employee:emp_anna" } });
    assert(scan.employee.employeeId === "emp_anna" && scan.record.scene === "employee_qr", "客户扫码员工二维码生成归属记录");
    const scanRecords = await request(baseUrl, "/api/admin/scan-records");
    assert(scanRecords.records.some((record) => record.employeeId === "emp_anna"), "后台可查看扫码归属记录");

    const seatSit = await request(baseUrl, "/api/staff/seats/3/sit", { method: "POST", body: { userId: "user_demo", operatorId: "emp_anna" } });
    assert(seatSit.seat.status === "occupied", "员工可确认座位入座");
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

    const blindSettings = await request(baseUrl, "/api/admin/blind-settings", { method: "PATCH", body: { theme: "neon", fontSize: 56, registrationStatus: "stopped" } });
    assert(blindSettings.settings.theme === "neon" && blindSettings.settings.registrationStatus === "stopped", "后台可配置升盲样式和报名状态");

    const systemSettings = await request(baseUrl, "/api/admin/system-settings", { method: "PATCH", body: { pointsVisible: false, supportPhone: "400-000-0000" } });
    assert(systemSettings.settings.pointsVisible === false && systemSettings.settings.supportPhone === "400-000-0000", "后台可配置系统设置");

    const location = await request(baseUrl, "/api/store/location");
    assert(location.location.address.includes("上海"), "门店位置可查询");
    const support = await request(baseUrl, "/api/support/contact");
    assert(support.phone === "400-000-0000", "客服电话可查询");

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
