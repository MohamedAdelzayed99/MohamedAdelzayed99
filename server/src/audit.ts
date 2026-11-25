import type { DB } from "./db.ts";

export function audit(db: DB, adminId: number | null, action: string, entity: string, entityId: number | null, details: object = {}) {
  db.prepare("INSERT INTO audit_log (admin_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)").run(
    adminId, action, entity, entityId, JSON.stringify(details),
  );
}
