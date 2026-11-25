import { type Program, type RateConfig, validateRates } from "@hightech/commission";
import { DEFAULT_SETTINGS, type DB, sqlTime } from "./db.ts";
import { audit } from "./audit.ts";
import { getMember, type Member, network, publicMember, upline } from "./members.ts";
import { getOrder, listOrders } from "./orders.ts";
import { balances, walletView } from "./wallet.ts";
import { bad, checkPassword, clock, hashPassword, int, newToken, normalizePhone, notFound, sha256, str } from "./util.ts";

export function adminLogin(db: DB, username: unknown, password: unknown) {
  const a = db.prepare("SELECT * FROM admins WHERE username = ?").get(String(username ?? "")) as any;
  if (!a || !checkPassword(String(password ?? ""), a.password_hash)) throw bad("bad_login", "اسم المستخدم أو كلمة المرور غير صحيحة");
  const token = newToken();
  db.prepare("INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, 'admin', ?, ?)").run(sha256(token), a.id, sqlTime(clock.now(), 7));
  return { token, admin: { id: a.id, username: a.username, name: a.name } };
}

export function adminFromToken(db: DB, token: string | undefined) {
  if (!token) return undefined;
  const s = db.prepare("SELECT subject_id FROM sessions WHERE token_hash = ? AND kind = 'admin' AND expires_at > ?").get(sha256(token), sqlTime(clock.now())) as any;
  return s ? (db.prepare("SELECT id, username, name FROM admins WHERE id = ?").get(s.subject_id) as { id: number; username: string; name: string }) : undefined;
}

export function createAdmin(db: DB, username: string, password: string, name: string) {
  if (password.length < 8) throw bad("weak_password", "كلمة المرور 8 أحرف على الأقل");
  db.prepare("INSERT INTO admins (username, password_hash, name) VALUES (?, ?, ?)").run(username, hashPassword(password), name);
}

// ---------------------------------------------------------------- products

