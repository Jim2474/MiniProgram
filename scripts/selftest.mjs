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
