/**
 * Project detail aggregation.
 * Overview totals include all sessions (live + deleted); the selectable list
 * contains ROOT sessions only (parentID empty) with title+date, recent first.
 * Totals follow sidebar refreshProject: one session.list({directory: safeWorktree, scope:"project", limit: PROJECT_SESSION_LIMIT}) + sumProjectSessions + readDeletedAggregate.
 */

import {
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
} from "../legacy-db"
import { combineProjectUsage, resolveCost, sumProjectSessions } from "../math"
import { loadPricing } from "../pricing"
import { PROJECT_SESSION_LIMIT } from "../project"
import type { ProjectUsage } from "../types"
import { FETCH_TIMEOUT_MS } from "./constants"
import { resolveSafeWorktree } from "./directories"
import { withTimeout } from "./timeout"
import type { BrowserApi } from "./types"

export type BrowserSession = {
  id: string
  title?: string
  parentID?: string | null
  time: { created: number; updated: number }
  context: number
  cost: number
  isCurrent: boolean
}

export type BrowserProjectDetail = {
  id: string
  label: string
  worktree?: string
  usage: ProjectUsage
  lastActive: number
  period: { start: number; end: number } | null
  sessionCount: number
  sessions: BrowserSession[]
  currentSessionID: string | null
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

const isRoot = (s: unknown): boolean => {
  const pid =
    (s as Record<string, unknown>)?.parentID ??
    (s as Record<string, unknown>)?.parentId
  return pid == null || (typeof pid === "string" && pid.trim() === "")
}

function currentSessionID(api: BrowserApi): string | null {
  try {
    const p = (
      api as unknown as {
        route?: { current?: { params?: Record<string, unknown> } }
      }
    ).route?.current?.params
    const v = (p?.sessionID ?? p?.session_id) as unknown
    if (typeof v === "string" && v) return v
  } catch {}
  try {
    const v = (api as unknown as { currentSessionID?: unknown })
      .currentSessionID
    if (typeof v === "string" && v) return v
  } catch {}
  return null
}

export async function loadProjectDetail(
  api: BrowserApi,
  projectID: string,
): Promise<BrowserProjectDetail> {
  if (!projectID || typeof projectID !== "string")
    throw new Error("Unable to load project")
  let label = projectID
  let worktree: string | undefined
  let projectUpdated = 0
  try {
    const listRes = (await api.client.project.list()) as { data?: unknown }
    const arr = listRes?.data as
      | {
          id: string
          name?: string
          worktree?: string
          time?: { created?: number; updated?: number }
        }[]
      | undefined
    if (Array.isArray(arr)) {
      const f = arr.find((p) => p?.id === projectID)
      if (f) {
        label =
          typeof f.name === "string" && f.name.trim()
            ? f.name.trim()
            : f.worktree?.split("/").pop()?.trim() || projectID
        worktree = f.worktree
        projectUpdated =
          typeof f.time?.updated === "number"
            ? f.time.updated
            : typeof f.time?.created === "number"
              ? f.time.created
              : 0
      }
    }
  } catch {}
  try {
    await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
  } catch {}
  const safeWorktree = await resolveSafeWorktree(api, projectID, worktree)
  let sessionsRaw: import("../types").ProjectSessionLike[] = []
  if (safeWorktree) {
    const res = (await withTimeout(
      (
        api.client.session.list as (
          p: Record<string, unknown>,
        ) => Promise<unknown>
      ).call(api.client.session, {
        directory: safeWorktree,
        scope: "project",
        limit: PROJECT_SESSION_LIMIT,
      }),
      FETCH_TIMEOUT_MS,
    )) as { data?: unknown }
    const data = res?.data as
      | import("../types").ProjectSessionLike[]
      | undefined
    if (!Array.isArray(data)) throw new Error("Unable to load project")
    if (data.length >= PROJECT_SESSION_LIMIT)
      throw new Error("Unable to load project")
    sessionsRaw = data
  } else {
    sessionsRaw = []
  }
  const dbPath = projectDbPath(api.state.path.state)
  const exclude = readDeletedSessionIDs(dbPath, projectID)
  const seenIds = new Set<string>()
  const sessions: typeof sessionsRaw = []
  for (const s of sessionsRaw) {
    if (!s || typeof s.id !== "string" || !s.id) continue
    if (seenIds.has(s.id)) continue
    seenIds.add(s.id)
    sessions.push(s)
  }
  const filtered = sessions.filter((s) => !exclude.has(s.id))
  const live = sumProjectSessions(projectID, filtered, exclude)
  const deleted = readDeletedAggregate(dbPath, projectID)
  const usage = combineProjectUsage(live, deleted)
  let lastActive = projectUpdated
  let minCreated = Number.POSITIVE_INFINITY
  let maxLast = 0
  for (const s of filtered) {
    const t = s as unknown as { time?: { created?: number; updated?: number } }
    const created = typeof t.time?.created === "number" ? t.time.created : 0
    const updated =
      typeof t.time?.updated === "number" ? t.time.updated : created
    const last = updated || created
    if (last > lastActive) lastActive = last
    if (created && created < minCreated) minCreated = created
    if (last > maxLast) maxLast = last
  }
  const period =
    filtered.length > 0 && Number.isFinite(minCreated) && maxLast > 0
      ? { start: minCreated, end: maxLast }
      : null
  const curID = currentSessionID(api)
  const rootOnly = filtered.filter(isRoot)
  const rows: BrowserSession[] = rootOnly.map((s) => {
    const t = s as unknown as {
      time?: { created?: number; updated?: number }
      title?: string
      parentID?: unknown
    }
    const created =
      typeof t.time?.created === "number"
        ? t.time.created
        : typeof t.time?.updated === "number"
          ? t.time.updated
          : 0
    const updated =
      typeof t.time?.updated === "number" ? t.time.updated : created
    const input = num(s.tokens?.input),
      output = num(s.tokens?.output),
      reasoning = num(s.tokens?.reasoning)
    const read = num(s.tokens?.cache?.read),
      write = num(s.tokens?.cache?.write)
    const context = input + output + reasoning + read + write
    const cost = resolveCost({
      cost: num(s.cost),
      providerID: (s as unknown as { model?: { providerID?: unknown } }).model
        ?.providerID,
      modelID: (s as unknown as { model?: { id?: unknown } }).model?.id,
      tokens: { input, output, reasoning, cacheRead: read, cacheWrite: write },
    }).cost
    return {
      id: s.id,
      title: typeof t.title === "string" ? t.title : undefined,
      parentID: (t.parentID as string | undefined) ?? null,
      time: { created, updated },
      context,
      cost,
      isCurrent: s.id === curID && isRoot(s),
    }
  })
  const pinned = rows.filter((r) => r.isCurrent)
  const rest = rows
    .filter((r) => !r.isCurrent)
    .sort(
      (a, b) =>
        b.time.updated - a.time.updated || b.time.created - a.time.created,
    )
  return {
    id: projectID,
    label,
    worktree,
    usage,
    lastActive,
    period,
    sessionCount: usage.sessions,
    sessions: [...pinned, ...rest],
    currentSessionID: curID,
  }
}