export function saveProduct(db: DB, adminId: number, id: number | null, b: Record<string, unknown>) {
  const v = {
    category_id: b.categoryId ? int(b.categoryId, "categoryId", { min: 1 }) : null,
    name: str(b.name, "name", { max: 150 }),
    description: str(b.description, "description", { max: 3000, optional: true }),
    image_url: str(b.imageUrl, "imageUrl", { max: 500, optional: true }) || null,
    retail_price: int(b.retailPrice, "retailPrice"),
    retail_offer_price: b.retailOfferPrice === null || b.retailOfferPrice === undefined || b.retailOfferPrice === "" ? null : int(b.retailOfferPrice, "retailOfferPrice"),
    wholesale_price: int(b.wholesalePrice, "wholesalePrice"),
    wholesale_min_qty: int(b.wholesaleMinQty ?? 1, "wholesaleMinQty", { min: 1 }),
    stock: int(b.stock ?? 0, "stock"),
    active: b.active === false ? 0 : 1,
  };
  if (id) {
    const r = db.prepare(
      `UPDATE products SET category_id=?, name=?, description=?, image_url=?, retail_price=?, retail_offer_price=?, wholesale_price=?,
       wholesale_min_qty=?, stock=?, active=? WHERE id=?`,
    ).run(...(Object.values(v) as any[]), id);
    if (!r.changes) throw notFound("المنتج غير موجود");
  } else {
    const r = db.prepare(
      `INSERT INTO products (category_id, name, description, image_url, retail_price, retail_offer_price, wholesale_price, wholesale_min_qty, stock, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...(Object.values(v) as any[]));
    id = Number(r.lastInsertRowid);
  }
  audit(db, adminId, "save_product", "product", id, v);
  return productAdminView(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
}

export function productAdminView(p: any) {
  return {
    id: p.id, categoryId: p.category_id, name: p.name, description: p.description, imageUrl: p.image_url,
    retailPrice: p.retail_price, retailOfferPrice: p.retail_offer_price, wholesalePrice: p.wholesale_price,
    wholesaleMinQty: p.wholesale_min_qty, stock: p.stock, active: !!p.active, createdAt: p.created_at,
  };
}

// ---------------------------------------------------------------- members

export function searchMembers(db: DB, q: { program?: string; query?: string; status?: string }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.program) { where.push("program = ?"); args.push(q.program); }
  if (q.status) { where.push("status = ?"); args.push(q.status); }
  if (q.query) {
    let phone = "";
    try { phone = normalizePhone(q.query); } catch { /* not a phone */ }
    where.push("(phone = ? OR phone LIKE ? OR name LIKE ? OR shop_name LIKE ? OR referral_code = ?)");
    args.push(phone, `%${q.query.replace(/\D/g, "") || "~"}%`, `%${q.query}%`, `%${q.query}%`, q.query.toUpperCase());
  }
  const rows = db.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM members c WHERE c.parent_id = m.id) AS direct_count
     FROM members m ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.id DESC LIMIT 100`,
  ).all(...args) as any[];
  return rows.map((m) => ({ ...publicMember(m), directCount: m.direct_count, parentId: m.parent_id, ...balances(db, m) }));
}

/** Everything about one account, exactly as the member sees it in the app, plus the upline. */
export function memberDetail(db: DB, id: number) {
  const m = getMember(db, id);
  if (!m) throw notFound("العضو غير موجود");
  const up = upline(db, id).map((uid) => {
    const u = getMember(db, uid)!;
    return { id: u.id, name: u.shop_name ?? u.name, phone: u.phone, referralCode: u.referral_code };
  });
  return {
    member: { ...publicMember(m), parentId: m.parent_id, commercialReg: m.commercial_reg, lastActiveAt: m.last_active_at },
    upline: up,
    network: networkFull(db, m),
    wallet: walletView(db, m),
    orders: listOrders(db, id),
  };
}

/** Admin version of the network: all names at every level. */
function networkFull(db: DB, m: Member) {
  const base = network(db, m);
  const rows = db.prepare(
    `WITH RECURSIVE down(id, depth) AS (
       SELECT id, 0 FROM members WHERE id = ? UNION ALL
       SELECT c.id, down.depth + 1 FROM members c JOIN down ON c.parent_id = down.id)
     SELECT d.depth, m.id, m.name, m.shop_name, m.phone, m.parent_id FROM down d JOIN members m ON m.id = d.id WHERE d.depth > 0 ORDER BY d.depth, m.id LIMIT 2000`,
  ).all(m.id) as any[];
  return { ...base, members: rows.map((r) => ({ id: r.id, depth: r.depth, name: r.shop_name ?? r.name, phone: r.phone, parentId: r.parent_id })) };
}

export function setMemberStatus(db: DB, adminId: number, id: number, status: string) {
  if (!["active", "pending_approval", "suspended"].includes(status)) throw bad("status", "حالة غير صحيحة");
  const r = db.prepare("UPDATE members SET status = ? WHERE id = ?").run(status, id);
  if (!r.changes) throw notFound("العضو غير موجود");
  if (status === "suspended") db.prepare("DELETE FROM sessions WHERE kind = 'member' AND subject_id = ?").run(id);
  audit(db, adminId, "member_status", "member", id, { status });
}

/** Company-registered top-level members (e.g. the names at the top of the sheets). */
export function createMemberByAdmin(db: DB, adminId: number, b: Record<string, unknown>) {
  const program = b.program === "wholesale" ? "wholesale" : "retail";
  const phone = normalizePhone(b.phone);
  const parentId = b.parentId ? int(b.parentId, "parentId", { min: 1 }) : null;
  if (parentId && getMember(db, parentId)?.program !== program) throw bad("parent", "العضو الأعلى غير صحيح");
  const code = (program === "retail" ? "R" : "W") + sha256(phone + Date.now()).slice(0, 6).toUpperCase();
  const r = db.prepare(
    `INSERT INTO members (program, phone, name, referral_code, parent_id, status, shop_name, shop_address) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(program, phone, str(b.name, "name", { max: 80 }), code, parentId,
    str(b.shopName, "shopName", { optional: true }) || null, str(b.shopAddress, "shopAddress", { optional: true }) || null);
  audit(db, adminId, "create_member", "member", Number(r.lastInsertRowid), { program, parentId });
  return publicMember(getMember(db, Number(r.lastInsertRowid))!);
}

// ---------------------------------------------------------------- rates & settings

export function currentRates(db: DB) {
  const get = (p: Program) => db.prepare("SELECT * FROM rate_versions WHERE program = ? ORDER BY id DESC LIMIT 1").get(p) as any;
  const history = db.prepare("SELECT * FROM rate_versions ORDER BY id DESC LIMIT 50").all();
  return { retail: get("retail"), wholesale: get("wholesale"), history };
}

/** New rates only apply to orders placed from now on (orders keep the version they were placed with). */
export function setRates(db: DB, adminId: number, program: Program, r: RateConfig) {
  const rates = { totalBp: int(r.totalBp, "totalBp"), stepBp: int(r.stepBp, "stepBp"), floorBp: int(r.floorBp, "floorBp") };
  const errs = validateRates(rates);
  if (errs.length) throw bad("invalid_rates", errs.join("; "));
  db.prepare("INSERT INTO rate_versions (program, total_bp, step_bp, floor_bp, created_by) VALUES (?, ?, ?, ?, ?)").run(
    program, rates.totalBp, rates.stepBp, rates.floorBp, adminId,
  );
  audit(db, adminId, "set_rates", "rates", null, { program, ...rates });
  return currentRates(db);
}

export function getSettings(db: DB) {
  return Object.fromEntries((db.prepare("SELECT key, value FROM settings").all() as any[]).map((r) => [r.key, r.value]));
}

export function updateSettings(db: DB, adminId: number, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) throw bad("unknown_setting", `إعداد غير معروف: ${k}`);
    const value = typeof v === "string" ? v : JSON.stringify(v);
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(value, k);
  }
  audit(db, adminId, "update_settings", "settings", null, patch);
  return getSettings(db);
}

// ---------------------------------------------------------------- reports

export function reports(db: DB, from?: string, to?: string) {
  const f = from || "0000-01-01";
  const t = to ? to + " 23:59:59" : "9999-12-31";
  const sales = db.prepare(
    `SELECT program, COUNT(*) orders, SUM(subtotal) revenue FROM orders
     WHERE status = 'delivered' AND delivered_at BETWEEN ? AND ? GROUP BY program`,
  ).all(f, t);
  const daily = db.prepare(
    `SELECT date(delivered_at) day, program, SUM(subtotal) revenue, COUNT(*) orders FROM orders
     WHERE status = 'delivered' AND delivered_at BETWEEN ? AND ? GROUP BY day, program ORDER BY day`,
  ).all(f, t);
  const commissions = db.prepare(
    `SELECT program, status, SUM(amount) total FROM earnings WHERE created_at BETWEEN ? AND ? GROUP BY program, status`,
  ).all(f, t);
  const payable = db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM earnings WHERE program='retail' AND status='available')
       - (SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE status IN ('requested','approved','paid')) AS retail_available_unpaid,
       (SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE status IN ('requested','approved')) AS withdrawals_open`,
  ).get();
  // Strongest networks: who earned the most (proxy for sales made under them)
  const topNetworks = db.prepare(
    `SELECT m.id, m.program, COALESCE(m.shop_name, m.name) name, m.phone, SUM(e.amount) earned, COUNT(DISTINCT e.order_id) orders
     FROM earnings e JOIN members m ON m.id = e.member_id
     WHERE e.status != 'cancelled' AND e.created_at BETWEEN ? AND ?
     GROUP BY m.id ORDER BY earned DESC LIMIT 20`,
  ).all(f, t);
  const counts = db.prepare(
    `SELECT program, COUNT(*) members, SUM(status='pending_approval') pending FROM members GROUP BY program`,
  ).all();
  const openOrders = db.prepare(`SELECT status, COUNT(*) n FROM orders WHERE status IN ('placed','confirmed','shipped') GROUP BY status`).all();
  return { sales, daily, commissions, payable, topNetworks, counts, openOrders };
}

export function adminOrders(db: DB, q: { program?: string; status?: string; query?: string }) {
  const where: string[] = [];
  const args: string[] = [];
  if (q.program) { where.push("o.program = ?"); args.push(q.program); }
  if (q.status) { where.push("o.status = ?"); args.push(q.status); }
  if (q.query) { where.push("(CAST(o.id AS TEXT) = ? OR m.phone LIKE ? OR m.name LIKE ?)"); args.push(q.query, `%${q.query.replace(/\D/g, "") || "~"}%`, `%${q.query}%`); }
  const ids = db.prepare(
    `SELECT o.id FROM orders o JOIN members m ON m.id = o.member_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.id DESC LIMIT 200`,
  ).all(...args) as { id: number }[];
  return ids.map(({ id }) => {
    const o = getOrder(db, id)!;
    const m = getMember(db, o.memberId)!;
    return { ...o, member: { id: m.id, name: m.shop_name ?? m.name, phone: m.phone } };
  });
}
