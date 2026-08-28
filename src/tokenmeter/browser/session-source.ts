/**
 * Browser session sources.
 * Uses legacy directory-scoped session.list({directory, scope:"project"})
 * via resolveSafeWorktree — proven authoritative cross-project. V2
 * project-scoped list is instance-scoped and not used for browse.
 */

import type { ProjectSessionLike } from "../types"
import { FETCH_TIMEOUT_MS } from "./constants"
import { resolveSafeWorktree } from "./directories"
import { withTimeout } from "./timeout"
import type { BrowserApi } from "./types"

async function fetchViaDirectory(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[] | null> {
  let dir: string | null = null
  try {
    const listRes = (await withTimeout(
      api.client.project.list() as Promise<{ data?: unknown }>,
      FETCH_TIMEOUT_MS,
    )) as { data?: unknown }
    const arr = listRes?.data as { id: string; worktree?: string }[] | undefined
    const found = Array.isArray(arr)
      ? arr.find((p) => p.id === projectID)
      : undefined
    dir = await resolveSafeWorktree(api, projectID, found?.worktree)
  } catch {
    return null
  }
  if (!dir) return null
  try {
    const res = (await withTimeout(
      (
        api.client.session.list as (
          p: Record<string, unknown>,
        ) => Promise<unknown>
      ).call(api.client.session, {
        directory: dir,
        scope: "project",
        limit: 200,
      }),
      FETCH_TIMEOUT_MS,
    )) as { data?: unknown }
    const data = res?.data as ProjectSessionLike[] | undefined
    if (!Array.isArray(data)) return null
    return data.filter(
      (s) => (s as unknown as { projectID?: string }).projectID === projectID,
    )
  } catch {
    return null
  }
}

export async function fetchSessionsForBrowse(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[]> {
  try {
    const via = await fetchViaDirectory(api, projectID)
    if (Array.isArray(via)) return via
  } catch {}
  return []
}

export async function fetchSessionsForProject(
  api: BrowserApi,
  projectID: string,
): Promise<ProjectSessionLike[]> {
  return fetchSessionsForBrowse(api, projectID)
}
