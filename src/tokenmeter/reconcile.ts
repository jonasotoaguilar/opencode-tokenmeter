/**
 * Reconciliation for the TokenMeter sidebar.
 *
 * Loads persisted usage per session and publishes a fresh snapshot. Every
 * load reads the authoritative client session messages — the host's
 * in-memory mirror is capped (the TUI drops the OLDEST messages of a long
 * session), so a non-empty mirror is never a complete usage source and can
 * never win over client data. The usage map is replaced only after a
 * successful load; empty/failed loads stay retryable. A debounce plus a
 * generation counter tolerate event ordering and drop stale async results.
 * Idle sessions are invalidated by the entry before scheduling so their next
 * load REPLACES the stored message map — removals and changed messages are
 * reflected, never just merged. An empty load is provisional: the TUI sync
 * may still be streaming the session's messages, so the session stays
 * loadable and the next event-driven reconcile re-reads the current
 * messages — a first-open panel transitions from placeholder to populated
 * instead of freezing on an empty map. The headline totalTokens is the sum
 * of each session's complete TOKEN SPEND — Σ input + Σ output + Σ reasoning
 * + Σ cache.read + Σ cache.write across ALL assistant messages per session
 * (the exact reconstruction of OpenCode's billed tokens.total), summed
 * across the
 * root session and every recursively discovered descendant, each session ID
 * exactly once. The high-water never lowers (compaction or a smaller later
 * snapshot cannot reduce it): the store keeps the in-run per-component
 * maximum of cost/input/output/reasoning/cacheRead/cacheWrite. Nothing live
 * is persisted — after a restart every session rebuilds its spend from the
 * authoritative client messages.
 * input/output/reasoning/cacheRead/cacheWrite/cost stay cumulative and
 * separate, with RAW
 * output and RAW reasoning preserved independently (never merged); the
 * displayed output real (output + reasoning) is computed once at the
 * formatting boundary, so no reasoning token is ever counted twice.
 * Because every per-session spend includes its cumulative
 * input + output + reasoning, the coins total is always
 * >= the session's cumulative input + real output. delegations counts descendant sessions and agents counts distinct agent
 * types. A snapshot with nothing
 * to show is not published, so empty sessions keep the placeholder until
 * data arrives. A low-frequency maintenance timer on the active root covers
 * missed-event races: a delegated child can become visible from the client
 * tree while no tree-invalidating event was observed (session.created may
 * lack parentID), and the cached empty child list would freeze the snapshot
 * forever. Each tick purges the tree cache and reuses the debounced
 * reconcile, so the next reconcile re-discovers descendants — a tree-only
 * refresh that never forces a client message fetch. The timer is owned by
 * the activateRoot/disposeReconcile lifecycle: route changes replace it
 * instead of stacking ticks, and disposal clears it.
 */

import { buildGroups } from "./groups"
import { usageOf } from "./math"
import { loadPricing } from "./pricing"
import {
  clearRehydrate,
  getStatus,
  isLoaded,
  markLoaded,
  markRehydrate,
  needsRehydrate,
  observedSessionUsage,
  setSnapshot,
  unmarkLoaded,
  usageMap,
} from "./store"
import { discoverTree, purgeTreeCache } from "./tree"
import type {
  SessionInfo,
  SessionStatusType,
  UsageMessage,
  UsageSnapshot,
} from "./types"

export type ReconcileApi = {
  client: {
    session: {
      messages(params: {
        sessionID: string
      }): Promise<{ data?: { info: UsageMessage }[] }>
      children(params: { sessionID: string }): Promise<{ data?: SessionInfo[] }>
      get(params: { sessionID: string }): Promise<{ data?: SessionInfo }>
    }
    v2?: {
      model?: {
        list?(params?: unknown): Promise<unknown>
      }
    }
  }
  state: {
    path?: { directory?: string }
    session: {
      status(sessionID: string): { type?: SessionStatusType } | undefined
    }
  }
}

export const RECONCILE_DELAY = 300
export const IDLE_DELAY = 100
/** Low-frequency tree-maintenance cadence on the active root (matches the reference plugin). */
export const MAINTENANCE_DELAY = 2000

let currentRoot: string | null = null
let reconcileTimer: ReturnType<typeof setTimeout> | null = null
let maintenanceTimer: ReturnType<typeof setInterval> | null = null
let reconcileSeq = 0

/**
 * Fetches the FULL message list from the authoritative client. The host's
 * in-memory mirror is never consulted: the TUI caps it (dropping the oldest
 * messages of a long session), so a non-empty mirror is a truncated view
 * that would silently undercount the session's usage.
 */
async function fetchMessages(
  api: ReconcileApi,
  sessionID: string,
): Promise<readonly UsageMessage[]> {
  const res = await api.client.session.messages({ sessionID })
  return (res?.data ?? []).map((m) => m.info)
}

