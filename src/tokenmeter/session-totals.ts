import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
export type SessionTotals = {
  projectId: string
  sessionId: string
  costReported: number
  costEstimated: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
  context: number
  revision: number
  fingerprint: string
  pricingVersion: string
  isDeleted: boolean
  updatedAt: number
  deletedAt: number | null
}
export type Fail = { ok: false; reason: "busy" | "io" }
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS session_totals (project_id TEXT NOT NULL, session_id TEXT NOT NULL, cost_reported REAL NOT NULL DEFAULT 0, cost_estimated REAL NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, reasoning INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, cache INTEGER NOT NULL DEFAULT 0, context INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, fingerprint TEXT NOT NULL DEFAULT '', pricing_version TEXT NOT NULL DEFAULT '', is_deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, PRIMARY KEY (project_id, session_id))`
const INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_session_totals_stale ON session_totals(project_id, pricing_version) WHERE is_deleted = 0 AND cost_estimated > 0"
function isFail(v: unknown): v is Fail {
  return (
    !!v &&
    typeof v === "object" &&
    "ok" in v &&
    (v as Fail).ok === false &&
    ((v as Fail).reason === "busy" || (v as Fail).reason === "io")
  )
}
function mapRow(r: Record<string, unknown>): SessionTotals {
  return {
    projectId: r.project_id as string,
    sessionId: r.session_id as string,
    costReported: r.cost_reported as number,
    costEstimated: r.cost_estimated as number,
    input: r.input as number,
    output: r.output as number,
    reasoning: r.reasoning as number,
    cacheRead: r.cache_read as number,
    cacheWrite: r.cache_write as number,
    cache: r.cache as number,
    context: r.context as number,
    revision: r.revision as number,
    fingerprint: r.fingerprint as string,
    pricingVersion: r.pricing_version as string,
    isDeleted: Boolean(r.is_deleted),
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
  }
}
export function computeFingerprint(
  entries: Array<{
    id: string
    cost: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }>,
): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id))
  const payload = sorted
    .map(
      (e) =>
        `${e.id}:${e.cost}:${e.input}:${e.output}:${e.reasoning}:${e.cacheRead}:${e.cacheWrite}`,
    )
    .join("|")
  return createHash("sha256").update(payload).digest("hex")
}
function withDb<T>(dbPath: string | null, fn: (db: Database) => T): T | Fail {
  if (!dbPath) return { ok: false, reason: "io" }
  let db: Database | null = null
  try {
    db = new Database(dbPath)
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA synchronous = NORMAL")
    return fn(db) as T
  } catch (e) {
    const m = String(e)
    return {
      ok: false,
      reason: m.includes("busy") || m.includes("locked") ? "busy" : "io",
    }
  } finally {
    try {
      db?.close()
    } catch {}
  }
}
export function migrateSessionTotals(
  dbPath: string | null,
): { ok: true } | Fail {
  const r = withDb(dbPath, (db) => {
    const v =
      (db.query("PRAGMA user_version").get() as { user_version: number } | null)
        ?.user_version ?? 0
    if (v < 1) {
      // BEGIN IMMEDIATE via transaction.immediate() — atomic clean-break
      const tx = db.transaction(() => {
        db.exec("DROP TABLE IF EXISTS projects")
        db.exec("DROP TABLE IF EXISTS tombstones")
        db.exec(TABLE_SQL)
        db.exec(INDEX_SQL)
        db.exec("PRAGMA user_version = 1")
      })
      tx.immediate()
    } else {
      db.exec(TABLE_SQL)
      db.exec(INDEX_SQL)
    }
    return { ok: true as const }
  })
  return isFail(r) ? r : (r as { ok: true })
}
export function readSessionTotals(
  dbPath: string | null,
  projectId: string,
  sessionId: string,
): SessionTotals | null | Fail {
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const row = db
      .query(
        "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
      )
      .get(projectId, sessionId) as Record<string, unknown> | null
    return row ? mapRow(row) : null
  })
  return isFail(r) ? r : (r as SessionTotals | null)
}
