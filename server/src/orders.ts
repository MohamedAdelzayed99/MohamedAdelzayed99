import { formatEGP, type Program, splitCommission } from "@hightech/commission";
import { type DB, getJson, getNum, sqlTime, tx } from "./db.ts";
import { audit } from "./audit.ts";
import { type Member, upline } from "./members.ts";
import { notify } from "./notify.ts";
import { bad, clock, forbidden, int, notFound, str } from "./util.ts";
import { balances } from "./wallet.ts";

export type OrderStatus = "placed" | "confirmed" | "shipped" | "delivered" | "returned" | "cancelled";

/** Allowed status changes from the dashboard. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

export const STATUS_AR: Record<OrderStatus, string> = {
  placed: "تم الطلب",
  confirmed: "تم التأكيد",
  shipped: "في الطريق",
  delivered: "تم التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
};

interface ProductRow {
  id: number;
  name: string;
  retail_price: number;
  retail_offer_price: number | null;
  wholesale_price: number;
  wholesale_min_qty: number;
  stock: number;
  active: number;
}

/** Price the member pays. Retail members never see wholesale prices and vice versa. */
export function unitPrice(p: ProductRow, program: Program): number {
  return program === "retail" ? (p.retail_offer_price ?? p.retail_price) : p.wholesale_price;
}

export function productView(p: ProductRow & Record<string, unknown>, program: Program) {
  return {
    id: p.id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    imageUrl: p.image_url,
    price: unitPrice(p, program),
    ...(program === "retail"
      ? { originalPrice: p.retail_offer_price != null ? p.retail_price : null }
      : { minQty: p.wholesale_min_qty }),
    inStock: p.stock > 0,
  };
}

export interface PlaceOrderInput {
  items: unknown;
  address: unknown;
  governorate?: unknown;
  contactPhone?: unknown;
  notes?: unknown;
  paymentMethod?: unknown;
  useDiscount?: unknown; // wholesale: apply discount balance to this invoice
}

export function placeOrder(db: DB, member: Member, input: PlaceOrderInput) {
  if (member.status !== "active") throw forbidden("الحساب في انتظار التفعيل");
  const program = member.program;
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) throw bad("empty_cart", "السلة فارغة");
  const methods = getJson<string[]>(db, `payment_methods_${program}`);
  const paymentMethod = typeof input.paymentMethod === "string" ? input.paymentMethod : "cod";
  if (!methods.includes(paymentMethod)) throw bad("payment_method", "طريقة الدفع غير متاحة");

  return tx(db, () => {
    const lines = (input.items as { productId: unknown; qty: unknown }[]).map((it) => {
      const id = int(it?.productId, "productId", { min: 1 });
      const qty = int(it?.qty, "qty", { min: 1 });
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
      if (!p || !p.active) throw bad("product_unavailable", "منتج غير متاح");
      if (program === "wholesale" && qty < p.wholesale_min_qty) {
        throw bad("min_qty", `أقل كمية لـ ${p.name} هي ${p.wholesale_min_qty}`);
      }
      if (p.stock < qty) throw bad("out_of_stock", `الكمية المتاحة من ${p.name}: ${p.stock}`);
      return { p, qty, price: unitPrice(p, program) };
    });

    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const shipping = getNum(db, `${program}_shipping_fee`);
    let discountUsed = 0;
    if (program === "wholesale" && input.useDiscount) {
      discountUsed = Math.min(balances(db, member).available, subtotal);
    }
    const rate = db.prepare("SELECT id FROM rate_versions WHERE program = ? ORDER BY id DESC LIMIT 1").get(program) as { id: number };

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO orders (program, member_id, payment_method, subtotal, discount_used, shipping_fee, total, address, governorate,
           contact_phone, notes, rate_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        program, member.id, paymentMethod, subtotal, discountUsed, shipping, subtotal - discountUsed + shipping,
        str(input.address, "address", { max: 300 }), str(input.governorate, "governorate", { max: 50, optional: true }),
        input.contactPhone ? String(input.contactPhone).slice(0, 20) : member.phone,
        str(input.notes, "notes", { max: 500, optional: true }), rate.id, sqlTime(clock.now()),
      );
    const orderId = Number(lastInsertRowid);
    for (const l of lines) {
      db.prepare("INSERT INTO order_items (order_id, product_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)").run(
        orderId, l.p.id, l.p.name, l.price, l.qty,
      );
      db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(l.qty, l.p.id);
    }
    db.prepare("INSERT INTO order_status_log (order_id, status) VALUES (?, 'placed')").run(orderId);
    db.prepare("UPDATE members SET last_active_at = ? WHERE id = ?").run(sqlTime(clock.now()), member.id);
    return getOrder(db, orderId)!;
  });
}

export function getOrder(db: DB, id: number) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Record<string, any> | undefined;
  if (!o) return undefined;
  const items = db.prepare("SELECT product_id, name, unit_price, qty FROM order_items WHERE order_id = ?").all(id) as any[];
  const history = db.prepare("SELECT status, note, at FROM order_status_log WHERE order_id = ? ORDER BY id").all(id) as any[];
  return {
    id: o.id,
    program: o.program as Program,
    memberId: o.member_id,
    status: o.status as OrderStatus,
    statusLabel: STATUS_AR[o.status as OrderStatus],
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    subtotal: o.subtotal,
    discountUsed: o.discount_used,
    shippingFee: o.shipping_fee,
    total: o.total,
    address: o.address,
    governorate: o.governorate,
    contactPhone: o.contact_phone,
    notes: o.notes,
    createdAt: o.created_at,
    deliveredAt: o.delivered_at,
    releaseAt: o.release_at,
    items: items.map((i) => ({ productId: i.product_id, name: i.name, unitPrice: i.unit_price, qty: i.qty })),
    history,
  };
}

