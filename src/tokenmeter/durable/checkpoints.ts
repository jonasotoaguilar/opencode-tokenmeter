/**
 * Per-session durable checkpoints — batch piggyback on session.list.
 * Stores one row per (session_id, project_id) with WAL + busy_timeout
 * and monotonic merge. Idle refresh with unchanged rows does zero updates.
 * Observed message-derived usage is merged per session ID present in the
 * successful project list before UPSERT so partial reported aggregates never
 * undercount a complete observed aggregate; no extra SDK calls or message sweeps.
 */

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { ProjectSessionLike } from "../types"
import { entryFromSession, mergeRows, rowsEqual } from "./merge"
import { normalizeAlias } from "./paths"
import type { CheckpointRow } from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

function ensureDirForDb(dbPath: string): void {
  try {
    const dir = dirname(dbPath)
    if (dir && dir !== dbPath && dir !== ".") {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      try {
        require("node:fs").chmodSync(dir, 0o700)
      } catch {}
    }
  } catch {}
}

function withDurableDb<T>(
  dbPath: string | null,
  fn: (db: Database) => T,
): T | null {
  if (!dbPath) return null
  let db: Database | null = null
  try {
    ensureDirForDb(dbPath)
    db = new Database(dbPath)
    try {
      require("node:fs").chmodSync(dbPath, 0o600)
    } catch {}
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA synchronous = NORMAL")
    db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
      session_id TEXT NOT NULL, project_id TEXT NOT NULL, project_alias TEXT NOT NULL DEFAULT '',
      cost REAL NOT NULL DEFAULT 0, cost_source TEXT NOT NULL DEFAULT 'reported',
      input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, reasoning INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, cache INTEGER NOT NULL DEFAULT 0,
      context INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, checkpoint_at INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (session_id, project_id))`)
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_checkpoints_alias ON checkpoints(project_alias)`,
    )
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id)`,
    )
    return fn(db)
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

export function readCheckpoints(
  dbPath: string | null,
  projectID: string,
  aliasRaw?: string | null,
): Map<string, CheckpointRow> {
  const out = new Map<string, CheckpointRow>()
  if (!dbPath || !projectID) return out
  const alias = normalizeAlias(aliasRaw)
  const rows = withDurableDb(dbPath, (db) => {
    const q = alias
      ? (db
          .query(
            "SELECT * FROM checkpoints WHERE project_id = ? OR (project_alias = ? AND project_alias != '')",
          )
          .all(projectID, alias) as Record<string, unknown>[])
      : (db
          .query("SELECT * FROM checkpoints WHERE project_id = ?")
          .all(projectID) as Record<string, unknown>[])
    return q
  })
  if (!rows) return out
  for (const r of rows) {
    const row: CheckpointRow = {
      sessionID: String(r.session_id ?? ""),
      projectID: String(r.project_id ?? ""),
      projectAlias: String(r.project_alias ?? ""),
      cost: num(r.cost),
      costSource:
        (r.cost_source as string) === "estimated"
          ? "estimated"
          : (r.cost_source as string) === "observed"
            ? "observed"
            : "reported",
      input: num(r.input),
      output: num(r.output),
      reasoning: num(r.reasoning),
      cacheRead: num(r.cache_read),
      cacheWrite: num(r.cache_write),
      cache: num(r.cache),
      context: num(r.context),
      updatedAt: num(r.updated_at),
      checkpointAt: num(r.checkpoint_at),
      version: num(r.version) || 1,
    }
    if (!row.sessionID) continue
    const existing = out.get(row.sessionID)
    if (!existing) out.set(row.sessionID, row)
    else out.set(row.sessionID, mergeRows(existing, row))
  }
  return out
}

export function checkpointActiveProject(
  dbPath: string | null,
  projectID: string,
  aliasRaw: string | null | undefined,
  sessions: ProjectSessionLike[],
  observedById?: Map<string, import("./types").CheckpointRow> | null,
): number {
  if (
    !dbPath ||
    !projectID ||
    !Array.isArray(sessions) ||
    sessions.length === 0
  )
    return 0
  const alias = normalizeAlias(aliasRaw)
  const liveMap = new Map<string, CheckpointRow>()
  const seen = new Set<string>()
  for (const s of sessions) {
    if (!s || typeof s.id !== "string" || !s.id) continue
    const pid = (s as unknown as { projectID?: unknown })?.projectID
    if (pid != null && pid !== "" && pid !== projectID) continue
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const entry = entryFromSession(s, alias)
    if (!entry) continue
    entry.projectID = projectID
    liveMap.set(s.id, entry)
  }
  // Merge observed message-derived usage for each session ID present in the
  // successful project list when provided by the active-project refresh.
  // Only IDs in `seen` are considered; historical checkpoint-only sessions
  // are untouched until they reappear. Each session (principal or delegated
  // child) merges independently — no tree total.
  if (observedById && observedById.size > 0) {
    for (const sid of seen) {
      const observedEntry = observedById.get(sid)
      if (!observedEntry) continue
      const live = liveMap.get(sid)
      if (!live) liveMap.set(sid, observedEntry)
      else liveMap.set(sid, mergeRows(live, observedEntry))
    }
  }
  if (liveMap.size === 0) return 0
  const existing = readCheckpoints(dbPath, projectID, alias)
  const toUpsert: CheckpointRow[] = []
  for (const [sid, live] of liveMap) {
    const stored = existing.get(sid)
    if (!stored) toUpsert.push(live)
    else {
      const merged = mergeRows(stored, live)
      merged.projectID = projectID
      if (!rowsEqual(stored, merged)) toUpsert.push(merged)
    }
  }
  if (toUpsert.length === 0) return 0
  const changed = withDurableDb(dbPath, (db) => {
    const tx = db.transaction((rows: CheckpointRow[]) => {
      for (const r of rows) {
        db.query(`INSERT INTO checkpoints (session_id, project_id, project_alias, cost, cost_source, input, output, reasoning, cache_read, cache_write, cache, context, updated_at, checkpoint_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, project_id) DO UPDATE SET
           project_alias=excluded.project_alias,
           cost=CASE WHEN excluded.cost_source IN ('reported','observed') AND excluded.cost!=0 AND checkpoints.cost_source IN ('reported','observed') AND checkpoints.cost!=0 THEN MAX(checkpoints.cost, excluded.cost) WHEN excluded.cost_source IN ('reported','observed') AND excluded.cost!=0 THEN excluded.cost WHEN checkpoints.cost_source IN ('reported','observed') AND checkpoints.cost!=0 THEN checkpoints.cost ELSE MAX(checkpoints.cost, excluded.cost) END,
           cost_source=CASE WHEN excluded.cost_source IN ('reported','observed') AND excluded.cost!=0 AND checkpoints.cost_source IN ('reported','observed') AND checkpoints.cost!=0 THEN CASE WHEN checkpoints.cost>=excluded.cost THEN checkpoints.cost_source ELSE excluded.cost_source END WHEN excluded.cost_source IN ('reported','observed') AND excluded.cost!=0 THEN excluded.cost_source WHEN checkpoints.cost_source IN ('reported','observed') AND checkpoints.cost!=0 THEN checkpoints.cost_source ELSE CASE WHEN checkpoints.cost>=excluded.cost THEN checkpoints.cost_source ELSE excluded.cost_source END END,
            input=MAX(checkpoints.input, excluded.input), output=MAX(checkpoints.output, excluded.output), reasoning=MAX(checkpoints.reasoning, excluded.reasoning),
            cache_read=MAX(checkpoints.cache_read, excluded.cache_read), cache_write=MAX(checkpoints.cache_write, excluded.cache_write), cache=MAX(checkpoints.cache_read, excluded.cache_read) + MAX(checkpoints.cache_write, excluded.cache_write),
            context=MAX(checkpoints.input, excluded.input) + MAX(checkpoints.output, excluded.output) + MAX(checkpoints.reasoning, excluded.reasoning) + MAX(checkpoints.cache_read, excluded.cache_read) + MAX(checkpoints.cache_write, excluded.cache_write), updated_at=MAX(checkpoints.updated_at, excluded.updated_at), checkpoint_at=MAX(checkpoints.checkpoint_at, excluded.checkpoint_at), version=1`).run(
          r.sessionID,
          r.projectID,
          r.projectAlias,
          r.cost,
          r.costSource,
          r.input,
          r.output,
          r.reasoning,
          r.cacheRead,
          r.cacheWrite,
          r.cache,
          r.context,
          r.updatedAt,
          r.checkpointAt,
          r.version,
        )
      }
      return rows.length
    })
    return tx.immediate(toUpsert)
  })
  return changed ?? 0
}

export { durableDbPath } from "./paths"
