import type { DatabaseSync } from "node:sqlite";

/** Run SQLite's native integrity probe through the shared lifecycle boundary. */
export function readSqliteQuickCheck(db: DatabaseSync): string[] {
  const rows = db.prepare("PRAGMA quick_check").all() as Array<{
    quick_check?: unknown;
  }>;
  return rows.map((row) => (typeof row.quick_check === "string" ? row.quick_check : "unknown"));
}