export function listOrders(db: DB, memberId: number) {
  const ids = db.prepare("SELECT id FROM orders WHERE member_id = ? ORDER BY id DESC LIMIT 200").all(memberId) as { id: number }[];
  return ids.map((r) => getOrder(db, r.id)!);
}

/**
 * Dashboard status change. Delivery (with payment) creates pending earnings for the upline;
 * a return inside the window cancels them; maturity releases them (see releaseMatured).
 */
export function setOrderStatus(db: DB, adminId: number | null, orderId: number, to: OrderStatus, note = "") {
  return tx(db, () => {
    const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as Record<string, any> | undefined;
    if (!o) throw notFound("الطلب غير موجود");
    const from = o.status as OrderStatus;
    if (!TRANSITIONS[from]?.includes(to)) throw bad("bad_transition", `لا يمكن التحويل من «${STATUS_AR[from]}» إلى «${STATUS_AR[to]}»`);
    const now = sqlTime(clock.now());

    if (to === "delivered") {
      // Cash on delivery is collected by the courier at delivery.
      if (o.payment_method === "cod") db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(orderId);
      const paid = (db.prepare("SELECT payment_status FROM orders WHERE id = ?").get(orderId) as any).payment_status === "paid";
      if (!paid) throw bad("unpaid", "لا يمكن تسليم طلب غير مدفوع");
      const releaseAt = sqlTime(clock.now(), getNum(db, "return_window_days"));
      db.prepare("UPDATE orders SET status = 'delivered', delivered_at = ?, release_at = ? WHERE id = ?").run(now, releaseAt, orderId);
      createEarnings(db, o, releaseAt);
    } else if (to === "returned") {
      if (o.release_at && o.release_at <= now) throw bad("window_closed", "انتهت مدة الإرجاع");
      db.prepare("UPDATE orders SET status = 'returned', payment_status = 'refunded', closed_at = ? WHERE id = ?").run(now, orderId);
      db.prepare("UPDATE earnings SET status = 'cancelled' WHERE order_id = ? AND status = 'pending'").run(orderId);
      restock(db, orderId);
      for (const e of db.prepare("SELECT member_id, amount FROM earnings WHERE order_id = ?").all(orderId) as any[]) {
        notify(db, e.member_id, "تم إلغاء ربح", `تم إرجاع طلب في شبكتك، وتم إلغاء ${formatEGP(e.amount)} من رصيدك المعلّق`);
      }
    } else if (to === "cancelled") {
      db.prepare("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?").run(now, orderId);
      restock(db, orderId);
    } else {
      db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(to, orderId);
    }
    db.prepare("INSERT INTO order_status_log (order_id, status, admin_id, note) VALUES (?, ?, ?, ?)").run(orderId, to, adminId, note);
    if (adminId) audit(db, adminId, "order_status", "order", orderId, { from, to, note });
    notify(db, o.member_id, `طلبك رقم ${orderId}`, `حالة الطلب: ${STATUS_AR[to]}`);
    return getOrder(db, orderId)!;
  });
}

/** Mark a card / wallet payment as paid (called by the payment gateway webhook or the dashboard). */
export function markPaid(db: DB, adminId: number | null, orderId: number) {
  const r = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND payment_status = 'unpaid'").run(orderId);
  if (!r.changes) throw bad("not_unpaid", "الطلب مدفوع بالفعل أو غير موجود");
  if (adminId) audit(db, adminId, "order_paid", "order", orderId);
  return getOrder(db, orderId)!;
}

function restock(db: DB, orderId: number) {
  for (const i of db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ?").all(orderId) as any[]) {
    db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").run(i.qty, i.product_id);
  }
}

function createEarnings(db: DB, order: Record<string, any>, releaseAt: string) {
  const rate = db.prepare("SELECT total_bp, step_bp, floor_bp FROM rate_versions WHERE id = ?").get(order.rate_version_id) as any;
  // Commission is on the goods value (subtotal), before discount credit and shipping (Q2: selling price).
  const shares = splitCommission(upline(db, order.member_id), order.subtotal, {
    totalBp: rate.total_bp, stepBp: rate.step_bp, floorBp: rate.floor_bp,
  });
  const word = order.program === "retail" ? "كسبت" : "حصلت على خصم";
  for (const s of shares) {
    if (s.amount <= 0) continue;
    db.prepare(
      "INSERT INTO earnings (member_id, order_id, program, level, rate_bp, amount, release_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(s.memberId, order.id, order.program, s.level, s.rateBp, s.amount, releaseAt);
    notify(db, s.memberId, "ربح جديد 🎉", `${word} ${formatEGP(s.amount)} من طلب جديد في شبكتك (رصيد معلّق حتى انتهاء مدة الإرجاع)`);
  }
}

/** Release earnings whose return window has passed. Safe to call any time. */
export function releaseMatured(db: DB): number {
  const now = sqlTime(clock.now());
  const r = db
    .prepare(
      `UPDATE earnings SET status = 'available'
       WHERE status = 'pending' AND release_at <= ?
         AND order_id IN (SELECT id FROM orders WHERE status = 'delivered')`,
    )
    .run(now);
  return Number(r.changes);
}
