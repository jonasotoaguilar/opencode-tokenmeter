import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resolveCost, usageOf } from "../src/tokenmeter/math"
import {
  clearPricing,
  estimateCost,
  pricingKey,
  selectFiniteNonTier,
  setPricing,
} from "../src/tokenmeter/pricing"
import {
  forgetSession,
  observedSessionUsage,
  rememberCosts,
  removeMessageUsage,
  usageMap,
} from "../src/tokenmeter/store"
import type { FinitePrice, MessageUsage } from "../src/tokenmeter/types"

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

const mk = (
  cost: number,
  source: MessageUsage["source"],
  tokens: Partial<MessageUsage> = {},
): MessageUsage => ({
  cost,
  source,
  input: tokens.input ?? 10,
  output: tokens.output ?? 5,
  reasoning: tokens.reasoning ?? 1,
  cacheRead: tokens.cacheRead ?? 2,
  cacheWrite: tokens.cacheWrite ?? 1,
  context:
    (tokens.input ?? 10) +
    (tokens.output ?? 5) +
    (tokens.reasoning ?? 1) +
    (tokens.cacheRead ?? 2) +
    (tokens.cacheWrite ?? 1),
})

describe("Unit 1B store identity", () => {
  beforeEach(() => {
    forgetSession("s1")
    clearPricing()
  })
  afterEach(() => {
    forgetSession("s1")
    clearPricing()
  })
  test("composite per-message authority: M1.10+M2.05+M3.04 refill M2.02 M3 absent→.16 repeat→.16 mixed sums idempotency", () => {
    const prior = new Map<string, MessageUsage>([
      ["m1", mk(0.1, "reported")],
      ["m2", mk(0.05, "estimated")],
      ["m3", mk(0.04, "estimated")],
    ])
    expect(rememberCosts("s1", prior)).toBeCloseTo(0.19)
    // idempotency: re-upsert same prior no double count
    expect(rememberCosts("s1", prior)).toBeCloseTo(0.19)
    const refill = new Map<string, MessageUsage>([
      ["m1", mk(0.1, "reported")],
      ["m2", mk(0.02, "reported")],
    ])
    expect(rememberCosts("s1", refill)).toBeCloseTo(0.16)
    expect(rememberCosts("s1", refill)).toBeCloseTo(0.16)
    // converted replaces only its estimate; missing estimated archives once
    const refill2 = new Map<string, MessageUsage>([["m1", mk(0.1, "reported")]])
    expect(rememberCosts("s1", refill2)).toBeCloseTo(0.16)
    // reported outranks estimated even if lower (m1 reported .10 vs estimated .20 should keep .10)
    const lowerReported = new Map<string, MessageUsage>([
      ["m1", mk(0.2, "estimated")],
    ])
    expect(rememberCosts("s1", lowerReported)).toBeCloseTo(0.16)
    // unrelated missing estimated survives exactly once (m2,m3 still accounted)
    const empty = new Map<string, MessageUsage>()
    expect(rememberCosts("s1", empty)).toBeCloseTo(0.16)
  })
  test("observed uses identity sum while tokens keep high-water; remove/forget clean identity", () => {
    const sid = "s1"
    const map = usageMap(sid)
    map.set("m1", mk(0.1, "reported", { input: 100, output: 10 }))
    map.set("m2", mk(0.05, "estimated", { input: 50, output: 5 }))
    const o1 = observedSessionUsage(sid)
    expect(o1?.cost).toBeCloseTo(0.15)
    expect(o1?.input).toBe(150)
    // compaction: smaller token set but cost persists via identity
    map.delete("m2")
    map.set("m2", mk(0.02, "reported", { input: 5, output: 1 }))
    // token high-water keeps max 150, cost reflects latest identity sum
    const o2 = observedSessionUsage(sid)
    expect(o2?.cost).toBeCloseTo(0.12)
    expect(o2?.input).toBe(150)
    // remove cleans that id from cost
    removeMessageUsage(sid, "m2")
    const o3 = observedSessionUsage(sid)
    expect(o3?.cost).toBeCloseTo(0.1)
    expect(o3?.input).toBe(150)
    // forget cleans all
    forgetSession(sid)
    expect(observedSessionUsage(sid)).toBeNull()
    expect(
      rememberCosts(sid, new Map([["m1", mk(0.1, "reported")]])),
    ).toBeCloseTo(0.1)
  })
})
