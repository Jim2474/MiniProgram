import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = resolve(rootDir, "..", "legacy-web", "public");
const dataDir = join(rootDir, "data");
const defaultDataFile = join(dataDir, "store.json");

const now = () => new Date().toISOString();
const dayKey = () => new Date().toISOString().slice(0, 10);
const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const idCounters = {};
function newId(prefix) {
  idCounters[prefix] = (idCounters[prefix] || 0) + 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounters[prefix].toString(36)}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedData() {
  const merchantId = "merchant_demo";
  const storeId = "store_demo";
  const createdAt = now();
  return {
    meta: { version: 1, seededAt: createdAt },
    settings: {
      merchantId,
      storeId,
      pointRate: 1,
      orderTimeoutMinutes: 15,
      staffPointLimit: 200,
      storageAgreement: "客户确认酒水寄存在本店，需在有效期内申请取酒；过期后由管理员人工处理。",
      pointsVisible: true,
      checkinEnabled: true,
      checkinPoints: 10,
      pointExpireDays: 365,
      couponExchangePoints: 100,
      supportPhone: "021-88886666",
      location: { latitude: 31.2304, longitude: 121.4737, address: "上海市静安区示例路 88 号" },
    },
    merchants: [{ merchantId, name: "河岸德扑酒馆", status: "active", createdAt }],
    stores: [
      {
        storeId,
        merchantId,
        name: "河岸德扑酒馆",
        address: "上海市静安区示例路 88 号",
        phone: "021-88886666",
        logoUrl: "",
        status: "active",
      },
    ],
    users: [
      {
        userId: "user_demo",
        merchantId,
        storeId,
        openid: "openid_demo",
        nickname: "示例客户",
        avatar: "",
        phone: "13800000000",
        pointsBalance: 120,
        balance: 0,
        memberLevel: "普通会员",
        createdAt,
      },
    ],
    employees: [
      {
        employeeId: "emp_anna",
        merchantId,
        storeId,
        name: "安娜",
        phone: "13900000001",
        role: "staff",
        loginAccount: "anna",
        passwordHash: "demo",
        status: "active",
        createdAt,
      },
      {
        employeeId: "emp_bar",
        merchantId,
        storeId,
        name: "吧台",
        phone: "13900000002",
        role: "warehouse",
        loginAccount: "bar",
        passwordHash: "demo",
        status: "active",
        createdAt,
      },
      {
        employeeId: "emp_admin",
        merchantId,
        storeId,
        name: "老板",
        phone: "13900000003",
        role: "admin",
        loginAccount: "admin",
        passwordHash: "demo",
        status: "active",
        createdAt,
      },
      {
        employeeId: "emp_dealer",
        merchantId,
        storeId,
        name: "荷官",
        phone: "13900000004",
        role: "dealer",
        loginAccount: "dealer",
        passwordHash: "demo",
        status: "active",
        createdAt,
      },
    ],
    categories: [
      { categoryId: "cat_beer", merchantId, storeId, name: "啤酒", sortOrder: 1, status: "active" },
      { categoryId: "cat_spirit", merchantId, storeId, name: "洋酒", sortOrder: 2, status: "active" },
      { categoryId: "cat_snack", merchantId, storeId, name: "小吃", sortOrder: 3, status: "active" },
    ],
    products: [
      {
        skuId: "sku_bud",
        merchantId,
        storeId,
        categoryId: "cat_beer",
        name: "百威啤酒",
        spec: "330ml 瓶装",
        unit: "瓶",
        price: 28,
        stockQty: 60,
        warningQty: 12,
        status: "active",
        description: "冰镇瓶装啤酒，适合拼桌畅饮。",
        imageUrl: "",
        storageDays: 30,
      },
      {
        skuId: "sku_whisky",
        merchantId,
        storeId,
        categoryId: "cat_spirit",
        name: "单一麦芽威士忌",
        spec: "700ml",
        unit: "瓶",
        price: 588,
        stockQty: 8,
        warningQty: 2,
        status: "active",
        description: "可现场饮用，也可转为客户存酒。",
        imageUrl: "",
        storageDays: 60,
      },
      {
        skuId: "sku_fries",
        merchantId,
        storeId,
        categoryId: "cat_snack",
        name: "薯条拼盘",
        spec: "单份",
        unit: "份",
        price: 38,
        stockQty: 25,
        warningQty: 5,
        status: "active",
        description: "现场现做小吃。",
        imageUrl: "",
        storageDays: 0,
      },
    ],
    carts: [],
    cartItems: [],
    orders: [],
    orderItems: [],
    payments: [],
    refunds: [],
    pointsLedgers: [],
    stockLedgers: [],
    stockRequests: [],
    scanRecords: [],
    customerStorage: [
      {
        storageId: "storage_demo",
        merchantId,
        storeId,
        userId: "user_demo",
        skuId: "sku_whisky",
        quantity: 1,
        expireAt: addDays(45),
        status: "available",
        createdAt,
      },
    ],
    customerStorageLedgers: [],
    storagePickupRequests: [],
    reservations: [],
    tables: [
      {
        tableId: "table_a1",
        merchantId,
        storeId,
        name: "A1 德扑桌",
        type: "普通卡座",
        capacity: 9,
        imageUrl: "",
        status: "available",
      },
      {
        tableId: "table_vip",
        merchantId,
        storeId,
        name: "VIP 房台",
        type: "VIP卡座",
        capacity: 9,
        imageUrl: "",
        status: "reserved",
      },
    ],
    tableTypes: [
      { typeId: "type_normal", name: "普通卡座", capacity: 9, status: "active" },
      { typeId: "type_vip", name: "VIP卡座", capacity: 9, status: "active" },
    ],
    seats: Array.from({ length: 9 }, (_, index) => ({
      seatNo: index + 1,
      status: "available",
      userId: null,
      eliminated: false,
      updatedAt: createdAt,
    })),
    rechargeConfigs: [
      { configId: "recharge_500", amount: 500, giftAmount: 50, status: "active", createdAt },
      { configId: "recharge_1000", amount: 1000, giftAmount: 120, status: "active", createdAt },
    ],
    rechargeRecords: [],
    coupons: [
      {
        couponId: "coupon_demo",
        userId: "user_demo",
        title: "威士忌取酒券",
        skuId: "sku_whisky",
        quantity: 1,
        status: "available",
        createdAt,
      },
    ],
    couponRecords: [],
    checkins: [],
    lotterySettings: { enabled: true, dailyLimit: 3, cooldownMinutes: 0, costPoints: 20 },
    lotteryPrizes: [
      { prizeId: "prize_beer", name: "百威啤酒 1 瓶", winRate: 50, status: "active", createdAt },
      { prizeId: "prize_points", name: "积分 30", winRate: 50, status: "active", createdAt },
    ],
    lotteryRecords: [],
    memberLevels: [
      { levelId: "level_normal", name: "普通会员", minPoints: 0, status: "active" },
      { levelId: "level_gold", name: "黄金会员", minPoints: 500, status: "active" },
      { levelId: "level_vip", name: "VIP会员", minPoints: 1500, status: "active" },
    ],
    blindSettings: {
      theme: "classic",
      backgroundImage: "",
      logo: "",
      fontColor: "#FFFFFF",
      timerColor: "#F8D66D",
      breakColor: "#7DD3FC",
      dialogColor: "#15221B",
      fontSize: 48,
      fontFamily: "system",
      titleMap: {
        level: "LEVEL",
        playerLeft: "PLAYER LEFT",
        entrants: "ENTRANTS",
        prizePlayer: "PRIZE PLAYER",
        blinds: "BLINDS",
        ante: "ANTE",
        nextLevel: "NEXT LEVEL",
        nextBreak: "NEXT BREAK IN",
        avgChips: "AVG CHIPS",
        totalChips: "TOTAL CHIPS",
      },
      showBeijingTime: true,
      showRegistrationCountdown: true,
      autoStartAfterCountdown: false,
      registrationStatus: "accepting",
      championBackgroundImage: "",
      voiceType: "default",
      voiceStartText: "开始提示音",
      voiceEndText: "结束提示音",
      voiceTerms: { smallBlind: "小盲", bigBlind: "大盲", ante: "前注" },
      entrants: 9,
      totalBuyins: 0,
    },
    blindGames: [],
    operationLogs: [],
  };
}

