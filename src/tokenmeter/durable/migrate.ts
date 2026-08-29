/**
 * One-time migration from the legacy SQLite aggregate (tokenmeter.sqlite
 * under api.state.path.state) into the durable per-session checkpoint model.
 *
 * The legacy DB holds ONE aggregate row per project_id and a tombstone set.
 * We import each aggregate as a single reserved checkpoint row per project so
 * the existing all-time-history contract is preserved. The import is idempotent:
 * re-running never duplicates. After import, only the durable reader/writer
 * is used — no ongoing dual-write.
 *
 * If the legacy DB was already deleted, there is nothing to recover.
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const LEGACY_RESERVED_ID = "__migrated_aggregate__"

function withLegacyDb<T>(
  legacyPath: string | null,
  fn: (db: Database) => T,
): T | null {
  if (!legacyPath || !existsSync(legacyPath)) return null
  let db: Database | null = null
  try {
    db = new Database(legacyPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 2000")
    return fn(db)
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

/**
 * Migrates legacy aggregates into the durable store.
 * Returns number of projects migrated, or 0 if nothing to do.
 * Idempotent and fail-contained: never throws.
 */
export function migrateLegacyAggregates(
  durablePath: string | null,
  legacyPath: string | null,
): number {
  if (!durablePath || !legacyPath || !existsSync(legacyPath)) return 0
  const aggregates = withLegacyDb(legacyPath, (db) => {
    try {
      const rows = db
        .query(
          `SELECT project_id, cost, input, output, reasoning, cache_read, cache_write, cache, context
           FROM projects`,
        )
        .all() as {
        project_id: string
        cost: number
        input: number
        output: number
        reasoning: number
        cache_read: number
        cache_write: number
        cache: number
        context: number
      }[]
      return rows
    } catch {
      return null
    }
  })
  if (!aggregates || aggregates.length === 0) return 0

  let migrated = 0
  const result = ((): number | null => {
    let db: Database | null = null
    try {
      const dir = dirname(durablePath)
      if (dir && dir !== durablePath && dir !== ".")
        mkdirSync(dir, { recursive: true, mode: 0o700 })
      db = new Database(durablePath)
      try {
        const { chmodSync } = require("node:fs")
        chmodSync(durablePath, 0o600)
      } catch {}
      db.exec("PRAGMA busy_timeout = 5000")
      db.exec("PRAGMA journal_mode = WAL")
      db.exec("PRAGMA synchronous = NORMAL")
      db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_alias TEXT NOT NULL DEFAULT '',
        cost REAL NOT NULL DEFAULT 0,
        cost_source TEXT NOT NULL DEFAULT 'reported',
        input INTEGER NOT NULL DEFAULT 0,
        output INTEGER NOT NULL DEFAULT 0,
        reasoning INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0,
        cache_write INTEGER NOT NULL DEFAULT 0,
        cache INTEGER NOT NULL DEFAULT 0,
        context INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        checkpoint_at INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (session_id, project_id)
      )
    `)
      const tx = db!.transaction((rows: typeof aggregates) => {
        let count = 0
        for (const r of rows) {
          if (!r.project_id) continue
          const existing = db!
            .query(
              "SELECT 1 FROM checkpoints WHERE session_id = ? AND project_id = ?",
            )
            .get(LEGACY_RESERVED_ID, r.project_id) as unknown
          if (existing) continue
          const hasUsage =
            (r.cost ?? 0) +
              (r.input ?? 0) +
              (r.output ?? 0) +
              (r.reasoning ?? 0) +
              (r.cache_read ?? 0) +
              (r.cache_write ?? 0) +
              (r.context ?? 0) >
            0
          if (!hasUsage) continue
          db!
            .query(
              `INSERT INTO checkpoints (session_id, project_id, project_alias, cost, cost_source, input, output, reasoning, cache_read, cache_write, cache, context, updated_at, checkpoint_at, version)
             VALUES (?, ?, '', ?, 'reported', ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`,
            )
            .run(
              LEGACY_RESERVED_ID,
              r.project_id,
              r.cost ?? 0,
              r.input ?? 0,
              r.output ?? 0,
              r.reasoning ?? 0,
              r.cache_read ?? 0,
              r.cache_write ?? 0,
              r.cache ?? 0,
              r.context ?? 0,
              Date.now(),
            )
          count += 1
        }
        return count
      })
      const c = tx.immediate(aggregates)
      return c
    } catch {
      return null
    } finally {
      try {
        db?.close()
      } catch {}
    }
  })()
  migrated = result ?? 0
  return migrated
}

export const MIGRATED_RESERVED_ID = LEGACY_RESERVED_ID
