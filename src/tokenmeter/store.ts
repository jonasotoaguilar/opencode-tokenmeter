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
 * Spend high-water: each session keeps the maximum per-COMPONENT spend ever
 * observed — cost/input/output/reasoning/cacheRead/cacheWrite each as a
 * per-field maximum — independent of the current message map. Compaction or
 * a smaller later snapshot rewrites the map, but the high-water never lowers
 * while the plugin runs. Nothing live is ever persisted: after a restart
 * every session rebuilds its spend from the authoritative client messages.
 */
import { createSignal } from "solid-js"
import { maxComponents, sumMessages, usageOf } from "./math"
import { forgetSessionMeta, purgeTreeCache } from "./tree"
import type {
  MessageUsage,
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

/**
 * The plugin's OWN observed aggregate for a session: each cumulative
 * component is the per-field maximum of the message-usage map sum (which is
 * rebuilt from the authoritative client messages on every load) and the
 * session's spend high-water — the in-memory map never lowers it. `total`
 * is the sum of the merged components, i.e. the session's complete TOKEN
 * SPEND (Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write).
 * Null when the session has no observed usage. The deleted-session
 * aggregate falls back to this when list/delete payloads carry no token/cost
 * data (the real-world shape).
 */
export function observedSessionUsage(sessionID: string): SessionUsage | null {
  const map = msgUsage.get(sessionID)
  if (!map || map.size === 0) return null
  const usage = sumMessages(map)
  const prev = sessionHighWaters.get(sessionID)
  const merged = prev ? maxComponents(prev, usage) : usage
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
    statuses.delete(sessionID)
    loadedSessions.delete(sessionID)
    rehydrating.delete(sessionID)
    sessionHighWaters.delete(sessionID)
    forgetSessionMeta(sessionID)
  }
}
