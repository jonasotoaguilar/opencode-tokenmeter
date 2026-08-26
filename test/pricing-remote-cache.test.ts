import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveCost } from "../src/tokenmeter/math"
import {
  __setPricingClockForTest,
  __setPricingFetchForTest,
  clearPricing,
  getPricing,
  loadPricing,
} from "../src/tokenmeter/pricing"

const FIXTURE = {
  openai: {
    models: {
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        cost: {
          input: 4,
          output: 20,
          cache_read: 0.4,
          cache_write: 5,
          tiers: [
            {
              input: 8,
              output: 30,
              cache_read: 0.8,
              cache_write: 10,
              tier: { type: "context", size: 272000 },
            },
          ],
        },
      },
    },
  },
}
const hostApi = (d: unknown) =>
  ({
    state: { path: { directory: "/tmp/test-remote" } },
    client: { v2: { model: { list: async () => ({ data: d }) } } },
  }) as unknown as Parameters<typeof loadPricing>[0]
const mockFetch = (j: unknown = FIXTURE) =>
  (async () =>
    ({
      ok: true,
      json: async () => j,
    }) as unknown as Response) as unknown as typeof fetch
const TOK = (i: number, o = 500) => ({
  input: i,
  output: o,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
})

describe("pricing remote cache and failure", () => {
  beforeEach(() => {
    clearPricing()
    __setPricingClockForTest(null)
    __setPricingFetchForTest(null)
  })
  afterEach(() => {
    clearPricing()
    __setPricingClockForTest(null)
    __setPricingFetchForTest(null)
  })

  test("malformed/offline/timeout preserves last-good or safe-zero", async () => {
    const api = hostApi([])
    __setPricingFetchForTest(mockFetch())
    await loadPricing(api)
    const good = getPricing("openai:gpt-5.6-sol")
    let now = Date.now()
    __setPricingClockForTest(() => now)
    const bad = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch
    __setPricingFetchForTest(bad as any)
    now += 25 * 60 * 60 * 1000
    await expect(loadPricing(api)).resolves.toBeUndefined()
    expect(getPricing("openai:gpt-5.6-sol")).toEqual(good)
    const off = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    __setPricingFetchForTest(off as any)
    now += 25 * 60 * 60 * 1000 + 16 * 60 * 1000
    await expect(loadPricing(api)).resolves.toBeUndefined()
    expect(getPricing("openai:gpt-5.6-sol")).toEqual(good)
    const to = (async () => {
      throw new Error("timeout")
    }) as unknown as typeof fetch
    __setPricingFetchForTest(to as any)
    now += 16 * 60 * 1000
    await expect(loadPricing(api)).resolves.toBeUndefined()
    expect(getPricing("openai:gpt-5.6-sol")).toEqual(good)
    clearPricing()
    __setPricingClockForTest(() => Date.now())
    __setPricingFetchForTest(off as any)
    await expect(loadPricing(hostApi([]))).resolves.toBeUndefined()
    expect(getPricing("openai:gpt-5.6-sol")).toBeUndefined()
    expect(
      resolveCost({
        cost: 0,
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        tokens: TOK(1000, 500),
      }).cost,
    ).toBe(0)
  })

  test("TTL 24h, cooldown 15m, in-flight coalesced", async () => {
    let now = 1_000_000
    __setPricingClockForTest(() => now)
    let c = 0
    const cnt = (async () => {
      c++
      await new Promise((r) => setTimeout(r, 20))
      return { ok: true, json: async () => FIXTURE } as unknown as Response
    }) as unknown as typeof fetch
    __setPricingFetchForTest(cnt)
    const api = hostApi([])
    await Promise.all([loadPricing(api), loadPricing(api)])
    expect(c).toBe(1)
    now += 1 * 60 * 60 * 1000
    c = 0
    await loadPricing(api)
    expect(c).toBe(0)
    now += 24 * 60 * 60 * 1000
    await loadPricing(api)
    expect(c).toBe(1)
    let f = 0
    const fail = (async () => {
      f++
      throw new Error("offline")
    }) as unknown as typeof fetch
    __setPricingFetchForTest(fail as any)
    now += 25 * 60 * 60 * 1000
    await loadPricing(api)
    expect(f).toBe(1)
    await loadPricing(api)
    expect(f).toBe(1)
    now += 16 * 60 * 1000
    await loadPricing(api)
    expect(f).toBe(2)
    await expect(loadPricing(api)).resolves.toBeUndefined()
  })
  test("tier only when threshold from payload, else standard; safe-zero when no exact", async () => {
    const api = hostApi([])
    __setPricingFetchForTest(
      mockFetch({
        openai: {
          models: {
            "gpt-5.6-sol": {
              id: "gpt-5.6-sol",
              cost: { input: 4, output: 20, cache_read: 0.4, cache_write: 5 },
            },
          },
        },
      } as any),
    )
    await loadPricing(api)
    expect(
      resolveCost({
        cost: 0,
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        tokens: TOK(500000, 500),
      }).cost,
    ).toBeCloseTo((500000 * 4 + 500 * 20) / 1_000_000)
    clearPricing()
    __setPricingFetchForTest(mockFetch(FIXTURE))
    await loadPricing(api)
    expect(
      resolveCost({
        cost: 0,
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        tokens: TOK(500000, 500),
      }).cost,
    ).toBeCloseTo((500000 * 8 + 500 * 30) / 1_000_000)
    __setPricingFetchForTest(mockFetch({ openai: { models: {} } } as any))
    clearPricing()
    await loadPricing(hostApi([]))
    expect(
      resolveCost({
        cost: 0,
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        tokens: TOK(1000, 500),
      }).cost,
    ).toBe(0)
    expect(
      resolveCost({
        cost: 0,
        providerID: "openai",
        modelID: "unknown-model-xyz",
        tokens: TOK(1000, 500),
      }).cost,
    ).toBe(0)
  })
})
