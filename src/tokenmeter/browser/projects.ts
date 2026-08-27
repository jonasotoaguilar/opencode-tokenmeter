/**
 * Browser projects aggregation.
 * Loads project.list + current pin and enriches each project via
 * V2-only session fetch plus the deleted SQLite aggregate.
 */

import {
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
} from "../db"
import { combineProjectUsage, sumProjectSessions } from "../math"
import { loadPricing } from "../pricing"
import type { ProjectSessionLike } from "../types"
import { withConcurrency } from "./concurrency"
import { BROWSER_CONCURRENCY, FETCH_TIMEOUT_MS } from "./constants"
import { isSafeDirectory } from "./is-safe-directory"
import { fetchSessionsForBrowse } from "./session-source"
import { withTimeout } from "./timeout"
import type { BrowserApi, BrowserProject, RawProject } from "./types"

export async function loadBrowserProjects(
  api: BrowserApi,
): Promise<BrowserProject[]> {
  const listRes = (await withTimeout(
    api.client.project.list() as Promise<unknown>,
    FETCH_TIMEOUT_MS,
  )) as { data?: unknown }
  const projects = listRes?.data as RawProject[] | undefined
  if (!Array.isArray(projects)) throw new Error("Unable to load projects")
  let currentID: string | null = null
  try {
    const host = api.state.path.directory
    if (isSafeDirectory(host)) {
      const cur = (await withTimeout(
        api.client.project.current({ directory: host }) as Promise<unknown>,
        FETCH_TIMEOUT_MS,
      )) as { data?: { id?: string } }
      currentID = cur?.data?.id ?? null
    }
  } catch {
    currentID = null
  }
  try {
    await withTimeout(
      loadPricing(
        api as unknown as Parameters<typeof loadPricing>[0],
      ) as Promise<unknown>,
      FETCH_TIMEOUT_MS,
    )
  } catch {
    // pricing warmup failure is non-fatal
  }
  const rows: BrowserProject[] = []
  await withConcurrency(projects, BROWSER_CONCURRENCY, async (proj) => {
    const pid = proj?.id
    if (typeof pid !== "string" || !pid) return
    const label =
      typeof proj.name === "string" && proj.name.trim()
        ? proj.name.trim()
        : proj.worktree?.split("/").pop()?.trim() || pid
    const created =
      typeof proj.time?.created === "number" ? proj.time.created : 0
    const updated =
      typeof proj.time?.updated === "number" ? proj.time.updated : created
    let sessions: ProjectSessionLike[] = []
    try {
      sessions = await withTimeout(
        fetchSessionsForBrowse(api, pid) as Promise<ProjectSessionLike[]>,
        FETCH_TIMEOUT_MS * 3,
      )
    } catch {
      sessions = []
    }
    let lastActive = updated
    for (const s of sessions) {
      const st =
        (s as unknown as { time?: { updated?: number; created?: number } })
          ?.time?.updated ??
        (s as unknown as { time?: { created?: number } })?.time?.created ??
        0
      if (typeof st === "number" && st > lastActive) lastActive = st
    }
    const dbPath = projectDbPath(api.state.path.state)
    const exclude = readDeletedSessionIDs(dbPath, pid)
    const live = sumProjectSessions(pid, sessions, exclude)
    const deleted = readDeletedAggregate(dbPath, pid)
    rows.push({
      id: pid,
      label,
      worktree: proj.worktree,
      time: { created, updated },
      usage: combineProjectUsage(live, deleted),
      lastActive,
      isCurrent: pid === currentID,
    })
  })
  const curRows = rows.filter((r) => r.isCurrent)
  const rest = rows
    .filter((r) => !r.isCurrent)
    .sort((a, b) => b.lastActive - a.lastActive)
  return [...curRows, ...rest]
}
