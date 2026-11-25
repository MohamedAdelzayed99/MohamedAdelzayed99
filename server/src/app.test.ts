// End-to-end tests through the HTTP API, using a fresh in-memory database per test.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { egp } from "@hightech/commission";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { createAdmin } from "./admin.ts";
import { clock } from "./util.ts";

process.env.DEV_OTP = "1";

async function setup() {
  const db = openDb(":memory:");
  createAdmin(db, "admin", "password123", "Admin");
  const sent: string[] = [];
  const server = createApp(db, { sms: { send: async (_p, t) => void sent.push(t) } }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
  };
  const ok = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await call(method, path, body, token);
    assert.ok(r.status < 300, `${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const login = async () => (await ok("POST", "/api/admin/login", { username: "admin", password: "password123" })).token as string;
  let adminToken = await login();
  // Admin sessions last 7 days; tests jump the clock forward, so log in again when needed.
  const A = async (method: string, path: string, body?: unknown) => {
    if ((await call("GET", "/api/admin/me", undefined, adminToken)).status === 401) adminToken = await login();
    return ok(method, path, body, adminToken);
  };

  let phoneN = 0;
  /** Sign up a member through the real OTP flow. */
  const signup = async (program: "retail" | "wholesale", name: string, referralCode?: string) => {
    const phone = `0101${String(++phoneN).padStart(7, "0")}`;
    const { devCode } = await ok("POST", `/api/${program}/auth/request-otp`, { phone });
    const extra = program === "wholesale" ? { shopName: name, shopAddress: "Cairo" } : {};
    const r = await ok("POST", `/api/${program}/auth/verify`, { phone, code: devCode, name, referralCode, ...extra });
    return { token: r.token as string, id: r.member.id as number, code: r.member.referralCode as string, phone };
  };
  const product = await A("POST", "/api/admin/products", {
    name: "Power bank", retailPrice: egp(1000), wholesalePrice: egp(800), wholesaleMinQty: 5, stock: 1000,
  });
  const close = () => { server.close(); clock.now = () => new Date(); };
  return { db, call, ok, A, signup, product, close, sent };
}

const days = (n: number) => { const t = Date.now() + n * 86_400_000; clock.now = () => new Date(t); };

test("plan example: «4.1» buys for 1,000 EGP and the chain earns 100/50/50/50/50 after the return window", async () => {
  const s = await setup();
  try {
    const khaled = await s.signup("retail", "م. خالد");
    const a1 = await s.signup("retail", "أ1", khaled.code);
    const b11 = await s.signup("retail", "1.1", a1.code);
    const b21 = await s.signup("retail", "2.1", b11.code);
    const b31 = await s.signup("retail", "3.1", b21.code);
    const buyer = await s.signup("retail", "4.1", b31.code);

    const order = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "Cairo" }, buyer.token);
    assert.equal(order.subtotal, egp(1000));

    // Nothing is earned until delivery.
    assert.equal((await s.ok("GET", "/api/retail/wallet", undefined, b31.token)).pending, 0);
    for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${order.id}/status`, { status: st });

    const wallet = async (m: { token: string }) => s.ok("GET", "/api/retail/wallet", undefined, m.token);
    assert.equal((await wallet(b31)).pending, egp(100));
    for (const m of [b21, b11, a1, khaled]) assert.equal((await wallet(m)).pending, egp(50));
    assert.equal((await wallet(buyer)).pending, 0, "buyer earns nothing from own purchase");
    assert.equal((await wallet(b31)).available, 0);

    // Notification sent to the upline.
    const notes = await s.ok("GET", "/api/retail/notifications", undefined, khaled.token);
    assert.ok(notes.some((n: any) => n.body.includes("50 ج")));

    // After the 14-day window the balance becomes available.
    days(15);
    await s.A("POST", "/api/admin/jobs/release");
    assert.equal((await wallet(b31)).available, egp(100));
    assert.equal((await wallet(khaled)).available, egp(50));
    assert.equal((await wallet(khaled)).pending, 0);

    // Network page: khaled sees level-1 names and per-level counts and earnings.
    const net = await s.ok("GET", "/api/retail/network", undefined, khaled.token);
    assert.equal(net.totalMembers, 5);
    assert.equal(net.levels[0].members[0].name, "أ1");
    assert.equal(net.levels[1].members, undefined, "deeper levels show counts only");
    assert.equal(net.levels[4].earnedAvailable, egp(50));
  } finally {
    s.close();
  }
});

test("a return inside the window cancels the pending commission; after the window it is refused", async () => {
  const s = await setup();
  try {
    const p = await s.signup("retail", "parent");
    const c = await s.signup("retail", "child", p.code);
    const o1 = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 2 }], address: "x" }, c.token);
    for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${o1.id}/status`, { status: st });
    assert.equal((await s.ok("GET", "/api/retail/wallet", undefined, p.token)).pending, egp(600));
    await s.A("POST", `/api/admin/orders/${o1.id}/status`, { status: "returned" });
    const w = await s.ok("GET", "/api/retail/wallet", undefined, p.token);
    assert.equal(w.pending, 0);
    assert.equal(w.available, 0);

    const o2 = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "x" }, c.token);
    for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${o2.id}/status`, { status: st });
    days(20);
    const r = await s.call("POST", `/api/admin/orders/${o2.id}/status`, { status: "returned" }, (await s.ok("POST", "/api/admin/login", { username: "admin", password: "password123" })).token);
    assert.equal(r.status, 400);
  } finally {
    s.close();
  }
});

