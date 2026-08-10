/**
 * Reconciliation for the TokenMeter sidebar.
 *
 * Loads persisted usage per session and publishes a fresh snapshot. The
 * in-memory TUI mirror is the cheap fast path for unchanged sessions, but a
 * session marked for rehydration (invalidated by activity, or the active
 * root/descendant tree on activation) bypasses the mirror and re-reads the
 * authoritative client messages — a stale non-empty mirror can never win
 * over fresh client data. The usage map is replaced only after a successful
 * authoritative load; empty/failed loads stay retryable. A debounce plus a
 * generation counter tolerate event ordering and drop stale async results.
 * Idle sessions are invalidated by the entry before scheduling so their next
 * load REPLACES the stored message map — removals and changed messages are
 * reflected, never just merged. An empty load is provisional: the TUI sync
 * may still be streaming the session's messages, so the session stays
 * loadable and the next event-driven reconcile re-reads the current
 * messages — a first-open panel transitions from placeholder to populated
 * instead of freezing on an empty map. The headline totalTokens sums each
 * session's max context snapshot (one per session, root + all descendants);
 * input/output/reasoning/cache/cost stay cumulative and separate, with RAW
 * output and RAW reasoning preserved independently (never merged); the
 * displayed output real (output + reasoning) is computed once at the
 * formatting boundary, so no reasoning token is ever counted twice.
 * delegations counts descendant sessions and agents counts distinct agent
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
import { sumMessages, usageOf } from "./math"
import {
  clearRehydrate,
  getStatus,
  hasUsage,
  isLoaded,
  markLoaded,
  markRehydrate,
  needsRehydrate,
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
  }
  state: {
    session: {
      status(sessionID: string): { type?: SessionStatusType } | undefined
      messages(sessionID: string): readonly UsageMessage[]
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

async function fetchMessages(
  api: ReconcileApi,
  sessionID: string,
  authoritative: boolean,
): Promise<readonly UsageMessage[]> {
  // Cheap in-memory fast path for unchanged sessions. An invalidated session
  // bypasses it entirely: its mirror may be stale, and the client is the
  // authoritative source.
  if (!authoritative) {
    try {
      const inMemory = api.state.session.messages(sessionID)
      if (inMemory?.length) return inMemory
    } catch {
      /* fall through to client */
    }
  }
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
    const messages = await fetchMessages(api, sessionID, rehydrate)
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
  let cache = 0
  let anyUsage = false
  for (const sid of ids) {
    if (!hasUsage(sid)) continue
    const s = sumMessages(usageMap(sid))
    anyUsage = true
    cost += s.cost
    totalTokens += s.total
    input += s.input
    output += s.output
    reasoning += s.reasoning
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
