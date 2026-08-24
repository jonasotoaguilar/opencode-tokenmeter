import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveCost, usageOf } from "../src/tokenmeter/math"
import {
  clearPricing,
  estimateCost,
  pricingKey,
  selectFiniteNonTier,
  setPricing,
} from "../src/tokenmeter/pricing"
import type { FinitePrice } from "../src/tokenmeter/types"

const P10: FinitePrice = {
  input: 10,
  output: 10,
  cache: { read: 10, write: 10 },
}
const T100 = {
  input: 100,
  output: 100,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
}
const T0 = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
const RC = (
  cost: number,
  providerID: unknown,
  modelID: unknown,
  tokens = T100,
) => resolveCost({ cost, providerID, modelID, tokens })
describe("Unit 1A pure resolver", () => {
  beforeEach(() => clearPricing())
  afterEach(() => clearPricing())
  test("gates, reported, trim/suffix, safe-zero", () => {
    setPricing(new Map([["openai:gpt-4o", P10]]))
    expect(RC(0, "openai", "gpt-4o").source).toBe("estimated")
    expect(RC(0, "openai", "gpt-4o").cost).toBeGreaterThan(0)
    expect(RC(0, "anthropic", "claude-3").cost).toBe(0)
    expect(RC(0.123, "openai", "gpt-4o").cost).toBeCloseTo(0.123)
    expect(RC(0, "openai", "gpt-4o", T0).cost).toBe(0)
    expect(RC(0, "openai", "gpt-unknown").cost).toBe(0)
    expect(RC(0, " openai ", " gpt-4o ").cost).toBeGreaterThan(0)
    expect(RC(0, "openai", "gpt-4o-2024-08-06").cost).toBe(0)
    expect(pricingKey(" OpenAI ", " GPT-4o ")).toBe("openai:gpt-4o")
    expect(pricingKey("openai", "gpt-4o-2024-08-06")).toBe(
      "openai:gpt-4o-2024-08-06",
    )
    expect(pricingKey("", "gpt-4o")).toBeNull()
    expect(RC(0, undefined, "gpt-4o").cost).toBe(0)
    expect(() => RC(0, "openai", "unknown")).not.toThrow()
    const uRep = usageOf({
      id: "m1",
      sessionID: "s1",
      role: "assistant",
      cost: 0.5,
      providerID: "openai",
      modelID: "gpt-4o",
      tokens: { input: 100, output: 100 },
    } as unknown as import("../src/tokenmeter/types").UsageMessage)
    expect(uRep?.cost).toBeCloseTo(0.5)
    expect(uRep?.source).toBe("reported")
    const uEst = usageOf({
      id: "m1",
      sessionID: "s1",
      role: "assistant",
      cost: 0,
      providerID: "openai",
      modelID: "gpt-4o",
      tokens: { input: 100, output: 100 },
    } as unknown as import("../src/tokenmeter/types").UsageMessage)
    expect(uEst?.source).toBe("estimated")
    clearPricing()
    expect(RC(0, "openai", "gpt-4o").cost).toBe(0)
  })
  test("formula and selector", () => {
    const price: FinitePrice = {
      input: 5,
      output: 15,
      cache: { read: 2, write: 3 },
    }
    const toks = {
      input: 1000,
      output: 200,
      reasoning: 50,
      cacheRead: 500,
      cacheWrite: 100,
    }
    expect(estimateCost(toks, price)).toBeCloseTo(0.01005)
    setPricing(new Map([["openai:gpt-4o", price]]))
    expect(RC(0, "openai", "gpt-4o", toks).cost).toBeCloseTo(0.01005)
    for (const bad of [
      [
        {
          tier: { type: "context" },
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        },
      ],
      [{ input: NaN, output: 1, cache: { read: 1, write: 1 } }],
      [{ input: Infinity, output: 1, cache: { read: 1, write: 1 } }],
      [{ input: -1, output: 1, cache: { read: 1, write: 1 } }],
    ])
      expect(selectFiniteNonTier(bad)).toBeNull()
    expect(selectFiniteNonTier(null)).toBeNull()
    expect(
      selectFiniteNonTier([
        {
          tier: { size: 1 },
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        },
        { input: 5, output: 6, cache: { read: 7, write: 8 } },
        { input: 9, output: 9, cache: { read: 9, write: 9 } },
      ]),
    ).toEqual({ input: 5, output: 6, cache: { read: 7, write: 8 } })
  })
})
