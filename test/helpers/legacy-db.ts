import { Database } from "bun:sqlite"
import { join } from "node:path"
import {
  entryOfSession,
  entryOfSessionUsage,
  resolveEntry,
} from "../../src/tokenmeter/math"
import type {
  ProjectAggregateEntry,
  ProjectSessionLike,
  SessionUsage,
} from "../../src/tokenmeter/types"
export const PROJECT_DB_FILE = "tokenmeter.sqlite"
export function projectDbPath(stateDir: string | undefined): string | null {
  if (!stateDir) return null
  return join(stateDir, PROJECT_DB_FILE)
}
function withDb<T>(dbPath: string | null, fn: (db: Database) => T): T | null {
  if (!dbPath) return null
  let db: Database | null = null
  try {
    db = new Database(dbPath)
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA synchronous = NORMAL")
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        cost REAL NOT NULL DEFAULT 0,
        input INTEGER NOT NULL DEFAULT 0,
        output INTEGER NOT NULL DEFAULT 0,
        reasoning INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0,
        cache_write INTEGER NOT NULL DEFAULT 0,
        cache INTEGER NOT NULL DEFAULT 0,
        context INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS tombstones (
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        PRIMARY KEY (session_id, project_id)
      )
    `)
    return fn(db)
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {}
  }
}
export function recordDeletedSession(
  dbPath: string | null,
  session: unknown,
  observed?: SessionUsage | null,
): void {
  const info = session as ProjectSessionLike | undefined
  if (!info?.id || !info.projectID) return
  const model = (info as any)?.model
  const entry = resolveEntry(
    entryOfSession(info),
    entryOfSessionUsage(observed),
    model,
  )
  if (!entry) return
  withDb(dbPath, (db) => {
    const admit = db.transaction(
      (sessionID: string, projectID: string, e: ProjectAggregateEntry) => {
        const inserted = db
          .query(
            "INSERT OR IGNORE INTO tombstones (session_id, project_id) VALUES (?, ?)",
          )
          .run(sessionID, projectID)
        if (inserted.changes !== 1) return false
        db.query(
          `INSERT INTO projects (project_id, cost, input, output, reasoning, cache_read, cache_write, cache, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET cost = projects.cost + excluded.cost, input = projects.input + excluded.input, output = projects.output + excluded.output, reasoning = projects.reasoning + excluded.reasoning, cache_read = projects.cache_read + excluded.cache_read, cache_write = projects.cache_write + excluded.cache_write, cache = projects.cache + excluded.cache, context = projects.context + excluded.context`,
        ).run(
          projectID,
          e.cost,
          e.input,
          e.output,
          e.reasoning,
          e.cacheRead,
          e.cacheWrite,
          e.cache,
          e.context,
        )
        return true
      },
    )
    admit.immediate(info.id, info.projectID, entry)
  })
}
export function readDeletedSessionIDs(
  dbPath: string | null,
  projectID: string,
): ReadonlySet<string> {
  if (!dbPath || !projectID) return new Set<string>()
  const result = withDb(dbPath, (db) => {
    const rows = db
      .query("SELECT session_id FROM tombstones WHERE project_id = ?")
      .all(projectID) as { session_id: string }[]
    return new Set<string>(rows.map((r) => r.session_id))
  })
  return result ?? new Set<string>()
}
export function readDeletedAggregate(
  dbPath: string | null,
  projectID: string,
): ProjectAggregateEntry | null {
  return withDb(dbPath, (db) => {
    const row = db
      .query(
        `SELECT cost, input, output, reasoning, cache_read, cache_write, cache, context FROM projects WHERE project_id = ?`,
      )
      .get(projectID) as any
    if (!row) return null
    return {
      cost: row.cost,
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      cache: row.cache,
      context: row.context,
    }
  })
}
