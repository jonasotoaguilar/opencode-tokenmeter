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
export function clearPricing(): void {
  pricingMap.clear()
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