class Store {
  constructor(filePath = defaultDataFile) {
    this.filePath = filePath;
    this.data = null;
  }

  async load() {
    await mkdir(dataDir, { recursive: true });
    if (!existsSync(this.filePath)) {
      this.data = seedData();
      await this.save();
      return this.data;
    }
    this.data = JSON.parse(await readFile(this.filePath, "utf8"));
    this.data.stockRequests ||= [];
    this.data.scanRecords ||= [];
    return this.data;
  }

  async save() {
    await mkdir(dataDir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  log(operatorId, role, action, targetType, targetId, beforeValue, afterValue, reason = "") {
    this.data.operationLogs.unshift({
      logId: newId("log"),
      merchantId: this.data.settings.merchantId,
      storeId: this.data.settings.storeId,
      operatorId,
      role,
      action,
      targetType,
      targetId,
      beforeJson: beforeValue ? JSON.stringify(beforeValue) : "",
      afterJson: afterValue ? JSON.stringify(afterValue) : "",
      reason,
      createdAt: now(),
    });
  }

  getUser(userId = "user_demo") {
    const user = this.data.users.find((item) => item.userId === userId);
    if (!user) throw new HttpError(404, "会员不存在");
    return user;
  }

  getEmployee(employeeId) {
    const employee = this.data.employees.find((item) => item.employeeId === employeeId);
    if (!employee) throw new HttpError(404, "员工不存在");
    return employee;
  }

  getSku(skuId) {
    const sku = this.data.products.find((item) => item.skuId === skuId);
    if (!sku) throw new HttpError(404, "商品不存在");
    return sku;
  }

  getOrder(orderId) {
    const order = this.data.orders.find((item) => item.orderId === orderId);
    if (!order) throw new HttpError(404, "订单不存在");
    return order;
  }

  getStorage(storageId) {
    const storage = this.data.customerStorage.find((item) => item.storageId === storageId);
    if (!storage) throw new HttpError(404, "存酒记录不存在");
    return storage;
  }

  createPointsLedger(user, changeAmount, reason, sourceType, sourceId, operatorId = "system") {
    user.pointsBalance += changeAmount;
    const ledger = {
      ledgerId: newId("points"),
      merchantId: user.merchantId,
      storeId: user.storeId,
      userId: user.userId,
      changeAmount,
      balanceAfter: user.pointsBalance,
      reason,
      sourceType,
      sourceId,
      operatorId,
      createdAt: now(),
    };
    this.data.pointsLedgers.unshift(ledger);
    return ledger;
  }

  createStockLedger(sku, changeQty, changeType, sourceType, sourceId, operatorId, reason) {
    sku.stockQty += changeQty;
    const ledger = {
      ledgerId: newId("stock"),
      merchantId: sku.merchantId,
      storeId: sku.storeId,
      skuId: sku.skuId,
      changeQty,
      stockAfter: sku.stockQty,
      changeType,
      sourceType,
      sourceId,
      operatorId,
      reason,
      createdAt: now(),
    };
    this.data.stockLedgers.unshift(ledger);
    return ledger;
  }

  createStorageLedger(storage, changeQty, actionType, operatorId, reason) {
    storage.quantity += changeQty;
    if (storage.quantity <= 0) {
      storage.quantity = 0;
      storage.status = "empty";
    }
    const ledger = {
      ledgerId: newId("storageLedger"),
      storageId: storage.storageId,
      userId: storage.userId,
      skuId: storage.skuId,
      changeQty,
      quantityAfter: storage.quantity,
      actionType,
      operatorId,
      reason,
      createdAt: now(),
    };
    this.data.customerStorageLedgers.unshift(ledger);
    return ledger;
  }

  findOrCreateCart(userId, employeeId = null) {
    let cart = this.data.carts.find((item) => item.userId === userId && item.status !== "checked_out");
    if (!cart) {
      cart = { cartId: newId("cart"), userId, employeeId, source: employeeId ? "employee_qr" : "natural", status: "open", createdAt: now() };
      this.data.carts.push(cart);
    }
    if (employeeId) {
      cart.employeeId = employeeId;
      cart.source = "employee_qr";
    }
    return cart;
  }
}

function publicOrder(store, order) {
  const items = store.data.orderItems
    .filter((item) => item.orderId === order.orderId)
    .map((item) => ({ ...item, product: store.data.products.find((sku) => sku.skuId === item.skuId) }));
  const employee = order.employeeId ? store.data.employees.find((item) => item.employeeId === order.employeeId) : null;
  const user = store.data.users.find((item) => item.userId === order.userId);
  return { ...order, items, employee, user };
}

function dashboard(store) {
  const today = dayKey();
  const paidOrders = store.data.orders.filter((order) => order.payStatus === "paid");
  const todayOrders = paidOrders.filter((order) => order.paidAt?.startsWith(today));
  const revenue = todayOrders.reduce((sum, order) => sum + order.amount, 0);
  const staffSales = store.data.employees.map((employee) => {
    const orders = paidOrders.filter((order) => order.employeeId === employee.employeeId);
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      role: employee.role,
      orderCount: orders.length,
      sales: orders.reduce((sum, order) => sum + order.amount, 0),
    };
  });
  const occupied = store.data.tables.filter((table) => table.status === "occupied" || table.status === "reserved").length;
  return {
    todayRevenue: revenue,
    todayOrderCount: todayOrders.length,
    memberCount: store.data.users.length,
    tableUsageRate: store.data.tables.length ? Math.round((occupied / store.data.tables.length) * 100) : 0,
    lowStock: store.data.products.filter((sku) => sku.stockQty <= sku.warningQty),
    pendingOrders: store.data.orders.filter((order) => order.orderStatus === "pending"),
    pendingPickupRequests: store.data.storagePickupRequests.filter((request) => request.status === "pending"),
    staffSales: staffSales.sort((a, b) => b.sales - a.sales),
    latestOrders: store.data.orders.slice(-8).reverse().map((order) => publicOrder(store, order)),
  };
}

function calculateMemberLevel(store, user) {
  const levels = [...store.data.memberLevels].filter((level) => level.status === "active").sort((a, b) => b.minPoints - a.minPoints);
  return levels.find((level) => user.pointsBalance >= level.minPoints) || levels[levels.length - 1] || null;
}

function monthKey(dateValue = new Date()) {
  return new Date(dateValue).toISOString().slice(0, 7);
}

function publicCoupon(store, coupon) {
  return {
    ...coupon,
    user: store.data.users.find((user) => user.userId === coupon.userId),
    product: coupon.skuId ? store.data.products.find((sku) => sku.skuId === coupon.skuId) : null,
  };
}

function publicStockRequest(store, request) {
  return {
    ...request,
    product: store.data.products.find((sku) => sku.skuId === request.skuId),
    operator: store.data.employees.find((employee) => employee.employeeId === request.operatorId),
    handledByEmployee: request.handledBy ? store.data.employees.find((employee) => employee.employeeId === request.handledBy) : null,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "请求体不是有效 JSON");
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, { error: error.message || "服务器错误" });
}

function parseUrl(req) {
  const parsed = new URL(req.url, "http://localhost");
  return {
    path: decodeURIComponent(parsed.pathname),
    params: parsed.searchParams,
  };
}

function matchRoute(method, path, pattern) {
  const routeParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < routeParts.length; i += 1) {
    const routePart = routeParts[i];
    const pathPart = pathParts[i];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = pathPart;
    } else if (routePart !== pathPart) {
      return null;
    }
  }
  return params;
}