async function loadSessionUsage(
  api: ReconcileApi,
  sessionID: string,
): Promise<void> {
  const rehydrate = needsRehydrate(sessionID)
  if (isLoaded(sessionID) && !rehydrate) return
  markLoaded(sessionID)
  try {
    const messages = await fetchMessages(api, sessionID)
    const map = usageMap(sessionID)
    map.clear()
    for (const m of messages) {
      const usage = usageOf(m)
      if (usage && m.id) map.set(m.id, usage)
    }
    if (messages.length === 0) {
      // An empty load is provisional — the TUI sync may still be streaming
      // this session's messages — so keep it loadable and let the next
      // event-driven reconcile re-read the current messages. The rehydration
      // flag stays set, so the retry still reads the authoritative client.
      unmarkLoaded(sessionID)
    } else if (rehydrate) {
      // Authoritative load landed: the mirror is caught up, stop forcing
      // client fetches until the next invalidation or activation.
      clearRehydrate(sessionID)
    }
  } catch {
    unmarkLoaded(sessionID)
  }
}

export async function reconcile(
  api: ReconcileApi,
  rootID: string,
  force = false,
): Promise<void> {
  const seq = ++reconcileSeq
  try {
    await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
  } catch {}
  let ids: string[]
  try {
    ids = await discoverTree(api, rootID)
  } catch {
    return
  }
  // Activation force-refreshes the active root and its whole descendant
  // tree: a previously-loaded map is never trusted across a session switch.
  if (force) for (const sid of ids) markRehydrate(sid)
  await Promise.all(ids.map((sid) => loadSessionUsage(api, sid)))
  if (seq !== reconcileSeq || currentRoot !== rootID) return
  publish(api, rootID, ids)
}

function statusOf(
  api: ReconcileApi,
  sessionID: string,
): SessionStatusType | undefined {
  let status = getStatus(sessionID)
  if (!status) {
    try {
      status = api.state.session.status(sessionID)?.type
    } catch {
      status = undefined
    }
  }
  return status
}

function publish(api: ReconcileApi, rootID: string, ids: string[]): void {
  let cost = 0
  let totalTokens = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cache = 0
  let anyUsage = false
  for (const sid of ids) {
    // observedSessionUsage applies the session's per-component spend
    // high-water, so a compacted (smaller) message set can never lower the
    // published spend.
    const s = observedSessionUsage(sid)
    if (!s) continue
    anyUsage = true
    cost += s.cost
    totalTokens += s.total
    input += s.input
    output += s.output
    reasoning += s.reasoning
    cacheRead += s.cacheRead
    cacheWrite += s.cacheWrite
    cache += s.cache
  }
  const runningOf = (sid: string) => {
    const status = statusOf(api, sid)
    return status === "busy" || status === "retry"
  }
  const groups = buildGroups(ids, rootID, runningOf)
  // Nothing to show yet: keep the previous snapshot so an empty first-open
  // session stays on the placeholder until usage or delegations arrive.
  if (!anyUsage && ids.length <= 1) return
  const snap: UsageSnapshot = {
    rootID,
    cost,
    totalTokens,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache,
    delegations: ids.length - 1,
    agents: groups.length,
    groups,
  }
  setSnapshot(snap)
}

export function scheduleReconcile(
  api: ReconcileApi,
  delay: number = RECONCILE_DELAY,
): void {
  const root = currentRoot
  if (!root) return
  clearTimeout(reconcileTimer ?? undefined)
  reconcileTimer = setTimeout(() => void reconcile(api, root), delay)
}

export function getCurrentRoot(): string | null {
  return currentRoot
}

export function scheduleForcedReconcile(
  api: ReconcileApi,
  delay: number = RECONCILE_DELAY,
): void {
  const root = currentRoot
  if (!root) return
  clearTimeout(reconcileTimer ?? undefined)
  reconcileTimer = setTimeout(() => void reconcile(api, root, true), delay)
}

/**
 * Periodic recovery for missed-event races: a delegated child may become
 * visible from the client tree without any tree-invalidating event (e.g.
 * session.created without parentID). Purge the tree cache and reuse the
 * debounced reconcile so descendants are re-discovered — messages are NOT
 * invalidated, so loaded sessions keep the cheap in-memory fast path.
 */
function maintenanceTick(api: ReconcileApi): void {
  purgeTreeCache()
  scheduleReconcile(api, RECONCILE_DELAY)
}

export function activateRoot(api: ReconcileApi, rootID: string): void {
  currentRoot = rootID
  clearTimeout(reconcileTimer ?? undefined)
  // A route change replaces the maintenance timer instead of stacking ticks.
  if (maintenanceTimer) clearInterval(maintenanceTimer)
  maintenanceTimer = setInterval(() => maintenanceTick(api), MAINTENANCE_DELAY)
  void reconcile(api, rootID, true)
}

export function disposeReconcile(): void {
  clearTimeout(reconcileTimer ?? undefined)
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer)
    maintenanceTimer = null
  }
}
