// Demo data: admin account, categories, products, and the example trees from the plan.
// Usage: npm run seed  (uses DB_PATH, default hightech.db)
import { egp } from "@hightech/commission";
import { openDb } from "./db.ts";
import { createAdmin, saveProduct } from "./admin.ts";

const db = openDb();
if (db.prepare("SELECT 1 FROM admins").get()) {
  console.log("Database already seeded.");
  process.exit(0);
}
const pw = process.env.ADMIN_PASSWORD ?? "hightech-admin";
createAdmin(db, "admin", pw, "مدير النظام");

const cats = ["شواحن", "باور بنك", "سماعات", "وصلات"];
cats.forEach((name, i) => db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)").run(name, i));
const cat = (n: string) => (db.prepare("SELECT id FROM categories WHERE name = ?").get(n) as { id: number }).id;
const products: [string, string, number, number, number][] = [
  ["شاحن سريع 20 وات USB-C", "شواحن", 350, 260, 10],
  ["شاحن سيارة 2 منفذ", "شواحن", 220, 160, 10],
  ["باور بنك 10000 مللي أمبير", "باور بنك", 650, 500, 5],
  ["باور بنك 20000 مللي أمبير", "باور بنك", 1000, 780, 5],
  ["سماعة بلوتوث لاسلكية", "سماعات", 900, 680, 5],
  ["سماعة سلك 3.5 مم", "سماعات", 120, 85, 20],
  ["وصلة Type-C إلى Type-C متر", "وصلات", 150, 100, 20],
  ["وصلة Lightning متر", "وصلات", 180, 120, 20],
];
for (const [name, c, retail, wholesale, minQty] of products) {
  saveProduct(db, 1, null, {
    name, categoryId: cat(c), description: "", retailPrice: egp(retail), wholesalePrice: egp(wholesale), wholesaleMinQty: minQty, stock: 500,
  });
}

// Example trees from the sheets: م. خالد → أ1 → 1.1 → 2.1 → 3.1 → 4.1 (retail), shops for wholesale.
let phoneN = 1000000;
const add = (program: "retail" | "wholesale", name: string, parentId: number | null, shop?: string) => {
  const phone = `+20100${String(phoneN++).padStart(7, "0")}`;
  const code = (program === "retail" ? "R" : "W") + name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(3, "X") + phoneN % 1000;
  const r = db.prepare(
    "INSERT INTO members (program, phone, name, referral_code, parent_id, status, shop_name, shop_address) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
  ).run(program, phone, name, code, parentId, shop ?? null, shop ? "القاهرة" : null);
  return Number(r.lastInsertRowid);
};
let parent = add("retail", "م. خالد", null);
for (const n of ["أ1", "1.1", "2.1", "3.1", "4.1"]) parent = add("retail", n, parent);
add("retail", "م. رضا", null);
let shop = add("wholesale", "ميلانو", null, "ميلانو");
for (const n of ["طيب", "مينا"]) shop = add("wholesale", n, shop, n);

console.log(`Seeded. Admin login: admin / ${pw}`);
