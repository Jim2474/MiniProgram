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
assert(appConfig.pages.includes("pages/customer/customer"), "customer page registered");
assert(appConfig.pages.includes("pages/staff/staff"), "staff page registered");
assert(appConfig.pages.includes("pages/admin/admin"), "admin page registered");
assert(appConfig.pages.includes("pages/dealer/dealer"), "dealer page registered");
assert(appConfig.tabBar?.list?.length === 4, "four tabBar entries configured");

const projectConfig = JSON.parse(await readFile(join(root, "miniprogram/project.config.json"), "utf8"));
assert(projectConfig.setting?.urlCheck === false, "local API urlCheck disabled for devtools");
assert(projectConfig.miniprogramRoot === "./", "miniprogram root configured");

const apiSource = await readFile(join(root, "miniprogram/utils/api.js"), "utf8");
assert(apiSource.includes("http://localhost:3000"), "api util points to local backend");
assert(apiSource.includes("wx.request"), "api util uses wx.request");

for (const page of ["customer", "staff", "admin", "dealer"]) {
  const js = await readFile(join(root, `miniprogram/pages/${page}/${page}.js`), "utf8");
  const wxml = await readFile(join(root, `miniprogram/pages/${page}/${page}.wxml`), "utf8");
  assert(js.includes("Page({"), `${page} page declares Page`);
  assert(wxml.length > 200, `${page} wxml has meaningful markup`);
}

const customerJs = await readFile(join(root, "miniprogram/pages/customer/customer.js"), "utf8");
assert(customerJs.includes("/api/cart/items"), "customer page calls cart API");
assert(customerJs.includes("/api/orders") && customerJs.includes("/pay"), "customer page calls order pay API");
assert(customerJs.includes("/api/storage/") && customerJs.includes("pickup-requests"), "customer page calls pickup request API");
assert(customerJs.includes("/api/reservations"), "customer page calls reservation API");
assert(customerJs.includes("/cancel"), "customer page calls reservation cancel API");
assert(customerJs.includes("/api/checkin"), "customer page calls checkin API");
assert(customerJs.includes("/api/recharge"), "customer page calls recharge API");
assert(customerJs.includes("/api/lottery/draw"), "customer page calls lottery API");
assert(customerJs.includes("/api/leaderboard/points"), "customer page calls leaderboard API");
assert(customerJs.includes("/api/coupons/"), "customer page calls coupon API");
assert(customerJs.includes("/api/coupons/exchange"), "customer page calls coupon exchange API");
assert(customerJs.includes("wx.scanCode"), "customer page uses WeChat scanCode");
assert(customerJs.includes("wx.openLocation"), "customer page uses WeChat openLocation");
assert(customerJs.includes("wx.makePhoneCall"), "customer page uses WeChat makePhoneCall");
assert(customerJs.includes("/api/scan/employee"), "customer page records employee QR scan");
assert(customerJs.includes("/api/lottery/records/") && customerJs.includes("redeem-request"), "customer page calls lottery redeem request API");

const staffJs = await readFile(join(root, "miniprogram/pages/staff/staff.js"), "utf8");
assert(staffJs.includes("/api/staff/storage"), "staff page calls storage create API");
assert(staffJs.includes("/api/staff/login"), "staff page calls staff login API");
assert(staffJs.includes("/confirm"), "staff page calls pickup confirm API");
assert(staffJs.includes("/api/staff/points/adjust"), "staff page calls point adjust API");
assert(staffJs.includes("/api/staff/verify-code"), "staff page calls verify code API");
assert(staffJs.includes("/api/staff/seats/"), "staff page calls seat API");
assert(staffJs.includes("/api/staff/password"), "staff page calls password API");
assert(staffJs.includes("/api/staff/lottery-records/"), "staff page calls lottery redeem confirm API");

const adminJs = await readFile(join(root, "miniprogram/pages/admin/admin.js"), "utf8");
assert(adminJs.includes("/api/admin/dashboard"), "admin page calls dashboard API");
assert(adminJs.includes("/refund"), "admin page calls refund API");
assert(adminJs.includes("/transfer-storage"), "admin page calls transfer storage API");
assert(adminJs.includes("/api/admin/stock/adjust"), "admin page calls stock adjust API");
assert(adminJs.includes("/api/admin/stock-requests"), "admin page calls stock request workflow API");
assert(adminJs.includes("/api/admin/storage/") && adminJs.includes("expire-handle"), "admin page calls expired storage handling API");
assert(adminJs.includes("/api/admin/stock-ledgers"), "admin page calls stock ledger API");
assert(adminJs.includes("/api/admin/categories"), "admin page calls category create API");
assert(adminJs.includes("/api/admin/products") && adminJs.includes("createProduct"), "admin page supports product create API");
assert(adminJs.includes("/api/admin/finance/overview"), "admin page calls finance API");
assert(adminJs.includes("/api/admin/recharge-configs"), "admin page calls recharge config API");
assert(adminJs.includes("/api/admin/recharge-records"), "admin page calls recharge records API");
assert(adminJs.includes("/api/admin/consumption-records"), "admin page calls consumption records API");
assert(adminJs.includes("/api/admin/member-levels"), "admin page calls member level API");
assert(adminJs.includes("/api/admin/lottery/"), "admin page calls lottery admin API");
assert(adminJs.includes("/api/admin/scan-records"), "admin page calls scan records API");
assert(adminJs.includes("/api/admin/tables"), "admin page calls table management API");
assert(adminJs.includes("/api/admin/blind-settings"), "admin page calls blind settings API");
assert(adminJs.includes("/api/admin/system-settings"), "admin page calls system settings API");

const dealerJs = await readFile(join(root, "miniprogram/pages/dealer/dealer.js"), "utf8");
const dealerWxml = await readFile(join(root, "miniprogram/pages/dealer/dealer.wxml"), "utf8");
assert(dealerJs.includes("/api/staff/blind-games"), "dealer page calls blind game API");
assert(dealerJs.includes("/timer"), "dealer page calls blind timer API");
assert(dealerWxml.includes("next_level"), "dealer page supports next level action");
assert(dealerJs.includes("/api/admin/blind-settings"), "dealer page reads blind settings API");

console.log(`Miniprogram validation passed: ${checks.length} checks`);
for (const check of checks) console.log(`- ${check}`);