test("cancelled / undelivered orders never pay commission", async () => {
  const s = await setup();
  try {
    const p = await s.signup("retail", "parent");
    const c = await s.signup("retail", "child", p.code);
    const o = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "x" }, c.token);
    await s.A("POST", `/api/admin/orders/${o.id}/status`, { status: "cancelled" });
    days(30);
    await s.A("POST", "/api/admin/jobs/release");
    const w = await s.ok("GET", "/api/retail/wallet", undefined, p.token);
    assert.equal(w.pending + w.available, 0);
  } finally {
    s.close();
  }
});

test("withdrawals: minimum, balance check, one open request, reject returns money", async () => {
  const s = await setup();
  try {
    const p = await s.signup("retail", "parent");
    const c = await s.signup("retail", "child", p.code);
    const o = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "x" }, c.token);
    for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${o.id}/status`, { status: st });
    const wd = (amount: number) => s.call("POST", "/api/retail/wallet/withdrawals", { amount, method: "vodafone_cash", account: "01000000000" }, p.token);

    assert.equal((await wd(egp(200))).status, 400, "pending money cannot be withdrawn");
    days(15);
    await s.A("POST", "/api/admin/jobs/release");
    assert.equal((await wd(egp(50))).status, 400, "below the 100 EGP minimum");
    assert.equal((await wd(egp(301))).status, 400, "more than available");
    const w1 = await wd(egp(200));
    assert.equal(w1.status, 200);
    assert.equal((await wd(egp(100))).status, 400, "one open request at a time");
    assert.equal((await s.ok("GET", "/api/retail/wallet", undefined, p.token)).available, egp(100));

    await s.A("POST", `/api/admin/withdrawals/${w1.data.id}`, { status: "rejected", note: "wrong number" });
    assert.equal((await s.ok("GET", "/api/retail/wallet", undefined, p.token)).available, egp(300));
    const w2 = await wd(egp(300));
    await s.A("POST", `/api/admin/withdrawals/${w2.data.id}`, { status: "approved" });
    await s.A("POST", `/api/admin/withdrawals/${w2.data.id}`, { status: "paid" });
    assert.equal((await s.ok("GET", "/api/retail/wallet", undefined, p.token)).available, 0);
  } finally {
    s.close();
  }
});

test("wholesale: approval, min quantity, 5% discount split, discount used on the next invoice, no cash out", async () => {
  const s = await setup();
  try {
    const top = await s.signup("wholesale", "Milano");
    const mid = await s.signup("wholesale", "Tayeb", top.code);
    const shop = await s.signup("wholesale", "Mina", mid.code);

    // Must be approved before ordering.
    const blocked = await s.call("POST", "/api/wholesale/orders", { items: [{ productId: s.product.id, qty: 5 }], address: "x" }, shop.token);
    assert.equal(blocked.status, 403);
    for (const m of [top, mid, shop]) await s.A("POST", `/api/admin/members/${m.id}/status`, { status: "active" });

    // Wholesale price is used, and the minimum quantity enforced.
    assert.equal((await s.call("POST", "/api/wholesale/orders", { items: [{ productId: s.product.id, qty: 2 }], address: "x" }, shop.token)).status, 400);
    // 12.5 units × 800 = 10,000 EGP is not possible, so use a 10,000 EGP product.
    const p10k = await s.A("POST", "/api/admin/products", { name: "Bulk", retailPrice: egp(12000), wholesalePrice: egp(2000), wholesaleMinQty: 5, stock: 100 });
    const inv = await s.ok("POST", "/api/wholesale/orders", { items: [{ productId: p10k.id, qty: 5 }], address: "x" }, shop.token);
    assert.equal(inv.subtotal, egp(10000));
    for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${inv.id}/status`, { status: st });
    days(15);
    await s.A("POST", "/api/admin/jobs/release");

    // Two shops above the buyer: direct 4% = 400, the one above 1% = 100.
    const midW = await s.ok("GET", "/api/wholesale/wallet", undefined, mid.token);
    assert.equal(midW.available, egp(400));
    assert.equal(midW.canWithdraw, false);
    assert.equal((await s.ok("GET", "/api/wholesale/wallet", undefined, top.token)).available, egp(100));
    assert.equal((await s.call("POST", "/api/wholesale/wallet/withdrawals", { amount: egp(400), method: "instapay", account: "x" }, mid.token)).status, 403);

    // Mid uses the 400 discount on its own next invoice.
    const inv2 = await s.ok("POST", "/api/wholesale/orders", { items: [{ productId: s.product.id, qty: 5 }], address: "x", useDiscount: true }, mid.token);
    assert.equal(inv2.subtotal, egp(4000));
    assert.equal(inv2.discountUsed, egp(400));
    assert.equal(inv2.total, egp(3600));
    assert.equal((await s.ok("GET", "/api/wholesale/wallet", undefined, mid.token)).available, 0);
    // Cancelling the invoice gives the discount back.
    await s.A("POST", `/api/admin/orders/${inv2.id}/status`, { status: "cancelled" });
    assert.equal((await s.ok("GET", "/api/wholesale/wallet", undefined, mid.token)).available, egp(400));
  } finally {
    s.close();
  }
});

