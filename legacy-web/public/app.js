const state = {
  bootstrap: null,
  products: [],
  categories: [],
  cart: null,
  cartItems: [],
  currentOrder: null,
  selectedEmployeeId: "emp_anna",
  selectedStaffId: "emp_anna",
  latestGameId: null,
};

const $ = (selector) => document.querySelector(selector);
const fmt = (value) => `¥${Number(value || 0).toFixed(0)}`;

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function statusLabel(status) {
  const map = {
    unpaid: "待支付",
    pending: "待处理",
    completed: "已完成",
    refunded: "已退款",
    closed: "已关闭",
    available: "可取",
    empty: "已取完",
    expired: "已过期",
    pending_confirm: "待确认",
    confirmed: "已确认",
    rejected: "已拒绝",
    reserved: "预订",
    occupied: "占用",
    maintenance: "维护",
  };
  return map[status] || status;
}

function row(title, body, actions = "") {
  return `<article class="list-row"><h3>${title}</h3><div class="muted-text">${body}</div>${actions ? `<div class="list-actions">${actions}</div>` : ""}</article>`;
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function setupNavigation() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active");
      $("#viewTitle").textContent = button.textContent;
    });
  });
  $("#refreshBtn").addEventListener("click", loadAll);
}

function fillEmployees() {
  const staffOptions = state.bootstrap.employees
    .filter((employee) => employee.role !== "admin")
    .map((employee) => `<option value="${employee.employeeId}">${employee.name} · ${employee.role}</option>`)
    .join("");
  $("#customerEmployee").innerHTML = `<option value="">自然订单</option>${staffOptions}`;
  $("#customerEmployee").value = state.selectedEmployeeId;
  $("#staffEmployee").innerHTML = staffOptions;
  $("#staffEmployee").value = state.selectedStaffId;
  $("#customerEmployee").addEventListener("change", async (event) => {
    state.selectedEmployeeId = event.target.value;
    await refreshCart();
  });
  $("#staffEmployee").addEventListener("change", async (event) => {
    state.selectedStaffId = event.target.value;
    await renderStaff();
  });
}

function renderProducts() {
  $("#productList").innerHTML = state.products
    .map((product) => {
      const low = product.stockQty <= product.warningQty;
      return `<article class="product-item">
        <h3>${product.name}</h3>
        <div class="tag-row">
          <span class="tag">${product.spec}</span>
          <span class="tag">${fmt(product.price)}</span>
          <span class="tag ${low ? "danger" : ""}">库存 ${product.stockQty}</span>
        </div>
        <p>${product.description}</p>
        <button class="primary-button" data-add="${product.skuId}" ${product.stockQty <= 0 ? "disabled" : ""}>加入购物车</button>
      </article>`;
    })
    .join("");
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/cart/items", {
          method: "POST",
          body: { userId: "user_demo", employeeId: state.selectedEmployeeId || null, skuId: button.dataset.add, quantity: 1 },
        });
        await refreshCart();
        toast("已加入购物车");
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function refreshCart() {
  const query = new URLSearchParams({ userId: "user_demo" });
  if (state.selectedEmployeeId) query.set("employeeId", state.selectedEmployeeId);
  const data = await api(`/api/cart?${query}`);
  state.cart = data.cart;
  state.cartItems = data.items;
  renderCart();
}