function createRouter(store) {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  add("GET", "/api/health", async () => ({ ok: true, time: now() }));
  add("GET", "/api/bootstrap", async () => ({
    settings: store.data.settings,
    store: store.data.stores[0],
    user: store.getUser(),
    employees: store.data.employees,
    seats: store.data.seats,
  }));

  add("POST", "/api/wechat/login", async (body) => {
    const phone = body.phone || "13800000000";
    let user = store.data.users.find((item) => item.phone === phone);
    if (!user) {
      user = {
        userId: newId("user"),
        merchantId: store.data.settings.merchantId,
        storeId: store.data.settings.storeId,
        openid: `openid_${phone}`,
        nickname: body.nickname || `客户${phone.slice(-4)}`,
        avatar: "",
        phone,
        pointsBalance: 0,
        createdAt: now(),
      };
      store.data.users.push(user);
      await store.save();
    }
    return { user };
  });

  add("POST", "/api/user/bind-phone", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const before = deepClone(user);
    user.phone = body.phone || user.phone;
    store.log(user.userId, "customer", "bind_phone", "User", user.userId, before, user, "绑定手机号");
    await store.save();
    return { user };
  });

  add("GET", "/api/products/categories", async () => ({ categories: store.data.categories.filter((item) => item.status === "active") }));
  add("GET", "/api/products", async (_body, _params, query) => {
    let products = store.data.products.filter((item) => item.status === "active");
    const categoryId = query.get("categoryId");
    const keyword = query.get("keyword");
    if (categoryId) products = products.filter((item) => item.categoryId === categoryId);
    if (keyword) products = products.filter((item) => `${item.name}${item.spec}${item.description}`.includes(keyword));
    return { products, categories: store.data.categories.filter((item) => item.status === "active") };
  });
  add("GET", "/api/products/:skuId", async (_body, params) => ({ product: store.getSku(params.skuId) }));

  add("GET", "/api/cart", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    const cart = store.findOrCreateCart(userId, query.get("employeeId") || null);
    const items = store.data.cartItems
      .filter((item) => item.cartId === cart.cartId)
      .map((item) => ({ ...item, product: store.getSku(item.skuId) }));
    return { cart, items };
  });

  add("POST", "/api/cart/items", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    if (body.employeeId) store.getEmployee(body.employeeId);
    const sku = store.getSku(body.skuId);
    const quantity = Number(body.quantity || 1);
    if (quantity < 1) throw new HttpError(400, "数量必须大于 0");
    if (sku.status !== "active") throw new HttpError(400, "商品未上架");
    if (sku.stockQty < quantity) throw new HttpError(409, "库存不足");
    const cart = store.findOrCreateCart(user.userId, body.employeeId || null);
    let item = store.data.cartItems.find((candidate) => candidate.cartId === cart.cartId && candidate.skuId === sku.skuId);
    if (item) {
      if (sku.stockQty < item.quantity + quantity) throw new HttpError(409, "库存不足");
      item.quantity += quantity;
    } else {
      item = { cartItemId: newId("cartItem"), cartId: cart.cartId, skuId: sku.skuId, quantity };
      store.data.cartItems.push(item);
    }
    await store.save();
    return { cart, item, product: sku };
  });

  add("PATCH", "/api/cart/items/:itemId", async (body, params) => {
    const item = store.data.cartItems.find((candidate) => candidate.cartItemId === params.itemId);
    if (!item) throw new HttpError(404, "购物车商品不存在");
    const sku = store.getSku(item.skuId);
    const quantity = Number(body.quantity);
    if (quantity < 1) throw new HttpError(400, "数量必须大于 0");
    if (sku.stockQty < quantity) throw new HttpError(409, "库存不足");
    item.quantity = quantity;
    await store.save();
    return { item };
  });

  add("DELETE", "/api/cart/items/:itemId", async (_body, params) => {
    store.data.cartItems = store.data.cartItems.filter((item) => item.cartItemId !== params.itemId);
    await store.save();
    return { ok: true };
  });

  add("POST", "/api/orders", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const cart = store.findOrCreateCart(user.userId, body.employeeId || null);
    const cartItems = store.data.cartItems.filter((item) => item.cartId === cart.cartId);
    if (!cartItems.length) throw new HttpError(400, "购物车为空");
    const items = cartItems.map((item) => ({ cartItem: item, sku: store.getSku(item.skuId) }));
    for (const { cartItem, sku } of items) {
      if (sku.stockQty < cartItem.quantity) throw new HttpError(409, `${sku.name} 库存不足`);
    }
    const amount = items.reduce((sum, { cartItem, sku }) => sum + sku.price * cartItem.quantity, 0);
    const order = {
      orderId: newId("order"),
      merchantId: store.data.settings.merchantId,
      storeId: store.data.settings.storeId,
      userId: user.userId,
      employeeId: cart.employeeId || null,
      source: cart.employeeId ? "employee_qr" : "natural",
      amount,
      payStatus: "unpaid",
      orderStatus: "unpaid",
      pointsAwarded: 0,
      createdAt: now(),
      paidAt: null,
      closedAt: null,
    };
    store.data.orders.push(order);
    for (const { cartItem, sku } of items) {
      store.data.orderItems.push({
        orderItemId: newId("orderItem"),
        orderId: order.orderId,
        skuId: sku.skuId,
        nameSnapshot: sku.name,
        specSnapshot: sku.spec,
        unitSnapshot: sku.unit,
        price: sku.price,
        quantity: cartItem.quantity,
        subtotal: sku.price * cartItem.quantity,
      });
    }
    cart.status = "checked_out";
    store.data.cartItems = store.data.cartItems.filter((item) => item.cartId !== cart.cartId);
    store.log(user.userId, "customer", "create_order", "Order", order.orderId, null, order, "创建订单");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("POST", "/api/orders/:orderId/pay", async (_body, params) => {
    const order = store.getOrder(params.orderId);
    if (order.payStatus === "paid") return { order: publicOrder(store, order), idempotent: true };
    if (order.orderStatus !== "unpaid") throw new HttpError(400, "订单状态不可支付");
    const orderItems = store.data.orderItems.filter((item) => item.orderId === order.orderId);
    for (const item of orderItems) {
      const sku = store.getSku(item.skuId);
      if (sku.stockQty < item.quantity) throw new HttpError(409, `${sku.name} 库存不足`);
    }
    const before = deepClone(order);
    order.payStatus = "paid";
    order.orderStatus = "pending";
    order.paidAt = now();
    order.pointsAwarded = Math.floor(order.amount * store.data.settings.pointRate);
    store.data.payments.push({
      paymentId: newId("pay"),
      orderId: order.orderId,
      wxTransactionId: `mock_wx_${order.orderId}`,
      amount: order.amount,
      status: "paid",
      paidAt: order.paidAt,
      refundedAt: null,
    });
    for (const item of orderItems) {
      store.createStockLedger(store.getSku(item.skuId), -item.quantity, "sale", "order", order.orderId, "system", "支付成功扣减库存");
    }
    store.createPointsLedger(store.getUser(order.userId), order.pointsAwarded, "消费赠送积分", "order", order.orderId, "system");
    store.log("system", "system", "pay_order", "Order", order.orderId, before, order, "模拟微信支付成功");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("GET", "/api/orders", async (_body, _params, query) => {
    const userId = query.get("userId");
    const employeeId = query.get("employeeId");
    let orders = store.data.orders;
    if (userId) orders = orders.filter((order) => order.userId === userId);
    if (employeeId) orders = orders.filter((order) => order.employeeId === employeeId);
    return { orders: orders.map((order) => publicOrder(store, order)).reverse() };
  });

  add("PATCH", "/api/admin/orders/:orderId/complete", async (body, params) => {
    const order = store.getOrder(params.orderId);
    const before = deepClone(order);
    if (order.orderStatus !== "pending") throw new HttpError(400, "只有待处理订单可完成");
    order.orderStatus = "completed";
    order.completedAt = now();
    store.log(body.operatorId || "emp_admin", "admin", "complete_order", "Order", order.orderId, before, order, body.reason || "订单完成");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("PATCH", "/api/admin/orders/:orderId/employee", async (body, params) => {
    const order = store.getOrder(params.orderId);
    const employee = body.employeeId ? store.getEmployee(body.employeeId) : null;
    const before = deepClone(order);
    order.employeeId = employee?.employeeId || null;
    order.source = employee ? "employee_qr" : "natural";
    store.log(body.operatorId || "emp_admin", "admin", "change_order_employee", "Order", order.orderId, before, order, body.reason || "调整订单归属");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("POST", "/api/admin/orders/:orderId/refund", async (body, params) => {
    const order = store.getOrder(params.orderId);
    if (order.payStatus !== "paid") throw new HttpError(400, "只有已支付订单可退款");
    if (order.orderStatus === "refunded") return { order: publicOrder(store, order), idempotent: true };
    const before = deepClone(order);
    order.payStatus = "refunded";
    order.orderStatus = "refunded";
    order.refundedAt = now();
    store.data.refunds.push({
      refundId: newId("refund"),
      orderId: order.orderId,
      amount: order.amount,
      reason: body.reason || "管理员退款",
      status: "refunded",
      operatorId: body.operatorId || "emp_admin",
      createdAt: now(),
    });
    const payment = store.data.payments.find((item) => item.orderId === order.orderId);
    if (payment) {
      payment.status = "refunded";
      payment.refundedAt = order.refundedAt;
    }
    const orderItems = store.data.orderItems.filter((item) => item.orderId === order.orderId);
    for (const item of orderItems) {
      store.createStockLedger(store.getSku(item.skuId), item.quantity, "refund", "order", order.orderId, body.operatorId || "emp_admin", "退款恢复库存");
    }
    const user = store.getUser(order.userId);
    if (user.pointsBalance >= order.pointsAwarded) {
      store.createPointsLedger(user, -order.pointsAwarded, "退款扣回积分", "refund", order.orderId, body.operatorId || "emp_admin");
    } else {
      store.createPointsLedger(user, 0, `积分不足扣回，应扣 ${order.pointsAwarded}`, "refund_exception", order.orderId, body.operatorId || "emp_admin");
    }
    store.log(body.operatorId || "emp_admin", "admin", "refund_order", "Order", order.orderId, before, order, body.reason || "管理员退款");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("POST", "/api/admin/orders/:orderId/transfer-storage", async (body, params) => {
    const order = store.getOrder(params.orderId);
    if (order.payStatus !== "paid") throw new HttpError(400, "仅已支付订单可转存");
    const user = store.getUser(order.userId);
    const sku = store.getSku(body.skuId);
    const quantity = Number(body.quantity || 1);
    if (quantity < 1) throw new HttpError(400, "转存数量必须大于 0");
    const storage = {
      storageId: newId("storage"),
      merchantId: order.merchantId,
      storeId: order.storeId,
      userId: user.userId,
      skuId: sku.skuId,
      quantity,
      expireAt: addDays(sku.storageDays || 30),
      status: "available",
      createdAt: now(),
    };
    store.data.customerStorage.push(storage);
    store.data.customerStorageLedgers.unshift({
      ledgerId: newId("storageLedger"),
      storageId: storage.storageId,
      userId: user.userId,
      skuId: sku.skuId,
      changeQty: quantity,
      quantityAfter: quantity,
      actionType: "from_order",
      operatorId: body.operatorId || "emp_admin",
      reason: "订单转存",
      createdAt: now(),
    });
    store.log(body.operatorId || "emp_admin", "admin", "transfer_order_storage", "CustomerStorage", storage.storageId, null, storage, "订单转存");
    await store.save();
    return { storage };
  });

  add("GET", "/api/points", async (_body, _params, query) => {
    const user = store.getUser(query.get("userId") || "user_demo");
    return { balance: user.pointsBalance, ledgers: store.data.pointsLedgers.filter((item) => item.userId === user.userId) };
  });

  add("POST", "/api/staff/points/adjust", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const amount = Number(body.amount);
    if (!amount) throw new HttpError(400, "积分变动不能为空");
    if (employee.role !== "admin" && Math.abs(amount) > store.data.settings.staffPointLimit) {
      throw new HttpError(403, "超过员工单次积分调整上限");
    }
    const user = store.getUser(body.userId || "user_demo");
    const before = deepClone(user);
    const ledger = store.createPointsLedger(user, amount, body.reason || "手动调整积分", "manual", employee.employeeId, employee.employeeId);
    store.log(employee.employeeId, employee.role, "adjust_points", "User", user.userId, before, user, body.reason || "手动调整积分");
    await store.save();
    return { user, ledger };
  });

  add("GET", "/api/storage", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    const storage = store.data.customerStorage
      .filter((item) => item.userId === userId)
      .map((item) => ({ ...item, product: store.getSku(item.skuId) }));
    return { storage };
  });

  add("POST", "/api/storage/:storageId/pickup-requests", async (body, params) => {
    const storage = store.getStorage(params.storageId);
    if (storage.status !== "available") throw new HttpError(400, "当前存酒不可取");
    if (new Date(storage.expireAt).getTime() < Date.now()) {
      storage.status = "expired";
      await store.save();
      throw new HttpError(400, "存酒已过期，需管理员处理");
    }
    const quantity = Number(body.quantity || 1);
    if (quantity < 1 || quantity > storage.quantity) throw new HttpError(400, "取酒数量不合法");
    const request = {
      requestId: newId("pickup"),
      storageId: storage.storageId,
      userId: storage.userId,
      quantity,
      status: "pending",
      reason: "",
      handledBy: null,
      createdAt: now(),
      handledAt: null,
    };
    store.data.storagePickupRequests.unshift(request);
    store.log(storage.userId, "customer", "create_pickup_request", "StoragePickupRequest", request.requestId, null, request, "客户申请取酒");
    await store.save();
    return { request };
  });

  add("POST", "/api/staff/storage", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const sku = store.getSku(body.skuId);
    const quantity = Number(body.quantity || 1);
    if (!body.agreementAccepted) throw new HttpError(400, "需要勾选寄存协议");
    if (quantity < 1) throw new HttpError(400, "存酒数量必须大于 0");
    let user = store.data.users.find((item) => item.phone === body.phone);
    if (!user) {
      user = {
        userId: newId("user"),
        merchantId: store.data.settings.merchantId,
        storeId: store.data.settings.storeId,
        openid: `manual_${body.phone}`,
        nickname: `客户${String(body.phone || "").slice(-4)}`,
        avatar: "",
        phone: body.phone,
        pointsBalance: 0,
        createdAt: now(),
      };
      store.data.users.push(user);
    }
    const storage = {
      storageId: newId("storage"),
      merchantId: user.merchantId,
      storeId: user.storeId,
      userId: user.userId,
      skuId: sku.skuId,
      quantity,
      expireAt: body.expireAt || addDays(sku.storageDays || 30),
      status: "available",
      createdAt: now(),
    };
    store.data.customerStorage.push(storage);
    store.data.customerStorageLedgers.unshift({
      ledgerId: newId("storageLedger"),
      storageId: storage.storageId,
      userId: user.userId,
      skuId: sku.skuId,
      changeQty: quantity,
      quantityAfter: quantity,
      actionType: "manual_add",
      operatorId: employee.employeeId,
      reason: body.reason || "手动新增存酒",
      createdAt: now(),
    });
    store.log(employee.employeeId, employee.role, "create_storage", "CustomerStorage", storage.storageId, null, storage, body.reason || "手动新增存酒");
    await store.save();
    return { storage, user };
  });

  add("POST", "/api/staff/storage/pickup-requests/:requestId/confirm", async (body, params) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const request = store.data.storagePickupRequests.find((item) => item.requestId === params.requestId);
    if (!request) throw new HttpError(404, "取酒申请不存在");
    if (request.status !== "pending") throw new HttpError(400, "取酒申请已处理");
    const storage = store.getStorage(request.storageId);
    if (storage.status !== "available") throw new HttpError(400, "存酒状态不可取");
    if (storage.quantity < request.quantity) throw new HttpError(409, "存酒数量不足");
    const before = deepClone(storage);
    store.createStorageLedger(storage, -request.quantity, "pickup_confirm", employee.employeeId, "员工确认取酒");
    request.status = "completed";
    request.handledBy = employee.employeeId;
    request.handledAt = now();
    store.log(employee.employeeId, employee.role, "confirm_pickup", "CustomerStorage", storage.storageId, before, storage, "员工确认取酒");
    await store.save();
    return { request, storage };
  });

  add("POST", "/api/staff/storage/pickup-requests/:requestId/reject", async (body, params) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const request = store.data.storagePickupRequests.find((item) => item.requestId === params.requestId);
    if (!request) throw new HttpError(404, "取酒申请不存在");
    if (request.status !== "pending") throw new HttpError(400, "取酒申请已处理");
    request.status = "rejected";
    request.reason = body.reason || "员工拒绝取酒";
    request.handledBy = employee.employeeId;
    request.handledAt = now();
    store.log(employee.employeeId, employee.role, "reject_pickup", "StoragePickupRequest", request.requestId, null, request, request.reason);
    await store.save();
    return { request };
  });

  add("GET", "/api/tables", async () => ({ tables: store.data.tables }));

  add("POST", "/api/reservations", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const table = store.data.tables.find((item) => item.tableId === body.tableId);
    if (!table) throw new HttpError(404, "桌位不存在");
    const reservation = {
      reservationId: newId("reservation"),
      merchantId: table.merchantId,
      storeId: table.storeId,
      userId: user.userId,
      tableId: table.tableId,
      status: "pending",
      reservationTime: body.reservationTime || now(),
      contactPhone: body.contactPhone || user.phone,
      remark: body.remark || "",
      createdAt: now(),
    };
    store.data.reservations.unshift(reservation);
    store.log(user.userId, "customer", "create_reservation", "Reservation", reservation.reservationId, null, reservation, "提交预约");
    await store.save();
    return { reservation };
  });

  add("GET", "/api/admin/reservations", async () => ({
    reservations: store.data.reservations.map((reservation) => ({
      ...reservation,
      user: store.data.users.find((user) => user.userId === reservation.userId),
      table: store.data.tables.find((table) => table.tableId === reservation.tableId),
    })),
  }));

  add("PATCH", "/api/admin/reservations/:reservationId", async (body, params) => {
    const reservation = store.data.reservations.find((item) => item.reservationId === params.reservationId);
    if (!reservation) throw new HttpError(404, "预约不存在");
    const before = deepClone(reservation);
    reservation.status = body.status || reservation.status;
    const table = store.data.tables.find((item) => item.tableId === reservation.tableId);
    if (table && reservation.status === "confirmed") table.status = "reserved";
    store.log(body.operatorId || "emp_admin", "admin", "update_reservation", "Reservation", reservation.reservationId, before, reservation, body.reason || "处理预约");
    await store.save();
    return { reservation, table };
  });

  add("GET", "/api/admin/dashboard", async () => dashboard(store));
  add("GET", "/api/admin/orders", async () => ({ orders: store.data.orders.map((order) => publicOrder(store, order)).reverse() }));
  add("GET", "/api/admin/products", async (_body, _params, query) => {
    let products = store.data.products;
    const status = query.get("status");
    const categoryId = query.get("categoryId");
    const keyword = query.get("keyword");
    if (status) products = products.filter((item) => item.status === status);
    if (categoryId) products = products.filter((item) => item.categoryId === categoryId);
    if (keyword) products = products.filter((item) => `${item.name}${item.spec}${item.description}`.includes(keyword));
    return { products, categories: store.data.categories };
  });
  add("POST", "/api/admin/categories", async (body) => {
    const category = {
      categoryId: newId("cat"),
      merchantId: store.data.settings.merchantId,
      storeId: store.data.settings.storeId,
      name: body.name || "新分类",
      sortOrder: Number(body.sortOrder || store.data.categories.length + 1),
      status: body.status || "active",
    };
    store.data.categories.push(category);
    store.log(body.operatorId || "emp_admin", "admin", "create_category", "ProductCategory", category.categoryId, null, category, "新增商品分类");
    await store.save();
    return { category };
  });
  add("POST", "/api/admin/products", async (body) => {
    const category = store.data.categories.find((item) => item.categoryId === (body.categoryId || store.data.categories[0]?.categoryId));
    if (!category) throw new HttpError(404, "商品分类不存在");
    const product = {
      skuId: newId("sku"),
      merchantId: store.data.settings.merchantId,
      storeId: store.data.settings.storeId,
      categoryId: category.categoryId,
      name: body.name || "新商品",
      spec: body.spec || "标准规格",
      unit: body.unit || "份",
      price: Number(body.price || 0),
      stockQty: Number(body.stockQty || 0),
      warningQty: Number(body.warningQty || 0),
      status: body.status || "active",
      description: body.description || "",
      imageUrl: body.imageUrl || "",
      storageDays: Number(body.storageDays || 0),
    };
    if (product.price < 0 || product.stockQty < 0) throw new HttpError(400, "价格和库存不能为负数");
    store.data.products.push(product);
    if (product.stockQty > 0) {
      store.data.stockLedgers.unshift({
        ledgerId: newId("stock"),
        merchantId: product.merchantId,
        storeId: product.storeId,
        skuId: product.skuId,
        changeQty: product.stockQty,
        stockAfter: product.stockQty,
        changeType: "initial",
        sourceType: "product",
        sourceId: product.skuId,
        operatorId: body.operatorId || "emp_admin",
        reason: "新增商品初始库存",
        createdAt: now(),
      });
    }
    store.log(body.operatorId || "emp_admin", "admin", "create_product", "ProductSKU", product.skuId, null, product, "新增 SKU");
    await store.save();
    return { product };
  });
  add("GET", "/api/admin/stock-ledgers", async () => ({ ledgers: store.data.stockLedgers.map((ledger) => ({ ...ledger, product: store.data.products.find((sku) => sku.skuId === ledger.skuId) })) }));
  add("GET", "/api/admin/stock-requests", async (_body, _params, query) => {
    let requests = store.data.stockRequests;
    const status = query.get("status");
    if (status) requests = requests.filter((item) => item.status === status);
    return { requests: requests.map((request) => publicStockRequest(store, request)) };
  });
  add("POST", "/api/admin/stock-requests", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_admin");
    const sku = store.getSku(body.skuId);
    const quantity = Number(body.quantity || 0);
    const direction = body.direction === "out" ? "out" : "in";
    if (quantity <= 0) throw new HttpError(400, "出入库数量必须大于 0");
    if (direction === "out" && sku.stockQty < quantity) throw new HttpError(409, "库存不足，不能提交出库");
    const request = {
      requestId: newId("stockReq"),
      merchantId: sku.merchantId,
      storeId: sku.storeId,
      skuId: sku.skuId,
      direction,
      quantity,
      status: "pending",
      operatorId: employee.employeeId,
      handledBy: null,
      reason: body.reason || (direction === "in" ? "后台入库申请" : "后台出库申请"),
      createdAt: now(),
      handledAt: null,
    };
    store.data.stockRequests.unshift(request);
    store.log(employee.employeeId, employee.role, "create_stock_request", "StockRequest", request.requestId, null, request, request.reason);
    await store.save();
    return { request: publicStockRequest(store, request) };
  });
  add("POST", "/api/admin/stock-requests/:requestId/confirm", async (body, params) => {
    const request = store.data.stockRequests.find((item) => item.requestId === params.requestId);
    if (!request) throw new HttpError(404, "出入库申请不存在");
    if (request.status !== "pending") throw new HttpError(400, "出入库申请已处理");
    const sku = store.getSku(request.skuId);
    const before = deepClone(sku);
    const changeQty = request.direction === "in" ? request.quantity : -request.quantity;
    if (sku.stockQty + changeQty < 0) throw new HttpError(409, "库存不足，不能确认出库");
    const ledger = store.createStockLedger(sku, changeQty, request.direction === "in" ? "stock_in" : "stock_out", "stock_request", request.requestId, body.operatorId || "emp_admin", request.reason);
    request.status = "completed";
    request.handledBy = body.operatorId || "emp_admin";
    request.handledAt = now();
    store.log(body.operatorId || "emp_admin", "admin", "confirm_stock_request", "ProductSKU", sku.skuId, before, sku, request.reason);
    await store.save();
    return { request: publicStockRequest(store, request), product: sku, ledger };
  });
  add("POST", "/api/admin/stock-requests/:requestId/reject", async (body, params) => {
    const request = store.data.stockRequests.find((item) => item.requestId === params.requestId);
    if (!request) throw new HttpError(404, "出入库申请不存在");
    if (request.status !== "pending") throw new HttpError(400, "出入库申请已处理");
    const before = deepClone(request);
    request.status = "rejected";
    request.handledBy = body.operatorId || "emp_admin";
    request.handledAt = now();
    request.reason = body.reason || request.reason;
    store.log(body.operatorId || "emp_admin", "admin", "reject_stock_request", "StockRequest", request.requestId, before, request, request.reason);
    await store.save();
    return { request: publicStockRequest(store, request) };
  });
  add("GET", "/api/admin/customer-storage", async () => ({
    storage: store.data.customerStorage.map((item) => ({ ...item, user: store.data.users.find((user) => user.userId === item.userId), product: store.getSku(item.skuId) })),
    pickupRequests: store.data.storagePickupRequests,
  }));
  add("GET", "/api/admin/users", async () => ({ users: store.data.users }));
  add("GET", "/api/admin/points-ledgers", async () => ({ ledgers: store.data.pointsLedgers }));
  add("GET", "/api/admin/consumption-records", async (_body, _params, query) => {
    const userId = query.get("userId");
    let orders = store.data.orders.filter((order) => order.payStatus === "paid");
    if (userId) orders = orders.filter((order) => order.userId === userId);
    return { records: orders.map((order) => publicOrder(store, order)).reverse() };
  });
  add("GET", "/api/admin/employees", async () => ({ employees: store.data.employees }));
  add("GET", "/api/admin/scan-records", async () => ({ records: store.data.scanRecords }));
  add("GET", "/api/admin/operation-logs", async () => ({ logs: store.data.operationLogs }));

  add("POST", "/api/admin/stock/adjust", async (body) => {
    const sku = store.getSku(body.skuId);
    const before = deepClone(sku);
    const targetQty = Number(body.targetQty);
    if (targetQty < 0) throw new HttpError(400, "库存不能为负数");
    const delta = targetQty - sku.stockQty;
    const ledger = store.createStockLedger(sku, delta, "adjust", "manual", sku.skuId, body.operatorId || "emp_admin", body.reason || "后台库存调整");
    store.log(body.operatorId || "emp_admin", "admin", "adjust_stock", "ProductSKU", sku.skuId, before, sku, body.reason || "后台库存调整");
    await store.save();
    return { product: sku, ledger };
  });

  add("POST", "/api/staff/blind-games", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_dealer");
    const game = {
      gameId: newId("game"),
      merchantId: employee.merchantId,
      storeId: employee.storeId,
      operatorId: employee.employeeId,
      smallBlind: Number(body.smallBlind || 1),
      bigBlind: Number(body.bigBlind || 2),
      intervalMinutes: Number(body.intervalMinutes || 10),
      initialPlayers: Number(body.initialPlayers || 9),
      currentPlayers: Number(body.initialPlayers || 9),
      buyinAmount: Number(body.buyinAmount || 100),
      buyinCount: 0,
      level: 1,
      status: "running",
      voiceEnabled: body.voiceEnabled !== false,
      createdAt: now(),
      updatedAt: now(),
    };
    store.data.blindGames.unshift(game);
    store.log(employee.employeeId, employee.role, "create_blind_game", "BlindGame", game.gameId, null, game, "创建升盲游戏");
    await store.save();
    return { game };
  });

  add("PATCH", "/api/staff/blind-games/:gameId", async (body, params) => {
    const game = store.data.blindGames.find((item) => item.gameId === params.gameId);
    if (!game) throw new HttpError(404, "升盲游戏不存在");
    const before = deepClone(game);
    const action = body.action;
    if (action === "pause") game.status = "paused";
    if (action === "resume") game.status = "running";
    if (action === "next_level") {
      game.level += 1;
      game.smallBlind *= 2;
      game.bigBlind *= 2;
    }
    if (action === "prev_level" && game.level > 1) {
      game.level -= 1;
      game.smallBlind = Math.max(1, Math.floor(game.smallBlind / 2));
      game.bigBlind = Math.max(2, Math.floor(game.bigBlind / 2));
    }
    if (action === "eliminate") game.currentPlayers = Math.max(1, game.currentPlayers - 1);
    if (action === "restore") game.currentPlayers = Math.min(game.initialPlayers, game.currentPlayers + 1);
    if (action === "buyin") game.buyinCount += Number(body.count || 1);
    if (action === "reset") {
      game.status = "running";
      game.level = 1;
      game.currentPlayers = game.initialPlayers;
      game.buyinCount = 0;
    }
    game.updatedAt = now();
    store.log(body.operatorId || game.operatorId, "dealer", "update_blind_game", "BlindGame", game.gameId, before, game, action || "更新升盲游戏");
    await store.save();
    return { game };
  });

  add("GET", "/api/staff/blind-games", async () => ({ games: store.data.blindGames }));

  add("GET", "/api/user/profile", async (_body, _params, query) => {
    const user = store.getUser(query.get("userId") || "user_demo");
    const level = calculateMemberLevel(store, user);
    user.memberLevel = level?.name || user.memberLevel || "普通会员";
    return {
      user,
      level,
      pointsVisible: store.data.settings.pointsVisible,
      orderCount: store.data.orders.filter((order) => order.userId === user.userId).length,
      storageCount: store.data.customerStorage.filter((item) => item.userId === user.userId && item.quantity > 0).length,
      couponCount: store.data.coupons.filter((item) => item.userId === user.userId && item.status === "available").length,
    };
  });

  add("GET", "/api/leaderboard/points", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    const ranked = [...store.data.users]
      .sort((a, b) => b.pointsBalance - a.pointsBalance)
      .map((user, index) => ({ rank: index + 1, userId: user.userId, nickname: user.nickname, phone: user.phone, pointsBalance: user.pointsBalance }));
    return { top10: ranked.slice(0, 10), mine: ranked.find((item) => item.userId === userId) || null };
  });

  add("GET", "/api/checkin", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { records: store.data.checkins.filter((item) => item.userId === userId), settings: { enabled: store.data.settings.checkinEnabled, points: store.data.settings.checkinPoints } };
  });

  add("POST", "/api/checkin", async (body) => {
    if (!store.data.settings.checkinEnabled) throw new HttpError(400, "签到未开启");
    const user = store.getUser(body.userId || "user_demo");
    const today = dayKey();
    if (store.data.checkins.some((item) => item.userId === user.userId && item.date === today)) {
      throw new HttpError(409, "今日已签到");
    }
    const record = { checkinId: newId("checkin"), userId: user.userId, date: today, points: store.data.settings.checkinPoints, createdAt: now() };
    store.data.checkins.unshift(record);
    store.createPointsLedger(user, record.points, "签到送积分", "checkin", record.checkinId, "system");
    store.log(user.userId, "customer", "checkin", "Checkin", record.checkinId, null, record, "日历签到");
    await store.save();
    return { record, user };
  });

  add("GET", "/api/coupons", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { coupons: store.data.coupons.filter((coupon) => coupon.userId === userId).map((coupon) => publicCoupon(store, coupon)), records: store.data.couponRecords.filter((record) => record.userId === userId) };
  });

  add("POST", "/api/coupons/:couponId/redeem-request", async (body, params) => {
    const coupon = store.data.coupons.find((item) => item.couponId === params.couponId);
    if (!coupon) throw new HttpError(404, "酒水券不存在");
    if (coupon.status !== "available") throw new HttpError(400, "酒水券不可兑换");
    const before = deepClone(coupon);
    coupon.status = "pending";
    const record = { recordId: newId("couponRecord"), couponId: coupon.couponId, userId: coupon.userId, action: "redeem_request", status: "pending", operatorId: body.operatorId || coupon.userId, createdAt: now() };
    store.data.couponRecords.unshift(record);
    store.log(coupon.userId, "customer", "coupon_redeem_request", "Coupon", coupon.couponId, before, coupon, "客户申请兑换酒水券");
    await store.save();
    return { coupon: publicCoupon(store, coupon), record };
  });

  add("POST", "/api/staff/coupons/:couponId/confirm", async (body, params) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const coupon = store.data.coupons.find((item) => item.couponId === params.couponId);
    if (!coupon) throw new HttpError(404, "酒水券不存在");
    if (coupon.status !== "pending") throw new HttpError(400, "酒水券不是待确认状态");
    const before = deepClone(coupon);
    coupon.status = "completed";
    coupon.completedAt = now();
    const record = { recordId: newId("couponRecord"), couponId: coupon.couponId, userId: coupon.userId, action: "redeem_confirm", status: "completed", operatorId: employee.employeeId, createdAt: now() };
    store.data.couponRecords.unshift(record);
    store.log(employee.employeeId, employee.role, "coupon_confirm", "Coupon", coupon.couponId, before, coupon, "员工确认酒水券兑换");
    await store.save();
    return { coupon: publicCoupon(store, coupon), record };
  });

  add("GET", "/api/recharge-records", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { records: store.data.rechargeRecords.filter((record) => record.userId === userId), configs: store.data.rechargeConfigs.filter((config) => config.status === "active") };
  });

  add("POST", "/api/recharge", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const config = body.configId ? store.data.rechargeConfigs.find((item) => item.configId === body.configId) : null;
    const amount = Number(body.amount || config?.amount || 0);
    const giftAmount = Number(body.giftAmount ?? config?.giftAmount ?? 0);
    if (amount <= 0) throw new HttpError(400, "充值金额必须大于 0");
    const before = deepClone(user);
    user.balance = Number(user.balance || 0) + amount + giftAmount;
    const record = { recordId: newId("recharge"), userId: user.userId, amount, giftAmount, balanceAfter: user.balance, payMethod: "mock_wechat", status: "paid", createdAt: now() };
    store.data.rechargeRecords.unshift(record);
    store.log(user.userId, "customer", "recharge", "User", user.userId, before, user, `充值${amount}赠送${giftAmount}`);
    await store.save();
    return { user, record };
  });

  add("GET", "/api/store/location", async () => ({ location: store.data.settings.location, store: store.data.stores[0] }));
  add("GET", "/api/support/contact", async () => ({ phone: store.data.settings.supportPhone }));
  add("POST", "/api/scan/employee", async (body) => {
    const employee = store.getEmployee(body.employeeId || "emp_anna");
    const record = {
      recordId: newId("scan"),
      userId: body.userId || "user_demo",
      employeeId: employee.employeeId,
      scene: "employee_qr",
      rawCode: body.rawCode || `employee:${employee.employeeId}`,
      createdAt: now(),
    };
    store.data.scanRecords.unshift(record);
    store.log(record.userId, "customer", "scan_employee_qr", "Employee", employee.employeeId, null, record, "客户扫码点单归属员工");
    await store.save();
    return { employee, record, scene: "employee_qr" };
  });

  add("POST", "/api/lottery/draw", async (body) => {
    if (!store.data.lotterySettings.enabled) throw new HttpError(400, "抽奖未开启");
    const user = store.getUser(body.userId || "user_demo");
    const today = dayKey();
    const todayCount = store.data.lotteryRecords.filter((record) => record.userId === user.userId && record.createdAt.startsWith(today)).length;
    if (todayCount >= store.data.lotterySettings.dailyLimit) throw new HttpError(429, "今日抽奖次数已用完");
    const cost = store.data.lotterySettings.costPoints;
    if (user.pointsBalance < cost) throw new HttpError(400, "积分不足");
    const prizes = store.data.lotteryPrizes.filter((prize) => prize.status === "active");
    const prize = prizes[store.data.lotteryRecords.length % prizes.length];
    store.createPointsLedger(user, -cost, "积分抽奖消耗", "lottery", prize.prizeId, "system");
    const record = { recordId: newId("lottery"), userId: user.userId, prizeId: prize.prizeId, prizeName: prize.name, costPoints: cost, status: "won", redeemedBy: null, redeemedAt: null, createdAt: now() };
    store.data.lotteryRecords.unshift(record);
    store.log(user.userId, "customer", "lottery_draw", "LotteryRecord", record.recordId, null, record, "积分抽奖");
    await store.save();
    return { record, prize, user };
  });

  add("GET", "/api/lottery/records", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { records: store.data.lotteryRecords.filter((record) => record.userId === userId), settings: store.data.lotterySettings, prizes: store.data.lotteryPrizes };
  });

  add("POST", "/api/lottery/records/:recordId/redeem-request", async (body, params) => {
    const record = store.data.lotteryRecords.find((item) => item.recordId === params.recordId);
    if (!record) throw new HttpError(404, "中奖记录不存在");
    if (record.userId !== (body.userId || record.userId)) throw new HttpError(403, "不能核销他人中奖记录");
    if (record.status !== "won") throw new HttpError(400, "中奖记录不可申请核销");
    const before = deepClone(record);
    record.status = "redeeming";
    store.log(record.userId, "customer", "lottery_redeem_request", "LotteryRecord", record.recordId, before, record, "客户申请核销中奖记录");
    await store.save();
    return { record };
  });

  add("POST", "/api/staff/lottery-records/:recordId/confirm", async (body, params) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const record = store.data.lotteryRecords.find((item) => item.recordId === params.recordId);
    if (!record) throw new HttpError(404, "中奖记录不存在");
    if (record.status !== "redeeming" && record.status !== "won") throw new HttpError(400, "中奖记录已核销");
    const before = deepClone(record);
    record.status = "completed";
    record.redeemedBy = employee.employeeId;
    record.redeemedAt = now();
    store.log(employee.employeeId, employee.role, "lottery_redeem_confirm", "LotteryRecord", record.recordId, before, record, "员工确认核销中奖记录");
    await store.save();
    return { record };
  });

  add("POST", "/api/staff/password", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const before = deepClone(employee);
    employee.passwordHash = body.newPassword || "demo";
    employee.passwordChangedAt = now();
    store.log(employee.employeeId, employee.role, "change_password", "Employee", employee.employeeId, before, employee, "员工修改密码");
    await store.save();
    return { employee };
  });

  add("POST", "/api/staff/verify-code", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    return { user, pointsBalance: user.pointsBalance, storage: store.data.customerStorage.filter((item) => item.userId === user.userId), coupons: store.data.coupons.filter((item) => item.userId === user.userId) };
  });

  add("POST", "/api/staff/seats/:seatNo/sit", async (body, params) => {
    const seatNo = Number(params.seatNo);
    const seat = store.data.seats.find((item) => item.seatNo === seatNo);
    if (!seat) throw new HttpError(404, "座位不存在");
    const before = deepClone(seat);
    seat.status = "occupied";
    seat.userId = body.userId || "user_demo";
    seat.eliminated = false;
    seat.updatedAt = now();
    store.log(body.operatorId || "emp_anna", "staff", "seat_sit", "Seat", String(seatNo), before, seat, "确认入座");
    await store.save();
    return { seat };
  });

  add("POST", "/api/staff/seats/:seatNo/eliminate", async (body, params) => {
    const seat = store.data.seats.find((item) => item.seatNo === Number(params.seatNo));
    if (!seat) throw new HttpError(404, "座位不存在");
    const before = deepClone(seat);
    seat.status = "eliminated";
    seat.eliminated = true;
    seat.updatedAt = now();
    store.log(body.operatorId || "emp_anna", "staff", "seat_eliminate", "Seat", String(seat.seatNo), before, seat, "淘汰座位");
    await store.save();
    return { seat };
  });

  add("POST", "/api/staff/seats/:seatNo/restore", async (body, params) => {
    const seat = store.data.seats.find((item) => item.seatNo === Number(params.seatNo));
    if (!seat) throw new HttpError(404, "座位不存在");
    const before = deepClone(seat);
    seat.status = seat.userId ? "occupied" : "available";
    seat.eliminated = false;
    seat.updatedAt = now();
    store.log(body.operatorId || "emp_anna", "staff", "seat_restore", "Seat", String(seat.seatNo), before, seat, "恢复座位");
    await store.save();
    return { seat };
  });

  add("GET", "/api/staff/performance/monthly", async (_body, _params, query) => {
    const employeeId = query.get("employeeId") || "emp_anna";
    const months = Number(query.get("months") || 6);
    const paid = store.data.orders.filter((order) => order.employeeId === employeeId && order.payStatus === "paid");
    const rows = [];
    for (let index = 0; index < months; index += 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - index);
      const key = monthKey(date);
      const orders = paid.filter((order) => monthKey(order.paidAt || order.createdAt) === key);
      rows.push({ month: key, orderCount: orders.length, sales: orders.reduce((sum, order) => sum + order.amount, 0) });
    }
    return { employee: store.getEmployee(employeeId), rows };
  });

  add("GET", "/api/admin/finance/overview", async () => {
    const paid = store.data.orders.filter((order) => order.payStatus === "paid");
    const today = dayKey();
    const currentMonth = monthKey();
    return {
      todayRevenue: paid.filter((order) => order.paidAt?.startsWith(today)).reduce((sum, order) => sum + order.amount, 0),
      monthRevenue: paid.filter((order) => monthKey(order.paidAt || order.createdAt) === currentMonth).reduce((sum, order) => sum + order.amount, 0),
      rechargeRevenue: store.data.rechargeRecords.reduce((sum, record) => sum + record.amount, 0),
      trend: Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        const key = date.toISOString().slice(0, 10);
        return { date: key, revenue: paid.filter((order) => order.paidAt?.startsWith(key)).reduce((sum, order) => sum + order.amount, 0) };
      }),
    };
  });

  add("GET", "/api/admin/business-details", async () => ({ details: store.data.orders.filter((order) => order.payStatus === "paid").map((order) => publicOrder(store, order)).reverse() }));
  add("GET", "/api/admin/recharge-configs", async () => ({ configs: store.data.rechargeConfigs }));
  add("POST", "/api/admin/recharge-configs", async (body) => {
    const config = { configId: newId("rechargeConfig"), amount: Number(body.amount), giftAmount: Number(body.giftAmount || 0), status: body.status || "active", createdAt: now() };
    if (config.amount <= 0) throw new HttpError(400, "充值金额必须大于 0");
    store.data.rechargeConfigs.unshift(config);
    store.log(body.operatorId || "emp_admin", "admin", "create_recharge_config", "RechargeConfig", config.configId, null, config, "新增充值配置");
    await store.save();
    return { config };
  });
  add("GET", "/api/admin/recharge-records", async () => ({ records: store.data.rechargeRecords }));
  add("GET", "/api/admin/member-levels", async () => ({ levels: store.data.memberLevels }));
  add("POST", "/api/admin/member-levels", async (body) => {
    const level = { levelId: newId("level"), name: body.name, minPoints: Number(body.minPoints || 0), status: body.status || "active" };
    store.data.memberLevels.push(level);
    await store.save();
    return { level };
  });
  add("GET", "/api/admin/lottery/overview", async () => {
    const month = monthKey();
    const records = store.data.lotteryRecords;
    return {
      totalDraws: records.length,
      monthDraws: records.filter((record) => monthKey(record.createdAt) === month).length,
      wins: records.filter((record) => record.status === "won").length,
      todayCostPoints: records.filter((record) => record.createdAt.startsWith(dayKey())).reduce((sum, record) => sum + record.costPoints, 0),
      records,
    };
  });
  add("GET", "/api/admin/lottery/prizes", async () => ({ prizes: store.data.lotteryPrizes, settings: store.data.lotterySettings }));
  add("POST", "/api/admin/lottery/prizes", async (body) => {
    const prize = { prizeId: newId("prize"), name: body.name, winRate: Number(body.winRate || 0), status: body.status || "active", createdAt: now() };
    store.data.lotteryPrizes.push(prize);
    await store.save();
    return { prize };
  });
  add("PATCH", "/api/admin/lottery/settings", async (body) => {
    store.data.lotterySettings = { ...store.data.lotterySettings, ...body };
    await store.save();
    return { settings: store.data.lotterySettings };
  });
  add("GET", "/api/admin/table-types", async () => ({ tableTypes: store.data.tableTypes }));
  add("POST", "/api/admin/table-types", async (body) => {
    const type = { typeId: newId("tableType"), name: body.name, capacity: Number(body.capacity || 1), status: body.status || "active" };
    store.data.tableTypes.push(type);
    await store.save();
    return { type };
  });
  add("POST", "/api/admin/employees", async (body) => {
    const employee = { employeeId: newId("emp"), merchantId: store.data.settings.merchantId, storeId: store.data.settings.storeId, name: body.name, phone: body.phone, role: body.role || "staff", loginAccount: body.loginAccount || body.phone, passwordHash: body.password || "demo", status: "active", createdAt: now() };
    store.data.employees.push(employee);
    store.log(body.operatorId || "emp_admin", "admin", "create_employee", "Employee", employee.employeeId, null, employee, "新增工作人员");
    await store.save();
    return { employee };
  });
  add("PATCH", "/api/admin/employees/:employeeId", async (body, params) => {
    const employee = store.getEmployee(params.employeeId);
    const before = deepClone(employee);
    Object.assign(employee, body);
    if (body.resetPassword) employee.passwordHash = body.resetPassword;
    store.log(body.operatorId || "emp_admin", "admin", "update_employee", "Employee", employee.employeeId, before, employee, "修改工作人员");
    await store.save();
    return { employee };
  });
  add("GET", "/api/admin/blind-settings", async () => ({ settings: store.data.blindSettings }));
  add("PATCH", "/api/admin/blind-settings", async (body) => {
    store.data.blindSettings = { ...store.data.blindSettings, ...body };
    await store.save();
    return { settings: store.data.blindSettings };
  });
  add("GET", "/api/admin/system-settings", async () => ({ settings: store.data.settings }));
  add("PATCH", "/api/admin/system-settings", async (body) => {
    store.data.settings = { ...store.data.settings, ...body };
    await store.save();
    return { settings: store.data.settings };
  });

  return async function route(req, res) {
    const { path, params: query } = parseUrl(req);
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchRoute(req.method, path, route.pattern);
      if (!params) continue;
      const body = req.method === "GET" ? {} : await readBody(req);
      const result = await route.handler(body, params, query);
      await store.save();
      sendJson(res, 200, result);
      return true;
    }
    return false;
  };
}

async function serveStatic(req, res) {
  const { path } = parseUrl(req);
  if (path === "/favicon.ico") {
    res.writeHead(302, { location: "/favicon.svg" });
    res.end();
    return true;
  }
  const safePath = path === "/" ? "/index.html" : path;
  const filePath = resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) return false;
  const ext = extname(filePath);
  res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
  return true;
}

export async function createApp(options = {}) {
  const store = new Store(options.dataFile || process.env.DATA_FILE || defaultDataFile);
  await store.load();
  const router = createRouter(store);
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.url?.startsWith("/api/")) {
        const handled = await router(req, res);
        if (!handled) sendJson(res, 404, { error: "接口不存在" });
        return;
      }
      const staticHandled = await serveStatic(req, res);
      if (!staticHandled) sendJson(res, 404, { error: "页面不存在" });
    } catch (error) {
      sendError(res, error);
    }
  });
  return { server, store };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server } = await createApp();
  server.listen(port, () => {
    console.log(`MiniProgram backend running at http://localhost:${port}`);
  });
}