test("retail and wholesale are separate: prices, trees, tokens, referral codes", async () => {
  const s = await setup();
  try {
    const retailProducts = await s.ok("GET", "/api/retail/products");
    assert.equal(retailProducts[0].price, egp(1000));
    assert.ok(!JSON.stringify(retailProducts).includes(String(egp(800))), "wholesale price never leaks to retail");
    assert.equal((await s.ok("GET", "/api/wholesale/products"))[0].price, egp(800));

    const r = await s.signup("retail", "R");
    const bad = await s.ok("POST", "/api/wholesale/auth/request-otp", { phone: "01099999999" });
    const res = await s.call("POST", "/api/wholesale/auth/verify", { phone: "01099999999", code: bad.devCode, name: "x", shopName: "x", shopAddress: "x", referralCode: r.code });
    assert.equal(res.status, 400, "retail code cannot be used in wholesale");
    assert.equal((await s.call("GET", "/api/wholesale/wallet", undefined, r.token)).status, 401, "retail token rejected by wholesale API");

    // Same phone can have one account in each app.
    const { devCode } = await s.ok("POST", "/api/wholesale/auth/request-otp", { phone: r.phone });
    const w = await s.ok("POST", "/api/wholesale/auth/verify", { phone: r.phone, code: devCode, name: "x", shopName: "x", shopAddress: "x" });
    assert.notEqual(w.member.id, r.id);
  } finally {
    s.close();
  }
});

test("OTP: wrong code, lockout, resend cooldown, phone normalisation", async () => {
  const s = await setup();
  try {
    assert.equal((await s.call("POST", "/api/retail/auth/request-otp", { phone: "12345" })).status, 400);
    const { devCode, phone } = await s.ok("POST", "/api/retail/auth/request-otp", { phone: "+20 101 234 5678" });
    assert.equal(phone, "+201012345678");
    assert.equal((await s.call("POST", "/api/retail/auth/request-otp", { phone: "01012345678" })).status, 429);
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) assert.equal((await s.call("POST", "/api/retail/auth/verify", { phone, code: wrong, name: "x" })).status, 400);
    const locked = await s.call("POST", "/api/retail/auth/verify", { phone, code: devCode, name: "x" });
    assert.equal(locked.data.error, "otp_locked");
  } finally {
    s.close();
  }
});

test("rate changes apply to new orders only; old orders keep their rates", async () => {
  const s = await setup();
  try {
    const p = await s.signup("retail", "p");
    const c = await s.signup("retail", "c", p.code);
    const old = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "x" }, c.token);
    await s.A("PUT", "/api/admin/rates/retail", { totalBp: 2000, stepBp: 500, floorBp: 1000 });
    const neu = await s.ok("POST", "/api/retail/orders", { items: [{ productId: s.product.id, qty: 1 }], address: "x" }, c.token);
    for (const o of [old, neu]) for (const st of ["confirmed", "shipped", "delivered"]) await s.A("POST", `/api/admin/orders/${o.id}/status`, { status: st });
    const w = await s.ok("GET", "/api/retail/wallet", undefined, p.token);
    assert.equal(w.pending, egp(300) + egp(200));
    assert.equal((await s.call("PUT", "/api/admin/rates/retail", { totalBp: 100, stepBp: 1, floorBp: 500 }, undefined)).status, 401);
  } finally {
    s.close();
  }
});

test("admin can move a member (logged, no cycles) and see their account", async () => {
  const s = await setup();
  try {
    const a = await s.signup("retail", "a");
    const b = await s.signup("retail", "b", a.code);
    const c = await s.signup("retail", "c");
    const cycle = await s.call("POST", `/api/admin/members/${a.id}/move`, { parentId: b.id, reason: "test" },
      (await s.ok("POST", "/api/admin/login", { username: "admin", password: "password123" })).token);
    assert.equal(cycle.status, 400);
    const d = await s.A("POST", `/api/admin/members/${b.id}/move`, { parentId: c.id, reason: "requested by customer" });
    assert.equal(d.upline[0].id, c.id);
    const log = await s.A("GET", "/api/admin/audit");
    assert.ok(log.some((l: any) => l.action === "move_member" && l.entity_id === b.id));
    const found = await s.A("GET", `/api/admin/members?query=${encodeURIComponent(b.phone)}`);
    assert.equal(found[0].id, b.id);
    const rep = await s.A("GET", "/api/admin/reports");
    assert.ok(Array.isArray(rep.topNetworks));
  } finally {
    s.close();
  }
});
