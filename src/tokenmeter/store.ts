/**
 * Reactive usage store for the usage sidebar.
 *
 * Holds the per-session message-usage maps plus session statuses, and exposes
 * the snapshot signal the panel renders from. Message usage is keyed by
 * message ID and upserted (replace, never append), so totals recomputed from
 * these maps can never double-count repeated events or retries. Per-session
 * rehydration state tracks sessions whose in-memory TUI mirror may be stale;
 * reconciliation bypasses the mirror for those sessions and re-reads the
 * authoritative client messages instead.
 */
import { createSignal } from "solid-js"
import { usageOf } from "./math"
import { forgetSessionMeta, purgeTreeCache } from "./tree"
import type {
  MessageUsage,
  SessionStatusType,
  UsageMessage,
  UsageSnapshot,
} from "./types"

export const [snapshot, setSnapshot] = createSignal<UsageSnapshot | null>(null)

const msgUsage = new Map<string, Map<string, MessageUsage>>()
const statuses = new Map<string, SessionStatusType>()
const loadedSessions = new Set<string>()
const rehydrating = new Set<string>()

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
    forgetSessionMeta(sessionID)
  }
}
