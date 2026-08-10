/**
 * Recursive descendant discovery for the TokenMeter sidebar.
 *
 * Walks the delegation tree from a root session via client.session.children(),
 * caching per-parent child lists and session metadata so repeated reconciles
 * do not re-fetch unchanged parts of the tree. Also resolves the agent type
 * of each session, which keeps group summaries stable across runs.
 *
 * The cache is best-effort: session.created purges it wholesale (parentID
 * can be absent at creation time), and the active root's maintenance timer
 * re-discovers the tree periodically — a cached empty child list can never
 * permanently hide a child that became visible later.
 */
import type { SessionInfo } from "./types"

export type ChildrenClient = {
  client: {
    session: {
      children(params: { sessionID: string }): Promise<{ data?: SessionInfo[] }>
      get(params: { sessionID: string }): Promise<{ data?: SessionInfo }>
    }
  }
}

const childrenOf = new Map<string, string[]>()
const sessionMeta = new Map<string, SessionInfo>()

export function rememberSession(session: SessionInfo | undefined): void {
  if (session) sessionMeta.set(session.id, session)
}

export function forgetSessionMeta(sessionID: string): void {
  sessionMeta.delete(sessionID)
}

export function purgeTreeCache(): void {
  childrenOf.clear()
}

export function getSessionTitle(sessionID: string): string {
  return sessionMeta.get(sessionID)?.title ?? "subagent"
}

/**
 * Resolves the agent type used to group a session: the session agent field,
 * then subagent_type, then the `(@agent subagent)` title suffix, then
 * "subagent" as the last-resort bucket.
 */
export function getSessionAgent(sessionID: string): string {
  const meta = sessionMeta.get(sessionID)
  const direct = meta?.agent ?? meta?.subagent_type
  if (direct?.trim()) return direct.trim()
  return parseTitleAgent(meta?.title) ?? "subagent"
}

/** Extracts the agent from a `(@agent subagent)` title suffix. */
export function parseTitleAgent(title: string | undefined): string | null {
  const match = title?.match(/\(@([^)]+)\)\s*$/)
  if (!match) return null
  const agent = match[1]?.replace(/\s+subagent$/i, "").trim()
  return agent || null
}

export async function discoverTree(
  api: ChildrenClient,
  rootID: string,
): Promise<string[]> {
  const visited = new Set([rootID])
  const queue = [rootID]
  while (queue.length) {
    const sid = queue.shift()
    if (sid === undefined) continue
    if (!sessionMeta.has(sid)) {
      try {
        const got = await api.client.session.get({ sessionID: sid })
        if (got?.data) sessionMeta.set(sid, got.data)
      } catch {
        /* meta is optional */
      }
    }
    let kids = childrenOf.get(sid)
    if (!kids) {
      kids = []
      try {
        const res = await api.client.session.children({ sessionID: sid })
        for (const child of res?.data ?? []) {
          sessionMeta.set(child.id, child)
          kids.push(child.id)
        }
      } catch {
        /* treat as leaf */
      }
      childrenOf.set(sid, kids)
    }
    for (const kid of kids) {
      if (!visited.has(kid)) {
        visited.add(kid)
        queue.push(kid)
      }
    }
  }
  return [...visited]
}
