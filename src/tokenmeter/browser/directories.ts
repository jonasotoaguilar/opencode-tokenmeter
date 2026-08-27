/**
 * Directory resolution for the browser.
 * Centralizes the project.directories → worktree → host fallback
 * chain with isSafeDirectory guards so no caller touches "/",
 * homedir or filesystem roots.
 */

import { FETCH_TIMEOUT_MS } from "./constants"
import { isSafeDirectory } from "./is-safe-directory"
import { withTimeout } from "./timeout"
import type { BrowserApi } from "./types"

function extractDirectoryCandidate(data: unknown): string | undefined {
  let cand: string | undefined
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as unknown
    if (typeof first === "string" && first) cand = first
    else if (first && typeof first === "object") {
      const r = first as Record<string, unknown>
      const c = (r.path ?? r.directory ?? r.worktree) as unknown
      if (typeof c === "string" && c) cand = c
    }
  } else if (data && typeof data === "object") {
    const dirs = (data as Record<string, unknown>).directories as unknown
    if (Array.isArray(dirs) && typeof dirs[0] === "string" && dirs[0])
      cand = dirs[0] as string
  }
  return cand
}

async function getDirectoriesCandidate(
  api: BrowserApi,
  projectID: string,
): Promise<string | null> {
  try {
    const fn = (
      api.client.project as { directories?: (p: unknown) => Promise<unknown> }
    ).directories
    if (typeof fn !== "function") return null
    const res = (await withTimeout(
      fn.call(api.client.project, { projectID }) as Promise<unknown>,
      FETCH_TIMEOUT_MS,
    )) as { data?: unknown }
    const cand = extractDirectoryCandidate((res as { data?: unknown })?.data)
    if (cand && isSafeDirectory(cand)) return cand
  } catch {
    // directories unavailable or timed out
  }
  return null
}

export async function resolveSafeDirectory(
  api: BrowserApi,
  projectID: string,
  worktree: string | undefined,
  currentID: string | null,
): Promise<string | null> {
  const cand = await getDirectoriesCandidate(api, projectID)
  if (cand) return cand
  if (typeof worktree === "string" && isSafeDirectory(worktree)) return worktree
  if (currentID && projectID === currentID) {
    const host = api.state.path.directory
    if (isSafeDirectory(host)) return host
  }
  return null
}

export async function resolveBrowseDirectory(
  api: BrowserApi,
  projectID: string,
  worktree: string | undefined,
  currentID: string | null,
): Promise<string | null> {
  const cand = await getDirectoriesCandidate(api, projectID)
  if (cand) return cand
  if (typeof worktree === "string" && isSafeDirectory(worktree)) return worktree
  if (currentID && projectID === currentID) {
    const host = (api as unknown as { state: { path: { directory: string } } })
      .state.path.directory as string
    if (isSafeDirectory(host)) return host
  }
  return null
}

export async function resolveSafeWorktree(
  api: BrowserApi,
  projectID: string,
  worktree: string | undefined,
): Promise<string | null> {
  const cand = await getDirectoriesCandidate(api, projectID)
  if (cand) return cand
  if (typeof worktree === "string" && isSafeDirectory(worktree)) return worktree
  try {
    const host = api.state.path.directory
    if (isSafeDirectory(host)) {
      const cur = (await withTimeout(
        api.client.project.current({ directory: host }) as Promise<unknown>,
        FETCH_TIMEOUT_MS,
      )) as { data?: { id?: string } }
      if (cur?.data?.id === projectID) return host
    }
  } catch {
    // host check failed
  }
  return null
}

// Legacy name kept for external callers that may import it.
export async function resolveDirectory(
  api: BrowserApi,
  projectID: string,
  worktree?: string,
): Promise<string> {
  let cur: string | null = null
  try {
    const host = api.state.path.directory
    if (isSafeDirectory(host)) {
      const r = (await withTimeout(
        api.client.project.current({ directory: host }) as Promise<unknown>,
        FETCH_TIMEOUT_MS,
      )) as { data?: { id?: string } }
      cur = r?.data?.id ?? null
    }
  } catch {
    cur = null
  }
  const safe = await resolveSafeDirectory(api, projectID, worktree, cur)
  if (safe) return safe
  return safe ?? ""
}
