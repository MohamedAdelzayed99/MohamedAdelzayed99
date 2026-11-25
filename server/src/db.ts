import { DatabaseSync } from "node:sqlite";
import { DEFAULT_RATES } from "@hightech/commission";

export type DB = DatabaseSync;

const SCHEMA = /* sql */ `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY,
  program       TEXT NOT NULL CHECK (program IN ('retail','wholesale')),
  phone         TEXT NOT NULL,
  name          TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES members(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending_approval','suspended')),
  shop_name     TEXT,
  shop_address  TEXT,
  commercial_reg TEXT,
  push_token    TEXT,
  payout_method TEXT,
  payout_account TEXT,
  last_active_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (program, phone)
);
CREATE INDEX IF NOT EXISTS idx_members_parent ON members(parent_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  program    TEXT NOT NULL,
  phone      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (program, phone)
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('member','admin')),
  subject_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id               INTEGER PRIMARY KEY,
  category_id      INTEGER REFERENCES categories(id),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  image_url        TEXT,
  retail_price     INTEGER NOT NULL CHECK (retail_price >= 0),
  retail_offer_price INTEGER CHECK (retail_offer_price >= 0),
  wholesale_price  INTEGER NOT NULL CHECK (wholesale_price >= 0),
  wholesale_min_qty INTEGER NOT NULL DEFAULT 1,
  stock            INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_versions (
  id         INTEGER PRIMARY KEY,
  program    TEXT NOT NULL,
  total_bp   INTEGER NOT NULL,
  step_bp    INTEGER NOT NULL,
  floor_bp   INTEGER NOT NULL,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY,
  program         TEXT NOT NULL,
  member_id       INTEGER NOT NULL REFERENCES members(id),
  status          TEXT NOT NULL DEFAULT 'placed'
                  CHECK (status IN ('placed','confirmed','shipped','delivered','returned','cancelled')),
  payment_method  TEXT NOT NULL DEFAULT 'cod',
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  subtotal        INTEGER NOT NULL,
  discount_used   INTEGER NOT NULL DEFAULT 0,
  shipping_fee    INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  address         TEXT NOT NULL,
  governorate     TEXT NOT NULL DEFAULT '',
  contact_phone   TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  rate_version_id INTEGER NOT NULL REFERENCES rate_versions(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at    TEXT,
  release_at      TEXT,
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_member ON orders(member_id);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS order_status_log (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  status     TEXT NOT NULL,
  admin_id   INTEGER REFERENCES admins(id),
  note       TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (order, upline member). Pending until the return window ends.
CREATE TABLE IF NOT EXISTS earnings (
  id          INTEGER PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id),
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  program     TEXT NOT NULL,
  level       INTEGER NOT NULL,
  rate_bp     REAL NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','cancelled')),
  release_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_earnings_member ON earnings(member_id, status);

CREATE TABLE IF NOT EXISTS withdrawals (
  id          INTEGER PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL,
  account     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','paid','rejected')),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT,
  decided_by  INTEGER REFERENCES admins(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  admin_id   INTEGER REFERENCES admins(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  details    TEXT NOT NULL DEFAULT '{}',
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** Defaults for the open questions in the plan (section 10). All editable from the dashboard. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  return_window_days: "14", // Q9
  min_withdrawal: "10000", // Q4: 100 EGP, in piastres
  withdrawal_methods: JSON.stringify(["vodafone_cash", "instapay", "bank_transfer"]), // Q4
  wholesale_cash_out: "false", // Q3: wholesale discount is credit on future invoices only
  wholesale_requires_approval: "true", // Q8
  network_names_depth: "1", // Q10: names visible for level 1 only, counts for deeper levels
  retail_shipping_fee: "5000", // Q12: 50 EGP
  wholesale_shipping_fee: "0",
  payment_methods_retail: JSON.stringify(["cod"]), // Q13 (card/wallets via Paymob once the account exists)
  payment_methods_wholesale: JSON.stringify(["cod"]),
  default_sponsor_retail: "", // Q5: member id new sign-ups without a link go under ("" = become a top-level member)
  default_sponsor_wholesale: "",
};

export function openDb(path = process.env.DB_PATH ?? "hightech.db"): DB {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const ins = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  for (const program of ["retail", "wholesale"] as const) {
    const has = db.prepare("SELECT 1 FROM rate_versions WHERE program = ?").get(program);
    if (!has) {
      const r = DEFAULT_RATES[program];
      db.prepare("INSERT INTO rate_versions (program, total_bp, step_bp, floor_bp) VALUES (?, ?, ?, ?)").run(
        program, r.totalBp, r.stepBp, r.floorBp,
      );
    }
  }
  return db;
}

/** Run `fn` inside a transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting(db: DB, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}
export const getNum = (db: DB, key: string) => Number(getSetting(db, key));
export const getBool = (db: DB, key: string) => getSetting(db, key) === "true";
export const getJson = <T>(db: DB, key: string): T => JSON.parse(getSetting(db, key) || "null") as T;

/** SQLite datetime string for now (+ optional days), comparable with datetime('now'). */
export function sqlTime(date = new Date(), plusDays = 0): string {
  const d = new Date(date.getTime() + plusDays * 86_400_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
