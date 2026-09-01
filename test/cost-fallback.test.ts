import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  checkpointActiveProject,
  readCheckpoints,
} from "../src/tokenmeter/durable/checkpoints"
import { durableDbPath } from "../src/tokenmeter/durable/paths"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"
import {
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
  recordDeletedSession,
} from "../src/tokenmeter/legacy-db"
import {
  resolveCost,
  resolveEntry,
  sumProjectSessions,
  usageOf,
} from "../src/tokenmeter/math"
import {
  __setPricingFetchForTest,
  clearPricing,
  estimateCost,
  getPricing,
  loadPricing,
  pricingKey,
  selectFiniteNonTier,
  setPricing,
} from "../src/tokenmeter/pricing"
import {
  disposeProjectRefresh,
  projectSnapshot,
  refreshProject,
  setProjectSnapshot,
} from "../src/tokenmeter/project"
import { activateRoot, disposeReconcile } from "../src/tokenmeter/reconcile"
import {
  forgetSession,
  observedSessionUsage,
  rememberCosts,
  removeMessageUsage,
  setSnapshot,
  snapshot,
  usageMap,
} from "../src/tokenmeter/store"
import { purgeTreeCache } from "../src/tokenmeter/tree"
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

const pricingApi = (list: () => Promise<unknown>) => ({
  state: { path: { directory: "/tmp/test" } },
  client: { v2: { model: { list } } },
})

