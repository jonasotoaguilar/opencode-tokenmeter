import type { FinitePrice } from "./types"

export const REMOTE_URL = "https://models.dev/api.json"
export const REMOTE_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
export const REMOTE_FAILURE_COOLDOWN_MS = 15 * 60 * 1000
export const REMOTE_FETCH_TIMEOUT_MS = 8000

export const remotePricingMap = new Map<string, FinitePrice>()
let remoteInflight: Promise<void> | null = null
let remoteLastSuccess = 0
let remoteLastFailure = 0

export let clockNow: () => number = () => Date.now()
export let fetchImpl: typeof fetch =
  typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : ((async () => {
        throw new Error("fetch unavailable")
      }) as unknown as typeof fetch)

export function __setPricingClockForTest(fn: (() => number) | null): void {
  clockNow = fn ?? (() => Date.now())
}
export function __setPricingFetchForTest(fn: typeof fetch | null): void {
  fetchImpl =
    fn ??
    (typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : ((async () => {
          throw new Error("fetch unavailable")
        }) as unknown as typeof fetch))
}
export function clearRemotePricing(): void {
  remotePricingMap.clear()
  remoteLastSuccess = 0
  remoteLastFailure = 0
  remoteInflight = null
}

export function normalizeModelId(raw: string): string {
  let m = raw.trim()
  if (m.toLowerCase().startsWith("openai/")) m = m.slice("openai/".length)
  m = m.trim().toLowerCase()
  if (m === "gpt-5.6") m = "gpt-5.6-sol"
  return m
}
export function pricingKey(a: unknown, b: unknown): string | null {
  if (typeof a !== "string" || typeof b !== "string") return null
  const pa = a.trim().toLowerCase()
  const pb = normalizeModelId(b)
  if (!pa || !pb) return null
  return `${pa}:${pb}`
}
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
}
export function parseStandardPrice(
  obj: Record<string, unknown>,
): FinitePrice | null {
  const input = obj.input
  const output = obj.output
  let read: unknown
  let write: unknown
  const cache = obj.cache
  if (cache && typeof cache === "object" && !Array.isArray(cache)) {
    const c = cache as Record<string, unknown>
    read = c.read
    write = c.write
  } else {
    read = obj.cache_read
    if (read === undefined) read = obj.cacheRead
    write = obj.cache_write
    if (write === undefined) write = obj.cacheWrite
  }
  if (write === undefined) write = 0
  if (read === undefined) read = 0
  if (
    !isFiniteNumber(input) ||
    !isFiniteNumber(output) ||
    !isFiniteNumber(read) ||
    !isFiniteNumber(write)
  )
    return null
  if ((input as number) === 0 && (output as number) === 0) return null
  return {
    input: input as number,
    output: output as number,
    cache: { read: read as number, write: write as number },
  }
}
