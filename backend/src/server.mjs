import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecipheriv, createSign, createVerify, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";

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
const currentAppEnv = () => process.env.APP_ENV || process.env.NODE_ENV || "development";
const mockWechatEnabled = () => process.env.ALLOW_MOCK_WECHAT === "true" || currentAppEnv() !== "production";
const authRequired = () => process.env.REQUIRE_AUTH === "true" || currentAppEnv() === "production";
const jsonStoreAllowedInProduction = () => process.env.ALLOW_JSON_STORE_IN_PRODUCTION === "true";
const databaseProvider = () => (process.env.DATABASE_URL?.startsWith("sqlite://") ? "sqlite" : process.env.DATABASE_URL ? "unsupported" : "json_store");
const requiredWechatLoginEnv = ["WECHAT_APPID", "WECHAT_APP_SECRET"];
const requiredWechatPayEnv = [
  "WECHAT_APPID",
  "WECHAT_MCH_ID",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PLATFORM_CERTIFICATE",
  "WECHAT_PAY_NOTIFY_URL",
];
const requiredWechatEnv = [...new Set([...requiredWechatLoginEnv, ...requiredWechatPayEnv])];
const deploymentChecks = () => {
  const missingWechatEnv = requiredWechatEnv.filter((key) => !process.env[key]);
  const missingWechatLoginEnv = requiredWechatLoginEnv.filter((key) => !process.env[key]);
  const missingWechatPayEnv = requiredWechatPayEnv.filter((key) => !process.env[key]);
  return {
    wechatConfigured: missingWechatEnv.length === 0,
    missingWechatEnv,
    wechatLoginConfigured: missingWechatLoginEnv.length === 0,
    missingWechatLoginEnv,
    wechatPayConfigured: missingWechatPayEnv.length === 0,
    missingWechatPayEnv,
    wechatLoginDryRun: process.env.WECHAT_LOGIN_DRY_RUN === "true",
    wechatPhoneDryRun: process.env.WECHAT_PHONE_DRY_RUN === "true",
    wechatQrDryRun: process.env.WECHAT_QR_DRY_RUN === "true",
    wechatPayDryRun: process.env.WECHAT_PAY_DRY_RUN === "true",
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseProvider: databaseProvider(),
    usingJsonStore: databaseProvider() === "json_store",
    jsonStoreAllowedInProduction: jsonStoreAllowedInProduction(),
  };
};
const runtimeInfo = () => ({
  appEnv: currentAppEnv(),
  mockWechatEnabled: mockWechatEnabled(),
  paymentProvider: mockWechatEnabled() ? "mock_wechat" : "wechat_pay_required",
  authRequired: authRequired(),
  deployment: deploymentChecks(),
});
function requireMockWechat(feature) {
  if (!mockWechatEnabled()) throw new HttpError(501, `${feature}需要接入真实微信能力，生产环境禁止使用模拟接口`);
}

async function qrDataUri(payload) {
  return QRCode.toDataURL(payload, {
    type: "image/svg+xml",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: { dark: "#18241f", light: "#ffffff" },
  });
}

async function wechatMiniProgramCode(scene, page = "pages/customer/customer") {
  if (!scene) throw new HttpError(400, "缺少小程序码 scene");
  const missing = requiredWechatLoginEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("微信小程序码", missing));
  if (process.env.WECHAT_QR_DRY_RUN === "true") {
    return { imageUrl: await qrDataUri(`mp:${page}?scene=${encodeURIComponent(scene)}`), provider: "wechat_qr_dry_run", page, scene };
  }
  const accessToken = await getWechatAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scene,
      page,
      check_path: false,
      env_version: process.env.WECHAT_MINIPROGRAM_ENV_VERSION || "release",
    }),
  });
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || contentType.includes("application/json")) {
    const data = JSON.parse(buffer.toString("utf8") || "{}");
    throw new HttpError(502, `微信小程序码生成失败：${data.errmsg || response.statusText}`);
  }
  return { imageUrl: `data:image/png;base64,${buffer.toString("base64")}`, provider: "wechat_miniprogram_code", page, scene };
}

const defaultBlindLevels = () => [
  { level: 1, smallBlind: 1, bigBlind: 2, ante: 0 },
  { level: 2, smallBlind: 2, bigBlind: 4, ante: 0 },
  { level: 3, smallBlind: 5, bigBlind: 10, ante: 0 },
  { level: 4, smallBlind: 10, bigBlind: 20, ante: 0 },
  { level: 5, smallBlind: 25, bigBlind: 50, ante: 0 },
  { level: 6, smallBlind: 50, bigBlind: 100, ante: 0 },
];

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

function checkinCalendar(records, referenceDate = new Date()) {
  const month = referenceDate.toISOString().slice(0, 7);
  const [year, monthValue] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthValue, 0)).getUTCDate();
  const signedDates = new Set(records.map((record) => record.date));
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const date = `${month}-${day}`;
    return { date, day: index + 1, signed: signedDates.has(date), isToday: date === dayKey() };
  });
}

const passwordHashPrefix = "scrypt";
function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(String(password || ""), salt, 64).toString("base64url");
  return `${passwordHashPrefix}$${salt}$${hash}`;
}

function isStrongPasswordHash(value) {
  return String(value || "").startsWith(`${passwordHashPrefix}$`);
}

function verifyPassword(password, storedHash) {
  const stored = String(storedHash || "");
  const rawPassword = String(password || "");
  if (!isStrongPasswordHash(stored)) return stored === rawPassword;
  const [, salt, expectedHash] = stored.split("$");
  if (!salt || !expectedHash) return false;
  const actual = scryptSync(rawPassword, salt, 64);
  const expected = Buffer.from(expectedHash, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function migrateEmployeePassword(employee) {
  if (!employee || !employee.passwordHash || isStrongPasswordHash(employee.passwordHash)) return false;
  employee.passwordHash = hashPassword(employee.passwordHash);
  employee.passwordMigratedAt = now();
  return true;
}

function normalizeStoreData(data) {
  data.stockRequests ||= [];
  data.stockCounts ||= [];
  data.scanRecords ||= [];
  data.verificationCodes ||= [];
  data.staffSessions ||= [];
  data.voiceEvents ||= [];
  let shouldSaveAfterLoad = false;
  for (const user of data.users || []) {
    user.balance ||= 0;
    user.memberLevel ||= "普通会员";
  }
  for (const employee of data.employees || []) {
    employee.commissionRate ??= employee.role === "staff" ? 0.05 : 0;
    shouldSaveAfterLoad = migrateEmployeePassword(employee) || shouldSaveAfterLoad;
  }
  for (const product of data.products || []) {
    product.costPrice ??= 0;
    product.supplierName ||= "";
  }
  for (const table of data.tables || []) {
    table.occupiedStartedAt ||= null;
    table.consumptionAmount ||= 0;
    table.imageUrl ||= defaultTableImage(table);
  }
  data.blindSettings ||= {};
  data.blindSettings.blindLevels ||= defaultBlindLevels();
  for (const storage of data.customerStorage || []) {
    storage.handledAt ||= null;
    storage.handledBy ||= null;
    storage.expiredHandledAt ||= null;
    storage.expiredHandledBy ||= null;
    storage.expiredHandlingNote ||= "";
  }
  return shouldSaveAfterLoad;
}

function sqlitePathFromDatabaseUrl(databaseUrl) {
  const value = String(databaseUrl || "");
  if (!value.startsWith("sqlite://")) return "";
  const rawPath = value.slice("sqlite://".length);
  if (!rawPath || rawPath === ":memory:") return rawPath || ":memory:";
  return resolve(rawPath.replace(/^\/([A-Za-z]:)/, "$1"));
}

function createUserFromWechat(store, { openid, nickname, avatar = "", phone = "" }) {
  return {
    userId: newId("user"),
    merchantId: store.data.settings.merchantId,
    storeId: store.data.settings.storeId,
    openid,
    nickname: nickname || "微信用户",
    avatar,
    phone,
    pointsBalance: 0,
    balance: 0,
    memberLevel: "普通会员",
    createdAt: now(),
  };
}

function missingConfigMessage(feature, keys) {
  return `${feature}缺少配置：${keys.join(", ")}`;
}

async function wechatCodeToSession(code) {
  if (!code) throw new HttpError(400, "缺少微信登录 code");
  const missing = requiredWechatLoginEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("真实微信登录", missing));
  if (process.env.WECHAT_LOGIN_DRY_RUN === "true") {
    return { openid: `dry_openid_${code}`, session_key: "dry_session_key", provider: "wechat_jscode2session_dry_run" };
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", process.env.WECHAT_APPID);
  url.searchParams.set("secret", process.env.WECHAT_APP_SECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new HttpError(502, `微信登录失败：${data.errmsg || response.statusText}`);
  }
  if (!data.openid) throw new HttpError(502, "微信登录未返回 openid");
  return { ...data, provider: "wechat_jscode2session" };
}

async function getWechatAccessToken() {
  const missing = requiredWechatLoginEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("微信手机号授权", missing));
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", process.env.WECHAT_APPID);
  url.searchParams.set("secret", process.env.WECHAT_APP_SECRET);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new HttpError(502, `微信 access_token 获取失败：${data.errmsg || response.statusText}`);
  }
  if (!data.access_token) throw new HttpError(502, "微信 access_token 未返回");
  return data.access_token;
}

async function wechatCodeToPhone(code) {
  if (!code) throw new HttpError(400, "缺少微信手机号授权 code");
  const missing = requiredWechatLoginEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("微信手机号授权", missing));
  if (process.env.WECHAT_PHONE_DRY_RUN === "true") {
    return { phoneNumber: `13${String(code).replace(/\D/g, "").slice(-9).padStart(9, "0")}`, purePhoneNumber: `13${String(code).replace(/\D/g, "").slice(-9).padStart(9, "0")}`, countryCode: "86", provider: "wechat_phone_dry_run" };
  }
  const accessToken = await getWechatAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new HttpError(502, `微信手机号授权失败：${data.errmsg || response.statusText}`);
  }
  const phoneInfo = data.phone_info || {};
  if (!phoneInfo.phoneNumber) throw new HttpError(502, "微信手机号授权未返回手机号");
  return { ...phoneInfo, provider: "wechat_phone" };
}

function normalizePrivateKey(value) {
  const key = (value || "").replace(/\\n/g, "\n").trim();
  if (!key) throw new HttpError(501, "微信支付缺少配置：WECHAT_PAY_PRIVATE_KEY");
  return key;
}