describe("Unit 2 adapter+reconcile", () => {
  beforeEach(() => {
    clearPricing()
    // Prevent eager remote hydration from hitting real network in unit tests.
    __setPricingFetchForTest(
      (async () =>
        ({
          ok: true,
          json: async () => ({ openai: { models: {} } }),
        }) as unknown as typeof fetch) as unknown as typeof fetch,
    )
    setSnapshot(null)
    purgeTreeCache()
    disposeReconcile()
  })
  afterEach(() => {
    clearPricing()
    __setPricingFetchForTest(null as unknown as typeof fetch)
    setSnapshot(null)
    purgeTreeCache()
    disposeReconcile()
  })
  test("success atomically replaces map; failure/offline/throw retains last-known-good; malformed omitted", async () => {
    setPricing(new Map([["openai:gpt-4o", P10]]))
    await loadPricing(
      pricingApi(async () => ({
        data: [
          {
            providerID: "openai",
            id: "gpt-4o-mini",
            cost: [{ input: 1, output: 2, cache: { read: 3, write: 4 } }],
          },
        ],
      })),
    )
    expect(getPricing("openai:gpt-4o")).toBeUndefined()
    expect(getPricing("openai:gpt-4o-mini")).toEqual({
      input: 1,
      output: 2,
      cache: { read: 3, write: 4 },
    })
    // malformed omitted but valid kept; atomic replace
    await loadPricing(
      pricingApi(async () => ({
        data: [
          {
            providerID: "openai",
            id: " gpt-4o ",
            cost: [{ input: 5, output: 6, cache: { read: 7, write: 8 } }],
          },
          {
            providerID: "openai",
            id: "bad-tier",
            cost: [
              {
                tier: { type: "context", size: 1 },
                input: 1,
                output: 1,
                cache: { read: 1, write: 1 },
              },
            ],
          },
          {
            providerID: "openai",
            id: "bad-nan",
            cost: [{ input: NaN, output: 1, cache: { read: 1, write: 1 } }],
          },
          {
            providerID: "",
            id: "gpt-4o",
            cost: [{ input: 1, output: 1, cache: { read: 1, write: 1 } }],
          },
          {
            providerID: "openai",
            id: "",
            cost: [{ input: 1, output: 1, cache: { read: 1, write: 1 } }],
          },
          {
            id: "gpt-4o",
            cost: [{ input: 1, output: 1, cache: { read: 1, write: 1 } }],
          },
        ],
      })),
    )
    expect(getPricing("openai:gpt-4o")).toEqual({
      input: 5,
      output: 6,
      cache: { read: 7, write: 8 },
    })
    expect(getPricing("openai:bad-tier")).toBeUndefined()
    expect(getPricing("openai:bad-nan")).toBeUndefined()
    // failure retains last-known-good, no partial mutation, never throws
    const good = getPricing("openai:gpt-4o")
    await expect(
      loadPricing(
        pricingApi(async () => {
          throw new Error("offline")
        }),
      ),
    ).resolves.toBeUndefined()
    expect(getPricing("openai:gpt-4o")).toEqual(good)
    await loadPricing(pricingApi(async () => ({ data: null })))
    expect(getPricing("openai:gpt-4o")).toEqual(good)
    await loadPricing(pricingApi(async () => ({})))
    expect(getPricing("openai:gpt-4o")).toEqual(good)
  })
  test("one-in-flight coalesced refresh and poll-delay lifecycle retains map", async () => {
    let calls = 0
    const slow = pricingApi(
      () =>
        new Promise((res) =>
          setTimeout(() => {
            calls++
            res({
              data: [
                {
                  providerID: "openai",
                  id: "gpt-4o",
                  cost: [{ input: 9, output: 9, cache: { read: 9, write: 9 } }],
                },
              ],
            })
          }, 40),
        ),
    )
    const p1 = loadPricing(slow)
    const p2 = loadPricing(slow)
    await Promise.all([p1, p2])
    expect(calls).toBe(1)
    expect(getPricing("openai:gpt-4o")).toEqual({
      input: 9,
      output: 9,
      cache: { read: 9, write: 9 },
    })
    // poll-delay: immediate failure cooldown keeps last-known-good
    clearPricing()
    setPricing(new Map([["openai:gpt-4o", P10]]))
    let failCalls = 0
    const failApi = pricingApi(async () => {
      failCalls++
      throw new Error("offline")
    })
    await loadPricing(failApi)
    expect(getPricing("openai:gpt-4o")).toEqual(P10)
    const before = failCalls
    await loadPricing(failApi)
    expect(failCalls).toBe(before)
    expect(getPricing("openai:gpt-4o")).toEqual(P10)
  })
  test("reconcile awaits pricing before publishing estimated cost", async () => {
    const rootID = "s1-reconcile-cost"
    forgetSession(rootID)
    purgeTreeCache()
    clearPricing()
    // Eager remote hydration would otherwise hit real network; mock to empty for determinism.
    __setPricingFetchForTest(
      (async () =>
        ({
          ok: true,
          json: async () => ({ openai: { models: {} } }),
        }) as unknown as typeof fetch) as unknown as typeof fetch,
    )
    setSnapshot(null)
    disposeReconcile()
    const fake = {
      client: {
        session: {
          messages: async ({ sessionID }: { sessionID: string }) => ({
            data: [
              {
                info: {
                  id: "m1",
                  sessionID,
                  role: "assistant",
                  cost: 0,
                  providerID: "openai",
                  modelID: "gpt-4o-mini",
                  tokens: {
                    input: 1000,
                    output: 500,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                  },
                },
              },
            ],
          }),
          children: async () => ({ data: [] }),
          get: async () => ({ data: undefined }),
        },
        v2: {
          model: {
            list: async () => ({
              data: [
                {
                  providerID: "openai",
                  id: "gpt-4o-mini",
                  cost: [
                    { input: 5, output: 15, cache: { read: 0, write: 0 } },
                  ],
                },
              ],
            }),
          },
        },
      },
      state: {
        path: { directory: "/tmp/test" },
        session: { status: () => undefined },
      },
    }
    // use activateRoot so currentRoot is set for publish guard
    activateRoot(fake as unknown as Parameters<typeof activateRoot>[0], rootID)
    await new Promise<void>((resolve) => {
      const start = Date.now()
      const check = () => {
        if (snapshot()?.rootID === rootID) resolve()
        else if (Date.now() - start > 1000) resolve()
        else setTimeout(check, 10)
      }
      check()
    })
    const snap = snapshot()
    expect(snap).not.toBeNull()
    expect(snap?.cost).toBeCloseTo(0.0125)
    forgetSession(rootID)
    purgeTreeCache()
    disposeReconcile()
    clearPricing()
    __setPricingFetchForTest(null as unknown as typeof fetch)
    setSnapshot(null)
  })
})

