import type { Program } from "@hightech/commission";
import { type DB, getBool, getNum, getSetting, sqlTime, tx } from "./db.ts";
import { bad, clock, forbidden, HttpError, maskPhone, newToken, normalizePhone, notFound, otpCode, referralCode, sha256, str } from "./util.ts";
import { audit } from "./audit.ts";

export interface Member {
  id: number;
  program: Program;
  phone: string;
  name: string;
  referral_code: string;
  parent_id: number | null;
  status: "active" | "pending_approval" | "suspended";
  shop_name: string | null;
  shop_address: string | null;
  commercial_reg: string | null;
  push_token: string | null;
  payout_method: string | null;
  payout_account: string | null;
  last_active_at: string | null;
  created_at: string;
}

export const getMember = (db: DB, id: number) =>
  db.prepare("SELECT * FROM members WHERE id = ?").get(id) as Member | undefined;

export function shareLink(m: Pick<Member, "program" | "referral_code">): string {
  const base = (process.env.PUBLIC_URL ?? "https://hightech.example").replace(/\/$/, "");
  return `${base}/${m.program === "retail" ? "r" : "w"}/${m.referral_code}`;
}

/** Public view of the logged-in member (what the app shows on "my account"). */
export function publicMember(m: Member) {
  return {
    id: m.id,
    program: m.program,
    phone: m.phone,
    name: m.name,
    referralCode: m.referral_code,
    shareLink: shareLink(m),
    status: m.status,
    shopName: m.shop_name,
    shopAddress: m.shop_address,
    payoutMethod: m.payout_method,
    payoutAccount: m.payout_account,
    createdAt: m.created_at,
  };
}

// ---------------------------------------------------------------- OTP login

const OTP_TTL_MIN = 5;
const OTP_RESEND_SEC = 60;
const OTP_MAX_ATTEMPTS = 5;

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

/** Without an SMS provider configured the code is logged (and returned when DEV_OTP=1). */
export const consoleSms: SmsSender = {
  async send(phone, text) {
    console.log(`[sms] ${phone}: ${text}`);
  },
};

export async function requestOtp(db: DB, sms: SmsSender, program: Program, rawPhone: unknown) {
  const phone = normalizePhone(rawPhone);
  const prev = db.prepare("SELECT sent_at FROM otp_codes WHERE program = ? AND phone = ?").get(program, phone) as
    | { sent_at: string }
    | undefined;
  if (prev && prev.sent_at > sqlTime(new Date(clock.now().getTime() - OTP_RESEND_SEC * 1000))) {
    throw new HttpError(429, "otp_too_soon", "انتظر دقيقة قبل طلب كود جديد");
  }
  const code = otpCode();
  db.prepare(
    `INSERT INTO otp_codes (program, phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (program, phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_at = excluded.sent_at`,
  ).run(program, phone, sha256(phone + code), sqlTime(new Date(clock.now().getTime() + OTP_TTL_MIN * 60_000)), sqlTime(clock.now()));
  await sms.send(phone, `High Tech: كود التأكيد ${code}`);
  const exists = !!db.prepare("SELECT 1 FROM members WHERE program = ? AND phone = ?").get(program, phone);
  return { phone, isNewUser: !exists, ...(process.env.DEV_OTP === "1" ? { devCode: code } : {}) };
}

export interface SignupInput {
  phone: unknown;
  code: unknown;
  name?: unknown;
  referralCode?: unknown;
  shopName?: unknown;
  shopAddress?: unknown;
  commercialReg?: unknown;
}

export function verifyOtp(db: DB, program: Program, input: SignupInput) {
  const phone = normalizePhone(input.phone);
  const row = db.prepare("SELECT * FROM otp_codes WHERE program = ? AND phone = ?").get(program, phone) as
    | { code_hash: string; expires_at: string; attempts: number }
    | undefined;
  if (!row || row.expires_at < sqlTime(clock.now())) throw bad("otp_expired", "الكود انتهى، اطلب كودًا جديدًا");
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw bad("otp_locked", "محاولات كثيرة، اطلب كودًا جديدًا");
  if (row.code_hash !== sha256(phone + String(input.code ?? "").trim())) {
    db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE program = ? AND phone = ?").run(program, phone);
    throw bad("otp_wrong", "الكود غير صحيح");
  }

  return tx(db, () => {
    let member = db.prepare("SELECT * FROM members WHERE program = ? AND phone = ?").get(program, phone) as Member | undefined;
    let isNew = false;
    if (!member) {
      member = createMember(db, program, phone, input);
      isNew = true;
    }
    if (member.status === "suspended") throw forbidden("الحساب موقوف، تواصل معنا");
    db.prepare("DELETE FROM otp_codes WHERE program = ? AND phone = ?").run(program, phone);
    const token = newToken();
    db.prepare("INSERT INTO sessions (token_hash, kind, subject_id, expires_at) VALUES (?, 'member', ?, ?)").run(
      sha256(token), member.id, sqlTime(clock.now(), 180),
    );
    return { token, isNew, member: publicMember(member) };
  });
}

