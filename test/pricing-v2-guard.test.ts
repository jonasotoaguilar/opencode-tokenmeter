import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveCost } from "../src/tokenmeter/math"
import {
  clearPricing,
  estimateCost,
  getPricing,
  loadPricing,
} from "../src/tokenmeter/pricing"
import type { FinitePrice } from "../src/tokenmeter/types"

const price: FinitePrice = {
  input: 5,
  output: 15,
  cache: { read: 2, write: 3 },
}

describe("pricing v2 guard", () => {
  beforeEach(() => clearPricing())
  afterEach(() => clearPricing())

  test("legacy client.model.list does NOT populate pricing and throws method_missing", async () => {
    let called = false
    const legacyApi = {
      state: { path: { directory: "/tmp/v2-guard-legacy" } },
      client: {
        model: {
          list: async () => {
            called = true
            return {
              data: [
                {
                  providerID: "openai",
                  id: "gpt-4o",
                  cost: [
                    { input: 5, output: 15, cache: { read: 2, write: 3 } },
                  ],
                },
              ],
            }
          },
        },
      },
    } as unknown as Parameters<typeof loadPricing>[0]

    let threw = false
    try {
      await loadPricing(legacyApi)
    } catch (e) {
      threw = true
      expect(String(e)).toMatch(/method_missing/)
    }
    expect(called).toBe(false)
    expect(threw).toBe(true)
    expect(getPricing("openai:gpt-4o")).toBeUndefined()
  })

  test("v2 client.v2.model.list DOES populate pricing with location.directory and this binding", async () => {
    let seen: unknown
    let thisSeen: unknown
    const v2Api = {
      state: { path: { directory: "/tmp/v2-guard" } },
      client: {
        v2: {
          model: {
            async list(this: unknown, params: unknown) {
              seen = params
              thisSeen = this
              return {
                data: [
                  {
                    providerID: "openai",
                    id: "gpt-4o",
                    cost: [
                      { input: 5, output: 15, cache: { read: 2, write: 3 } },
                    ],
                  },
                ],
              }
            },
          },
        },
      },
    } as unknown as Parameters<typeof loadPricing>[0]

    await loadPricing(v2Api)

    expect(seen).toEqual({ location: { directory: "/tmp/v2-guard" } })
    expect(thisSeen).toBe(
      (v2Api as unknown as { client: { v2: { model: unknown } } }).client.v2
        .model,
    )
    expect(getPricing("openai:gpt-4o")).toEqual(price)
  })

  test("estimateCost / resolveCost estimates OpenAI zero-cost with billable tokens when pricing loaded", async () => {
    const api = {
      state: { path: { directory: "/tmp/v2-est" } },
      client: {
        v2: {
          model: {
            list: async () => ({
              data: [
                {
                  providerID: "openai",
                  id: "gpt-4o",
                  cost: [
                    { input: 5, output: 15, cache: { read: 2, write: 3 } },
                  ],
                },
              ],
            }),
          },
        },
      },
    } as unknown as Parameters<typeof loadPricing>[0]

    await loadPricing(api)

    const toks = {
      input: 1000,
      output: 200,
      reasoning: 50,
      cacheRead: 500,
      cacheWrite: 100,
    }
    const p = getPricing("openai:gpt-4o")
    expect(p).toEqual(price)
    expect(estimateCost(toks, p as FinitePrice)).toBeCloseTo(0.01005)

    const resolved = resolveCost({
      cost: 0,
      providerID: "openai",
      modelID: "gpt-4o",
      tokens: toks,
    })
    expect(resolved.source).toBe("estimated")
    expect(resolved.cost).toBeCloseTo(0.01005)
  })

  test("non-zero reported cost still wins over estimate", async () => {
    const api = {
      state: { path: { directory: "/tmp/v2-wins" } },
      client: {
        v2: {
          model: {
            list: async () => ({
              data: [
                {
                  providerID: "openai",
                  id: "gpt-4o",
                  cost: [
                    { input: 5, output: 15, cache: { read: 2, write: 3 } },
                  ],
                },
              ],
            }),
          },
        },
      },
    } as unknown as Parameters<typeof loadPricing>[0]

    await loadPricing(api)

    const resolved = resolveCost({
      cost: 0.123,
      providerID: "openai",
      modelID: "gpt-4o",
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    })
    expect(resolved.cost).toBeCloseTo(0.123)
    expect(resolved.source).toBe("reported")
  })
})