function renderCart() {
  const total = state.cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  $("#cartList").innerHTML =
    state.cartItems.length === 0
      ? row("购物车为空", "选择左侧商品加入购物车。")
      : state.cartItems
          .map((item) =>
            row(
              `${item.product.name} x ${item.quantity}`,
              `${item.product.spec} · ${fmt(item.product.price * item.quantity)} · 当前库存 ${item.product.stockQty}`,
              `<button data-remove="${item.cartItemId}">删除</button>`,
            ),
          )
          .join("") + row("合计", `${fmt(total)}，预计赠送 ${total} 积分`);
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/cart/items/${button.dataset.remove}`, { method: "DELETE" });
      await refreshCart();
    });
  });
}

async function renderCustomerData() {
  const orders = await api("/api/orders?userId=user_demo");
  $("#myOrders").innerHTML = orders.orders.length
    ? orders.orders
        .slice(0, 5)
        .map((order) => row(`${order.orderId}`, `${statusLabel(order.orderStatus)} · ${fmt(order.amount)} · ${order.employee?.name || "自然订单"}`))
        .join("")
    : row("暂无订单", "完成一次模拟支付后会出现订单。");

  const points = await api("/api/points?userId=user_demo");
  $("#myPoints").innerHTML =
    metric("当前积分", points.balance) +
    points.ledgers
      .slice(0, 4)
      .map((item) => row(item.reason, `${item.changeAmount >= 0 ? "+" : ""}${item.changeAmount} · 余额 ${item.balanceAfter}`))
      .join("");

  const storage = await api("/api/storage?userId=user_demo");
  $("#myStorage").innerHTML = storage.storage.length
    ? storage.storage
        .map((item) =>
          row(
            `${item.product.name} · ${item.quantity}${item.product.unit}`,
            `${statusLabel(item.status)} · 到期 ${item.expireAt.slice(0, 10)}`,
            item.status === "available" && item.quantity > 0 ? `<button data-pickup="${item.storageId}">申请取酒</button>` : "",
          ),
        )
        .join("")
    : row("暂无存酒", "支付订单后可由后台转存，或员工手动新增。");

  document.querySelectorAll("[data-pickup]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/storage/${button.dataset.pickup}/pickup-requests`, { method: "POST", body: { quantity: 1 } });
        toast("已提交取酒申请");
        await loadAll();
      } catch (error) {
        toast(error.message);
      }
    });
  });

  const tables = await api("/api/tables");
  $("#tableList").innerHTML = tables.tables
    .map((table) =>
      row(
        `${table.name} · ${table.capacity}人`,
        `${table.type} · ${statusLabel(table.status)}`,
        `<button data-reserve="${table.tableId}">提交预约</button>`,
      ),
    )
    .join("");
  document.querySelectorAll("[data-reserve]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/reservations", {
        method: "POST",
        body: { userId: "user_demo", tableId: button.dataset.reserve, reservationTime: new Date().toISOString(), remark: "客户小程序预约" },
      });
      toast("预约已提交，等待后台确认");
      await loadAll();
    });
  });
}

async function renderStaff() {
  const employee = state.bootstrap.employees.find((item) => item.employeeId === state.selectedStaffId);
  $("#staffQr").innerHTML = `<div><strong>${employee.name} 专属二维码</strong><p class="muted-text">扫码参数：employeeId=${employee.employeeId}</p></div>`;

  const orders = await api(`/api/orders?employeeId=${state.selectedStaffId}`);
  const sales = orders.orders.filter((order) => order.payStatus === "paid").reduce((sum, order) => sum + order.amount, 0);
  $("#staffPerformance").innerHTML = metric("个人销售额", fmt(sales)) + metric("订单数", orders.orders.length);
  $("#staffOrders").innerHTML = orders.orders.length
    ? orders.orders.map((order) => row(`${order.orderId}`, `${statusLabel(order.orderStatus)} · ${fmt(order.amount)}`)).join("")
    : row("暂无个人订单", "客户通过该员工二维码下单后会出现在这里。");

  const adminStorage = await api("/api/admin/customer-storage");
  $("#pickupRequests").innerHTML = adminStorage.pickupRequests.length
    ? adminStorage.pickupRequests
        .map((request) =>
          row(
            `取酒申请 ${request.requestId}`,
            `${statusLabel(request.status)} · 数量 ${request.quantity}`,
            request.status === "pending" ? `<button data-confirm-pickup="${request.requestId}">确认取酒</button><button data-reject-pickup="${request.requestId}">拒绝</button>` : "",
          ),
        )
        .join("")
    : row("暂无取酒申请", "客户从我的存酒发起申请后会显示。");

  document.querySelectorAll("[data-confirm-pickup]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/staff/storage/pickup-requests/${button.dataset.confirmPickup}/confirm`, {
        method: "POST",
        body: { operatorId: state.selectedStaffId },
      });
      toast("已确认取酒并扣减客户存酒");
      await loadAll();
    });
  });
  document.querySelectorAll("[data-reject-pickup]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/staff/storage/pickup-requests/${button.dataset.rejectPickup}/reject`, {
        method: "POST",
        body: { operatorId: state.selectedStaffId, reason: "现场暂不可取" },
      });
      toast("已拒绝取酒申请");
      await loadAll();
    });
  });
}