function normalizeCertificate(value) {
  const certificate = (value || "").replace(/\\n/g, "\n").trim();
  if (!certificate) throw new HttpError(501, "微信支付回调缺少配置：WECHAT_PAY_PLATFORM_CERTIFICATE");
  return certificate;
}

function createNonce() {
  return randomBytes(16).toString("hex");
}

function signRsaSha256(message) {
  const sign = createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  return sign.sign(normalizePrivateKey(process.env.WECHAT_PAY_PRIVATE_KEY), "base64");
}

function wechatPayAuthorization(method, urlPath, body, timestamp, nonceStr) {
  const signature = signRsaSha256(`${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHAT_MCH_ID}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_PAY_SERIAL_NO}",signature="${signature}"`;
}

function buildWechatRequestPaymentParams(prepayId) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = createNonce();
  const packageValue = `prepay_id=${prepayId}`;
  const paySign = signRsaSha256(`${process.env.WECHAT_APPID}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
  return { timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign };
}

function verifyWechatPayNotifySignature(ctx) {
  const timestamp = ctx.headers["wechatpay-timestamp"];
  const nonce = ctx.headers["wechatpay-nonce"];
  const signature = ctx.headers["wechatpay-signature"];
  const serial = ctx.headers["wechatpay-serial"];
  if (!timestamp || !nonce || !signature || !serial) throw new HttpError(400, "微信支付回调缺少验签请求头");
  if (process.env.WECHAT_PAY_PLATFORM_SERIAL_NO && serial !== process.env.WECHAT_PAY_PLATFORM_SERIAL_NO) {
    throw new HttpError(400, "微信支付平台证书序列号不匹配");
  }
  const message = `${timestamp}\n${nonce}\n${ctx.rawBody}\n`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(message);
  verifier.end();
  const ok = verifier.verify(normalizeCertificate(process.env.WECHAT_PAY_PLATFORM_CERTIFICATE), signature, "base64");
  if (!ok) throw new HttpError(400, "微信支付回调验签失败");
}

function decryptWechatPayResource(resource) {
  if (!resource?.ciphertext || !resource.nonce) throw new HttpError(400, "微信支付回调资源格式错误");
  const apiKey = process.env.WECHAT_PAY_API_V3_KEY || "";
  if (Buffer.byteLength(apiKey) !== 32) throw new HttpError(501, "微信支付 API V3 Key 必须为 32 字节");
  const ciphertext = Buffer.from(resource.ciphertext, "base64");
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(apiKey), Buffer.from(resource.nonce));
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data));
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

function resolveWechatPayNotify(body, ctx) {
  if (body.signatureVerified && (mockWechatEnabled() || process.env.WECHAT_PAY_DRY_RUN === "true")) {
    return {
      orderId: body.orderId,
      amount: Number(body.amount),
      transactionId: body.transactionId || "",
      verifiedBy: "trusted_test_flag",
    };
  }
  verifyWechatPayNotifySignature(ctx);
  const transaction = decryptWechatPayResource(body.resource);
  return {
    orderId: transaction.out_trade_no,
    amount: Number(transaction.amount?.total || 0) / 100,
    transactionId: transaction.transaction_id || "",
    tradeState: transaction.trade_state,
    verifiedBy: "wechat_pay_v3",
  };
}

async function createWechatRefund(order, payment, reason) {
  const missing = requiredWechatPayEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("微信支付退款", missing));
  const outRefundNo = `refund_${order.orderId}_${Date.now().toString(36)}`;
  const bodyObject = {
    out_trade_no: order.orderId,
    out_refund_no: outRefundNo,
    reason,
    amount: {
      refund: Math.round(Number(order.amount || 0) * 100),
      total: Math.round(Number(order.amount || 0) * 100),
      currency: "CNY",
    },
  };
  if (payment?.wxTransactionId) {
    delete bodyObject.out_trade_no;
    bodyObject.transaction_id = payment.wxTransactionId;
  }
  const body = JSON.stringify(bodyObject);
  const urlPath = "/v3/refund/domestic/refunds";
  if (process.env.WECHAT_PAY_DRY_RUN === "true") {
    return { refundId: `dry_refund_${order.orderId}`, outRefundNo, status: "PROCESSING", provider: "wechat_refund_dry_run" };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = createNonce();
  const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: wechatPayAuthorization("POST", urlPath, body, timestamp, nonceStr),
    },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.refund_id) {
    throw new HttpError(502, `微信退款申请失败：${data.message || data.code || response.statusText}`);
  }
  return { refundId: data.refund_id, outRefundNo: data.out_refund_no || outRefundNo, status: data.status || "PROCESSING", provider: "wechat_refund" };
}

async function createWechatJsapiPrepay(order, user) {
  const missing = requiredWechatPayEnv.filter((key) => !process.env[key]);
  if (missing.length) throw new HttpError(501, missingConfigMessage("微信支付 JSAPI", missing));
  if (!user.openid) throw new HttpError(400, "会员缺少微信 openid，需先微信登录");
  const bodyObject = {
    appid: process.env.WECHAT_APPID,
    mchid: process.env.WECHAT_MCH_ID,
    description: `门店点单 ${order.orderId}`,
    out_trade_no: order.orderId,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL,
    amount: { total: Math.round(Number(order.amount || 0) * 100), currency: "CNY" },
    payer: { openid: user.openid },
  };
  const body = JSON.stringify(bodyObject);
  const urlPath = "/v3/pay/transactions/jsapi";
  let prepayId = "";
  if (process.env.WECHAT_PAY_DRY_RUN === "true") {
    prepayId = `dry_prepay_${order.orderId}`;
  } else {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = createNonce();
    const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: wechatPayAuthorization("POST", urlPath, body, timestamp, nonceStr),
      },
      body,
    });
    const data = await response.json();
    if (!response.ok || !data.prepay_id) {
      throw new HttpError(502, `微信支付预支付失败：${data.message || data.code || response.statusText}`);
    }
    prepayId = data.prepay_id;
  }
  return {
    prepayId,
    requestPayment: buildWechatRequestPaymentParams(prepayId),
    provider: process.env.WECHAT_PAY_DRY_RUN === "true" ? "wechat_pay_dry_run" : "wechat_pay",
  };
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
      couponExchangePoints: 0,
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
        passwordHash: hashPassword("demo"),
        commissionRate: 0.08,
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
        passwordHash: hashPassword("demo"),
        commissionRate: 0.03,
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
        passwordHash: hashPassword("demo"),
        commissionRate: 0,
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
        passwordHash: hashPassword("demo"),
        commissionRate: 0.02,
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
        costPrice: 16,
        supplierName: "本地酒水供应商",
        stockQty: 60,
        warningQty: 12,
        status: "active",
        description: "冰镇瓶装啤酒，适合拼桌畅饮。",
        imageUrl: "https://dummyimage.com/640x360/18241f/f4d9a6&text=Budweiser",
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
        costPrice: 360,
        supplierName: "进口酒水供应商",
        stockQty: 8,
        warningQty: 2,
        status: "active",
        description: "可现场饮用，也可转为客户存酒。",
        imageUrl: "https://dummyimage.com/640x360/261b30/f4d9a6&text=Whisky",
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
        costPrice: 10,
        supplierName: "门店厨房",
        stockQty: 25,
        warningQty: 5,
        status: "active",
        description: "现场现做小吃。",
        imageUrl: "https://dummyimage.com/640x360/233326/f4d9a6&text=Fries",
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
    stockCounts: [],
    scanRecords: [],
    verificationCodes: [],
    staffSessions: [],
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
        handledAt: null,
        handledBy: null,
        expiredHandledAt: null,
        expiredHandledBy: null,
        expiredHandlingNote: "",
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
        imageUrl: "https://dummyimage.com/640x360/18241f/f4d9a6&text=A1+Poker+Table",
        occupiedStartedAt: null,
        consumptionAmount: 0,
        status: "available",
      },
      {
        tableId: "table_vip",
        merchantId,
        storeId,
        name: "VIP 房台",
        type: "VIP卡座",
        capacity: 9,
        imageUrl: "https://dummyimage.com/640x360/261b30/f4d9a6&text=VIP+Room",
        occupiedStartedAt: null,
        consumptionAmount: 0,
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
    rechargeConfigs: [],
    rechargeRecords: [],
    coupons: [],
    couponRecords: [],
    checkins: [],
    lotterySettings: { enabled: false, dailyLimit: 0, cooldownMinutes: 0, costPoints: 0 },
    lotteryPrizes: [
      { prizeId: "prize_beer", name: "百威啤酒 1 瓶", winRate: 50, status: "active", createdAt },
      { prizeId: "prize_points", name: "积分 30", winRate: 50, status: "active", createdAt },
    ],
    lotteryRecords: [],
    voiceEvents: [],
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
      blindLevels: defaultBlindLevels(),
    },
    blindGames: [],
    operationLogs: [],
  };
}

class Store {
  constructor(filePath = defaultDataFile) {
    this.filePath = filePath;
    this.data = null;
    this.saveQueue = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      this.data = seedData();
      await this.save();
      return this.data;
    }
    this.data = JSON.parse(await readFile(this.filePath, "utf8"));
    const shouldSaveAfterLoad = normalizeStoreData(this.data);
    if (shouldSaveAfterLoad) await this.save();
    return this.data;
  }

  async save() {
    const previousSave = this.saveQueue.catch(() => {});
    this.saveQueue = previousSave.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempFile = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tempFile, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tempFile, this.filePath);
    });
    return this.saveQueue;
  }

  async close() {}

  log(operatorId, role, action, targetType, targetId, beforeValue, afterValue, reason = "") {
    const safeBefore = targetType === "Employee" ? publicEmployee(beforeValue) : beforeValue;
    const safeAfter = targetType === "Employee" ? publicEmployee(afterValue) : afterValue;
    this.data.operationLogs.unshift({
      logId: newId("log"),
      merchantId: this.data.settings.merchantId,
      storeId: this.data.settings.storeId,
      operatorId,
      role,
      action,
      targetType,
      targetId,
      beforeJson: safeBefore ? JSON.stringify(safeBefore) : "",
      afterJson: safeAfter ? JSON.stringify(safeAfter) : "",
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

class SQLiteStore extends Store {
  constructor(databasePath) {
    super(databasePath);
    this.databasePath = databasePath;
    this.db = null;
  }

  async load() {
    if (this.databasePath !== ":memory:") await mkdir(dirname(this.databasePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run("store_type", "sqlite_app_state");
    const row = this.db.prepare("SELECT data FROM app_state WHERE id = 1").get();
    if (!row) {
      this.data = seedData();
      await this.save();
      return this.data;
    }
    this.data = JSON.parse(row.data);
    const shouldSaveAfterLoad = normalizeStoreData(this.data);
    if (shouldSaveAfterLoad) await this.save();
    return this.data;
  }

  async save() {
    const previousSave = this.saveQueue.catch(() => {});
    this.saveQueue = previousSave.then(async () => {
      if (!this.db) throw new Error("SQLite store is not loaded");
      this.db
        .prepare("INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
        .run(JSON.stringify(this.data, null, 2), now());
    });
    return this.saveQueue;
  }

  async close() {
    await this.saveQueue.catch(() => {});
    this.db?.close();
    this.db = null;
  }
}

function publicOrder(store, order) {
  const items = store.data.orderItems
    .filter((item) => item.orderId === order.orderId)
    .map((item) => ({ ...item, product: store.data.products.find((sku) => sku.skuId === item.skuId) }));
  const employee = order.employeeId ? publicEmployee(store.data.employees.find((item) => item.employeeId === order.employeeId)) : null;
  const user = store.data.users.find((item) => item.userId === order.userId);
  return { ...order, items, employee, user };
}

function dashboard(store) {
  const today = dayKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const paidOrders = store.data.orders.filter((order) => order.payStatus === "paid");
  const todayOrders = paidOrders.filter((order) => order.paidAt?.startsWith(today));
  const yesterdayOrders = paidOrders.filter((order) => order.paidAt?.startsWith(yesterday));
  const revenue = todayOrders.reduce((sum, order) => sum + order.amount, 0);
  const yesterdayRevenue = yesterdayOrders.reduce((sum, order) => sum + order.amount, 0);
  const todayMembers = store.data.users.filter((user) => user.createdAt?.startsWith(today)).length;
  const yesterdayMembers = store.data.users.filter((user) => user.createdAt?.startsWith(yesterday)).length;
  const staffSales = store.data.employees.map((employee) => {
    const orders = paidOrders.filter((order) => order.employeeId === employee.employeeId);
    const sales = orders.reduce((sum, order) => sum + order.amount, 0);
    const commissionRate = Number(employee.commissionRate || 0);
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      role: employee.role,
      commissionRate,
      orderCount: orders.length,
      sales,
      commissionAmount: Math.round(sales * commissionRate * 100) / 100,
    };
  });
  const occupied = store.data.tables.filter((table) => table.status === "occupied" || table.status === "reserved").length;
  const tableUsageRate = store.data.tables.length ? Math.round((occupied / store.data.tables.length) * 100) : 0;
  return {
    todayRevenue: revenue,
    yesterdayRevenue,
    revenueDelta: revenue - yesterdayRevenue,
    todayOrderCount: todayOrders.length,
    yesterdayOrderCount: yesterdayOrders.length,
    orderCountDelta: todayOrders.length - yesterdayOrders.length,
    newMemberCount: todayMembers,
    yesterdayNewMemberCount: yesterdayMembers,
    newMemberDelta: todayMembers - yesterdayMembers,
    memberCount: store.data.users.length,
    tableUsageRate,
    tableUsageRateDelta: tableUsageRate,
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

function dayKeyFor(dateValue = new Date()) {
  return new Date(dateValue).toISOString().slice(0, 10);
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
    operator: publicEmployee(store.data.employees.find((employee) => employee.employeeId === request.operatorId)),
    handledByEmployee: request.handledBy ? publicEmployee(store.data.employees.find((employee) => employee.employeeId === request.handledBy)) : null,
  };
}

function publicStorageLedger(store, ledger) {
  const storage = store.data.customerStorage.find((item) => item.storageId === ledger.storageId);
  return {
    ...ledger,
    storage: storage || null,
    user: store.data.users.find((user) => user.userId === ledger.userId) || null,
    product: store.data.products.find((sku) => sku.skuId === ledger.skuId) || null,
    operator: publicEmployee(store.data.employees.find((employee) => employee.employeeId === ledger.operatorId)),
  };
}

function publicEmployee(employee) {
  if (!employee) return null;
  const { passwordHash: _passwordHash, resetPassword: _resetPassword, ...safe } = employee;
  return safe;
}

async function employeeOrderQr(employee) {
  const qrPayload = `employee:${employee.employeeId}`;
  let qrImage = null;
  if (!mockWechatEnabled() || process.env.WECHAT_QR_DRY_RUN === "true") {
    qrImage = await wechatMiniProgramCode(qrPayload);
  }
  if (!qrImage) {
    qrImage = { imageUrl: await qrDataUri(qrPayload), provider: "payload_qr", page: "", scene: qrPayload };
  }
  return {
    scene: "employee_qr",
    qrPayload,
    qrImageUrl: qrImage.imageUrl,
    qrProvider: qrImage.provider,
    miniProgramPage: qrImage.page,
    miniProgramScene: qrImage.scene,
    employee: publicEmployee(employee),
    title: `${employee.name}专属点单码`,
    hint: "客户扫码后下单，订单、营收和员工业绩归属该员工。",
  };
}

function defaultTableImage(table) {
  if (table?.tableId === "table_vip" || table?.type?.includes("VIP") || table?.name?.includes("VIP")) {
    return "https://dummyimage.com/640x360/261b30/f4d9a6&text=VIP+Room";
  }
  return "https://dummyimage.com/640x360/18241f/f4d9a6&text=Poker+Table";
}

function publicTable(store, table) {
  return {
    ...table,
    imageUrl: table.imageUrl || defaultTableImage(table),
    reservations: store.data.reservations.filter((reservation) => reservation.tableId === table.tableId && reservation.status === "confirmed"),
  };
}

function publicAdminUser(store, user) {
  const storageItems = store.data.customerStorage.filter((item) => item.userId === user.userId && item.quantity > 0);
  const paidOrders = store.data.orders.filter((order) => order.userId === user.userId && order.payStatus === "paid");
  return {
    ...user,
    hasStorage: storageItems.length > 0,
    storageCount: storageItems.reduce((sum, item) => sum + item.quantity, 0),
    orderCount: paidOrders.length,
    totalSpend: paidOrders.reduce((sum, order) => sum + order.amount, 0),
    lastOrderAt: paidOrders.map((order) => order.paidAt || order.createdAt).sort().at(-1) || null,
  };
}

function blindLevelFor(store, level) {
  const levels = store.data.blindSettings?.blindLevels?.length ? store.data.blindSettings.blindLevels : defaultBlindLevels();
  return levels.find((item) => Number(item.level) === Number(level)) || levels[Math.min(level - 1, levels.length - 1)] || { level, smallBlind: 2 ** (level - 1), bigBlind: 2 ** level, ante: 0 };
}

function applyBlindLevel(store, game, level) {
  const next = blindLevelFor(store, level);
  game.level = Number(next.level || level);
  game.smallBlind = Number(next.smallBlind || game.smallBlind || 1);
  game.bigBlind = Number(next.bigBlind || game.bigBlind || 2);
  game.ante = Number(next.ante || 0);
}

function getOrCreatePayment(store, order, provider = "mock_wechat") {
  let payment = store.data.payments.find((item) => item.orderId === order.orderId && item.status !== "cancelled");
  if (!payment) {
    payment = {
      paymentId: newId("pay"),
      orderId: order.orderId,
      wxTransactionId: "",
      amount: order.amount,
      provider,
      status: "created",
      prepayId: "",
      nonceStr: "",
      paySign: "",
      paidAt: null,
      refundedAt: null,
      notifyAt: null,
    };
    store.data.payments.push(payment);
  }
  return payment;
}

function markOrderPaid(store, order, payment, transactionId, reason = "微信支付成功") {
  if (order.payStatus === "paid") return { alreadyPaid: true };
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
  payment.wxTransactionId = transactionId || payment.wxTransactionId;
  payment.status = "paid";
  payment.paidAt = order.paidAt;
  payment.notifyAt ||= order.paidAt;
  for (const item of orderItems) {
    store.createStockLedger(store.getSku(item.skuId), -item.quantity, "sale", "order", order.orderId, "system", "支付成功扣减库存");
  }
  store.createPointsLedger(store.getUser(order.userId), order.pointsAwarded, "消费赠送积分", "order", order.orderId, "system");
  store.log("system", "system", "pay_order", "Order", order.orderId, before, order, reason);
  return { alreadyPaid: false };
}

function markOrderRefunded(store, order, refund, operatorId = "system", reason = "退款成功") {
  if (order.orderStatus === "refunded") return { alreadyRefunded: true };
  if (order.payStatus !== "paid") throw new HttpError(400, "只有已支付订单可退款");
  const before = deepClone(order);
  order.payStatus = "refunded";
  order.orderStatus = "refunded";
  order.refundedAt = now();
  refund.status = "refunded";
  refund.completedAt = order.refundedAt;
  const payment = store.data.payments.find((item) => item.orderId === order.orderId);
  if (payment) {
    payment.status = "refunded";
    payment.refundedAt = order.refundedAt;
  }
  const orderItems = store.data.orderItems.filter((item) => item.orderId === order.orderId);
  for (const item of orderItems) {
    store.createStockLedger(store.getSku(item.skuId), item.quantity, "refund", "order", order.orderId, operatorId, "退款恢复库存");
  }
  const user = store.getUser(order.userId);
  if (user.pointsBalance >= order.pointsAwarded) {
    store.createPointsLedger(user, -order.pointsAwarded, "退款扣回积分", "refund", order.orderId, operatorId);
  } else {
    store.createPointsLedger(user, 0, `积分不足扣回，应扣 ${order.pointsAwarded}`, "refund_exception", order.orderId, operatorId);
  }
  store.log(operatorId, "admin", "refund_order", "Order", order.orderId, before, order, reason);
  return { alreadyRefunded: false };
}

function createVoiceEvent(store, game, eventType, message) {
  const event = {
    eventId: newId("voice"),
    gameId: game.gameId,
    eventType,
    message,
    level: game.level,
    smallBlind: game.smallBlind,
    bigBlind: game.bigBlind,
    createdAt: now(),
  };
  store.data.voiceEvents.unshift(event);
  return event;
}

function publicVerificationCode(store, code) {
  return {
    ...code,
    qrImageUrl: code.qrImageUrl || "",
    qrProvider: code.qrProvider || "payload_qr",
    miniProgramPage: code.miniProgramPage || "",
    miniProgramScene: code.miniProgramScene || code.qrPayload || "",
    user: store.data.users.find((user) => user.userId === code.userId),
    storage: code.storageId ? store.data.customerStorage.find((storage) => storage.storageId === code.storageId) : null,
    coupon: code.couponId ? store.data.coupons.find((coupon) => coupon.couponId === code.couponId) : null,
    lotteryRecord: code.lotteryRecordId ? store.data.lotteryRecords.find((record) => record.recordId === code.lotteryRecordId) : null,
  };
}

async function verificationCodeQrImage(qrPayload) {
  if (!mockWechatEnabled() || process.env.WECHAT_QR_DRY_RUN === "true") {
    return wechatMiniProgramCode(qrPayload, "pages/staff/staff");
  }
  return { imageUrl: await qrDataUri(qrPayload), provider: "payload_qr", page: "", scene: qrPayload };
}

function resolveVerificationCode(store, value) {
  const raw = String(value || "");
  const codeId = raw.startsWith("verify:") ? raw.slice("verify:".length) : raw;
  const code = store.data.verificationCodes.find((item) => item.codeId === codeId);
  if (!code) throw new HttpError(404, "核销二维码不存在");
  if (code.status !== "active") throw new HttpError(400, "核销二维码已失效");
  if (new Date(code.expiresAt).getTime() < Date.now()) {
    code.status = "expired";
    throw new HttpError(400, "核销二维码已过期");
  }
  return code;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return { parsed: {}, raw: "" };
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { parsed: {}, raw: "" };
  try {
    return { parsed: JSON.parse(raw), raw };
  } catch {
    throw new HttpError(400, "请求体不是有效 JSON");
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-staff-session",
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

function sessionFromRequest(store, req) {
  const headerValue = req.headers["x-staff-session"] || req.headers.authorization || "";
  const token = String(Array.isArray(headerValue) ? headerValue[0] : headerValue).replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const session = store.data.staffSessions.find((item) => item.sessionId === token);
  if (!session) throw new HttpError(401, "员工会话不存在或已失效");
  if (new Date(session.expiresAt).getTime() < Date.now()) throw new HttpError(401, "员工会话已过期，请重新登录");
  const employee = store.getEmployee(session.employeeId);
  if (employee.status !== "active") throw new HttpError(403, "员工账号已停用");
  return { session, employee };
}

function roleAllowed(employee, roles) {
  if (!roles.length) return true;
  if (employee.role === "admin") return true;
  return roles.includes(employee.role);
}

function requireStaffAccess(store, req, roles = []) {
  const auth = sessionFromRequest(store, req);
  if (!auth) {
    if (authRequired()) throw new HttpError(401, "请先登录员工账号");
    return null;
  }
  if (!roleAllowed(auth.employee, roles)) throw new HttpError(403, "无权限访问该接口");
  return auth;
}

function defaultRolesForPath(path) {
  if (path === "/api/staff/login") return null;
  if (path === "/api/staff/blind-settings") return ["staff", "dealer", "warehouse", "admin"];
  if (path.startsWith("/api/admin/stock-")) return ["warehouse", "admin"];
  if (path === "/api/admin/stock/adjust") return ["warehouse", "admin"];
  if (path.startsWith("/api/admin/")) return ["admin"];
  if (path.startsWith("/api/staff/")) return ["staff", "dealer", "warehouse", "admin"];
  return null;
}

function createRouter(store) {
  const routes = [];
  let requestQueue = Promise.resolve();
  const add = (method, pattern, handler, options = {}) => routes.push({ method, pattern, handler, options });

  add("GET", "/api/health", async () => ({ ok: true, time: now(), runtime: runtimeInfo() }));
  add("GET", "/api/bootstrap", async () => ({
    settings: store.data.settings,
    store: store.data.stores[0],
    user: store.getUser(),
    employees: store.data.employees.map(publicEmployee),
    seats: store.data.seats,
    runtime: runtimeInfo(),
  }));

  add("POST", "/api/wechat/login", async (body) => {
    if (mockWechatEnabled()) {
      const phone = body.phone || "13800000000";
      let user = store.data.users.find((item) => item.phone === phone);
      if (!user) {
        user = createUserFromWechat(store, {
          openid: `openid_${phone}`,
          nickname: body.nickname || `客户${phone.slice(-4)}`,
          phone,
        });
        store.data.users.push(user);
        await store.save();
      }
      return { user, authProvider: "mock_wechat" };
    }
    const session = await wechatCodeToSession(body.code);
    let user = store.data.users.find((item) => item.openid === session.openid);
    if (!user) {
      user = createUserFromWechat(store, {
        openid: session.openid,
        nickname: body.nickname,
        avatar: body.avatar || "",
        phone: body.phone || "",
      });
      store.data.users.push(user);
    } else {
      const before = deepClone(user);
      if (body.nickname) user.nickname = body.nickname;
      if (body.avatar) user.avatar = body.avatar;
      if (body.phone && !user.phone) user.phone = body.phone;
      store.log(user.userId, "customer", "wechat_login", "User", user.userId, before, user, "微信 code 登录");
    }
    await store.save();
    return { user, authProvider: session.provider };
  });

  add("POST", "/api/staff/login", async (body) => {
    const employee = store.data.employees.find((item) => item.loginAccount === body.account || item.phone === body.account);
    if (!employee || !verifyPassword(body.password || "", employee.passwordHash)) throw new HttpError(401, "账号或密码错误");
    if (employee.status !== "active") throw new HttpError(403, "员工账号已停用");
    const migratedPassword = migrateEmployeePassword(employee);
    const session = {
      sessionId: newId("session"),
      employeeId: employee.employeeId,
      role: employee.role,
      createdAt: now(),
      expiresAt: addDays(7),
    };
    store.data.staffSessions.unshift(session);
    store.log(employee.employeeId, employee.role, migratedPassword ? "staff_login_migrated_password" : "staff_login", "Employee", employee.employeeId, null, session, "员工账号密码登录");
    await store.save();
    return { employee: publicEmployee(employee), session };
  });

  add("GET", "/api/staff/employees/:employeeId/order-qr", async (_body, params) => {
    const employee = store.getEmployee(params.employeeId);
    return { qr: await employeeOrderQr(employee) };
  });

  add("POST", "/api/user/bind-phone", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const before = deepClone(user);
    let phoneProvider = "manual";
    let phone = body.phone;
    if (body.code || !mockWechatEnabled()) {
      const phoneInfo = await wechatCodeToPhone(body.code);
      phone = phoneInfo.phoneNumber || phoneInfo.purePhoneNumber;
      phoneProvider = phoneInfo.provider;
    }
    if (!phone) throw new HttpError(400, "缺少手机号");
    user.phone = phone;
    user.phoneBoundAt = now();
    user.phoneProvider = phoneProvider;
    store.log(user.userId, "customer", "bind_phone", "User", user.userId, before, user, phoneProvider === "manual" ? "手动绑定手机号" : "微信授权绑定手机号");
    await store.save();
    return { user, phoneProvider };
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
    getOrCreatePayment(store, order, runtimeInfo().paymentProvider);
    store.log(user.userId, "customer", "create_order", "Order", order.orderId, null, order, "创建订单");
    await store.save();
    return { order: publicOrder(store, order) };
  });

  add("POST", "/api/orders/:orderId/pay", async (_body, params) => {
    const order = store.getOrder(params.orderId);
    const payment = getOrCreatePayment(store, order, runtimeInfo().paymentProvider);
    if (order.payStatus === "paid") return { order: publicOrder(store, order), payment, paymentProvider: payment.provider, idempotent: true };
    if (order.orderStatus !== "unpaid") throw new HttpError(400, "订单状态不可支付");
    if (!mockWechatEnabled()) {
      const prepay = await createWechatJsapiPrepay(order, store.getUser(order.userId));
      payment.provider = prepay.provider;
      payment.status = "prepay_created";
      payment.prepayId = prepay.prepayId;
      payment.nonceStr = prepay.requestPayment.nonceStr;
      payment.paySign = prepay.requestPayment.paySign;
      payment.requestPayment = prepay.requestPayment;
      await store.save();
      return { order: publicOrder(store, order), payment, paymentProvider: prepay.provider, prepay: prepay.requestPayment };
    }
    payment.provider = "mock_wechat";
    markOrderPaid(store, order, payment, `mock_wx_${order.orderId}`, "模拟微信支付成功");
    await store.save();
    return { order: publicOrder(store, order), payment, paymentProvider: "mock_wechat" };
  });

  add("POST", "/api/payments/wechat/notify", async (body, _params, _query, ctx) => {
    const notification = resolveWechatPayNotify(body, ctx);
    if (notification.tradeState && notification.tradeState !== "SUCCESS") {
      return { ok: true, ignored: true, tradeState: notification.tradeState };
    }
    const order = store.getOrder(notification.orderId);
    const payment = getOrCreatePayment(store, order, "wechat_pay");
    if (order.payStatus === "paid") return { ok: true, idempotent: true, order: publicOrder(store, order), payment };
    if (Number(notification.amount) !== order.amount) throw new HttpError(400, "支付回调金额不匹配");
    markOrderPaid(store, order, payment, notification.transactionId || `wx_${order.orderId}`, "微信支付回调确认");
    payment.notifyVerifiedBy = notification.verifiedBy;
    await store.save();
    return { ok: true, order: publicOrder(store, order), payment };
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
    const existingRefund = store.data.refunds.find((item) => item.orderId === order.orderId && item.status !== "failed");
    if (existingRefund) return { order: publicOrder(store, order), refund: existingRefund, refundProvider: existingRefund.provider, idempotent: true };
    const payment = store.data.payments.find((item) => item.orderId === order.orderId);
    const reason = body.reason || "管理员退款";
    const refund = {
      refundId: newId("refund"),
      orderId: order.orderId,
      amount: order.amount,
      reason,
      provider: "mock_wechat",
      status: "created",
      wxRefundId: "",
      outRefundNo: "",
      operatorId: body.operatorId || "emp_admin",
      createdAt: now(),
      completedAt: null,
    };
    store.data.refunds.push(refund);
    if (!mockWechatEnabled()) {
      const wechatRefund = await createWechatRefund(order, payment, reason);
      refund.provider = wechatRefund.provider;
      refund.status = wechatRefund.status === "SUCCESS" ? "refunded" : "processing";
      refund.wxRefundId = wechatRefund.refundId;
      refund.outRefundNo = wechatRefund.outRefundNo;
      store.log(body.operatorId || "emp_admin", "admin", "request_refund", "Order", order.orderId, null, refund, reason);
      if (wechatRefund.status === "SUCCESS") {
        markOrderRefunded(store, order, refund, body.operatorId || "emp_admin", "微信退款申请同步成功");
      }
      await store.save();
      return { order: publicOrder(store, order), refund, refundProvider: refund.provider };
    }
    refund.provider = "mock_wechat";
    markOrderRefunded(store, order, refund, body.operatorId || "emp_admin", reason);
    await store.save();
    return { order: publicOrder(store, order), refund, refundProvider: "mock_wechat" };
  });

  add("POST", "/api/admin/refunds/:refundId/confirm", async (body, params) => {
    const refund = store.data.refunds.find((item) => item.refundId === params.refundId || item.outRefundNo === params.refundId || item.wxRefundId === params.refundId);
    if (!refund) throw new HttpError(404, "退款记录不存在");
    const order = store.getOrder(refund.orderId);
    if (refund.status === "refunded" || order.orderStatus === "refunded") {
      return { order: publicOrder(store, order), refund, idempotent: true };
    }
    if (!mockWechatEnabled() && process.env.WECHAT_PAY_DRY_RUN !== "true" && !body.confirmedByWechat) {
      throw new HttpError(400, "真实微信退款需由微信退款成功通知确认");
    }
    if (body.wxRefundId) refund.wxRefundId = body.wxRefundId;
    if (body.outRefundNo) refund.outRefundNo = body.outRefundNo;
    if (body.status && body.status !== "SUCCESS") {
      refund.status = String(body.status).toLowerCase();
      await store.save();
      return { order: publicOrder(store, order), refund, ignored: true };
    } else {
      markOrderRefunded(store, order, refund, body.operatorId || "emp_admin", body.reason || "微信退款成功确认");
    }
    await store.save();
    return { order: publicOrder(store, order), refund };
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

  add("GET", "/api/storage-records", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    const ledgers = store.data.customerStorageLedgers
      .filter((ledger) => ledger.userId === userId)
      .map((ledger) => publicStorageLedger(store, ledger));
    const pickupRequests = store.data.storagePickupRequests
      .filter((request) => request.userId === userId)
      .map((request) => ({ ...request, storage: store.data.customerStorage.find((storage) => storage.storageId === request.storageId) || null }));
    return { ledgers, pickupRequests };
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
        balance: 0,
        memberLevel: "普通会员",
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

  add("POST", "/api/admin/storage/:storageId/expire-handle", async (body, params) => {
    const storage = store.getStorage(params.storageId);
    if (storage.status !== "expired" && new Date(storage.expireAt).getTime() >= Date.now()) {
      throw new HttpError(400, "存酒尚未过期");
    }
    const before = deepClone(storage);
    const action = body.action === "extend" ? "extend" : "dispose";
    if (action === "extend") {
      storage.status = "available";
      storage.expireAt = body.expireAt || addDays(Number(body.extendDays || 30));
    } else {
      storage.status = "disposed";
      storage.quantity = 0;
    }
    storage.expiredHandledBy = body.operatorId || "emp_admin";
    storage.expiredHandledAt = now();
    storage.expiredHandlingNote = body.note || (action === "extend" ? "人工确认延期" : "人工确认过期处理");
    store.data.customerStorageLedgers.unshift({
      ledgerId: newId("storageLedger"),
      storageId: storage.storageId,
      userId: storage.userId,
      skuId: storage.skuId,
      changeQty: action === "dispose" ? -before.quantity : 0,
      quantityAfter: storage.quantity,
      actionType: action === "extend" ? "expired_extend" : "expired_dispose",
      operatorId: body.operatorId || "emp_admin",
      reason: storage.expiredHandlingNote,
      createdAt: now(),
    });
    store.log(body.operatorId || "emp_admin", "admin", "handle_expired_storage", "CustomerStorage", storage.storageId, before, storage, storage.expiredHandlingNote);
    await store.save();
    return { storage };
  });

  add("GET", "/api/tables", async (_body, _params, query) => {
    let tables = store.data.tables;
    const keyword = query.get("keyword");
    const status = query.get("status");
    if (keyword) tables = tables.filter((table) => `${table.name}${table.type}`.includes(keyword));
    if (status) tables = tables.filter((table) => table.status === status);
    return { tables: tables.map((table) => publicTable(store, table)) };
  });

  add("POST", "/api/reservations", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const table = store.data.tables.find((item) => item.tableId === body.tableId);
    if (!table) throw new HttpError(404, "桌位不存在");
    const partySize = Number(body.partySize || body.seatCount || 1);
    if (!Number.isInteger(partySize) || partySize < 1) throw new HttpError(400, "预约人数不合法");
    if (partySize > Number(table.capacity || 1)) throw new HttpError(400, "预约人数超过桌台容量");
    const reservation = {
      reservationId: newId("reservation"),
      merchantId: table.merchantId,
      storeId: table.storeId,
      userId: user.userId,
      tableId: table.tableId,
      status: "pending",
      reservationTime: body.reservationTime || now(),
      partySize,
      contactPhone: body.contactPhone || user.phone,
      remark: body.remark || "",
      createdAt: now(),
    };
    store.data.reservations.unshift(reservation);
    store.log(user.userId, "customer", "create_reservation", "Reservation", reservation.reservationId, null, reservation, "提交预约");
    await store.save();
    return { reservation };
  });

  add("GET", "/api/reservations", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return {
      reservations: store.data.reservations
        .filter((reservation) => reservation.userId === userId)
        .map((reservation) => ({ ...reservation, table: store.data.tables.find((table) => table.tableId === reservation.tableId) })),
    };
  });

  add("POST", "/api/reservations/:reservationId/cancel", async (body, params) => {
    const reservation = store.data.reservations.find((item) => item.reservationId === params.reservationId);
    if (!reservation) throw new HttpError(404, "预约不存在");
    if (reservation.status !== "pending" && reservation.status !== "confirmed") throw new HttpError(400, "预约不可取消");
    const before = deepClone(reservation);
    reservation.status = "cancelled";
    reservation.cancelledAt = now();
    reservation.cancelReason = body.reason || "客户取消预约";
    const table = store.data.tables.find((item) => item.tableId === reservation.tableId);
    if (table && table.status === "reserved") table.status = "available";
    store.log(reservation.userId, "customer", "cancel_reservation", "Reservation", reservation.reservationId, before, reservation, reservation.cancelReason);
    await store.save();
    return { reservation, table };
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
    if (table && (reservation.status === "cancelled" || reservation.status === "expired")) table.status = "available";
    if (reservation.status === "confirmed" && !reservation.confirmedAt) reservation.confirmedAt = now();
    if (reservation.status === "cancelled" && !reservation.cancelledAt) {
      reservation.cancelledAt = now();
      reservation.cancelReason = body.reason || "后台取消预约";
    }
    if (reservation.status === "expired") reservation.expiredAt = now();
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
  add("PATCH", "/api/admin/categories/:categoryId", async (body, params) => {
    const category = store.data.categories.find((item) => item.categoryId === params.categoryId);
    if (!category) throw new HttpError(404, "商品分类不存在");
    const before = deepClone(category);
    if (body.name !== undefined) category.name = body.name;
    if (body.sortOrder !== undefined) category.sortOrder = Number(body.sortOrder);
    if (body.status !== undefined) category.status = body.status;
    store.log(body.operatorId || "emp_admin", "admin", "update_category", "ProductCategory", category.categoryId, before, category, "修改商品分类");
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
      costPrice: Number(body.costPrice || 0),
      supplierName: body.supplierName || "",
      stockQty: Number(body.stockQty || 0),
      warningQty: Number(body.warningQty || 0),
      status: body.status || "active",
      description: body.description || "",
      imageUrl: body.imageUrl || "",
      storageDays: Number(body.storageDays || 0),
    };
    if (product.price < 0 || product.costPrice < 0 || product.stockQty < 0) throw new HttpError(400, "价格、成本和库存不能为负数");
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
  add("PATCH", "/api/admin/products/:skuId", async (body, params) => {
    const product = store.getSku(params.skuId);
    const before = deepClone(product);
    for (const key of ["categoryId", "name", "spec", "unit", "status", "description", "imageUrl", "supplierName"]) {
      if (body[key] !== undefined) product[key] = body[key];
    }
    for (const key of ["price", "costPrice", "warningQty", "storageDays"]) {
      if (body[key] !== undefined) product[key] = Number(body[key]);
    }
    store.log(body.operatorId || "emp_admin", "admin", "update_product", "ProductSKU", product.skuId, before, product, body.reason || "修改 SKU");
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
  add("GET", "/api/admin/stock-counts", async () => ({
    counts: store.data.stockCounts.map((count) => ({ ...count, product: store.data.products.find((sku) => sku.skuId === count.skuId) })).reverse(),
  }));
  add("POST", "/api/admin/stock-counts", async (body) => {
    const sku = store.getSku(body.skuId);
    const before = deepClone(sku);
    const countedQty = Number(body.countedQty);
    if (countedQty < 0) throw new HttpError(400, "盘点库存不能为负数");
    const bookQty = sku.stockQty;
    const differenceQty = countedQty - bookQty;
    const count = {
      countId: newId("stockCount"),
      merchantId: sku.merchantId,
      storeId: sku.storeId,
      skuId: sku.skuId,
      bookQty,
      countedQty,
      differenceQty,
      status: "completed",
      operatorId: body.operatorId || "emp_admin",
      reason: body.reason || "后台库存盘点",
      createdAt: now(),
    };
    store.data.stockCounts.unshift(count);
    sku.stockQty = countedQty;
    const ledger = {
      ledgerId: newId("stock"),
      merchantId: sku.merchantId,
      storeId: sku.storeId,
      skuId: sku.skuId,
      changeQty: differenceQty,
      stockAfter: sku.stockQty,
      changeType: differenceQty > 0 ? "stock_count_gain" : differenceQty < 0 ? "stock_count_loss" : "stock_count_even",
      sourceType: "stock_count",
      sourceId: count.countId,
      operatorId: count.operatorId,
      reason: count.reason,
      createdAt: now(),
    };
    store.data.stockLedgers.unshift(ledger);
    store.log(count.operatorId, "admin", "stock_count", "ProductSKU", sku.skuId, before, sku, count.reason);
    await store.save();
    return { count: { ...count, product: sku }, product: sku, ledger };
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
  add("GET", "/api/admin/storage-ledgers", async (_body, _params, query) => {
    let ledgers = store.data.customerStorageLedgers;
    const userId = query.get("userId");
    const storageId = query.get("storageId");
    const skuId = query.get("skuId");
    const actionType = query.get("actionType");
    if (userId) ledgers = ledgers.filter((ledger) => ledger.userId === userId);
    if (storageId) ledgers = ledgers.filter((ledger) => ledger.storageId === storageId);
    if (skuId) ledgers = ledgers.filter((ledger) => ledger.skuId === skuId);
    if (actionType) ledgers = ledgers.filter((ledger) => ledger.actionType === actionType);
    return { ledgers: ledgers.map((ledger) => publicStorageLedger(store, ledger)) };
  });
  add("GET", "/api/admin/users", async () => ({ users: store.data.users.map((user) => publicAdminUser(store, user)) }));
  add("GET", "/api/admin/points-ledgers", async () => ({ ledgers: store.data.pointsLedgers }));
  add("GET", "/api/admin/consumption-records", async (_body, _params, query) => {
    const userId = query.get("userId");
    let orders = store.data.orders.filter((order) => order.payStatus === "paid");
    if (userId) orders = orders.filter((order) => order.userId === userId);
    return { records: orders.map((order) => publicOrder(store, order)).reverse() };
  });
  add("GET", "/api/admin/employees", async () => ({ employees: store.data.employees.map(publicEmployee) }));
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
    const firstLevel = blindLevelFor(store, 1);
    const game = {
      gameId: newId("game"),
      merchantId: employee.merchantId,
      storeId: employee.storeId,
      operatorId: employee.employeeId,
      smallBlind: Number(body.smallBlind || firstLevel.smallBlind || 1),
      bigBlind: Number(body.bigBlind || firstLevel.bigBlind || 2),
      ante: Number(body.ante || firstLevel.ante || 0),
      intervalMinutes: Number(body.intervalMinutes || 10),
      initialPlayers: Number(body.initialPlayers || 9),
      currentPlayers: Number(body.initialPlayers || 9),
      buyinAmount: Number(body.buyinAmount || 100),
      buyinCount: 0,
      level: 1,
      status: "running",
      voiceEnabled: body.voiceEnabled !== false,
      levelStartedAt: now(),
      remainingSecondsOverride: null,
      lastVoiceMarks: [],
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
    if (action === "pause" && body.remainingSeconds !== undefined) game.remainingSecondsOverride = Number(body.remainingSeconds);
    if (action === "resume") {
      game.status = "running";
      game.levelStartedAt = now();
    }
    if (action === "next_level") {
      applyBlindLevel(store, game, game.level + 1);
      game.levelStartedAt = now();
      game.remainingSecondsOverride = null;
      game.lastVoiceMarks = [];
      if (game.voiceEnabled) createVoiceEvent(store, game, "level_up", `升盲！当前盲注 ${game.smallBlind}/${game.bigBlind}`);
    }
    if (action === "prev_level" && game.level > 1) {
      applyBlindLevel(store, game, game.level - 1);
      game.levelStartedAt = now();
      game.remainingSecondsOverride = null;
      game.lastVoiceMarks = [];
    }
    if (action === "eliminate") {
      if (body.seatNo !== undefined) {
        const seat = store.data.seats.find((item) => item.seatNo === Number(body.seatNo));
        if (!seat) throw new HttpError(404, "座位不存在");
        if (!seat.eliminated) game.currentPlayers = Math.max(1, game.currentPlayers - 1);
        seat.status = "eliminated";
        seat.eliminated = true;
        seat.updatedAt = now();
      } else {
        game.currentPlayers = Math.max(1, game.currentPlayers - 1);
      }
    }
    if (action === "restore") {
      if (body.seatNo !== undefined) {
        const seat = store.data.seats.find((item) => item.seatNo === Number(body.seatNo));
        if (!seat) throw new HttpError(404, "座位不存在");
        if (seat.eliminated) game.currentPlayers = Math.min(game.initialPlayers, game.currentPlayers + 1);
        seat.status = seat.userId ? "occupied" : "available";
        seat.eliminated = false;
        seat.updatedAt = now();
      } else {
        game.currentPlayers = Math.min(game.initialPlayers, game.currentPlayers + 1);
      }
    }
    if (action === "buyin") game.buyinCount += Number(body.count || 1);
    if (action === "buyin_minus") game.buyinCount = Math.max(0, game.buyinCount - Number(body.count || 1));
    if (action === "set_buyin_amount") {
      const buyinAmount = Number(body.buyinAmount);
      if (buyinAmount <= 0) throw new HttpError(400, "买入金额必须大于 0");
      game.buyinAmount = buyinAmount;
    }
    if (action === "reset") {
      game.status = "running";
      game.level = 1;
      game.currentPlayers = game.initialPlayers;
      game.buyinCount = 0;
      game.levelStartedAt = now();
      game.remainingSecondsOverride = null;
      game.lastVoiceMarks = [];
    }
    game.updatedAt = now();
    store.log(body.operatorId || game.operatorId, "dealer", "update_blind_game", "BlindGame", game.gameId, before, game, action || "更新升盲游戏");
    await store.save();
    return { game };
  });

  add("GET", "/api/staff/blind-games", async () => ({ games: store.data.blindGames }));

  add("GET", "/api/staff/blind-games/:gameId/timer", async (_body, params) => {
    const game = store.data.blindGames.find((item) => item.gameId === params.gameId);
    if (!game) throw new HttpError(404, "升盲游戏不存在");
    const totalSeconds = Math.max(60, Number(game.intervalMinutes || 10) * 60);
    const elapsed = game.status === "running" ? Math.floor((Date.now() - new Date(game.levelStartedAt || game.createdAt).getTime()) / 1000) : 0;
    let remainingSeconds = game.remainingSecondsOverride ?? Math.max(0, totalSeconds - elapsed);
    const events = [];
    game.lastVoiceMarks ||= [];
    for (const mark of [30, 10]) {
      if (game.voiceEnabled && remainingSeconds <= mark && !game.lastVoiceMarks.includes(mark) && remainingSeconds > 0) {
        game.lastVoiceMarks.push(mark);
        events.push(createVoiceEvent(store, game, `remaining_${mark}`, `还有${mark}秒升盲`));
      }
    }
    if (game.status === "running" && remainingSeconds <= 0) {
      const before = deepClone(game);
      game.level += 1;
      game.smallBlind *= 2;
      game.bigBlind *= 2;
      game.levelStartedAt = now();
      game.remainingSecondsOverride = null;
      game.lastVoiceMarks = [];
      remainingSeconds = totalSeconds;
      if (game.voiceEnabled) events.push(createVoiceEvent(store, game, "level_up", `升盲！当前盲注 ${game.smallBlind}/${game.bigBlind}`));
      store.log(game.operatorId, "dealer", "auto_next_level", "BlindGame", game.gameId, before, game, "倒计时结束自动升盲");
    }
    await store.save();
    return { game, timer: { totalSeconds, remainingSeconds, elapsedSeconds: Math.max(0, totalSeconds - remainingSeconds), events, latestEvents: store.data.voiceEvents.filter((event) => event.gameId === game.gameId).slice(0, 6) } };
  });

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
    };
  });

  add("GET", "/api/leaderboard/points", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { top10: [], mine: null, userId, featureEnabled: false };
  });

  add("GET", "/api/checkin", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    const records = store.data.checkins.filter((item) => item.userId === userId);
    return { records, calendar: checkinCalendar(records), settings: { enabled: store.data.settings.checkinEnabled, points: store.data.settings.checkinPoints } };
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
    const records = store.data.checkins.filter((item) => item.userId === user.userId);
    return { record, user, calendar: checkinCalendar(records) };
  });

  add("GET", "/api/coupons", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { coupons: store.data.coupons.filter((coupon) => coupon.userId === userId).map((coupon) => publicCoupon(store, coupon)), records: store.data.couponRecords.filter((record) => record.userId === userId) };
  });

  add("POST", "/api/coupons/exchange", async (body) => {
    store.getUser(body.userId || "user_demo");
    throw new HttpError(400, "积分兑换酒水券暂未开放");
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

  add("POST", "/api/verification-codes", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    const type = body.type || "points";
    const code = {
      codeId: newId("verify"),
      qrPayload: "",
      userId: user.userId,
      type,
      status: "active",
      storageId: body.storageId || null,
      couponId: body.couponId || null,
      lotteryRecordId: body.lotteryRecordId || null,
      pointsAmount: body.pointsAmount !== undefined ? Number(body.pointsAmount) : null,
      createdAt: now(),
      expiresAt: body.expiresAt || addDays(1),
      usedAt: null,
      usedBy: null,
      qrProvider: "payload_qr",
      miniProgramPage: "",
      miniProgramScene: "",
    };
    if (type === "storage") {
      const storage = store.getStorage(code.storageId);
      if (storage.userId !== user.userId) throw new HttpError(403, "不能生成他人存酒二维码");
      if (storage.status !== "available") throw new HttpError(400, "存酒状态不可生成二维码");
    }
    if (type === "coupon") {
      throw new HttpError(400, "酒水券二维码暂未开放");
    }
    if (type === "lottery") {
      throw new HttpError(400, "中奖二维码暂未开放");
    }
    if (type === "points") {
      const amount = Math.abs(Number(code.pointsAmount || 0));
      if (!amount) throw new HttpError(400, "积分二维码需要填写积分数量");
      if (user.pointsBalance < amount) throw new HttpError(400, "积分不足，无法生成取积分二维码");
      code.pointsAmount = amount;
    }
    code.qrPayload = `verify:${code.codeId}`;
    const qrImage = await verificationCodeQrImage(code.qrPayload);
    code.qrImageUrl = qrImage.imageUrl;
    code.qrProvider = qrImage.provider;
    code.miniProgramPage = qrImage.page;
    code.miniProgramScene = qrImage.scene;
    store.data.verificationCodes.unshift(code);
    store.log(user.userId, "customer", "create_verification_code", "VerificationCode", code.codeId, null, code, `生成${type}二维码`);
    await store.save();
    return { code: publicVerificationCode(store, code) };
  });

  add("GET", "/api/verification-codes", async (_body, _params, query) => {
    const userId = query.get("userId") || "user_demo";
    return { codes: store.data.verificationCodes.filter((code) => code.userId === userId).map((code) => publicVerificationCode(store, code)) };
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
    return { records: store.data.rechargeRecords.filter((record) => record.userId === userId), configs: [], featureEnabled: false };
  });

  add("POST", "/api/recharge", async () => {
    throw new HttpError(400, "余额充值暂未开放，请使用微信支付点单");
  });

  add("GET", "/api/store/location", async () => ({ location: store.data.settings.location, store: store.data.stores[0] }));
  add("GET", "/api/support/contact", async () => ({ phone: store.data.settings.supportPhone }));
  add("POST", "/api/scan/employee", async (body) => {
    const scenePayload = decodeURIComponent(body.scene || "");
    const rawPayload = body.rawCode || scenePayload;
    const resolvedEmployeeId = body.employeeId || (rawPayload.includes("employee:") ? rawPayload.split("employee:")[1] : "");
    const employee = store.getEmployee(resolvedEmployeeId || "emp_anna");
    const expectedPayload = `employee:${employee.employeeId}`;
    if (rawPayload && rawPayload !== expectedPayload) throw new HttpError(400, "员工二维码码值不匹配");
    const record = {
      recordId: newId("scan"),
      userId: body.userId || "user_demo",
      employeeId: employee.employeeId,
      scene: "employee_qr",
      rawCode: rawPayload || expectedPayload,
      createdAt: now(),
    };
    store.data.scanRecords.unshift(record);
    store.log(record.userId, "customer", "scan_employee_qr", "Employee", employee.employeeId, null, record, "客户扫码点单归属员工");
    await store.save();
    return { employee: publicEmployee(employee), record, scene: "employee_qr" };
  });

  add("POST", "/api/lottery/draw", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    if (!store.data.lotterySettings.enabled) throw new HttpError(400, "积分抽奖暂未开放");
    const today = dayKey();
    const todayCount = store.data.lotteryRecords.filter((record) => record.userId === user.userId && record.createdAt.startsWith(today)).length;
    if (todayCount >= store.data.lotterySettings.dailyLimit) throw new HttpError(429, "今日抽奖次数已用完");
    const cooldownMinutes = Number(store.data.lotterySettings.cooldownMinutes || 0);
    const lastDraw = store.data.lotteryRecords.find((record) => record.userId === user.userId);
    if (cooldownMinutes > 0 && lastDraw && Date.now() - new Date(lastDraw.createdAt).getTime() < cooldownMinutes * 60 * 1000) {
      throw new HttpError(429, "抽奖冷却中");
    }
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
    return { records: store.data.lotteryRecords.filter((record) => record.userId === userId), settings: store.data.lotterySettings, prizes: [], featureEnabled: false };
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
    employee.passwordHash = hashPassword(body.newPassword || "demo");
    employee.passwordChangedAt = now();
    store.log(employee.employeeId, employee.role, "change_password", "Employee", employee.employeeId, before, employee, "员工修改密码");
    await store.save();
    return { employee: publicEmployee(employee) };
  });

  add("POST", "/api/staff/verify-code", async (body) => {
    const user = store.getUser(body.userId || "user_demo");
    return { user, pointsBalance: user.pointsBalance, storage: store.data.customerStorage.filter((item) => item.userId === user.userId), coupons: store.data.coupons.filter((item) => item.userId === user.userId) };
  });

  add("POST", "/api/staff/verification-codes/scan", async (body) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const code = resolveVerificationCode(store, body.qrPayload || body.codeId);
    store.log(employee.employeeId, employee.role, "scan_verification_code", "VerificationCode", code.codeId, null, code, "员工扫码查看核销二维码");
    await store.save();
    return { code: publicVerificationCode(store, code) };
  });

  add("POST", "/api/staff/verification-codes/:codeId/confirm", async (body, params) => {
    const employee = store.getEmployee(body.operatorId || "emp_anna");
    const code = resolveVerificationCode(store, params.codeId);
    const beforeCode = deepClone(code);
    let result = {};
    if (code.type === "points") {
      const user = store.getUser(code.userId);
      const beforeUser = deepClone(user);
      const amount = Math.abs(Number(code.pointsAmount || 0));
      if (user.pointsBalance < amount) throw new HttpError(400, "积分不足，无法核销");
      const ledger = store.createPointsLedger(user, -amount, "二维码取积分", "verification_code", code.codeId, employee.employeeId);
      store.log(employee.employeeId, employee.role, "confirm_points_qr", "User", user.userId, beforeUser, user, "员工扫码核销积分");
      result = { user, ledger };
    } else if (code.type === "storage") {
      const storage = store.getStorage(code.storageId);
      if (storage.status !== "available") throw new HttpError(400, "存酒状态不可核销");
      if (new Date(storage.expireAt).getTime() < Date.now()) {
        storage.status = "expired";
        throw new HttpError(400, "存酒已过期，需管理员处理");
      }
      const beforeStorage = deepClone(storage);
      const quantity = Math.min(storage.quantity, Number(body.quantity || 1));
      store.createStorageLedger(storage, -quantity, "qr_pickup_confirm", employee.employeeId, "员工扫码取酒");
      store.log(employee.employeeId, employee.role, "confirm_storage_qr", "CustomerStorage", storage.storageId, beforeStorage, storage, "员工扫码核销取酒");
      result = { storage };
    } else if (code.type === "coupon") {
      const coupon = store.data.coupons.find((item) => item.couponId === code.couponId);
      if (!coupon) throw new HttpError(404, "酒水券不存在");
      if (coupon.status !== "available" && coupon.status !== "pending") throw new HttpError(400, "酒水券不可核销");
      const beforeCoupon = deepClone(coupon);
      coupon.status = "completed";
      coupon.completedAt = now();
      const record = { recordId: newId("couponRecord"), couponId: coupon.couponId, userId: coupon.userId, action: "qr_redeem_confirm", status: "completed", operatorId: employee.employeeId, createdAt: now() };
      store.data.couponRecords.unshift(record);
      store.log(employee.employeeId, employee.role, "confirm_coupon_qr", "Coupon", coupon.couponId, beforeCoupon, coupon, "员工扫码核销酒水券");
      result = { coupon: publicCoupon(store, coupon), record };
    } else if (code.type === "lottery") {
      const record = store.data.lotteryRecords.find((item) => item.recordId === code.lotteryRecordId);
      if (!record) throw new HttpError(404, "中奖记录不存在");
      if (record.status !== "won" && record.status !== "redeeming") throw new HttpError(400, "中奖记录不可核销");
      const beforeRecord = deepClone(record);
      record.status = "completed";
      record.redeemedBy = employee.employeeId;
      record.redeemedAt = now();
      store.log(employee.employeeId, employee.role, "confirm_lottery_qr", "LotteryRecord", record.recordId, beforeRecord, record, "员工扫码核销中奖记录");
      result = { lotteryRecord: record };
    } else {
      throw new HttpError(400, "不支持的二维码类型");
    }
    code.status = "used";
    code.usedAt = now();
    code.usedBy = employee.employeeId;
    store.log(employee.employeeId, employee.role, "confirm_verification_code", "VerificationCode", code.codeId, beforeCode, code, "员工确认核销二维码");
    await store.save();
    return { code: publicVerificationCode(store, code), result };
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
    const employee = store.getEmployee(employeeId);
    const commissionRate = Number(employee.commissionRate || 0);
    const rows = [];
    for (let index = 0; index < months; index += 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - index);
      const key = monthKey(date);
      const orders = paid.filter((order) => monthKey(order.paidAt || order.createdAt) === key);
      const sales = orders.reduce((sum, order) => sum + order.amount, 0);
      rows.push({ month: key, orderCount: orders.length, sales, commissionRate, commissionAmount: Math.round(sales * commissionRate * 100) / 100 });
    }
    return { employee: publicEmployee(employee), rows };
  });

  add("GET", "/api/staff/performance/daily", async (_body, _params, query) => {
    const employeeId = query.get("employeeId") || "emp_anna";
    const selectedMonth = query.get("month") || query.get("date") || monthKey();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth)) throw new HttpError(400, "月份格式应为 YYYY-MM");
    const employee = store.getEmployee(employeeId);
    const commissionRate = Number(employee.commissionRate || 0);
    const paid = store.data.orders.filter((order) => {
      if (order.employeeId !== employeeId || order.payStatus !== "paid") return false;
      return monthKey(order.paidAt || order.createdAt) === selectedMonth;
    });
    const daysInMonth = new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate();
    const rows = Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${selectedMonth}-${String(index + 1).padStart(2, "0")}`;
      const orders = paid.filter((order) => dayKeyFor(order.paidAt || order.createdAt) === date);
      const sales = orders.reduce((sum, order) => sum + order.amount, 0);
      return { date, orderCount: orders.length, sales, commissionRate, commissionAmount: Math.round(sales * commissionRate * 100) / 100 };
    });
    return {
      employee: publicEmployee(employee),
      month: selectedMonth,
      rows,
      totalSales: rows.reduce((sum, row) => sum + row.sales, 0),
      totalOrders: rows.reduce((sum, row) => sum + row.orderCount, 0),
      totalCommission: rows.reduce((sum, row) => sum + row.commissionAmount, 0),
    };
  });

  add("GET", "/api/admin/finance/overview", async () => {
    const paid = store.data.orders.filter((order) => order.payStatus === "paid");
    const today = dayKey();
    const currentMonth = monthKey();
    return {
      todayRevenue: paid.filter((order) => order.paidAt?.startsWith(today)).reduce((sum, order) => sum + order.amount, 0),
      monthRevenue: paid.filter((order) => monthKey(order.paidAt || order.createdAt) === currentMonth).reduce((sum, order) => sum + order.amount, 0),
      wechatPayRevenue: paid.reduce((sum, order) => sum + order.amount, 0),
      trend: Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - index));
        const key = date.toISOString().slice(0, 10);
        return { date: key, revenue: paid.filter((order) => order.paidAt?.startsWith(key)).reduce((sum, order) => sum + order.amount, 0) };
      }),
    };
  });

  add("GET", "/api/admin/business-details", async () => ({ details: store.data.orders.filter((order) => order.payStatus === "paid").map((order) => publicOrder(store, order)).reverse() }));
  add("GET", "/api/admin/recharge-configs", async () => ({ configs: [], featureEnabled: false }));
  add("POST", "/api/admin/recharge-configs", async () => {
    throw new HttpError(400, "余额充值暂未开放，请使用微信支付点单");
  });
  add("PATCH", "/api/admin/recharge-configs/:configId", async () => {
    throw new HttpError(400, "余额充值暂未开放，请使用微信支付点单");
  });
  add("GET", "/api/admin/recharge-records", async () => ({ records: store.data.rechargeRecords }));
  add("GET", "/api/admin/member-levels", async () => ({ levels: store.data.memberLevels }));
  add("POST", "/api/admin/member-levels", async (body) => {
    const level = { levelId: newId("level"), name: body.name, minPoints: Number(body.minPoints || 0), status: body.status || "active" };
    store.data.memberLevels.push(level);
    await store.save();
    return { level };
  });
  add("PATCH", "/api/admin/member-levels/:levelId", async (body, params) => {
    const level = store.data.memberLevels.find((item) => item.levelId === params.levelId);
    if (!level) throw new HttpError(404, "会员等级不存在");
    const before = deepClone(level);
    if (body.name !== undefined) level.name = body.name;
    if (body.minPoints !== undefined) level.minPoints = Number(body.minPoints);
    if (body.status !== undefined) level.status = body.status;
    store.log(body.operatorId || "emp_admin", "admin", "update_member_level", "MemberLevel", level.levelId, before, level, "修改会员等级");
    await store.save();
    return { level };
  });
  add("GET", "/api/admin/points-config", async () => ({
    config: {
      pointRate: store.data.settings.pointRate,
      pointsVisible: store.data.settings.pointsVisible,
      checkinEnabled: store.data.settings.checkinEnabled,
      checkinPoints: store.data.settings.checkinPoints,
      pointExpireDays: store.data.settings.pointExpireDays,
    },
  }));
  add("PATCH", "/api/admin/points-config", async (body) => {
    const before = deepClone(store.data.settings);
    for (const key of ["pointRate", "checkinPoints", "pointExpireDays"]) {
      if (body[key] !== undefined) store.data.settings[key] = Number(body[key]);
    }
    for (const key of ["pointsVisible", "checkinEnabled"]) {
      if (body[key] !== undefined) store.data.settings[key] = Boolean(body[key]);
    }
    store.log(body.operatorId || "emp_admin", "admin", "update_points_config", "Settings", store.data.settings.storeId, before, store.data.settings, "修改积分配置");
    await store.save();
    return { config: { pointRate: store.data.settings.pointRate, pointsVisible: store.data.settings.pointsVisible, checkinEnabled: store.data.settings.checkinEnabled, checkinPoints: store.data.settings.checkinPoints, pointExpireDays: store.data.settings.pointExpireDays } };
  });
  add("GET", "/api/admin/lottery/overview", async () => {
    return { totalDraws: 0, monthDraws: 0, wins: 0, todayCostPoints: 0, records: [], settings: store.data.lotterySettings, featureEnabled: false };
  });
  add("GET", "/api/admin/lottery/prizes", async () => ({ prizes: [], settings: store.data.lotterySettings, featureEnabled: false }));
  add("POST", "/api/admin/lottery/prizes", async () => {
    throw new HttpError(400, "积分抽奖暂未开放");
  });
  add("PATCH", "/api/admin/lottery/prizes/:prizeId", async () => {
    throw new HttpError(400, "积分抽奖暂未开放");
  });
  add("PATCH", "/api/admin/lottery/settings", async () => {
    throw new HttpError(400, "积分抽奖暂未开放");
  });
  add("GET", "/api/admin/table-types", async () => ({ tableTypes: store.data.tableTypes }));
  add("POST", "/api/admin/table-types", async (body) => {
    const type = { typeId: newId("tableType"), name: body.name, capacity: Number(body.capacity || 1), status: body.status || "active" };
    store.data.tableTypes.push(type);
    await store.save();
    return { type };
  });
  add("GET", "/api/admin/tables", async (_body, _params, query) => {
    const allTables = store.data.tables;
    let tables = allTables;
    const keyword = query.get("keyword");
    const status = query.get("status");
    if (keyword) tables = tables.filter((table) => `${table.name}${table.type}`.includes(keyword));
    if (status) tables = tables.filter((table) => table.status === status);
    const page = Math.max(1, Number(query.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.get("pageSize") || tables.length || 1)));
    const total = tables.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const pagedTables = tables.slice((page - 1) * pageSize, page * pageSize);
    const summary = {
      total: allTables.length,
      available: allTables.filter((table) => table.status === "available").length,
      occupied: allTables.filter((table) => table.status === "occupied").length,
      reserved: allTables.filter((table) => table.status === "reserved").length,
      maintenance: allTables.filter((table) => table.status === "maintenance").length,
      disabled: allTables.filter((table) => table.status === "disabled").length,
    };
    return {
      tables: pagedTables.map((table) => publicTable(store, table)),
      tableTypes: store.data.tableTypes,
      pagination: { page, pageSize, total, pageCount },
      summary,
    };
  });
  add("POST", "/api/admin/tables", async (body) => {
    const table = {
      tableId: newId("table"),
      merchantId: store.data.settings.merchantId,
      storeId: store.data.settings.storeId,
      name: body.name || "新桌台",
      type: body.type || store.data.tableTypes[0]?.name || "普通卡座",
      capacity: Number(body.capacity || 9),
      imageUrl: body.imageUrl || defaultTableImage(body),
      occupiedStartedAt: null,
      consumptionAmount: 0,
      status: body.status || "available",
    };
    store.data.tables.push(table);
    store.log(body.operatorId || "emp_admin", "admin", "create_table", "Table", table.tableId, null, table, "新增座台信息");
    await store.save();
    return { table: publicTable(store, table) };
  });
  add("PATCH", "/api/admin/tables/:tableId", async (body, params) => {
    const table = store.data.tables.find((item) => item.tableId === params.tableId);
    if (!table) throw new HttpError(404, "桌台不存在");
    const before = deepClone(table);
    if (body.name !== undefined) table.name = body.name;
    if (body.type !== undefined) table.type = body.type;
    if (body.capacity !== undefined) table.capacity = Number(body.capacity);
    if (body.status !== undefined) table.status = body.status;
    if (body.imageUrl !== undefined) table.imageUrl = body.imageUrl || defaultTableImage(table);
    if (body.consumptionAmount !== undefined) table.consumptionAmount = Number(body.consumptionAmount || 0);
    if (table.status === "occupied" && !table.occupiedStartedAt) table.occupiedStartedAt = now();
    if (table.status !== "occupied") table.occupiedStartedAt = null;
    store.log(body.operatorId || "emp_admin", "admin", "update_table", "Table", table.tableId, before, table, body.reason || "编辑座台信息");
    await store.save();
    return { table: publicTable(store, table) };
  });
  add("DELETE", "/api/admin/tables/:tableId", async (body, params) => {
    const table = store.data.tables.find((item) => item.tableId === params.tableId);
    if (!table) throw new HttpError(404, "桌台不存在");
    if (table.status === "occupied" || table.status === "reserved") throw new HttpError(400, "占用或预订中的桌台不能删除");
    const before = deepClone(table);
    table.status = "disabled";
    table.deletedAt = now();
    table.deletedBy = body.operatorId || "emp_admin";
    table.occupiedStartedAt = null;
    store.log(table.deletedBy, "admin", "delete_table", "Table", table.tableId, before, table, body.reason || "删除座台信息");
    await store.save();
    return { table: publicTable(store, table) };
  });
  add("POST", "/api/admin/employees", async (body) => {
    const employee = { employeeId: newId("emp"), merchantId: store.data.settings.merchantId, storeId: store.data.settings.storeId, name: body.name, phone: body.phone, role: body.role || "staff", loginAccount: body.loginAccount || body.phone, passwordHash: hashPassword(body.password || "demo"), commissionRate: Number(body.commissionRate ?? 0.05), status: "active", createdAt: now() };
    store.data.employees.push(employee);
    store.log(body.operatorId || "emp_admin", "admin", "create_employee", "Employee", employee.employeeId, null, employee, "新增工作人员");
    await store.save();
    return { employee: publicEmployee(employee) };
  });
  add("PATCH", "/api/admin/employees/:employeeId", async (body, params) => {
    const employee = store.getEmployee(params.employeeId);
    const before = deepClone(employee);
    const { resetPassword: _resetPassword, passwordHash: _passwordHash, ...updates } = body;
    Object.assign(employee, updates);
    if (body.commissionRate !== undefined) employee.commissionRate = Number(body.commissionRate);
    if (body.resetPassword) {
      employee.passwordHash = hashPassword(body.resetPassword);
      employee.passwordChangedAt = now();
    }
    store.log(body.operatorId || "emp_admin", "admin", "update_employee", "Employee", employee.employeeId, before, employee, "修改工作人员");
    await store.save();
    return { employee: publicEmployee(employee) };
  });
  add("GET", "/api/staff/blind-settings", async () => ({ settings: store.data.blindSettings }));
  add("GET", "/api/admin/blind-settings", async () => ({ settings: store.data.blindSettings }));
  add("PATCH", "/api/admin/blind-settings", async (body) => {
    const before = deepClone(store.data.blindSettings);
    const { titleMap, voiceTerms, ...updates } = body;
    if (updates.blindLevels) {
      updates.blindLevels = updates.blindLevels.map((level, index) => ({
        level: Number(level.level || index + 1),
        smallBlind: Number(level.smallBlind || 0),
        bigBlind: Number(level.bigBlind || 0),
        ante: Number(level.ante || 0),
      }));
    }
    store.data.blindSettings = {
      ...store.data.blindSettings,
      ...updates,
      titleMap: { ...(store.data.blindSettings.titleMap || {}), ...(titleMap || {}) },
      voiceTerms: { ...(store.data.blindSettings.voiceTerms || {}), ...(voiceTerms || {}) },
    };
    store.log(body.operatorId || "emp_admin", "admin", "update_blind_settings", "BlindSettings", store.data.settings.storeId, before, store.data.blindSettings, "修改升盲高级设置");
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
      const bodyData = req.method === "GET" ? { parsed: {}, raw: "" } : await readBody(req);
      const body = bodyData.parsed;
      const previousRequest = requestQueue.catch(() => {});
      const operation = previousRequest.then(async () => {
        const roles = route.options.roles || defaultRolesForPath(path);
        if (roles) requireStaffAccess(store, req, roles);
        const result = await route.handler(body, params, query, { req, rawBody: bodyData.raw, headers: req.headers });
        await store.save();
        return result;
      });
      requestQueue = operation;
      const result = await operation;
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
  if (currentAppEnv() === "production" && !process.env.DATABASE_URL && !jsonStoreAllowedInProduction()) {
    throw new HttpError(501, "生产环境缺少 DATABASE_URL；如仅沙箱演示需显式设置 ALLOW_JSON_STORE_IN_PRODUCTION=true");
  }
  const provider = databaseProvider();
  if (provider === "unsupported") throw new HttpError(501, "当前仅支持 sqlite:// DATABASE_URL；PostgreSQL/MySQL 适配尚未启用");
  const store = provider === "sqlite" ? new SQLiteStore(sqlitePathFromDatabaseUrl(process.env.DATABASE_URL)) : new Store(options.dataFile || process.env.DATA_FILE || defaultDataFile);
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
  server.on("close", () => {
    store.close().catch(() => {});
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
