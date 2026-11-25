import express, { type NextFunction, type Request, type Response } from "express";
import type { Program } from "@hightech/commission";
import type { DB } from "./db.ts";
import { getJson, getNum } from "./db.ts";
import { consoleSms, type Member, memberFromToken, network, publicMember, requestOtp, type SmsSender, verifyOtp, moveMember } from "./members.ts";
import { getOrder, listOrders, markPaid, placeOrder, productView, releaseMatured, setOrderStatus, type OrderStatus } from "./orders.ts";
import { decideWithdrawal, requestWithdrawal, walletView } from "./wallet.ts";
import * as admin from "./admin.ts";
import { HttpError, int, notFound, parseProgram, sha256, str } from "./util.ts";

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).then((out) => { if (!res.headersSent) res.json(out ?? { ok: true }); }, next);

const bearer = (req: Request) => req.headers.authorization?.replace(/^Bearer /, "");

declare module "express-serve-static-core" {
  interface Request {
    member?: Member;
    program?: Program;
    admin?: { id: number; username: string; name: string };
  }
}

export function createApp(db: DB, opts: { sms?: SmsSender } = {}) {
  const sms = opts.sms ?? consoleSms;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));
  app.use((req, res, next) => {
    // Dashboard and Expo web run on other origins during development.
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Share links: https://domain/r/CODE (retail) and /w/CODE (wholesale)
  app.get(["/r/:code", "/w/:code"], (req, res) => {
    const program = req.path.startsWith("/r/") ? "retail" : "wholesale";
    const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const m = db.prepare("SELECT name, shop_name FROM members WHERE referral_code = ? AND program = ?").get(code, program) as any;
    res.type("html").send(landingPage(program, code, m ? (m.shop_name ?? m.name) : null));
  });

  // ------------------------------------------------------------ member apps: /api/retail/... and /api/wholesale/...
  const member = express.Router({ mergeParams: true });
  app.use("/api/:program(retail|wholesale)", (req, _res, next) => { req.program = parseProgram(req.params.program); next(); }, member);

  member.post("/auth/request-otp", h((req) => requestOtp(db, sms, req.program!, req.body?.phone)));
  member.post("/auth/verify", h((req) => verifyOtp(db, req.program!, req.body ?? {})));
  member.get("/referral/:code", h((req) => {
    const m = db.prepare("SELECT name, shop_name FROM members WHERE referral_code = ? AND program = ?").get(String(req.params.code).toUpperCase(), req.program!) as any;
    if (!m) throw notFound("كود الدعوة غير صحيح");
    return { name: m.shop_name ?? m.name };
  }));

  // Catalogue is public so the app can show products before sign-in. Prices depend on the program.
  member.get("/categories", h(() => db.prepare("SELECT id, name FROM categories ORDER BY sort, name").all()));
  member.get("/products", h((req) => {
    const args: unknown[] = [];
    let where = "active = 1";
    if (req.query.categoryId) { where += " AND category_id = ?"; args.push(Number(req.query.categoryId)); }
    if (req.query.q) { where += " AND name LIKE ?"; args.push(`%${req.query.q}%`); }
    return (db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY id DESC LIMIT 500`).all(...(args as any[])) as any[]).map((p) => productView(p, req.program!));
  }));
  member.get("/products/:id", h((req) => {
    const p = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(Number(req.params.id)) as any;
    if (!p) throw notFound("المنتج غير موجود");
    return productView(p, req.program!);
  }));
  member.get("/config", h((req) => ({
    shippingFee: getNum(db, `${req.program}_shipping_fee`),
    paymentMethods: getJson<string[]>(db, `payment_methods_${req.program}`),
    returnWindowDays: getNum(db, "return_window_days"),
  })));

  // Everything below needs a signed-in member of this program.
  member.use((req, _res, next) => {
    const m = memberFromToken(db, bearer(req));
    if (!m || m.program !== req.program) return next(new HttpError(401, "unauthorized", "سجّل الدخول من جديد"));
    if (m.status === "suspended") return next(new HttpError(403, "suspended", "الحساب موقوف"));
    req.member = m;
    next();
  });
  member.get("/me", h((req) => publicMember(req.member!)));
  member.patch("/me", h((req) => {
    const b = req.body ?? {};
    if (b.name !== undefined) db.prepare("UPDATE members SET name = ? WHERE id = ?").run(str(b.name, "name", { max: 80 }), req.member!.id);
    if (b.pushToken !== undefined) db.prepare("UPDATE members SET push_token = ? WHERE id = ?").run(b.pushToken ? String(b.pushToken).slice(0, 200) : null, req.member!.id);
    return publicMember(memberFromToken(db, bearer(req))!);
  }));
  member.post("/auth/logout", h((req) => {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(bearer(req)!));
  }));
  member.get("/orders", h((req) => listOrders(db, req.member!.id)));
  member.post("/orders", h((req) => placeOrder(db, req.member!, req.body ?? {})));
  member.get("/orders/:id", h((req) => {
    const o = getOrder(db, Number(req.params.id));
    if (!o || o.memberId !== req.member!.id) throw notFound("الطلب غير موجود");
    return o;
  }));
  member.get("/wallet", h((req) => walletView(db, req.member!)));
  member.post("/wallet/withdrawals", h((req) => requestWithdrawal(db, req.member!, req.body ?? {})));
  member.get("/network", h((req) => network(db, req.member!)));
  member.get("/notifications", h((req) =>
    db.prepare("SELECT id, title, body, read, created_at FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT 100").all(req.member!.id)));
  member.post("/notifications/read", h((req) => {
    db.prepare("UPDATE notifications SET read = 1 WHERE member_id = ?").run(req.member!.id);
  }));

  // ------------------------------------------------------------ dashboard: /api/admin/...
  const adm = express.Router();
  app.use("/api/admin", adm);
  adm.post("/login", h((req) => admin.adminLogin(db, req.body?.username, req.body?.password)));
  adm.use((req, _res, next) => {
    const a = admin.adminFromToken(db, bearer(req));
    if (!a) return next(new HttpError(401, "unauthorized", "سجّل الدخول من جديد"));
    req.admin = a;
    next();
  });
  adm.get("/me", h((req) => req.admin));

  adm.get("/categories", h(() => db.prepare("SELECT * FROM categories ORDER BY sort, name").all()));
  adm.post("/categories", h((req) => {
    const r = db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)").run(str(req.body?.name, "name", { max: 60 }), Number(req.body?.sort ?? 0));
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(Number(r.lastInsertRowid));
  }));
  adm.put("/categories/:id", h((req) => {
    db.prepare("UPDATE categories SET name = ?, sort = ? WHERE id = ?").run(str(req.body?.name, "name", { max: 60 }), Number(req.body?.sort ?? 0), Number(req.params.id));
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(Number(req.params.id));
  }));

  adm.get("/products", h(() => (db.prepare("SELECT * FROM products ORDER BY id DESC").all() as any[]).map(admin.productAdminView)));
  adm.post("/products", h((req) => admin.saveProduct(db, req.admin!.id, null, req.body ?? {})));
  adm.put("/products/:id", h((req) => admin.saveProduct(db, req.admin!.id, int(req.params.id, "id", { min: 1 }), req.body ?? {})));

  adm.get("/orders", h((req) => admin.adminOrders(db, req.query as any)));
  adm.get("/orders/:id", h((req) => {
    const o = getOrder(db, Number(req.params.id));
    if (!o) throw notFound("الطلب غير موجود");
    return o;
  }));
  adm.post("/orders/:id/status", h((req) =>
    setOrderStatus(db, req.admin!.id, Number(req.params.id), req.body?.status as OrderStatus, String(req.body?.note ?? "").slice(0, 300))));
  adm.post("/orders/:id/paid", h((req) => markPaid(db, req.admin!.id, Number(req.params.id))));

  adm.get("/members", h((req) => admin.searchMembers(db, req.query as any)));
  adm.post("/members", h((req) => admin.createMemberByAdmin(db, req.admin!.id, req.body ?? {})));
  adm.get("/members/:id", h((req) => admin.memberDetail(db, Number(req.params.id))));
  adm.post("/members/:id/status", h((req) => { admin.setMemberStatus(db, req.admin!.id, Number(req.params.id), String(req.body?.status)); return admin.memberDetail(db, Number(req.params.id)); }));
  adm.post("/members/:id/move", h((req) => {
    const to = req.body?.parentId === null || req.body?.parentId === "" ? null : int(req.body?.parentId, "parentId", { min: 1 });
    moveMember(db, req.admin!.id, Number(req.params.id), to, str(req.body?.reason, "reason", { max: 300 }));
    return admin.memberDetail(db, Number(req.params.id));
  }));

  adm.get("/rates", h(() => admin.currentRates(db)));
  adm.put("/rates/:program", h((req) => admin.setRates(db, req.admin!.id, parseProgram(req.params.program), req.body ?? {})));
  adm.get("/settings", h(() => admin.getSettings(db)));
  adm.patch("/settings", h((req) => admin.updateSettings(db, req.admin!.id, req.body ?? {})));

  adm.get("/withdrawals", h((req) => db.prepare(
    `SELECT w.*, m.name member_name, m.phone member_phone FROM withdrawals w JOIN members m ON m.id = w.member_id
     ${req.query.status ? "WHERE w.status = ?" : ""} ORDER BY w.id DESC LIMIT 300`,
  ).all(...(req.query.status ? [String(req.query.status)] : []))));
  adm.post("/withdrawals/:id", h((req) =>
    decideWithdrawal(db, req.admin!.id, Number(req.params.id), req.body?.status, String(req.body?.note ?? "").slice(0, 300))));

  adm.get("/reports", h((req) => admin.reports(db, req.query.from as string, req.query.to as string)));
  adm.post("/jobs/release", h(() => ({ released: releaseMatured(db) })));
  adm.get("/audit", h(() => db.prepare("SELECT a.*, ad.username FROM audit_log a LEFT JOIN admins ad ON ad.id = a.admin_id ORDER BY a.id DESC LIMIT 300").all()));

  // ------------------------------------------------------------ errors
  app.use((_req, _res, next) => next(notFound()));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ error: "bad_json", message: "طلب غير صحيح" });
    console.error(err);
    res.status(500).json({ error: "server_error", message: "حدث خطأ، حاول مرة أخرى" });
  });
  return app;
}

function landingPage(program: Program, code: string, inviter: string | null) {
  const appName = program === "retail" ? "High Tech" : "High Tech جملة";
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const scheme = program === "retail" ? "hightech" : "hightech-wholesale";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${appName}</title><style>body{font-family:system-ui,sans-serif;background:#0b2447;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
.c{max-width:420px;padding:24px}.code{font-size:28px;letter-spacing:4px;background:#19376d;padding:12px 20px;border-radius:12px;display:inline-block;margin:12px 0}
a{display:block;margin:10px auto;padding:14px;border-radius:12px;background:#2f80ed;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><div class="c"><h1>${appName}</h1>
${inviter ? `<p>دعاك <b>${esc(inviter)}</b> للانضمام</p>` : "<p>انضم إلينا</p>"}
<p>كود الدعوة الخاص بك:</p><div class="code">${esc(code)}</div>
<a href="${scheme}://join?code=${esc(code)}">افتح التطبيق</a>
<a href="${esc(process.env[`PLAY_URL_${program.toUpperCase()}`] ?? "#")}">حمّل من Google Play</a>
<a href="${esc(process.env[`APPSTORE_URL_${program.toUpperCase()}`] ?? "#")}">حمّل من App Store</a>
<p style="opacity:.7;font-size:14px">اكتب الكود عند التسجيل لو لم يظهر تلقائيًا</p></div></body></html>`;
}
