/**
 * Session tree discovery.
 * Builds the root plus recursive delegation set via client.session.children
 * or by scanning session.list as a fallback.
 */

import type { BrowserApi } from "./types"

export async function discoverTree(
  api: BrowserApi,
  root: string,
): Promise<string[]> {
  const vis = new Set<string>([root])
  const q = [root]
  const fn = (
    api.client as unknown as {
      session?: { children?: (p: unknown) => Promise<unknown> }
    }
  ).session?.children
  const use = typeof fn === "function"
  let map: Map<string, string[]> | null = null
  if (!use) {
    try {
      const lf = (
        api.client as unknown as {
          session?: { list?: (p: Record<string, unknown>) => Promise<unknown> }
        }
      ).session?.list
      if (typeof lf === "function") {
        const res = (await lf.call(api.client.session, {})) as {
          data?: unknown
        }
        const arr = (res as { data?: unknown })?.data as
          | Record<string, unknown>[]
          | undefined
        if (Array.isArray(arr)) {
          map = new Map()
          for (const s of arr) {
            const pid = (s.parentID ??
              (s as Record<string, unknown>).parentId) as unknown
            if (typeof pid === "string" && pid) {
              const a = map.get(pid) ?? []
              a.push(s.id as string)
              map.set(pid, a)
            }
          }
        }
      }
    } catch {}
  }
  while (q.length) {
    const sid = q.shift()
    if (sid === undefined) continue
    let kids: string[] = []
    if (use) {
      try {
        const r = (await (fn as (p: unknown) => Promise<unknown>).call(
          api.client.session,
          { sessionID: sid },
        )) as {
          data?: unknown
        }
        const d = (r as { data?: unknown })?.data as
          | Record<string, unknown>[]
          | undefined
        if (Array.isArray(d))
          kids = d
            .map((c) => c.id as string)
            .filter((x) => typeof x === "string")
      } catch {
        kids = []
      }
    } else if (map) kids = map.get(sid) ?? []
    for (const k of kids)
      if (!vis.has(k)) {
        vis.add(k)
        q.push(k)
      }
  }
  return [...vis]
}
