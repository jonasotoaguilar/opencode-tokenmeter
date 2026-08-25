export type TokenmeterEvent = {
  type?: string
  properties?: Record<string, unknown>
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}
export function getTargetSessionId(event: unknown): string | null {
  if (!event || typeof event !== "object") return null
  const e = event as TokenmeterEvent
  const p = (e.properties ?? {}) as Record<string, unknown>
  const info = p.info as Record<string, unknown> | undefined
  if (info) {
    const sid =
      str(info.sessionID) ??
      str(info.sessionId) ??
      str((info as { session_id?: unknown }).session_id)
    if (sid) return sid
  }
  const direct = str(p.sessionID) ?? str(p.sessionId)
  if (direct) return direct
  const part = p.part as Record<string, unknown> | undefined
  if (part) {
    const ps = str(part.sessionID) ?? str(part.sessionId)
    if (ps) return ps
  }
  if (e.type === "session.deleted" && info) {
    const sid = str(info.id)
    if (sid) return sid
  }
  if (typeof e.type === "string" && e.type.startsWith("session.")) {
    const sid =
      str(p.sessionID) ?? str(p.sessionId) ?? (info ? str(info.id) : null)
    if (sid) return sid
  }
  return null
}
export function isSingleSessionEvent(event: unknown): boolean {
  return getTargetSessionId(event) !== null
}
export function isRemovalEvent(event: unknown): boolean {
  return (event as TokenmeterEvent)?.type === "message.removed"
}
export function isCompactionEvent(event: unknown): boolean {
  return (event as TokenmeterEvent)?.type === "session.compacted"
}
