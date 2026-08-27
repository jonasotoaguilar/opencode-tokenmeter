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
    const data = (r as { data?: unknown })?.data as unknown[] | undefined
    if (!Array.isArray(data)) throw new Error("Unable to load sessions")
    for (const s of data as ProjectSessionLike[]) {
      const pid = (s as unknown as { projectID?: unknown })?.projectID
      if (pid === projectID) all.push(s)
    }
    if (data.length === 0) break
    const next = (r as { cursor?: { next?: string } })?.cursor?.next
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
