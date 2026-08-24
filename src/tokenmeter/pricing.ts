import type { FinitePrice } from "./types"

export type {
  FinitePrice,
  MonetarySource,
  MoneyRow,
  ResolvedCost,
} from "./types"

const pricingMap = new Map<string, FinitePrice>()
export function getPricing(key: string): FinitePrice | undefined {
  return pricingMap.get(key)
}
export function setPricing(map: Map<string, FinitePrice>): void {
  pricingMap.clear()
  for (const [k, v] of map) pricingMap.set(k, v)
}
let pricingInflight: Promise<void> | null = null
let pricingLastFailure = 0
const PRICING_COOLDOWN_MS = 2000

export function clearPricing(): void {
  pricingMap.clear()
  pricingLastFailure = 0
  pricingInflight = null
}

export type PricingApi = {
  client?: { model?: { list?(params?: unknown): Promise<unknown> } }
  state?: { path?: { directory?: string } }
}

export async function loadPricing(api: PricingApi): Promise<void> {
  if (pricingInflight) return pricingInflight
  const now = Date.now()
  if (
    pricingLastFailure !== 0 &&
    now - pricingLastFailure < PRICING_COOLDOWN_MS
  )
    return
  const fn = api?.client?.model?.list as
    | ((p: unknown) => Promise<unknown>)
    | undefined
  const directoryValue = api?.state?.path?.directory
  if (typeof fn !== "function") return
  const modelObj = api?.client?.model
  pricingInflight = (async () => {
    try {
      const res = await (fn as (p: unknown) => Promise<unknown>).call(
        modelObj,
        {
          location: { directory: directoryValue },
        },
      )
      const data = (res as Record<string, unknown> | null | undefined)?.data
      if (!Array.isArray(data)) {
        pricingLastFailure = Date.now()
        return
      }
      const next = new Map<string, FinitePrice>()
      for (const row of data) {
        if (!row || typeof row !== "object") continue
        const r = row as Record<string, unknown>
        const key = pricingKey(r.providerID, r.id)
        if (!key) continue
        const price = selectFiniteNonTier(r.cost)
        if (!price) continue
        next.set(key, price)
      }
      pricingMap.clear()
      for (const [k, v] of next) pricingMap.set(k, v)
      pricingLastFailure = 0
    } catch {
      pricingLastFailure = Date.now()
    } finally {
      pricingInflight = null
    }
  })()
  return pricingInflight
}
export function pricingKey(a: unknown, b: unknown): string | null {
  if (typeof a !== "string" || typeof b !== "string") return null
  const pa = a.trim().toLowerCase()
  const pb = b.trim().toLowerCase()
  if (!pa || !pb) return null
  return `${pa}:${pb}`
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
}
export function selectFiniteNonTier(costs: unknown): FinitePrice | null {
  if (!Array.isArray(costs)) return null
  for (const entry of costs) {
    if (!entry || typeof entry !== "object") continue
    const c = entry as Record<string, unknown>
    if (c.tier != null) continue
    const input = c.input
    const output = c.output
    const cache = c.cache as Record<string, unknown> | undefined
    const read = cache?.read
    const write = cache?.write
    if (
      !isFiniteNumber(input) ||
      !isFiniteNumber(output) ||
      !isFiniteNumber(read) ||
      !isFiniteNumber(write)
    )
      continue
    return {
      input: input as number,
      output: output as number,
      cache: { read: read as number, write: write as number },
    }
  }
  return null
}
export function estimateCost(
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  },
  price: FinitePrice,
): number {
  const { input, output, reasoning, cacheRead, cacheWrite } = tokens
  return (
    (input * price.input +
      cacheRead * price.cache.read +
      cacheWrite * price.cache.write +
      (output + reasoning) * price.output) /
    1_000_000
  )
}