function createMember(db: DB, program: Program, phone: string, input: SignupInput): Member {
  const name = str(input.name, "name", { max: 80 });
  let parentId: number | null = null;
  const code = typeof input.referralCode === "string" ? input.referralCode.trim().toUpperCase() : "";
  if (code) {
    const parent = db.prepare("SELECT id, program, status FROM members WHERE referral_code = ?").get(code) as
      | { id: number; program: Program; status: string }
      | undefined;
    if (!parent || parent.program !== program) throw bad("invalid_referral", "كود الدعوة غير صحيح");
    parentId = parent.id;
  } else {
    const sponsor = getSetting(db, `default_sponsor_${program}`);
    parentId = sponsor ? Number(sponsor) : null;
  }

  let shop = { name: null as string | null, address: null as string | null, reg: null as string | null };
  let status: Member["status"] = "active";
  if (program === "wholesale") {
    shop = {
      name: str(input.shopName, "shopName", { max: 120 }),
      address: str(input.shopAddress, "shopAddress", { max: 300 }),
      reg: str(input.commercialReg, "commercialReg", { max: 60, optional: true }) || null,
    };
    if (getBool(db, "wholesale_requires_approval")) status = "pending_approval";
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO members (program, phone, name, referral_code, parent_id, status, shop_name, shop_address, commercial_reg)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(program, phone, name, referralCode(program === "retail" ? "R" : "W"), parentId, status, shop.name, shop.address, shop.reg);
      return getMember(db, Number(lastInsertRowid))!;
    } catch (e) {
      if (attempt < 5 && String(e).includes("referral_code")) continue; // code collision, retry
      throw e;
    }
  }
}

export function memberFromToken(db: DB, token: string | undefined): Member | undefined {
  if (!token) return undefined;
  const s = db
    .prepare("SELECT subject_id FROM sessions WHERE token_hash = ? AND kind = 'member' AND expires_at > ?")
    .get(sha256(token), sqlTime(clock.now())) as { subject_id: number } | undefined;
  return s ? getMember(db, s.subject_id) : undefined;
}

// ---------------------------------------------------------------- tree

/** Upline from the direct parent to the root. */
export function upline(db: DB, memberId: number): number[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM members WHERE id = ?
         UNION ALL
         SELECT m.id, m.parent_id, up.depth + 1 FROM members m JOIN up ON m.id = up.parent_id
         WHERE up.depth < 100000
       )
       SELECT id FROM up WHERE depth > 0 ORDER BY depth`,
    )
    .all(memberId) as { id: number }[];
  return rows.map((r) => r.id);
}

/** The member's network: counts, earnings per level, and names down to the configured depth. */
export function network(db: DB, member: Member) {
  const namesDepth = getNum(db, "network_names_depth");
  const rows = db
    .prepare(
      `WITH RECURSIVE down(id, depth) AS (
         SELECT id, 0 FROM members WHERE id = ?
         UNION ALL
         SELECT m.id, down.depth + 1 FROM members m JOIN down ON m.parent_id = down.id
       )
       SELECT d.depth, m.id, m.name, m.phone, m.shop_name, m.created_at
       FROM down d JOIN members m ON m.id = d.id WHERE d.depth > 0 ORDER BY d.depth, m.created_at`,
    )
    .all(member.id) as { depth: number; id: number; name: string; phone: string; shop_name: string | null; created_at: string }[];

  // Earnings per level, from this member's point of view (level 1 = sales by people they directly invited).
  const earned = db
    .prepare(
      `SELECT level, status, SUM(amount) AS total FROM earnings WHERE member_id = ? AND status != 'cancelled' GROUP BY level, status`,
    )
    .all(member.id) as { level: number; status: string; total: number }[];

  const levels = new Map<number, { level: number; count: number; earnedAvailable: number; earnedPending: number; members?: object[] }>();
  const lvl = (n: number) => {
    if (!levels.has(n)) levels.set(n, { level: n, count: 0, earnedAvailable: 0, earnedPending: 0 });
    return levels.get(n)!;
  };
  for (const r of rows) {
    const L = lvl(r.depth);
    L.count++;
    if (r.depth <= namesDepth) {
      (L.members ??= []).push({ id: r.id, name: r.shop_name ?? r.name, phone: maskPhone(r.phone), joinedAt: r.created_at });
    }
  }
  for (const e of earned) {
    const L = lvl(e.level);
    if (e.status === "available") L.earnedAvailable += e.total;
    else L.earnedPending += e.total;
  }
  const list = [...levels.values()].sort((a, b) => a.level - b.level);
  return { totalMembers: rows.length, levels: list };
}

/** Admin: move a member under a new parent (or make them top-level). Logged. */
export function moveMember(db: DB, adminId: number, memberId: number, newParentId: number | null, reason: string) {
  return tx(db, () => {
    const m = getMember(db, memberId);
    if (!m) throw notFound("العضو غير موجود");
    if (newParentId !== null) {
      const p = getMember(db, newParentId);
      if (!p) throw notFound("العضو الجديد غير موجود");
      if (p.program !== m.program) throw bad("program_mismatch", "لا يمكن النقل بين القطاعي والجملة");
      if (p.id === m.id || upline(db, p.id).includes(m.id)) throw bad("cycle", "لا يمكن وضع العضو تحت أحد أفراد شبكته");
    }
    db.prepare("UPDATE members SET parent_id = ? WHERE id = ?").run(newParentId, memberId);
    audit(db, adminId, "move_member", "member", memberId, { from: m.parent_id, to: newParentId, reason });
    return getMember(db, memberId)!;
  });
}
