/**
 * Reactive usage store for the usage sidebar.
 *
 * Holds the per-session message-usage maps plus session statuses, and exposes
 * the snapshot signal the panel renders from. Message usage is keyed by
 * message ID and upserted (replace, never append), so totals recomputed from
 * these maps can never double-count repeated events or retries. Per-session
 * rehydration state tracks sessions whose loaded map must be rebuilt on the
 * next load; reconciliation always re-reads the authoritative client
 * messages (the in-memory TUI mirror is capped and never used as a source).
 *
 * Token components keep the per-field high-water (maxComponents semantics for
 * input/output/reasoning/cacheRead/cacheWrite) — compaction or a smaller later
 * snapshot rewrites the map but the high-water never lowers while the plugin
 * runs. Monetary cost is the Σ of the per-message identity map (reported
 * outranks estimated even if lower; zero never overwrites non-zero; missing
 * estimated values survive compaction exactly once; repeat refill never double
 * counts). Nothing live is ever persisted: after a restart every session
 * rebuilds from the authoritative client messages.
 */
import { createSignal } from "solid-js"
import { sumMessages, usageOf } from "./math"
import { forgetSessionMeta, purgeTreeCache } from "./tree"
import type {
  MessageUsage,
  MoneyRow,
  SessionComponents,
  SessionStatusType,
  SessionUsage,
  UsageMessage,
  UsageSnapshot,
} from "./types"

export const [snapshot, setSnapshot] = createSignal<UsageSnapshot | null>(null)

const msgUsage = new Map<string, Map<string, MessageUsage>>()
const statuses = new Map<string, SessionStatusType>()
const loadedSessions = new Set<string>()
const rehydrating = new Set<string>()
const sessionHighWaters = new Map<string, SessionComponents>()
const sessionCostIdentity = new Map<string, Map<string, MoneyRow>>()

function upsertCostIdentity(
  identity: Map<string, MoneyRow>,
  id: string,
  incoming: MoneyRow,
): void {
  if (!id) return
  const existing = identity.get(id)
  if (!existing) {
    identity.set(id, incoming)
    return
  }
  if (existing.source === "reported" && incoming.source === "estimated") return
  if (incoming.cost === 0 && existing.cost !== 0) return
  identity.set(id, incoming)
}

export function usageMap(sessionID: string): Map<string, MessageUsage> {
  let map = msgUsage.get(sessionID)
  if (!map) {
    map = new Map()
    msgUsage.set(sessionID, map)
  }
  return map
}

export function hasUsage(sessionID: string): boolean {
  return msgUsage.has(sessionID)
}

export function rememberCosts(
  sessionID: string,
  current: Map<string, MessageUsage>,
): number {
  if (!sessionID) return 0
  let identity = sessionCostIdentity.get(sessionID)
  if (!identity) {
    identity = new Map()
    sessionCostIdentity.set(sessionID, identity)
  }
  for (const [id, usage] of current) {
    upsertCostIdentity(identity, id, {
      cost: usage.cost,
      source: usage.source,
    })
  }
  let sum = 0
  for (const row of identity.values()) sum += row.cost
  return sum
}

function syncIdentityFromMap(
  sessionID: string,
  map: Map<string, MessageUsage>,
): number {
  let identity = sessionCostIdentity.get(sessionID)
  if (!identity) {
    identity = new Map()
    sessionCostIdentity.set(sessionID, identity)
  }
  for (const [id, usage] of map) {
    upsertCostIdentity(identity, id, {
      cost: usage.cost,
      source: usage.source,
    })
  }
  let sum = 0
  for (const row of identity.values()) sum += row.cost
  return sum
}

/**
 * The plugin's OWN observed aggregate for a session: token components keep
 * the per-field high-water (never lower), while monetary cost is the Σ of
 * the per-message identity map (reported outranks estimated even if lower;
 * missing estimated values survive compaction exactly once; repeat refill
 * no double archive). Null when no observed usage.
 */
export function observedSessionUsage(sessionID: string): SessionUsage | null {
  const map = msgUsage.get(sessionID)
  if (!map || map.size === 0) return null
  const cost = syncIdentityFromMap(sessionID, map)
  const usage = sumMessages(map)
  const prev = sessionHighWaters.get(sessionID)
  const merged: SessionComponents = prev
    ? {
        cost,
        input: Math.max(prev.input, usage.input),
        output: Math.max(prev.output, usage.output),
        reasoning: Math.max(prev.reasoning, usage.reasoning),
        cacheRead: Math.max(prev.cacheRead, usage.cacheRead),
        cacheWrite: Math.max(prev.cacheWrite, usage.cacheWrite),
      }
    : {
        cost,
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      }
  sessionHighWaters.set(sessionID, merged)
  return {
    cost: merged.cost,
    input: merged.input,
    output: merged.output,
    reasoning: merged.reasoning,
    cacheRead: merged.cacheRead,
    cacheWrite: merged.cacheWrite,
    total:
      merged.input +
      merged.output +
      merged.reasoning +
      merged.cacheRead +
      merged.cacheWrite,
    cache: merged.cacheRead + merged.cacheWrite,
  }
}

export function upsertMessageUsage(message: UsageMessage): boolean {
  const usage = usageOf(message)
  if (!usage || !message.id || !message.sessionID) return false
  usageMap(message.sessionID).set(message.id, usage)
  return true
}

export function removeMessageUsage(sessionID: string, messageID: string): void {
  msgUsage.get(sessionID)?.delete(messageID)
  sessionCostIdentity.get(sessionID)?.delete(messageID)
}

export function isLoaded(sessionID: string): boolean {
  return loadedSessions.has(sessionID)
}

export function markLoaded(sessionID: string): void {
  loadedSessions.add(sessionID)
}

export function unmarkLoaded(sessionID: string): void {
  loadedSessions.delete(sessionID)
}

/**
 * A session marked for rehydration must be re-read from the authoritative
 * client source on its next load: the in-memory TUI mirror may hold stale
 * messages and must never win over fresh client data.
 */
export function needsRehydrate(sessionID: string): boolean {
  return rehydrating.has(sessionID)
}

export function markRehydrate(sessionID: string): void {
  rehydrating.add(sessionID)
}

export function clearRehydrate(sessionID: string): void {
  rehydrating.delete(sessionID)
}

/**
 * Drops the one-shot loaded flag and marks the session for rehydration so
 * the next reconcile re-reads its usage from the authoritative client
 * messages (replace, not merge). Keeps the existing message map untouched,
 * so an interrupted publish never flashes zeroes.
 */
export function invalidateUsage(sessionID: string): void {
  loadedSessions.delete(sessionID)
  rehydrating.add(sessionID)
}

export function setStatus(sessionID: string, status: SessionStatusType): void {
  statuses.set(sessionID, status)
}

export function getStatus(sessionID: string): SessionStatusType | undefined {
  return statuses.get(sessionID)
}

export function forgetSession(sessionID: string): void {
  purgeTreeCache()
  if (sessionID) {
    msgUsage.delete(sessionID)
    sessionCostIdentity.delete(sessionID)
    statuses.delete(sessionID)
    loadedSessions.delete(sessionID)
    rehydrating.delete(sessionID)
    sessionHighWaters.delete(sessionID)
    forgetSessionMeta(sessionID)
  }
}
