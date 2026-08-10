/**
 * Persistent all-time Project history ledger for the TokenMeter sidebar.
 *
 * Lives entirely inside the host's kv store (key `tokenmeter.project.history.v1`
 * — no external file): a per-project map of per-session snapshots. Every
 * refreshProject upserts the LIVE sessions by ID (replace, never accumulate)
 * and tombstones entries that no longer appear in the live list; entries are
 * never removed, so the project total is the idempotent sum of the full
 * ledger — repeating a refresh never duplicates, updating a session replaces
 * its snapshot and a deleted session keeps contributing its last known usage.
 *
 * Sessions deleted before their first observed snapshot cannot be recovered:
 * the public session.list API no longer returns them and the delete payload
 * carries no token data, so no entry is created for them.
 */
import type {
  ProjectLedger,
  ProjectLedgerEntry,
  ProjectSessionLike,
} from "./types"

export const PROJECT_HISTORY_KEY = "tokenmeter.project.history.v1"

export type LedgerKv = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

/** Plain record check: arrays and null are NOT acceptable ledger shapes. */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Reads the ledger, tolerating a missing or malformed stored value. A
 * non-record `projects` map (string, array, null) or a project whose
 * session map is not a record yields an empty ledger — the project refresh
 * then falls back to the live session list instead of showing zero.
 */
export function readLedger(kv: LedgerKv): ProjectLedger {
  const raw = kv.get<unknown>(PROJECT_HISTORY_KEY)
  if (isRecord(raw)) {
    const projects = raw.projects
    if (isRecord(projects)) {
      const cleaned: Record<string, Record<string, ProjectLedgerEntry>> = {}
      for (const [projectID, sessions] of Object.entries(projects)) {
        if (isRecord(sessions))
          cleaned[projectID] = sessions as Record<string, ProjectLedgerEntry>
      }
      return { v: 1, projects: cleaned }
    }
  }
  return { v: 1, projects: {} }
}

export function writeLedger(kv: LedgerKv, ledger: ProjectLedger): void {
  kv.set(PROJECT_HISTORY_KEY, ledger)
}

/** Per-session snapshot extracted from a list/delete payload; null when the payload carries no usage. */
export function entryOfSession(
  session: ProjectSessionLike,
): ProjectLedgerEntry | null {
  const tokens = session.tokens
  const input = num(tokens?.input)
  const output = num(tokens?.output)
  const reasoning = num(tokens?.reasoning)
  const cache = num(tokens?.cache?.read) + num(tokens?.cache?.write)
  const cost = num(session.cost)
  if (cost + input + output + reasoning + cache === 0) return null
  return { cost, input, output, reasoning, cache }
}

/**
 * Upserts every live session of the project by ID (snapshot replaced,
 * lastSeen refreshed, deletedAt cleared when the session is live again) and
 * tombstones ledger entries of this project that no longer appear in the
 * live list. Idempotent: running twice with the same list changes nothing.
 */
export function upsertLiveSessions(
  ledger: ProjectLedger,
  projectID: string,
  sessions: ProjectSessionLike[],
  now: number = Date.now(),
): void {
  const timestamp = new Date(now).toISOString()
  let project = ledger.projects[projectID]
  if (!project) {
    project = {}
    ledger.projects[projectID] = project
  }
  const seen = new Set<string>()
  for (const session of sessions) {
    if (!session || session.projectID !== projectID) continue
    seen.add(session.id)
    const entry = entryOfSession(session)
    if (!entry) continue
    project[session.id] = {
      ...project[session.id],
      ...entry,
      lastSeen: timestamp,
    }
    delete project[session.id]?.deletedAt
  }
  for (const sessionID of Object.keys(project)) {
    const entry = project[sessionID]
    if (entry && !seen.has(sessionID) && !entry.deletedAt)
      entry.deletedAt = timestamp
  }
}

/**
 * Persists a deleted session into the ledger before the next refresh. When
 * the delete payload carries token/cost data it becomes the final snapshot;
 * otherwise the last known snapshot is kept. A session that was never
 * observed (no payload usage, no ledger entry) leaves no phantom entry.
 */
export function persistDeletedSession(kv: LedgerKv, info: unknown): void {
  const session = info as ProjectSessionLike | undefined
  if (!session?.id || !session.projectID) return
  const ledger = readLedger(kv)
  let project = ledger.projects[session.projectID]
  if (!project) {
    project = {}
    ledger.projects[session.projectID] = project
  }
  const payload = entryOfSession(session)
  const existing = project[session.id]
  if (!payload && !existing) return
  project[session.id] = {
    ...existing,
    ...(payload ?? ({} as ProjectLedgerEntry)),
    deletedAt: new Date().toISOString(),
  }
  writeLedger(kv, ledger)
}
