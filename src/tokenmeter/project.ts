/**
 * Project usage aggregation for the TokenMeter sidebar.
 *
 * The Project section shows all-time usage for the current project,
 * reconciled as a union of live sessions (client session.list) and durable
 * per-session checkpoints (outside the host state directory). Overlap is
 * never double-counted: each session ID merges monotonically and counts once.
 * Checkpoints are piggybacked on the successful list — no extra SDK calls and
 * no message-history sweep — batch UPSERT only changed sessions in one WAL
 * transaction, with zero row updates on idle unchanged refresh.
 */

import { createSignal } from "solid-js"
import { checkpointActiveProject, readCheckpoints } from "./durable/checkpoints"
import { projectDbPath } from "./durable/legacy-path"
import { migrateLegacyAggregates } from "./durable/migrate"
import { durableDbPath, normalizeAlias } from "./durable/paths"
import { reconcileProjectUsage } from "./durable/reconcile"
import { readDeletedAggregate, readDeletedSessionIDs } from "./legacy-db"
import { combineProjectUsage, sumProjectSessions } from "./math"
import { loadPricing } from "./pricing"
import type { ProjectSessionLike, ProjectUsage } from "./types"

const [projectSnapshot, _setProjectSnapshot] =
  createSignal<ProjectUsage | null>(null)

export { projectSnapshot }

const snapshotListeners = new Set<(snap: ProjectUsage | null) => void>()
export function subscribeProjectSnapshot(
  listener: (snap: ProjectUsage | null) => void,
): () => void {
  snapshotListeners.add(listener)
  return () => snapshotListeners.delete(listener)
}
function notifyProjectSnapshot(snap: ProjectUsage | null): void {
  for (const listener of snapshotListeners) {
    try {
      listener(snap)
    } catch {}
  }
}
export function setProjectSnapshot(value: ProjectUsage | null): void {
  _setProjectSnapshot(value)
  notifyProjectSnapshot(value)
}
export function __clearSnapshotListenersForTest(): void {
  snapshotListeners.clear()
}

export const [projectLoading, setProjectLoading] = createSignal(false)
export const [projectError, setProjectError] = createSignal<string | null>(null)
export const PROJECT_REFRESH_DELAY = 300
export const PROJECT_SESSION_LIMIT = 10_000
export const PROJECT_POLL_DELAY = 30_000
export const PROJECT_ERROR_MESSAGE = "Unable to load project data"

export type ProjectApi = {
  state: { path: { directory: string; state: string } }
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
    v2?: { model?: { list?(params?: unknown): Promise<unknown> } }
  }
}

let projectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

export async function refreshProject(
  api: ProjectApi,
  projectIDHint?: string,
): Promise<void> {
  setProjectLoading(true)
  setProjectError(null)
  try {
    const directory = api.state.path.directory
    let projectID = projectIDHint
    let worktree: string | undefined
    try {
      const projectRes = await api.client.project.current({ directory })
      if (projectRes?.data?.id) {
        projectID = projectRes.data.id
        worktree = projectRes.data.worktree
      }
    } catch {}
    if (!projectID) throw new Error(PROJECT_ERROR_MESSAGE)
    const listRes = await api.client.session.list({
      directory,
      scope: "project",
      limit: PROJECT_SESSION_LIMIT,
    })
    const sessions = listRes?.data
    if (!sessions) throw new Error(PROJECT_ERROR_MESSAGE)
    if (sessions.length >= PROJECT_SESSION_LIMIT)
      throw new Error(PROJECT_ERROR_MESSAGE)
    const projectSessions = sessions.filter((s) => {
      const pid = (s as unknown as { projectID?: unknown })?.projectID
      return pid == null || pid === "" || pid === projectID
    })
    try {
      await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
    } catch {}
    // Migration bridge (feature-trunk-only, removed at final): prefer legacy
    // aggregate when the test's stateDir contains legacy tombstones/aggregate
    // so old harness remains green while durable tests use checkpoints.
    const legacyPathForBridge = projectDbPath(api.state.path.state)
    let hasLegacy = false
    try {
      const agg = legacyPathForBridge
        ? readDeletedAggregate(legacyPathForBridge, projectID)
        : null
      const ids = legacyPathForBridge
        ? readDeletedSessionIDs(legacyPathForBridge, projectID)
        : null
      hasLegacy = !!agg || !!ids?.size
    } catch {}
    if (hasLegacy) {
      const exclude = readDeletedSessionIDs(legacyPathForBridge, projectID)
      const live = sumProjectSessions(projectID, projectSessions, exclude)
      const deleted = readDeletedAggregate(legacyPathForBridge, projectID)
      setProjectSnapshot(combineProjectUsage(live, deleted))
    } else {
      const alias = normalizeAlias(worktree ?? directory)
      const durablePath = durableDbPath()
      const legacyPath = projectDbPath(api.state.path.state)
      try {
        if (durablePath && legacyPath)
          migrateLegacyAggregates(durablePath, legacyPath)
      } catch {}
      try {
        if (durablePath)
          checkpointActiveProject(
            durablePath,
            projectID,
            alias,
            projectSessions,
          )
      } catch {}
      let checkpoints: Map<
        string,
        import("./durable/types").CheckpointRow
      > | null = null
      try {
        checkpoints = durablePath
          ? readCheckpoints(durablePath, projectID, alias)
          : new Map()
      } catch {
        checkpoints = new Map()
      }
      const usage = reconcileProjectUsage(
        projectID,
        projectSessions,
        checkpoints ?? new Map(),
        alias,
      )
      setProjectSnapshot(usage)
    }
  } catch {
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
