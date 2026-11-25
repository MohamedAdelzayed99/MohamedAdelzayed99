import { formatEGP } from "@hightech/commission";
import { type DB, getBool, getJson, getNum, sqlTime, tx } from "./db.ts";
import { audit } from "./audit.ts";
import type { Member } from "./members.ts";
import { notify } from "./notify.ts";
import { bad, clock, forbidden, int, notFound, str } from "./util.ts";

/**
 * Balances are always derived from the ledger tables, never stored, so nobody can edit
 * a balance directly (plan section 6).
 *   available = released earnings − withdrawals (not rejected) − discount used on invoices (not cancelled/returned)
 *   pending   = earnings still inside the return window
 */
export function balances(db: DB, m: Pick<Member, "id">) {
  const q = (sql: string) => ((db.prepare(sql).get(m.id) as { v: number | null }).v ?? 0);
  const released = q("SELECT SUM(amount) v FROM earnings WHERE member_id = ? AND status = 'available'");
  const pending = q("SELECT SUM(amount) v FROM earnings WHERE member_id = ? AND status = 'pending'");
  const withdrawn = q("SELECT SUM(amount) v FROM withdrawals WHERE member_id = ? AND status != 'rejected'");
  const usedOnInvoices = q("SELECT SUM(discount_used) v FROM orders WHERE member_id = ? AND status NOT IN ('cancelled','returned')");
  const lifetime = released + pending;
  return { available: released - withdrawn - usedOnInvoices, pending, withdrawn, usedOnInvoices, lifetime };
}

export function walletView(db: DB, m: Member) {
  const earnings = db
    .prepare(
      `SELECT e.id, e.order_id, e.level, e.amount, e.status, e.release_at, e.created_at
       FROM earnings e WHERE e.member_id = ? ORDER BY e.id DESC LIMIT 100`,
    )
    .all(m.id);
  const withdrawals = db.prepare("SELECT id, amount, method, account, status, note, created_at, decided_at FROM withdrawals WHERE member_id = ? ORDER BY id DESC LIMIT 50").all(m.id);
  return {
    ...balances(db, m),
    minWithdrawal: getNum(db, "min_withdrawal"),
    canWithdraw: m.program === "retail" || getBool(db, "wholesale_cash_out"),
    withdrawalMethods: getJson<string[]>(db, "withdrawal_methods"),
    earnings,
    withdrawals,
  };
}

export function requestWithdrawal(db: DB, m: Member, input: { amount: unknown; method: unknown; account: unknown }) {
  if (m.program === "wholesale" && !getBool(db, "wholesale_cash_out")) {
    throw forbidden("رصيد الخصم يُستخدم في الفواتير القادمة فقط");
  }
  const amount = int(input.amount, "amount", { min: 1 });
  const method = str(input.method, "method", { max: 30 });
  const account = str(input.account, "account", { max: 100 });
  if (!getJson<string[]>(db, "withdrawal_methods").includes(method)) throw bad("method", "طريقة السحب غير متاحة");
  const min = getNum(db, "min_withdrawal");
  if (amount < min) throw bad("below_min", `الحد الأدنى للسحب ${formatEGP(min)}`);
  return tx(db, () => {
    if (db.prepare("SELECT 1 FROM withdrawals WHERE member_id = ? AND status = 'requested'").get(m.id)) {
      throw bad("pending_exists", "لديك طلب سحب قيد المراجعة بالفعل");
    }
    if (amount > balances(db, m).available) throw bad("insufficient", "الرصيد المتاح لا يكفي");
    const { lastInsertRowid } = db
      .prepare("INSERT INTO withdrawals (member_id, amount, method, account, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(m.id, amount, method, account, sqlTime(clock.now()));
    db.prepare("UPDATE members SET payout_method = ?, payout_account = ? WHERE id = ?").run(method, account, m.id);
    return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(Number(lastInsertRowid));
  });
}

/** Dashboard: approve → paid, or reject (which returns the money to the available balance). */
export function decideWithdrawal(db: DB, adminId: number, id: number, to: "approved" | "paid" | "rejected", note = "") {
  return tx(db, () => {
    const w = db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id) as any;
    if (!w) throw notFound("طلب السحب غير موجود");
    const ok = (w.status === "requested" && to !== "paid") || (w.status === "approved" && to !== "approved");
    if (!ok) throw bad("bad_transition", "لا يمكن تغيير حالة هذا الطلب");
    db.prepare("UPDATE withdrawals SET status = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(
      to, note, sqlTime(clock.now()), adminId, id,
    );
    audit(db, adminId, "withdrawal_" + to, "withdrawal", id, { amount: w.amount, note });
    const msg = {
      approved: `تمت الموافقة على سحب ${formatEGP(w.amount)}، وسيصلك قريبًا`,
      paid: `تم تحويل ${formatEGP(w.amount)} إلى حسابك`,
      rejected: `تم رفض طلب سحب ${formatEGP(w.amount)} وعاد المبلغ لرصيدك${note ? ": " + note : ""}`,
    }[to];
    notify(db, w.member_id, "طلب السحب", msg);
    return db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id);
  });
}
