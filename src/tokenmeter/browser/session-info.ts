/**
 * Session info fetching for browser session detail.
 * Resolves the current session identity and hydrates session payloads
 * via state.session.get, client.session.get, or session.list fallback.
 */

import type { BrowserApi } from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

export function curSID(api: BrowserApi): string | null {
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

export function toInfo(
  s: Record<string, unknown> | undefined,
  sid: string,
): {
  projectID: string
  title?: string
  time: { created: number; updated: number }
  tokens: unknown
  cost: unknown
  model: unknown
} | null {
  if (!s || typeof s.id !== "string" || s.id !== sid) return null
  return {
    projectID: typeof s.projectID === "string" ? s.projectID : "",
    title: typeof s.title === "string" ? s.title : undefined,
    time: {
      created: num((s.time as Record<string, unknown> | undefined)?.created),
      updated: num((s.time as Record<string, unknown> | undefined)?.updated),
    },
    tokens: (s as Record<string, unknown>).tokens,
    cost: (s as Record<string, unknown>).cost,
    model: (s as Record<string, unknown>).model,
  }
}

export async function fetchInfo(
  api: BrowserApi,
  sid: string,
): Promise<ReturnType<typeof toInfo>> {
  try {
    const f = (
      api as unknown as {
        state?: { session?: { get?: (id: string) => unknown } }
      }
    ).state?.session?.get
    if (typeof f === "function") {
      const r = toInfo(
        f.call(
          (api as unknown as { state: { session: unknown } }).state.session,
          sid,
        ) as Record<string, unknown> | undefined,
        sid,
      )
      if (r) return r
    }
  } catch {}
  try {
    const g = (
      api.client as unknown as {
        session?: { get?: (p: unknown) => Promise<unknown> }
      }
    ).session?.get
    if (typeof g === "function") {
      const res = (await (g as (p: unknown) => Promise<unknown>).call(
        api.client.session,
        { sessionID: sid },
      )) as { data?: unknown }
      const r = toInfo(
        (res?.data ?? res) as Record<string, unknown> | undefined,
        sid,
      )
      if (r) return r
    }
  } catch {}
  try {
    const l = (
      api.client as unknown as {
        session?: { list?: (p: Record<string, unknown>) => Promise<unknown> }
      }
    ).session?.list
    if (typeof l === "function") {
      const res = (await l.call(api.client.session, {})) as {
        data?: unknown
      }
      const arr = (res as { data?: unknown })?.data as unknown[] | undefined
      if (Array.isArray(arr)) {
        const f = arr.find((x) => (x as Record<string, unknown>)?.id === sid) as
          | Record<string, unknown>
          | undefined
        const r = toInfo(f, sid)
        if (r) return r
      }
    }
  } catch {}
  return null
}

export const numTokens = num
