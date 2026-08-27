import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { pricingKey, selectFiniteNonTier } from "../src/tokenmeter/pricing"
import {
  __setPricingClockForTest,
  __setPricingFetchForTest,
  clearRemotePricing,
  clockNow,
  fetchImpl,
  isFiniteNumber,
  normalizeModelId,
  parseStandardPrice,
  remotePricingMap,
} from "../src/tokenmeter/pricing-remote"

describe("openai cost remote helpers", () => {
  beforeEach(() => {
    clearRemotePricing()
    __setPricingClockForTest(null)
    __setPricingFetchForTest(null)
  })
  afterEach(() => {
    clearRemotePricing()
    __setPricingClockForTest(null)
    __setPricingFetchForTest(null)
  })

  test("isFiniteNumber guards", () => {
    expect(isFiniteNumber(1)).toBe(true)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber(-1)).toBe(false)
    expect(isFiniteNumber("1" as unknown as number)).toBe(false)
    expect(isFiniteNumber(undefined as unknown as number)).toBe(false)
  })

  test("normalizeModelId strips prefix and alias", () => {
    expect(normalizeModelId("openai/gpt-5.6")).toBe("gpt-5.6-sol")
    expect(normalizeModelId(" gpt-5.6 ")).toBe("gpt-5.6-sol")
    expect(normalizeModelId("gpt-4o")).toBe("gpt-4o")
    expect(normalizeModelId("OPENAI/GPT-5.6")).toBe("gpt-5.6-sol")
    expect(normalizeModelId("openai/gpt-4o ")).toBe("gpt-4o")
  })

  test("pricingKey remote handles alias", async () => {
    const { pricingKey: remoteKey } = await import(
      "../src/tokenmeter/pricing-remote"
    )
    expect(remoteKey("openai", "openai/gpt-5.6-sol")).toBe("openai:gpt-5.6-sol")
    expect(remoteKey("openai", "gpt-5.6")).toBe("openai:gpt-5.6-sol")
    expect(remoteKey(123 as unknown as string, "gpt-4o")).toBeNull()
    expect(remoteKey("openai", 123 as unknown as string)).toBeNull()
    expect(remoteKey("openai", "")).toBeNull()
    expect(remoteKey("openai", "   ")).toBeNull()
  })

  test("pricingKey simple lowercases (host layer)", () => {
    expect(pricingKey("OpenAI", "GPT-4o")).toBe("openai:gpt-4o")
  })

  test("parseStandardPrice rejects zero and invalid payload", () => {
    expect(
      parseStandardPrice({
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      } as any),
    ).toBeNull()
    expect(
      parseStandardPrice({
        input: 0,
        output: 0,
        cache: { read: 1, write: 1 },
      } as any),
    ).toBeNull()
    expect(
      parseStandardPrice({
        input: NaN,
        output: 1,
        cache: { read: 1, write: 1 },
      } as any),
    ).toBeNull()
    expect(
      parseStandardPrice({
        input: Infinity,
        output: 1,
        cache: { read: 1, write: 1 },
      } as any),
    ).toBeNull()
    expect(
      parseStandardPrice({
        input: -1,
        output: 1,
        cache: { read: 1, write: 1 },
      } as any),
    ).toBeNull()
    expect(
      parseStandardPrice({
        input: 2.5,
        output: 10,
        cache: { read: 1.25, write: undefined },
      } as any),
    ).toEqual({
      input: 2.5,
      output: 10,
      cache: { read: 1.25, write: 0 },
    })
    expect(
      parseStandardPrice({ input: 2.5, output: 10, cache_read: 1.25 } as any),
    ).toEqual({
      input: 2.5,
      output: 10,
      cache: { read: 1.25, write: 0 },
    })
    expect(
      parseStandardPrice({ input: 2.5, output: 10, cacheRead: 1.25 } as any),
    ).toEqual({
      input: 2.5,
      output: 10,
      cache: { read: 1.25, write: 0 },
    })
    expect(
      parseStandardPrice({
        input: 2.5,
        output: 10,
        cache: { read: 0.4, write: 5 },
      } as any),
    ).toEqual({
      input: 2.5,
      output: 10,
      cache: { read: 0.4, write: 5 },
    })
    expect(
      parseStandardPrice({
        input: 2.5,
        output: 10,
        cache: "invalid" as any,
      } as any),
    ).toEqual({
      input: 2.5,
      output: 10,
      cache: { read: 0, write: 0 },
    })
  })

  test("selectFiniteNonTier rejects tier", () => {
    expect(
      selectFiniteNonTier([
        {
          tier: { type: "context" },
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        } as any,
      ]),
    ).toBeNull()
    expect(
      selectFiniteNonTier([
        { input: 1, output: 1, cache: { read: 1, write: 1 } } as any,
      ]),
    ).toEqual({
      input: 1,
      output: 1,
      cache: { read: 1, write: 1 },
    })
  })

  test("clearRemotePricing resets map and clock/fetch overrides", () => {
    remotePricingMap.set("openai:gpt-4o", {
      input: 1,
      output: 1,
      cache: { read: 0, write: 0 },
    })
    expect(remotePricingMap.size).toBe(1)
    clearRemotePricing()
    expect(remotePricingMap.size).toBe(0)
    __setPricingClockForTest(() => 12345)
    expect(clockNow()).toBe(12345)
    __setPricingClockForTest(null)
    expect(typeof clockNow()).toBe("number")
  })

  test("__setPricingFetchForTest overrides and restores, invalid payload fallback", async () => {
    const custom = (async () =>
      ({
        ok: true,
        json: async () => ({}),
      }) as unknown as Response) as unknown as typeof fetch
    __setPricingFetchForTest(custom)
    expect(fetchImpl).toBe(custom)
    __setPricingFetchForTest(null)
    expect(typeof fetchImpl).toBe("function")
    const saved = (globalThis as unknown as { fetch?: typeof fetch }).fetch
    try {
      ;(globalThis as unknown as { fetch?: unknown }).fetch = undefined
      __setPricingFetchForTest(null)
      await expect(
        fetchImpl("https://example.invalid" as unknown as string),
      ).rejects.toThrow("fetch unavailable")
    } finally {
      ;(globalThis as unknown as { fetch?: typeof fetch }).fetch = saved
      __setPricingFetchForTest(null)
    }
    expect(parseStandardPrice({ input: 2.5 } as any)).toBeNull()
    expect(parseStandardPrice({ output: 10 } as any)).toBeNull()
  })
})
