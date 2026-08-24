/**
 * Plugin-owned SQLite persistence for the Project section's DELETED-session
 * totals.
 *
 * The Project total is the sum of the authoritative LIVE sessions
 * (client session.list, fetched fresh on every refresh — never persisted)
 * plus ONE per-project aggregate of every deleted session's final usage.
 * Deleted sessions stop appearing in session.list, so their last-known
 * usage must survive restarts and multiple concurrent TUIs. The host kv
 * store (api.kv) is a whole-file read-modify-write shared by every plugin
 * process: two concurrent TUIs would each overwrite the other's writes, so
 * Project history NEVER touches api.kv anymore. Instead this module owns a
 * small SQLite database file (`tokenmeter.sqlite`) inside the host's state
 * directory (`api.state.path.state`), keyed by projectID so different
 * projects stay isolated in the same file.
 *
 * Exactly-once semantics come from a minimal tombstone table keyed by
 * (sessionID, projectID). OpenCode's deletion walks the tree children-first
 * and publishes one `session.deleted` event per session; every event carries
 * that session's final payload, so each event atomically admits exactly that
 * session's usage:
 *
 *   BEGIN IMMEDIATE
 *   INSERT OR IGNORE INTO tombstones ...      -- only the process that
 *   if changes == 1:                          -- inserts the row may count
 *     upsert aggregate += resolved entry      -- the session's usage
 *   COMMIT
 *
 * A duplicate delivery or a second TUI processing the same event sees
 * changes == 0 and skips, so the session contributes exactly once across
 * processes. A delete whose payload AND observed usage carry nothing is
 * skipped WITHOUT inserting a tombstone — it must not block a later event
 * for the same session that does carry usage.
 *
 * Concurrency: every operation opens its own short-lived connection
 * (WAL journal mode + busy timeout), runs one transaction, and closes, so
 * every process reads the latest committed state and writers queue instead
 * of clobbering. The v4 kv ledger (live root trees + deleted aggregate) is
 * obsolete and is never read, written or migrated; stale kv keys are simply
 * ignored.
 */
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { entryOfSession, entryOfSessionUsage, resolveEntry } from "./math"
import type {
  ProjectAggregateEntry,
  ProjectSessionLike,
  SessionUsage,
} from "./types"

/** Database file name inside the host state directory. */
export const PROJECT_DB_FILE = "tokenmeter.sqlite"

/** Resolves the plugin database path from the host state directory. */
export function projectDbPath(stateDir: string | undefined): string | null {
  if (!stateDir) return null
  return join(stateDir, PROJECT_DB_FILE)
}

function withDb<T>(dbPath: string | null, fn: (db: Database) => T): T | null {
  if (!dbPath) return null
  let db: Database | null = null
  try {
    db = new Database(dbPath)
    // busy_timeout FIRST: switching to WAL can itself need the write lock,
    // so the timeout is armed before it, letting simultaneous initializers
    // queue instead of racing. WAL lets concurrent TUI processes read while
    // one writes. Each connection runs the pragmas and schema so any writer
    // can create it.
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
    // Fail-contained by contract: an unusable state directory (unopenable,
    // busy, or broken file) is a no-op that reads as no deleted usage and
    // never throws out of a plugin event handler. Raw errors are not
    // exposed and nothing is logged.
    return null
  } finally {
    try {
      db?.close()
    } catch {
      // Closing a failed connection must not escape either.
    }
  }
}

/**
 * Atomically records ONE deleted session into its project's aggregate,
 * exactly once across processes and duplicate deliveries. The tombstone
 * insert and the aggregate upsert share a single BEGIN IMMEDIATE
 * transaction: only the process that inserted the tombstone increments the
 * aggregate. Payload and plugin-observed usage are resolved per-component
 * (per-field maximum); a delete with no usage never inserts a tombstone,
 * so a later event for the same session that does carry usage is still
 * admitted. Failures are contained: a broken/absent state directory is a
 * no-op, never a throw.
 */
export function recordDeletedSession(
  dbPath: string | null,
  session: unknown,
  observed?: SessionUsage | null,
): void {
  const info = session as ProjectSessionLike | undefined
  if (!info?.id || !info.projectID) return
  const model = (info as ProjectSessionLike)?.model as
    | { providerID?: unknown; id?: unknown }
    | null
    | undefined
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
          `INSERT INTO projects (
             project_id, cost, input, output, reasoning,
             cache_read, cache_write, cache, context
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             cost = projects.cost + excluded.cost,
             input = projects.input + excluded.input,
             output = projects.output + excluded.output,
             reasoning = projects.reasoning + excluded.reasoning,
             cache_read = projects.cache_read + excluded.cache_read,
             cache_write = projects.cache_write + excluded.cache_write,
             cache = projects.cache + excluded.cache,
             context = projects.context + excluded.context`,
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

/**
 * Reads the set of tombstoned session IDs for ONE project. Scoped by
 * `(session_id, project_id)` so the same session ID tombstoned in
 * Project A remains eligible in Project B. Fail-contained: null/empty
 * project, missing DB, or corrupt file returns an empty set without
 * throwing, matching `readDeletedAggregate`/`recordDeletedSession`.
 */
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

/**
 * Reads ONE project's deleted aggregate (null when the project has no
 * recorded deletions yet). Used by the Project refresh to compute
 * live total + deleted aggregate. Never throws: a broken/absent state
 * directory reads as no deleted usage.
 */
export function readDeletedAggregate(
  dbPath: string | null,
  projectID: string,
): ProjectAggregateEntry | null {
  return withDb(dbPath, (db) => {
    const row = db
      .query(
        `SELECT cost, input, output, reasoning, cache_read, cache_write,
                cache, context
           FROM projects WHERE project_id = ?`,
      )
      .get(projectID) as {
      cost: number
      input: number
      output: number
      reasoning: number
      cache_read: number
      cache_write: number
      cache: number
      context: number
    } | null
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
