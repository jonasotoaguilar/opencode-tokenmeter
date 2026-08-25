import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/gen/types.gen"
import type { PricingApi } from "../src/tokenmeter/pricing"
import {
  clearPricing,
  estimateCost,
  getPricing,
  loadPricing,
  selectFiniteNonTier,
} from "../src/tokenmeter/pricing"
import type { FinitePrice } from "../src/tokenmeter/types"

describe("pricing v2 guard PR1", () => {
  beforeEach(() => clearPricing())
  afterEach(() => clearPricing())
  test("PricingApi v2 shape", () => {
    const list = async () => ({ data: [] as ModelV2Info[] })
    const api = {
      client: { v2: { model: { list } } },
      state: { path: { directory: "/tmp" } },
    } satisfies PricingApi
    expect(api.client.v2.model.list).toBeDefined()
  })
  test("calls v2 with location", async () => {
    let seen: unknown
    const list = async (p: unknown) => {
      seen = p
      return {
        data: [
          {
            providerID: "openai",
            id: "gpt-5.6-sol",
            cost: [{ input: 2, output: 8, cache: { read: 1, write: 1.5 } }],
          },
        ],
      } as any
    }
    const api = {
      client: { v2: { model: { list: list as any } } },
      state: { path: { directory: "/tmp/v2-dir" } },
    } as unknown as PricingApi
    await loadPricing(api as PricingApi)
    expect(seen).toEqual({ location: { directory: "/tmp/v2-dir" } })
  })
  test("legacy ignored", async () => {
    let called = false
    const legacy = {
      state: { path: { directory: "/tmp/leg" } },
      client: {
        model: {
          list: async () => {
            called = true
            return { data: [] }
          },
        },
      },
    } as unknown as PricingApi
    let threw = false
    try {
      await loadPricing(legacy)
    } catch {
      threw = true
    }
    expect(called).toBe(false)
    expect(threw).toBe(true)
  })
  test("method_missing visible", async () => {
    const m = {
      client: { v2: {} as unknown as OpencodeClient["v2"] },
      state: { path: { directory: "/tmp/m" } },
    } as unknown as PricingApi
    let threw = false
    try {
      await loadPricing(m)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    clearPricing()
    const a = {
      client: {} as unknown as Pick<OpencodeClient, "v2">,
      state: { path: { directory: "/tmp/a" } },
    } as PricingApi
    threw = false
    try {
      await loadPricing(a)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
  test("formula", async () => {
    const price: FinitePrice = {
      input: 3,
      output: 12,
      cache: { read: 1, write: 2 },
    }
    const toks = {
      input: 1000,
      output: 200,
      reasoning: 100,
      cacheRead: 500,
      cacheWrite: 200,
    }
    expect(estimateCost(toks, price)).toBeCloseTo(0.0075)
    const api = {
      client: {
        v2: {
          model: {
            list: async () =>
              ({
                data: [
                  {
                    providerID: "openai",
                    id: "gpt-5.6-sol",
                    cost: [
                      { input: 3, output: 12, cache: { read: 1, write: 2 } },
                    ],
                  },
                ],
              }) as any,
          },
        },
      },
      state: { path: { directory: "/tmp/f" } },
    } as unknown as PricingApi
    await loadPricing(api as PricingApi)
    expect(getPricing("openai:gpt-5.6-sol")).toEqual(price)
  })
  test("source guard", async () => {
    const p = await Bun.file(
      new URL("../src/tokenmeter/pricing.ts", import.meta.url),
    ).text()
    expect(p).toContain("client.v2.model.list")
    expect(p).toContain("Pick<OpencodeClient")
    expect(p.match(/(?<!v2\.)client\.model\.list/g)).toBeNull()
    const t = await Bun.file(
      new URL("../src/tokenmeter.tsx", import.meta.url),
    ).text()
    expect(t.match(/(?<!v2\.)client\.model\.list/g)).toBeNull()
    expect(t).not.toContain("invalidateAllUsage")
    const s = await Bun.file(
      new URL("../src/tokenmeter/store.ts", import.meta.url),
    ).text()
    expect(s).not.toContain("invalidateAllUsage")
  })
})