describe("Unit 3 durable checkpoint scope", () => {
  const prevEnv = () => process.env.TOKENMETER_DURABLE_DIR
  beforeEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
  })
  afterEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
  })
  test("checkpoint scope (sessionX,projectA) merges once; B remains eligible; reported+estimated via union", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const price: FinitePrice = {
      input: 5,
      output: 15,
      cache: { read: 0, write: 0 },
    }
    setPricing(new Map([["openai:gpt-4o", price]]))
    const durableDir = mkdtempSync(join(tmpdir(), "tokenmeter-ut3-"))
    const saved = prevEnv()
    process.env.TOKENMETER_DURABLE_DIR = durableDir
    const dbPath = durableDbPath()!
    const stateDir = mkdtempSync(join(tmpdir(), "tokenmeter-ut3-state-"))
    try {
      // checkpoint (sessionX, projectA) only
      checkpointActiveProject(dbPath, "projA", "/proj/dir", [
        {
          id: "sessionX",
          projectID: "projA",
          cost: 0.01,
          tokens: { input: 1000, output: 500, reasoning: 0 },
        } as never,
      ])
      const cpsA = readCheckpoints(dbPath, "projA", "/proj/dir")
      const cpsBsameAlias = readCheckpoints(dbPath, "projB", "/proj/dir")
      const cpsBdiffAlias = readCheckpoints(dbPath, "projB", "/other/dir")
      expect(cpsA.has("sessionX")).toBe(true)
      // Same alias with regenerated projectID recovers (intentional alias recovery)
      expect(cpsBsameAlias.has("sessionX")).toBe(true)
      // Different alias stays isolated
      expect(cpsBdiffAlias.has("sessionX")).toBe(false)
      expect(readCheckpoints(null, "projA", "/proj/dir").size).toBe(0)
      // For projB isolation test we use diff alias
      const cpsB = cpsBdiffAlias
      // live rows: sessionX (openai cost 0 → estimated 0.0125) + sessionY reported 0.03
      // For projA, sessionX overlaps checkpoint: merged once, cost is max(reported 0.01 vs estimated 0.0125) → reported 0.01 wins
      const liveA = [
        {
          id: "sessionX",
          projectID: "projA",
          cost: 0,
          tokens: { input: 1000, output: 500, reasoning: 0 },
          model: { id: "gpt-4o", providerID: "openai" },
        },
        {
          id: "sessionY",
          projectID: "projA",
          cost: 0.03,
          tokens: { input: 2000, output: 700, reasoning: 300 },
          model: { id: "gpt-4o", providerID: "openai" },
        },
      ]
      const liveB = [
        {
          id: "sessionX",
          projectID: "projB",
          cost: 0,
          tokens: { input: 1000, output: 500, reasoning: 0 },
          model: { id: "gpt-4o", providerID: "openai" },
        },
      ]
      const usageA = reconcileProjectUsage(
        "projA",
        liveA as never,
        cpsA,
        "/proj/dir",
      )
      const usageB = reconcileProjectUsage(
        "projB",
        liveB as never,
        cpsB,
        "/proj/dir",
      )
      // A: sessionX merged (checkpoint 0.01 reported wins over estimated 0.0125) + sessionY reported 0.03 => 2 sessions, cost ~0.04
      expect(usageA.sessions).toBe(2)
      expect(usageA.cost).toBeCloseTo(0.04)
      expect(usageA.input).toBe(3000)
      // B: same ID but different project — no checkpoint, estimated cost counts
      expect(usageB.sessions).toBe(1)
      expect(usageB.cost).toBeCloseTo(0.0125)
      expect(usageB.input).toBe(1000)
      // reported+estimated through existing authority: non-openai stays zero
      const nonOpenAI = sumProjectSessions("projA", [
        {
          id: "s3",
          projectID: "projA",
          cost: 0,
          tokens: { input: 1000, output: 500 },
          model: { id: "claude-3", providerID: "anthropic" },
        },
      ] as never)
      expect(nonOpenAI.cost).toBe(0)
      // refreshProject live path: checkpoint X + live Y via union
      const apiA = {
        state: { path: { directory: "/proj/dir", state: stateDir } },
        client: {
          project: {
            current: async () => ({
              data: { id: "projA", worktree: "/proj/dir" },
            }),
          },
          session: {
            list: async () => ({ data: liveA }),
          },
          v2: {
            model: {
              list: async () => ({
                data: [
                  {
                    providerID: "openai",
                    id: "gpt-4o",
                    cost: [
                      { input: 5, output: 15, cache: { read: 0, write: 0 } },
                    ],
                  },
                ],
              }),
            },
          },
        },
      }
      await refreshProject(apiA as never)
      const snapA = projectSnapshot()
      expect(snapA?.sessions).toBe(2)
      expect(snapA?.cost).toBeCloseTo(0.04)
      // B refresh still counts its X estimated (different alias => no checkpoint for projB)
      const apiB = {
        state: { path: { directory: "/other/dir", state: stateDir } },
        client: {
          project: {
            current: async () => ({
              data: { id: "projB", worktree: "/other/dir" },
            }),
          },
          session: { list: async () => ({ data: liveB }) },
          v2: {
            model: {
              list: async () => ({
                data: [
                  {
                    providerID: "openai",
                    id: "gpt-4o",
                    cost: [
                      { input: 5, output: 15, cache: { read: 0, write: 0 } },
                    ],
                  },
                ],
              }),
            },
          },
        },
      }
      await refreshProject(apiB as never)
      const snapB = projectSnapshot()
      expect(snapB?.cost).toBeCloseTo(0.0125)
    } finally {
      if (saved === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = saved
      rmSync(durableDir, { recursive: true, force: true })
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})

describe("remediation Tokens restart and recover", () => {
  beforeEach(() => {
    clearPricing()
    forgetSession("s-remed")
    forgetSession("s-remed2")
  })
  afterEach(() => {
    clearPricing()
    forgetSession("s-remed")
    forgetSession("s-remed2")
  })
  test("pre-pricing zero recovers to estimate, idempotent, reported wins", () => {
    const price: FinitePrice = {
      input: 5,
      output: 15,
      cache: { read: 0, write: 0 },
    }
    const sid = "s-remed"
    const m = (c: number) =>
      ({
        id: "m1",
        sessionID: sid,
        role: "assistant",
        cost: c,
        providerID: "openai",
        modelID: "gpt-4o",
        tokens: { input: 1000, output: 500 },
      }) as unknown as import("../src/tokenmeter/types").UsageMessage
    // biome-ignore lint/style/noNonNullAssertion: test guarantees usage
    const b = usageOf(m(0))!
    expect(b.cost).toBe(0)
    expect(b.source).toBe("reported")
    usageMap(sid).set("m1", b)
    expect(observedSessionUsage(sid)?.cost).toBe(0)
    setPricing(new Map([["openai:gpt-4o", price]]))
    // biome-ignore lint/style/noNonNullAssertion: test guarantees usage
    const e = usageOf(m(0))!
    expect(e.cost).toBeCloseTo(0.0125)
    expect(e.source).toBe("estimated")
    usageMap(sid).set("m1", e)
    expect(observedSessionUsage(sid)?.cost).toBeCloseTo(0.0125)
    usageMap(sid).set("m1", e)
    expect(observedSessionUsage(sid)?.cost).toBeCloseTo(0.0125)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees usage
    const r = usageOf(m(0.01))!
    usageMap(sid).set("m1", r)
    expect(observedSessionUsage(sid)?.cost).toBeCloseTo(0.01)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees usage
    const z = usageOf(m(0))!
    usageMap(sid).set("m1", z)
    expect(observedSessionUsage(sid)?.cost).toBeCloseTo(0.01)
    const k = (c: number, s: "reported" | "estimated") => ({
      cost: c,
      source: s,
      input: 10,
      output: 5,
      reasoning: 1,
      cacheRead: 2,
      cacheWrite: 1,
      context: 19,
    })
    rememberCosts(
      "s-remed2",
      new Map([
        ["a", k(0.05, "estimated") as MessageUsage],
        ["b", k(0.04, "estimated") as MessageUsage],
      ]),
    )
    expect(
      rememberCosts(
        "s-remed2",
        new Map([["a", k(0.05, "estimated") as MessageUsage]]),
      ),
    ).toBeCloseTo(0.09)
  })
})

describe("Unit 4 deleted monetary resolution", () => {
  beforeEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
  })
  afterEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
  })
  test("resolveEntry authority/estimate/safe-zero/malformed/tokens-max", () => {
    const price: FinitePrice = {
      input: 10,
      output: 10,
      cache: { read: 10, write: 10 },
    }
    setPricing(new Map([["openai:gpt-4o", price]]))
    const e = (c: number, i: number, o: number) => ({
      cost: c,
      input: i,
      output: o,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cache: 0,
      context: i + o,
    })
    const payload = e(0.02, 1000, 500),
      observed = e(0.05, 1000, 500),
      zero = e(0, 1000, 500)
    expect(
      resolveEntry(
        payload as never,
        observed as never,
        { providerID: "openai", id: "gpt-4o" } as never,
      )?.cost,
    ).toBeCloseTo(0.02)
    for (const [model, exp] of [
      [{ providerID: "openai", id: "gpt-4o" }, 0.015] as const,
      [{ providerID: "openai", id: " gpt-4o " }, 0.015] as const,
    ]) {
      expect(
        resolveEntry(zero as never, zero as never, model as never)?.cost,
      ).toBeCloseTo(exp)
    }
    expect(
      resolveEntry(
        zero as never,
        zero as never,
        { providerID: "anthropic", id: "claude-3" } as never,
      )?.cost,
    ).toBe(0)
    expect(
      resolveEntry(
        zero as never,
        zero as never,
        { providerID: "openai", id: "unknown" } as never,
      )?.cost,
    ).toBe(0)
    expect(() =>
      resolveEntry(zero as never, zero as never, null as never),
    ).not.toThrow()
    expect(
      resolveEntry(zero as never, zero as never, null as never)?.cost,
    ).toBe(0)
    const m = resolveEntry(
      e(0, 100, 10) as never,
      e(0, 200, 5) as never,
      { providerID: "openai", id: "unknown" } as never,
    )
    expect(m?.input).toBe(200)
    expect(m?.output).toBe(10)
    expect(m?.context).toBe(210)
    expect(
      resolveEntry(
        e(0, 0, 0) as never,
        e(0, 0, 0) as never,
        { providerID: "openai", id: "gpt-4o" } as never,
      ),
    ).toBeNull()
    expect(
      resolveEntry(null, null, { providerID: "openai", id: "gpt-4o" } as never),
    ).toBeNull()
  })
  test("repeated/lifecycle no double count", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const price: FinitePrice = {
      input: 5,
      output: 15,
      cache: { read: 0, write: 0 },
    }
    setPricing(new Map([["openai:gpt-4o", price]]))
    const dir = mkdtempSync(join(tmpdir(), "tokenmeter-ut4-"))
    const dbPath = projectDbPath(dir)
    const sess = (id: string, cost: number, input: number, output: number) =>
      ({
        id,
        projectID: "projA",
        cost,
        tokens: { input, output },
        model: { id: "gpt-4o", providerID: "openai" },
      }) as never
    recordDeletedSession(dbPath, sess("sessA", 0, 1000, 500), null)
    expect(readDeletedAggregate(dbPath, "projA")?.cost).toBeCloseTo(0.0125)
    recordDeletedSession(dbPath, sess("sessA", 0, 1000, 500), null)
    expect(readDeletedAggregate(dbPath, "projA")?.cost).toBeCloseTo(0.0125)
    recordDeletedSession(dbPath, sess("sessB", 0.03, 2000, 700), null)
    expect(readDeletedAggregate(dbPath, "projA")?.cost).toBeCloseTo(0.0425)
    expect(() => recordDeletedSession(null, null, null)).not.toThrow()
    const { readDeletedSessionIDs: rIds } = await import(
      "../src/tokenmeter/legacy-db"
    )
    const { sumProjectSessions: sSum, combineProjectUsage: cUse } =
      await import("../src/tokenmeter/math")
    const live = [
      {
        id: "live1",
        projectID: "projA",
        cost: 0,
        tokens: { input: 1000, output: 500 },
        model: { id: "gpt-4o", providerID: "openai" },
      },
    ]
    const lu = sSum("projA", live as never, rIds(dbPath, "projA"))
    expect(lu.cost).toBeCloseTo(0.0125)
    expect(cUse(lu, readDeletedAggregate(dbPath, "projA")).cost).toBeCloseTo(
      0.055,
    )
    rmSync(dir, { recursive: true, force: true })
  })
})
