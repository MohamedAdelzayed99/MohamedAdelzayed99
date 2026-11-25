import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb, sqlTime } from "./db.ts";
import { releaseMatured } from "./orders.ts";

const db = openDb();
const port = Number(process.env.PORT ?? 4000);
createApp(db).listen(port, () => console.log(`High Tech API on http://localhost:${port}`));

// Release earnings whose return window ended (every 10 minutes).
const release = () => {
  try {
    const n = releaseMatured(db);
    if (n) console.log(`[release] ${n} earnings now available`);
  } catch (e) {
    console.error("[release]", e);
  }
};
release();
setInterval(release, 10 * 60_000).unref();

// Nightly backup (plan section 6): consistent snapshot with VACUUM INTO.
const backupDir = process.env.BACKUP_DIR ?? "backups";
let lastBackupDay = "";
setInterval(() => {
  const now = new Date();
  const day = sqlTime(now).slice(0, 10);
  if (now.getUTCHours() !== 0 || day === lastBackupDay) return; // ~2am Cairo
  lastBackupDay = day;
  try {
    mkdirSync(backupDir, { recursive: true });
    db.exec(`VACUUM INTO '${join(backupDir, `hightech-${day}.db`).replace(/'/g, "''")}'`);
    console.log(`[backup] ${day} done`);
  } catch (e) {
    console.error("[backup]", e);
  }
}, 15 * 60_000).unref();
