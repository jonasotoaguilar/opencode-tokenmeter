/**
 * Browser session sources.
 * Prefers v2.session.list({project}) without directory; falls back
 * to safe directory pagination only for project detail paths.
 */

import type { ProjectSessionLike } from "../types"
import { BROWSER_SESSION_LIMIT, FETCH_TIMEOUT_MS, PAGE_SIZE } from "./constants"
import { withTimeout } from "./timeout"
import type { BrowserApi } from "./types"

async function fetchViaV2(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[] | null> {
  const v2 =
    (api as unknown as { client?: { v2?: { session?: { list?: unknown } } } })
      ?.client?.v2?.session ??
    (api.client as unknown as { v2?: { session?: { list?: unknown } } })?.v2
      ?.session
  const fn = (v2 as { list?: unknown })?.list
  if (typeof fn !== "function") return null
  const all: ProjectSessionLike[] = []
  let cursor: string | undefined
  do {
    const params: Record<string, unknown> = {
      project: projectID,
      limit: PAGE_SIZE,
    }
    if (cursor) params.cursor = cursor
    let res: unknown
    try {
      res = await withTimeout(
        (fn as (p: unknown) => Promise<unknown>).call(v2, params),
        FETCH_TIMEOUT_MS,
      )
    } catch {
      return null
    }
    const r = res as Record<string, unknown>
    const raw = r.data
    let data: unknown[] | null = null
    if (Array.isArray(raw)) data = raw as unknown[]
    else if (raw && typeof raw === "object") {
      const inner = (raw as Record<string, unknown>).data
      if (Array.isArray(inner)) data = inner as unknown[]
    }
    if (data === null) return null
    for (const s of data as ProjectSessionLike[]) {
      const pid = (s as unknown as { projectID?: unknown })?.projectID
      if (pid === projectID) all.push(s)
    }
    if (data.length === 0) break
    const cur = (raw as Record<string, unknown> | null)?.cursor as
      | { next?: string }
      | undefined
    const fallback = (r as { cursor?: { next?: string } })?.cursor?.next
    const next =
      typeof (cur as { next?: unknown } | undefined)?.next === "string"
        ? (cur as { next: string }).next
        : fallback
    if (typeof next === "string" && next && next !== cursor) cursor = next
    else break
    if (all.length >= BROWSER_SESSION_LIMIT) break
  } while (cursor !== undefined)
  return all
}

export async function fetchSessionsForBrowse(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[]> {
  try {
    const v2 = await fetchViaV2(api, projectID)
    if (Array.isArray(v2)) return v2
  } catch {}
  return []
}

export async function fetchSessionsForProject(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[]> {
  return fetchSessionsForBrowse(api, projectID)
}
