/**
 * Message fetching and provider/model grouping helpers.
 * Keeps token extraction and short-label logic isolated from
 * the session detail orchestration.
 */

import type { BrowserApi } from "./types"

export function shortLabel(id: string): string {
  const s = id.split("/").pop() ?? id
  return (s.split(":").pop() ?? s).trim() || id
}

export function provOf(m: unknown): string {
  const r = m as Record<string, unknown>
  const c =
    r?.providerID ??
    (r?.model as Record<string, unknown> | undefined)?.providerID ??
    r?.provider
  return typeof c === "string" && c.trim() ? c.trim() : "unknown"
}

export function modelOf(m: unknown): string {
  const r = m as Record<string, unknown>
  const c =
    r?.modelID ??
    (r?.model as Record<string, unknown> | undefined)?.id ??
    r?.model
  if (typeof c === "string" && c.trim()) return c.trim()
  return "unknown"
}

export async function fetchMsgs(
  api: BrowserApi,
  sid: string,
): Promise<unknown[]> {
  try {
    const fn = (
      api.client as unknown as {
        session?: { messages?: (p: unknown) => Promise<unknown> }
      }
    ).session?.messages
    if (typeof fn === "function") {
      const res = (await (fn as (p: unknown) => Promise<unknown>).call(
        api.client.session,
        { sessionID: sid },
      )) as { data?: unknown }
      const data = (res as { data?: unknown })?.data
      if (Array.isArray(data))
        return data.map((m) => (m as Record<string, unknown>)?.info ?? m)
      if (Array.isArray(res)) return res as unknown[]
    }
  } catch {}
  try {
    const fn = (
      api as unknown as {
        state?: { session?: { messages?: (id: string) => unknown } }
      }
    ).state?.session?.messages
    if (typeof fn === "function") {
      const data = (fn as (id: string) => unknown)(sid) as unknown
      if (Array.isArray(data))
        return (data as unknown[]).map(
          (m) => (m as Record<string, unknown>)?.info ?? m,
        )
    }
  } catch {}
  return []
}
