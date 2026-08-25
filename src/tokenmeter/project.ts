/**
 * Project usage aggregation for the TokenMeter sidebar.
 *
 * The Project section sits above Session and shows the same two metric rows
 * (spend + thinking + cost, then input · output real · cache read/write),
 * summed from ALL sessions of the CURRENT PROJECT — crossing
 * directories/worktrees and surviving session deletion. The total is the
 * authoritative LIVE sum of the client's `session.list({ scope: "project" })`
 * rows (filtered by `session.projectID === projectID`, every session ID
 * exactly once) PLUS the persisted deleted-session aggregate from the
 * plugin-owned SQLite store (`tokenmeter.sqlite` under
 * `api.state.path.state`, see db.ts): deleting a session records its final
 * payload/observed usage into that aggregate BEFORE the refresh, so deleted
 * sessions keep contributing exactly once, across restarts and across
 * concurrent TUIs. Live sessions are NEVER persisted or re-added — the list
 * endpoint is the authoritative live source on every refresh. The coins
 * total reads each snapshot's explicitly computed complete per-session
 * spend (`input + output + reasoning + cache.read + cache.write`, never
 * below input + output + reasoning); every other metric stays cumulative.
 *
 * The list call passes an explicit bounded `limit` (PROJECT_SESSION_LIMIT =
 * 10000) because the SDK defaults to 100 rows: a project with more sessions
 * would silently undercount. When the returned length reaches the cap the
 * list is TRUNCATED and therefore unusable — the refresh fails closed: the
 * previous snapshot is preserved and the stable error line is surfaced,
 * never a partial total.
 *
 * A failed lookup/list keeps the previous snapshot (when one exists) and
 * surfaces a safe, stack-free error message via the projectError signal —
 * never a silent placeholder; the Session panel is never touched. The
 * delete handler passes the deleted session's projectID as a projectIDHint:
 * right after a delete the context may not resolve `project.current()` for a
 * moment, and the hint lets the refresh keep the projectID and still sum the
 * (already updated) deleted aggregate, so deleting never flashes
 * "Unable to load project data".
 *
 * Refresh triggers: route changes and message/session/status/project events
 * schedule a debounced refresh (existing local fast path), and a single
 * bounded polling timer (PROJECT_POLL_DELAY ≈ 2 s) refreshes on top of it so
 * a SEPARATE OpenCode process working in the same project appears in this
 * TUI's sidebar. The poll never overlaps an in-flight refresh, is started at
 * most once per plugin, and is disposed through the same lifecycle as the
 * debounce timer.
 */
import { createSignal } from "solid-js"
import {
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
} from "./db"
import { combineProjectUsage, sumProjectSessions } from "./math"
import { loadPricing } from "./pricing"
import type { ProjectSessionLike, ProjectUsage } from "./types"

export const [projectSnapshot, setProjectSnapshot] =
  createSignal<ProjectUsage | null>(null)

/**
 * True while a refreshProject run is awaiting the API/list/ledger work, false
 * once it settles (success or failure, via finally). The panel keeps the
 * static `…` placeholder while no snapshot exists; this flag is the
 * observable in-flight state (used by tests) — loading never animates. It
 * also gates the polling timer, so two refreshes never overlap.
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

/**
 * Explicit bounded limit for the session.list call. The SDK defaults to
 * `input.limit ?? 100`; a project with more live rows would silently
 * undercount. 10000 is an explicit high bound, and a result length that
 * reaches it fails closed (truncated lists are never trusted).
 */
export const PROJECT_SESSION_LIMIT = 10_000

/** Polling cadence for cross-process Project freshness (~2 s). */
export const PROJECT_POLL_DELAY = 2000

/** Stable user-facing message for every Project refresh failure. */
export const PROJECT_ERROR_MESSAGE = "Unable to load project data"

export type ProjectApi = {
  state: {
    path: { directory: string; state: string }
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
        limit: number
      }): Promise<{ data?: ProjectSessionLike[] }>
    }
    v2?: {
      model?: {
        list?(params?: unknown): Promise<unknown>
      }
    }
  }
}

let projectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * Refreshes the Project snapshot: authoritative live list sum (explicit
 * bounded limit) plus the persisted deleted-session aggregate. Never writes
 * history during an ordinary refresh — live sessions are never persisted.
 * Fails closed on a truncated list: the prior snapshot is preserved and the
 * stable error line is surfaced. A `projectIDHint` (captured from a
 * session.deleted payload) keeps the refresh on the deleted session's
 * project when `project.current()` is momentarily unresolved right after a
 * delete. Any other failure keeps the previous snapshot (when one exists)
 * and surfaces a safe error message via projectError; the session panel is
 * independent and keeps working.
 */
export async function refreshProject(
  api: ProjectApi,
  projectIDHint?: string,
): Promise<void> {
  setProjectLoading(true)
  setProjectError(null)
  try {
    const directory = api.state.path.directory
    // The hint is only a fallback for the transient post-delete gap (a
    // throwing or empty project.current()); the resolved project always wins.
    let projectID = projectIDHint
    try {
      const projectRes = await api.client.project.current({ directory })
      if (projectRes?.data?.id) projectID = projectRes.data.id
    } catch {
      // Post-delete context gap: keep the hint and let the list decide.
    }
    if (!projectID) throw new Error(PROJECT_ERROR_MESSAGE)
    // The directory binds the SDK request to the active server instance;
    // `scope: "project"` then widens the query to every directory/worktree
    // of that project, and the explicit limit prevents the SDK's default
    // 100-row silent truncation.
    const listRes = await api.client.session.list({
      directory,
      scope: "project",
      limit: PROJECT_SESSION_LIMIT,
    })
    const sessions = listRes?.data
    // A missing list payload is an error, never a silent empty list: the
    // Project would otherwise show zeroed metrics while the API is down.
    if (!sessions) throw new Error(PROJECT_ERROR_MESSAGE)
    // A result at the cap is a TRUNCATED list: the total would silently
    // undercount, so fail closed — preserve the prior snapshot and surface
    // the stable error instead of showing a partial total.
    if (sessions.length >= PROJECT_SESSION_LIMIT)
      throw new Error(PROJECT_ERROR_MESSAGE)
    const projectSessions = sessions.filter(
      (session) => session?.projectID === projectID,
    )
    try {
      await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
    } catch {}
    const dbPath = projectDbPath(api.state.path.state)
    const exclude = readDeletedSessionIDs(dbPath, projectID)
    const live = sumProjectSessions(projectID, projectSessions, exclude)
    const deleted = readDeletedAggregate(dbPath, projectID)
    setProjectSnapshot(combineProjectUsage(live, deleted))
  } catch {
    // Preserve the previous snapshot (when one exists) and surface the
    // stable PROJECT_ERROR_MESSAGE — raw runtime detail is never exposed.
    // The Session panel is independent and keeps working.
    setProjectError(PROJECT_ERROR_MESSAGE)
  } finally {
    setProjectLoading(false)
  }
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

/**
 * Starts the single bounded polling timer that refreshes Project on top of
 * the local event-driven fast path, so another OpenCode process working in
 * the same project shows up in this TUI's sidebar within ~2 s. Started at
 * most once per plugin (duplicate starts are no-ops) and never overlaps an
 * in-flight refresh; cleared by disposeProjectRefresh.
 */
export function startProjectPolling(
  api: ProjectApi,
  delay: number = PROJECT_POLL_DELAY,
): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (projectLoading()) return
    void refreshProject(api)
  }, delay)
}

export function disposeProjectRefresh(): void {
  clearTimeout(projectTimer ?? undefined)
  projectTimer = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
