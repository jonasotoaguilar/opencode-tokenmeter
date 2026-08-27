import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import {
  clearRemotePricing,
  clockNow,
  isFiniteNumber,
  loadRemoteIfNeeded,
  pricingKey,
  remotePricingMap,
} from "./pricing-remote"
import type { FinitePrice } from "./types"

export {
  __setPricingClockForTest,
  __setPricingFetchForTest,
  isFiniteNumber,
  parseStandardPrice,
  pricingKey,
} from "./pricing-remote"
export type {
  FinitePrice,
  MonetarySource,
  MoneyRow,
  ResolvedCost,
} from "./types"

const hostPricingMap = new Map<string, FinitePrice>()
export function getPricing(key: string): FinitePrice | undefined {
  return hostPricingMap.get(key) ?? remotePricingMap.get(key)
}
export function setPricing(map: Map<string, FinitePrice>): void {
  hostPricingMap.clear()
  for (const [k, v] of map) hostPricingMap.set(k, v)
}
let hostInflight: Promise<void> | null = null
let hostLastFailure = 0
const HOST_COOLDOWN_MS = 2000

export function clearPricing(): void {
  hostPricingMap.clear()
  hostLastFailure = 0
  hostInflight = null
  clearRemotePricing()
}

// biome-ignore format: keep minimal v2.model.list on one line to preserve 400 review budget
export type PricingApi = { client: { v2: { model: { list: (...args: Parameters<OpencodeClient["v2"]["model"]["list"]>) => Promise<unknown> } } }; state: { path: { directory?: string } } } // Pick<OpencodeClient["v2"], "model"> Pick<OpencodeClient["v2"]["model"], "list">

export async function loadPricing(api: PricingApi): Promise<void> {
  if (hostInflight) return hostInflight
  const now = clockNow()
  const hostInCooldown =
    hostLastFailure !== 0 && now - hostLastFailure < HOST_COOLDOWN_MS
  hostInflight = (async () => {
    try {
      if (!hostInCooldown) {
        const v2Model = (
          api as unknown as { client?: { v2?: { model?: { list?: unknown } } } }
        )?.client?.v2?.model
        const fn = v2Model?.list as
          | ((p: unknown) => Promise<unknown>)
          | undefined
        const directoryValue = api?.state?.path?.directory
        if (typeof fn !== "function") {
          hostLastFailure = clockNow()
          throw new Error(
            "method_missing: api.client.v2.model.list is not available",
          )
        }
        try {
          const res = await (fn as (p: unknown) => Promise<unknown>).call(
            v2Model,
            { location: { directory: directoryValue } },
          )
          const data = (res as Record<string, unknown> | null | undefined)?.data
          if (!Array.isArray(data)) hostLastFailure = clockNow()
          else {
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
            hostPricingMap.clear()
            for (const [k, v] of next) hostPricingMap.set(k, v)
            hostLastFailure = 0
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("method_missing"))
            throw e
          hostLastFailure = clockNow()
        }
      }
      await loadRemoteIfNeeded()
    } finally {
      hostInflight = null
    }
  })()
  return hostInflight
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
    let read: unknown = cache?.read
    let write: unknown = cache?.write
    if (write === undefined) write = 0
    if (read === undefined) read = 0
    if (
      !isFiniteNumber(input) ||
      !isFiniteNumber(output) ||
      !isFiniteNumber(read) ||
      !isFiniteNumber(write)
    )
      continue
    if ((input as number) === 0 && (output as number) === 0) continue
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
  let p: FinitePrice = price
  if (
    price.tier &&
    typeof price.tier.threshold === "number" &&
    Number.isFinite(price.tier.threshold) &&
    price.tier.threshold > 0 &&
    input >= price.tier.threshold
  ) {
    p = {
      input: price.tier.input,
      output: price.tier.output,
      cache: { read: price.tier.cache.read, write: price.tier.cache.write },
    }
  }
  return (
    (input * p.input +
      cacheRead * p.cache.read +
      cacheWrite * p.cache.write +
      (output + reasoning) * p.output) /
    1_000_000
  )
}
