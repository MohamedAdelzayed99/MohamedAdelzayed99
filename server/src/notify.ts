import type { DB } from "./db.ts";

/**
 * Store an in-app notification and, when PUSH_ENABLED=1 and the member registered
 * an Expo push token, send a push notification too. Never throws.
 */
export function notify(db: DB, memberId: number, title: string, body: string) {
  db.prepare("INSERT INTO notifications (member_id, title, body) VALUES (?, ?, ?)").run(memberId, title, body);
  if (process.env.PUSH_ENABLED !== "1") return;
  const row = db.prepare("SELECT push_token FROM members WHERE id = ?").get(memberId) as { push_token: string | null } | undefined;
  if (!row?.push_token) return;
  fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: row.push_token, title, body, sound: "default" }),
  }).catch((e) => console.error("[push] failed", e));
}
