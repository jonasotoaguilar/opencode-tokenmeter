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
export type CasResult =
  | { ok: true; row: SessionTotals; unchanged?: true }
  | { ok: false; reason: "conflict"; stored: SessionTotals }
  | Fail
export type MarkDeletedResult =
  | { ok: true; row: SessionTotals }
  | { ok: false; reason: "missing" }
  | Fail
export type ProjectTotals = {
  costReported: number
  costEstimated: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
  context: number
  sessions: number
}
export function casReplace(
  dbPath: string | null,
  projectId: string,
  sessionId: string,
  expectedRevision: number,
  t: {
    costReported: number
    costEstimated: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    cache: number
    context: number
    fingerprint: string
    pricingVersion: string
    updatedAt: number
  },
): CasResult {
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const tx = db.transaction(() => {
      const row = db
        .query(
          "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
        )
        .get(projectId, sessionId) as Record<string, unknown> | null
      if (!row) {
        if (expectedRevision !== 0) {
          return { _conflict: true, stored: null as unknown as SessionTotals }
        }
        db.query(
          "INSERT INTO session_totals (project_id, session_id, cost_reported, cost_estimated, input, output, reasoning, cache_read, cache_write, cache, context, revision, fingerprint, pricing_version, is_deleted, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          projectId,
          sessionId,
          t.costReported,
          t.costEstimated,
          t.input,
          t.output,
          t.reasoning,
          t.cacheRead,
          t.cacheWrite,
          t.cache,
          t.context,
          1,
          t.fingerprint,
          t.pricingVersion,
          0,
          t.updatedAt,
          null,
        )
        const inserted = db
          .query(
            "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
          )
          .get(projectId, sessionId) as Record<string, unknown>
        return { ok: true as const, row: mapRow(inserted) }
      }
      const stored = mapRow(row)
      if (stored.revision !== expectedRevision) {
        return { _conflict: true, stored }
      }
      const same =
        stored.costReported === t.costReported &&
        stored.costEstimated === t.costEstimated &&
        stored.input === t.input &&
        stored.output === t.output &&
        stored.reasoning === t.reasoning &&
        stored.cacheRead === t.cacheRead &&
        stored.cacheWrite === t.cacheWrite &&
        stored.cache === t.cache &&
        stored.context === t.context &&
        stored.fingerprint === t.fingerprint &&
        stored.pricingVersion === t.pricingVersion
      if (same) {
        return { ok: true as const, row: stored, unchanged: true as const }
      }
      const nextRev = stored.revision + 1
      db.query(
        "UPDATE session_totals SET cost_reported = ?, cost_estimated = ?, input = ?, output = ?, reasoning = ?, cache_read = ?, cache_write = ?, cache = ?, context = ?, fingerprint = ?, pricing_version = ?, updated_at = ?, revision = ? WHERE project_id = ? AND session_id = ?",
      ).run(
        t.costReported,
        t.costEstimated,
        t.input,
        t.output,
        t.reasoning,
        t.cacheRead,
        t.cacheWrite,
        t.cache,
        t.context,
        t.fingerprint,
        t.pricingVersion,
        t.updatedAt,
        nextRev,
        projectId,
        sessionId,
      )
      const updated = db
        .query(
          "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
        )
        .get(projectId, sessionId) as Record<string, unknown>
      return { ok: true as const, row: mapRow(updated) }
    })
    const result = tx.immediate() as unknown as Record<string, unknown>
    if (result && "_conflict" in result) {
      const stored = (result as { stored: SessionTotals | null }).stored
      if (!stored) {
        return {
          ok: false as const,
          reason: "conflict" as const,
          stored: {
            projectId,
            sessionId,
            costReported: 0,
            costEstimated: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cache: 0,
            context: 0,
            revision: 0,
            fingerprint: "",
            pricingVersion: "",
            isDeleted: false,
            updatedAt: 0,
            deletedAt: null,
          },
        }
      }
      return { ok: false as const, reason: "conflict" as const, stored }
    }
    return result as CasResult
  })
  if (isFail(r)) return r
  return r as CasResult
}
export function sumProject(
  dbPath: string | null,
  projectId: string,
): ProjectTotals | Fail {
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const row = db
      .query(
        "SELECT COALESCE(SUM(cost_reported),0) as cost_reported, COALESCE(SUM(cost_estimated),0) as cost_estimated, COALESCE(SUM(input),0) as input, COALESCE(SUM(output),0) as output, COALESCE(SUM(reasoning),0) as reasoning, COALESCE(SUM(cache_read),0) as cache_read, COALESCE(SUM(cache_write),0) as cache_write, COALESCE(SUM(cache),0) as cache, COALESCE(SUM(context),0) as context, COUNT(*) as sessions FROM session_totals WHERE project_id = ?",
      )
      .get(projectId) as {
      cost_reported: number
      cost_estimated: number
      input: number
      output: number
      reasoning: number
      cache_read: number
      cache_write: number
      cache: number
      context: number
      sessions: number
    }
    return {
      costReported: row.cost_reported,
      costEstimated: row.cost_estimated,
      cost: row.cost_reported + row.cost_estimated,
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      cache: row.cache,
      context: row.context,
      sessions: row.sessions,
    } as ProjectTotals
  })
  return isFail(r) ? r : (r as ProjectTotals)
}
export function readTree(
  dbPath: string | null,
  projectId: string,
  sessionIds: string[],
): SessionTotals[] | Fail {
  if (!sessionIds.length) return []
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const placeholders = sessionIds.map(() => "?").join(",")
    const rows = db
      .query(
        `SELECT * FROM session_totals WHERE project_id = ? AND session_id IN (${placeholders})`,
      )
      .all(projectId, ...sessionIds) as Record<string, unknown>[]
    return rows.map(mapRow)
  })
  return isFail(r) ? r : (r as SessionTotals[])
}
export function markDeleted(
  dbPath: string | null,
  projectId: string,
  sessionId: string,
  deletedAt: number,
): MarkDeletedResult {
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const tx = db.transaction(() => {
      const row = db
        .query(
          "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
        )
        .get(projectId, sessionId) as Record<string, unknown> | null
      if (!row) return { _missing: true }
      const stored = mapRow(row)
      if (stored.isDeleted) return { ok: true as const, row: stored }
      db.query(
        "UPDATE session_totals SET is_deleted = 1, deleted_at = ? WHERE project_id = ? AND session_id = ?",
      ).run(deletedAt, projectId, sessionId)
      const updated = db
        .query(
          "SELECT * FROM session_totals WHERE project_id = ? AND session_id = ?",
        )
        .get(projectId, sessionId) as Record<string, unknown>
      return { ok: true as const, row: mapRow(updated) }
    })
    const result = tx.immediate() as unknown as Record<string, unknown>
    if (result && "_missing" in result)
      return { ok: false as const, reason: "missing" as const }
    return result as MarkDeletedResult
  })
  if (isFail(r)) return r
  return r as MarkDeletedResult
}
export function listPricingRepair(
  dbPath: string | null,
  projectId: string,
  pricingHash: string,
): SessionTotals[] | Fail {
  const r = withDb(dbPath, (db) => {
    db.exec(TABLE_SQL)
    db.exec(INDEX_SQL)
    const rows = db
      .query(
        "SELECT * FROM session_totals WHERE project_id = ? AND is_deleted = 0 AND cost_estimated > 0 AND pricing_version != ?",
      )
      .all(projectId, pricingHash) as Record<string, unknown>[]
    return rows.map(mapRow)
  })
  return isFail(r) ? r : (r as SessionTotals[])
}
