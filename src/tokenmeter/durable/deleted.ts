/**
 * Single-session durable checkpoint for session.deleted final flush.
 * Merges payload and observed high-water before UPSERT into the same
 * checkpoint row — no separate tombstone/aggregate ledger.
 */

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { ProjectSessionLike, SessionUsage } from "../types"
import { readCheckpoints } from "./checkpoints"
import {
  entryFromSession,
  mergeRows,
  observedToEntry,
  rowsEqual,
} from "./merge"
import { normalizeAlias } from "./paths"
import type { CheckpointRow } from "./types"

function withDurableDb<T>(
  dbPath: string | null,
  fn: (db: Database) => T,
): T | null {
  if (!dbPath) return null
  let db: Database | null = null
  try {
    const dir = dirname(dbPath)
    if (dir && dir !== dbPath && dir !== ".") {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      try {
        require("node:fs").chmodSync(dir, 0o700)
      } catch {}
    }
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

/** UPSERTs a deleted session's final usage (payload + observed high-water) into the durable row. */
export function checkpointDeletedSession(
  dbPath: string | null,
  session: ProjectSessionLike | unknown,
  aliasRaw?: string | null,
  observed?: SessionUsage | null,
): boolean {
  const info = session as ProjectSessionLike | undefined
  if (!info?.id || !info.projectID) return false
  const alias = normalizeAlias(aliasRaw)
  const payloadEntry = entryFromSession(info as ProjectSessionLike, alias)
  let observedEntry: CheckpointRow | null = null
  if (observed)
    observedEntry = observedToEntry(observed, info.id, info.projectID, alias)
  let entry: CheckpointRow | null = null
  if (payloadEntry && observedEntry)
    entry = mergeRows(payloadEntry, observedEntry)
  else entry = payloadEntry ?? observedEntry
  if (!entry) return false
  entry.projectID = info.projectID
  const existing = readCheckpoints(dbPath, info.projectID, alias)
  const stored = existing.get(info.id)
  const toWrite = stored ? mergeRows(stored, entry) : entry
  toWrite.projectID = info.projectID
  if (stored && rowsEqual(stored, toWrite)) return false
  const res = withDurableDb(dbPath, (db) => {
    const tx = db.transaction((r: CheckpointRow) => {
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
      return true
    })
    return tx.immediate(toWrite)
  })
  return res ?? false
}
