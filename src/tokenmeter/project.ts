/**
 * Project usage aggregation for the TokenMeter sidebar.
 *
 * The Project section sits above Session and shows the same two metric rows
 * (context + thinking + cost, then input · output real · cache), summed from
 * ALL sessions of the CURRENT PROJECT — crossing directories/worktrees and
 * surviving session deletion — via the persistent kv ledger
 * (`tokenmeter.project.history.v1`). Each refresh upserts the LIVE sessions
 * reported by the stable `api.client.session.list({ scope: "project" })`
 * endpoint (filtered by `session.projectID === projectID`) into the ledger
 * by ID; sessions that no longer appear are kept as tombstones and keep
 * their contribution. The project total is the idempotent sum of the FULL
 * all-time ledger: repeated refreshes never duplicate, updates replace
 * their snapshot and deleted sessions are never lost. It does NOT walk the
 * active session's delegation tree and is NOT scoped to a single directory:
 * the list endpoint is the authoritative source.
 *
 * A failed lookup/list keeps the previous snapshot (when one exists) and
 * surfaces a safe, stack-free error message via the projectError signal —
 * never a silent placeholder; the Session panel is never touched. Refreshes
 * are debounced and driven by the entry from route changes and the
 * message/session/status/project events; the timer is owned by the
 * schedule/dispose lifecycle so disposal clears it.
 *
 * Ledger fallback: the kv ledger can be empty, malformed or not yet
 * persisted (the host kv store is only READY asynchronously — TuiKV.ready —
 * so a write during startup may be dropped). The ledger is NEVER allowed to
 * zero out a Project that the live session list visibly carries tokens for:
 * when the ledger has no entries for this project but the live list does,
 * the snapshot falls back to the LIVE total and the ledger is rebuilt
 * (normalized and persisted) from the live sessions, so the next refresh
 * persists normally. When the ledger is usable its full sum is authoritative
 * (live snapshots + tombstones); the live list is never ADDED on top of it,
 * so there is no double counting between the live entry and the ledger.
 *
 * Post-delete fallback: right after a session is deleted the context may
 * not resolve `project.current()` (or the session list) for a moment, while
 * the ledger has already been updated by persistDeletedSession. The delete
 * handler passes the deleted session's projectID as a projectIDHint; when
 * the lookup/list then fails, the refresh recovers the snapshot from the
 * FULL ledger sum (tombstones included) instead of surfacing an error, so
 * deleting a session never flashes "Unable to load project data". Without a
 * hint — or when the ledger holds no entries for the hinted project — the
 * failure keeps the previous snapshot (when one exists) and shows the
 * stable error message as before.
 */
import { createSignal } from "solid-js"
import {
  type LedgerKv,
  readLedger,
  upsertLiveSessions,
  writeLedger,
} from "./ledger"
import { sumLedgerProject, sumProjectSessions } from "./math"
import type { ProjectSessionLike, ProjectUsage } from "./types"

export const [projectSnapshot, setProjectSnapshot] =
  createSignal<ProjectUsage | null>(null)

/**
 * True while a refreshProject run is awaiting the API/list/ledger work, false
 * once it settles (success or failure, via finally). The panel keeps the
 * static `…` placeholder while no snapshot exists; this flag is the
 * observable in-flight state (used by tests) — loading never animates.
 */
export const [projectLoading, setProjectLoading] = createSignal(false)

/**
 * Non-null when the last refresh failed to resolve the project or its
 * sessions: ALWAYS the stable PROJECT_ERROR_MESSAGE — raw runtime error
 * messages, string coercions and stack traces never reach the UI. Cleared
 * as soon as a refresh starts, so an in-flight or successful refresh never
 * shows a stale error. The panel renders it in theme().error, truncated to
 * the content width.
 */
export const [projectError, setProjectError] = createSignal<string | null>(null)

export const PROJECT_REFRESH_DELAY = 300

/** Stable user-facing message for every Project refresh failure. */
export const PROJECT_ERROR_MESSAGE = "Unable to load project data"

export type ProjectApi = {
  kv: LedgerKv
  state: {
    path: { directory: string }
  }
  client: {
    project: {
      current(params: {
        directory: string
      }): Promise<{ data?: { id: string; worktree?: string } }>
    }
    session: {
      list(params: {
        directory: string
        scope: "project"
      }): Promise<{ data?: ProjectSessionLike[] }>
    }
  }
}

let projectTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Resolves the current project, upserts its live sessions into the persistent
 * ledger (tombstoning whatever no longer appears) and sums the FULL ledger so
 * deleted sessions keep contributing. When the ledger is empty, malformed or
 * not persisted for this project yet the live list carries usage, the
 * snapshot falls back to the LIVE total (never zero) and the ledger is
 * rebuilt from the live sessions. A `projectIDHint` (captured from a
 * session.deleted payload) lets a failed lookup/list recover the snapshot
 * from the ledger instead of surfacing the generic error — the delete
 * already persisted its tombstone, so the Project keeps its total. Any other
 * failure keeps the previous snapshot (when one exists) and surfaces a safe
 * error message via projectError; the session panel is independent and
 * keeps working.
 */
export async function refreshProject(
  api: ProjectApi,
  projectIDHint?: string,
): Promise<void> {
  setProjectLoading(true)
  setProjectError(null)
  let fallbackProjectID = projectIDHint ?? projectSnapshot()?.id
  try {
    const directory = api.state.path.directory
    const projectRes = await api.client.project.current({ directory })
    const project = projectRes?.data
    if (!project) throw new Error(PROJECT_ERROR_MESSAGE)
    fallbackProjectID = project.id
    // The directory binds the SDK request to the active server instance;
    // `scope: "project"` then widens the query to every directory/worktree
    // of that project. Child sessions remain included because roots is unset.
    const listRes = await api.client.session.list({
      directory,
      scope: "project",
    })
    const sessions = listRes?.data
    // A missing list payload is an error, never a silent empty list: the
    // Project would otherwise show zeroed metrics while the API is down.
    if (!sessions) throw new Error(PROJECT_ERROR_MESSAGE)
    const projectSessions = sessions.filter(
      (session) => session?.projectID === project.id,
    )
    const ledger = readLedger(api.kv)
    const live = sumProjectSessions(project.id, projectSessions)
    const persisted = sumLedgerProject(project.id, ledger)
    if (persisted.sessions === 0 && live.sessions > 0) {
      // Ledger empty/malformed/not persisted: it must never zero out a
      // Project the live list visibly carries tokens for. Fall back to the
      // LIVE total and rebuild (normalize + persist) the ledger from the
      // live sessions so the next refresh persists normally.
      upsertLiveSessions(ledger, project.id, projectSessions)
      writeLedger(api.kv, ledger)
      setProjectSnapshot(live)
      return
    }
    upsertLiveSessions(ledger, project.id, projectSessions)
    writeLedger(api.kv, ledger)
    // Full ledger sum (live entries by ID + historical tombstones) — the
    // live list was upserted INTO the ledger, never added on top of it.
    setProjectSnapshot(sumLedgerProject(project.id, ledger))
  } catch {
    // Lookup/list failed. Post-delete fallback: when the caller captured the
    // deleted session's projectID as a hint and the ledger holds entries for
    // it, recover the snapshot from the FULL ledger sum (the tombstone keeps
    // its contribution) and stay error-free — deleting a session must not
    // flash "Unable to load project data". Otherwise keep the previous
    // snapshot (when one exists) and surface the stable PROJECT_ERROR_MESSAGE
    // — raw runtime detail is never exposed. The Session panel is
    // independent and keeps working.
    if (!recoverProjectFromLedger(api, fallbackProjectID))
      setProjectError(PROJECT_ERROR_MESSAGE)
  } finally {
    setProjectLoading(false)
  }
}

/**
 * Post-delete ledger recovery: sums the FULL all-time ledger of the hinted
 * project (live snapshots + tombstones) into the snapshot. Returns true only
 * when a hint exists AND the ledger holds at least one entry for that
 * project — without a hint the refresh cannot know which project to show,
 * and an empty ledger has nothing to recover from, so the generic error
 * path stays intact.
 */
function recoverProjectFromLedger(
  api: ProjectApi,
  projectIDHint?: string,
): boolean {
  if (!projectIDHint) return false
  const ledger = readLedger(api.kv)
  const project = ledger.projects[projectIDHint]
  if (!project || Object.keys(project).length === 0) return false
  setProjectSnapshot(sumLedgerProject(projectIDHint, ledger))
  return true
}

export function scheduleProjectRefresh(
  api: ProjectApi,
  delay: number = PROJECT_REFRESH_DELAY,
  projectIDHint?: string,
): void {
  clearTimeout(projectTimer ?? undefined)
  projectTimer = setTimeout(
    () => void refreshProject(api, projectIDHint),
    delay,
  )
}

export function disposeProjectRefresh(): void {
  clearTimeout(projectTimer ?? undefined)
  projectTimer = null
}