async function renderAdmin() {
  const dash = await api("/api/admin/dashboard");
  $("#dashboard").innerHTML =
    metric("今日营业额", fmt(dash.todayRevenue)) +
    metric("今日订单数", dash.todayOrderCount) +
    metric("会员数", dash.memberCount) +
    metric("卡座使用率", `${dash.tableUsageRate}%`) +
    metric("低库存 SKU", dash.lowStock.length) +
    metric("待处理订单", dash.pendingOrders.length);

  const orders = await api("/api/admin/orders");
  $("#adminOrders").innerHTML = orders.orders.length
    ? orders.orders
        .map((order) =>
          row(
            `${order.orderId} · ${fmt(order.amount)}`,
            `${statusLabel(order.orderStatus)} · ${order.employee?.name || "自然订单"} · ${order.user?.phone || ""}`,
            `<button data-complete="${order.orderId}">完成</button><button data-refund="${order.orderId}">退款</button><button data-transfer="${order.orderId}">转存威士忌</button>`,
          ),
        )
        .join("")
    : row("暂无订单", "客户支付后订单会显示在这里。");

  document.querySelectorAll("[data-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${button.dataset.complete}/complete`, { method: "PATCH", body: { reason: "吧台已出品" } });
        toast("订单已完成");
        await loadAll();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  document.querySelectorAll("[data-refund]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${button.dataset.refund}/refund`, { method: "POST", body: { reason: "后台测试退款" } });
        toast("已退款，库存和积分已回滚");
        await loadAll();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  document.querySelectorAll("[data-transfer]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${button.dataset.transfer}/transfer-storage`, {
          method: "POST",
          body: { skuId: "sku_whisky", quantity: 1 },
        });
        toast("已生成客户存酒记录");
        await loadAll();
      } catch (error) {
        toast(error.message);
      }
    });
  });

  const products = await api("/api/admin/products");
  $("#adminProducts").innerHTML = products.products
    .map((product) =>
      row(
        `${product.name} · ${product.spec}`,
        `${fmt(product.price)} · 库存 ${product.stockQty} · 预警 ${product.warningQty}`,
        `<button data-stock="${product.skuId}" data-current="${product.stockQty}">库存 +10</button>`,
      ),
    )
    .join("");
  document.querySelectorAll("[data-stock]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/admin/stock/adjust", {
        method: "POST",
        body: { skuId: button.dataset.stock, targetQty: Number(button.dataset.current) + 10, reason: "后台快速补货" },
      });
      toast("库存已调整并写入流水");
      await loadAll();
    });
  });

  const storage = await api("/api/admin/customer-storage");
  $("#adminStorage").innerHTML = storage.storage
    .slice(0, 6)
    .map((item) => row(`${item.user.phone} · ${item.product.name}`, `${statusLabel(item.status)} · 数量 ${item.quantity} · 到期 ${item.expireAt.slice(0, 10)}`))
    .join("");

  const reservations = await api("/api/admin/reservations");
  $("#adminReservations").innerHTML = reservations.reservations.length
    ? reservations.reservations
        .map((item) =>
          row(
            `${item.table.name} · ${item.user.phone}`,
            `${statusLabel(item.status)} · ${item.reservationTime.slice(0, 16)}`,
            item.status === "pending" ? `<button data-confirm-reservation="${item.reservationId}">确认预约</button>` : "",
          ),
        )
        .join("")
    : row("暂无预约", "客户提交桌位预约后会显示。");
  document.querySelectorAll("[data-confirm-reservation]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/reservations/${button.dataset.confirmReservation}`, {
        method: "PATCH",
        body: { status: "confirmed", reason: "后台确认预约" },
      });
      toast("预约已确认，桌位变为预订");
      await loadAll();
    });
  });

  const logs = await api("/api/admin/operation-logs");
  $("#operationLogs").innerHTML = logs.logs.slice(0, 10).map((log) => row(log.action, `${log.role} · ${log.reason} · ${log.createdAt.slice(0, 19)}`)).join("");
}

