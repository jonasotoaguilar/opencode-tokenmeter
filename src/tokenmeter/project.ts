/**
 * Project usage aggregation via SQLite SUM.
 *
 * Project shows spend summed from session_totals per project,
 * including deleted retained rows. Cheap SUM poll every ~2s,
 * no host list. Fail keeps snapshot and shows stable error.
 * Hint keeps project after delete when current is unavailable.
 * Poll never overlaps in-flight refresh.
 */
import { createSignal } from "solid-js"
import { projectDbPath } from "./db"
import { loadPricing } from "./pricing"
import type { ProjectTotals } from "./session-totals"
import { sumProject } from "./session-totals"
import type { ProjectUsage } from "./types"

export const [projectSnapshot, setProjectSnapshot] =
  createSignal<ProjectUsage | null>(null)
export const [projectLoading, setProjectLoading] = createSignal(false)
export const [projectError, setProjectError] = createSignal<string | null>(null)

export const PROJECT_REFRESH_DELAY = 300
export const PROJECT_POLL_DELAY = 2000
export const PROJECT_ERROR_MESSAGE = "Unable to load project data"

export type ProjectApi = {
  state: { path: { directory: string; state: string } }
  client: {
    project: {
      current(params: { directory: string }): Promise<{ data?: { id: string } }>
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
    try {
      const r = await api.client.project.current({ directory })
      if (r?.data?.id) projectID = r.data.id
    } catch {}
    if (!projectID) throw new Error(PROJECT_ERROR_MESSAGE)
    try {
      await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
    } catch {}
    const dbPath = projectDbPath(api.state.path.state)
    const totals = sumProject(dbPath, projectID)
    if (
      totals &&
      typeof totals === "object" &&
      "ok" in totals &&
      (totals as { ok: boolean }).ok === false
    ) {
      throw new Error(PROJECT_ERROR_MESSAGE)
    }
    const t = totals as unknown as ProjectTotals
    setProjectSnapshot({
      id: projectID,
      sessions: t.sessions,
      cost: t.cost,
      context: t.context,
      input: t.input,
      output: t.output,
      reasoning: t.reasoning,
      cacheRead: t.cacheRead,
      cacheWrite: t.cacheWrite,
      cache: t.cache,
    })
  } catch {
    setProjectError(PROJECT_ERROR_MESSAGE)
  } finally {
    setProjectLoading(false)
  }
}

export function scheduleProjectRefresh(
  api: ProjectApi,
  delay = PROJECT_REFRESH_DELAY,
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
  delay = PROJECT_POLL_DELAY,
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