async function renderDealer() {
  const games = await api("/api/staff/blind-games");
  const game = games.games[0];
  if (!game) {
    $("#blindGame").innerHTML = row("暂无游戏", "创建一局后可操作升盲、淘汰和代入。");
    return;
  }
  state.latestGameId = game.gameId;
  const headsUp = game.currentPlayers === 2 ? " · 单挑阶段" : "";
  $("#blindGame").innerHTML = row(
    `Level ${game.level} · ${game.smallBlind}/${game.bigBlind}`,
    `${statusLabel(game.status)} · 剩余 ${game.currentPlayers}/${game.initialPlayers} 人${headsUp} · 代入 ${game.buyinCount} 手 · 总代入 ${fmt(game.buyinCount * game.buyinAmount)}`,
    `<button data-game-action="pause">暂停</button><button data-game-action="resume">继续</button><button data-game-action="next_level">升盲</button><button data-game-action="prev_level">降盲</button><button data-game-action="eliminate">淘汰</button><button data-game-action="restore">恢复</button><button data-game-action="buyin">+1手</button><button data-game-action="reset">重开</button>`,
  );
  document.querySelectorAll("[data-game-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/staff/blind-games/${state.latestGameId}`, {
        method: "PATCH",
        body: { action: button.dataset.gameAction, operatorId: "emp_dealer" },
      });
      await renderDealer();
    });
  });
}

async function loadAll() {
  state.bootstrap = await api("/api/bootstrap");
  const products = await api("/api/products");
  const categories = await api("/api/products/categories");
  state.products = products.products;
  state.categories = categories.categories;
  fillEmployees();
  renderProducts();
  await refreshCart();
  $("#storageSku").innerHTML = state.products.map((product) => `<option value="${product.skuId}">${product.name}</option>`).join("");
  await renderCustomerData();
  await renderStaff();
  await renderAdmin();
  await renderDealer();
}

function setupActions() {
  $("#createOrderBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/orders", { method: "POST", body: { userId: "user_demo" } });
      state.currentOrder = data.order;
      $("#payOrderBtn").disabled = false;
      $("#customerResult").textContent = `订单已创建：${data.order.orderId}，金额 ${fmt(data.order.amount)}。`;
      await refreshCart();
      await renderCustomerData();
      toast("订单已创建");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#payOrderBtn").addEventListener("click", async () => {
    if (!state.currentOrder) return;
    try {
      const data = await api(`/api/orders/${state.currentOrder.orderId}/pay`, { method: "POST" });
      state.currentOrder = data.order;
      $("#payOrderBtn").disabled = true;
      $("#customerResult").textContent = `支付成功：库存已扣减，积分 +${data.order.pointsAwarded}，归属 ${data.order.employee?.name || "自然订单"}。`;
      await loadAll();
      toast("模拟微信支付成功");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#addStorageBtn").addEventListener("click", async () => {
    try {
      await api("/api/staff/storage", {
        method: "POST",
        body: {
          operatorId: state.selectedStaffId,
          phone: $("#storagePhone").value,
          skuId: $("#storageSku").value,
          quantity: Number($("#storageQty").value),
          agreementAccepted: true,
          reason: "员工端新增存酒",
        },
      });
      toast("已新增客户存酒");
      await loadAll();
    } catch (error) {
      toast(error.message);
    }
  });

  $("#adjustPointsBtn").addEventListener("click", async () => {
    try {
      await api("/api/staff/points/adjust", {
        method: "POST",
        body: { operatorId: state.selectedStaffId, userId: "user_demo", amount: Number($("#pointAmount").value), reason: $("#pointReason").value },
      });
      toast("积分已调整并写入流水");
      await loadAll();
    } catch (error) {
      toast(error.message);
    }
  });

  $("#createGameBtn").addEventListener("click", async () => {
    await api("/api/staff/blind-games", {
      method: "POST",
      body: {
        operatorId: "emp_dealer",
        smallBlind: Number($("#smallBlind").value),
        bigBlind: Number($("#bigBlind").value),
        intervalMinutes: Number($("#intervalMinutes").value),
        initialPlayers: Number($("#initialPlayers").value),
        buyinAmount: Number($("#buyinAmount").value),
      },
    });
    toast("升盲游戏已开始");
    await renderDealer();
  });
}

setupNavigation();
setupActions();
loadAll().catch((error) => toast(error.message));
