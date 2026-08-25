import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearPricing,
  getPricing,
  loadPricing,
  onPricingFirstFill,
} from "../src/tokenmeter/pricing"
import {
  disposeProjectRefresh,
  refreshProject,
} from "../src/tokenmeter/project"
import {
  activateRoot,
  disposeReconcile,
  getCurrentRoot,
  RECONCILE_DELAY,
  scheduleForcedReconcile,
} from "../src/tokenmeter/reconcile"
import { forgetSession, setSnapshot, snapshot } from "../src/tokenmeter/store"
import { purgeTreeCache } from "../src/tokenmeter/tree"
import type { FinitePrice } from "../src/tokenmeter/types"

const price5x15: FinitePrice = {
  input: 5,
  output: 15,
  cache: { read: 0, write: 0 },
}
const tierData = {
  data: [
    {
      providerID: "openai",
      id: "gpt-4o",
      cost: [
        {
          tier: { type: "context" },
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        },
      ],
    },
  ],
}
const goodData = {
  data: [
    {
      providerID: "openai",
      id: "gpt-4o",
      cost: [{ input: 5, output: 15, cache: { read: 0, write: 0 } }],
    },
  ],
}
const waitFor = async (c: () => boolean, t = 2000) => {
  const s = Date.now()
  while (!c()) {
    if (Date.now() - s > t) throw new Error("waitFor timeout")
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe("pricing first-fill PR1B", () => {
  beforeEach(() => {
    clearPricing()
    setSnapshot(null)
    purgeTreeCache()
    disposeReconcile()
    disposeProjectRefresh()
    forgetSession("s-pricing-root")
  })
  afterEach(() => {
    clearPricing()
    setSnapshot(null)
    purgeTreeCache()
    disposeReconcile()
    disposeProjectRefresh()
    forgetSession("s-pricing-root")
  })

  test("empty to non-empty schedules once with estimated replacement", async () => {
    const root = "s-pricing-root"
    let calls = 0
    const sessApi = {
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
                  modelID: "gpt-4o",
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
          model: { list: async () => (calls++ === 0 ? tierData : goodData) },
        },
      },
      state: {
        path: { directory: "/tmp/test-pricing-sess" },
        session: { status: () => undefined },
      },
    } as unknown as Parameters<typeof activateRoot>[0]
    const dir = mkdtempSync(join(tmpdir(), "tokenmeter-pff-"))
    const projApi = {
      state: { path: { directory: "/tmp/test-pricing-proj", state: dir } },
      client: {
        project: { current: async () => ({ data: { id: "proj-pff" } }) },
        session: {
          list: async () => ({
            data: [
              {
                id: root,
                projectID: "proj-pff",
                cost: 0,
                tokens: { input: 1000, output: 500, reasoning: 0 },
                model: { id: "gpt-4o", providerID: "openai" },
              },
            ],
          }),
        },
        v2: { model: { list: async () => goodData } },
      },
    } as unknown as Parameters<typeof refreshProject>[0]
    let scheduled = 0
    const dispose = onPricingFirstFill(() => {
      scheduled++
      scheduleForcedReconcile(sessApi as never, RECONCILE_DELAY)
    })
    activateRoot(sessApi as never, root)
    await waitFor(() => snapshot()?.rootID === root)
    expect(snapshot()?.cost).toBe(0)
    expect(scheduled).toBe(0)
    await refreshProject(projApi as never)
    expect(getPricing("openai:gpt-4o")).toEqual(price5x15)
    await waitFor(() => (snapshot()?.cost ?? 0) > 0)
    expect(snapshot()?.cost).toBeCloseTo(0.0125)
    expect(scheduled).toBe(1)
    const before = scheduled
    await loadPricing(projApi as never)
    await refreshProject(projApi as never)
    await new Promise((r) => setTimeout(r, RECONCILE_DELAY + 50))
    expect(scheduled).toBe(before)
    dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  test("exactly once, empty and repeat are no-ops, disposal and pre-available guard", async () => {
    clearPricing()
    let calls: number[] = []
    const d1 = onPricingFirstFill(() => calls.push(1))
    await loadPricing({
      state: { path: { directory: "/tmp/x-empty" } },
      client: { v2: { model: { list: async () => tierData } } },
    } as never)
    expect(calls.length).toBe(0)
    await loadPricing({
      state: { path: { directory: "/tmp/x-empty" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    expect(calls.length).toBe(1)
    await loadPricing({
      state: { path: { directory: "/tmp/x-empty" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    expect(calls.length).toBe(1)
    d1()
    clearPricing()
    calls = []
    const disposed = onPricingFirstFill(() => calls.push(1))
    disposed()
    await loadPricing({
      state: { path: { directory: "/tmp/x-dispose" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    expect(calls.length).toBe(0)
    clearPricing()
    calls = []
    const d2 = onPricingFirstFill(() => calls.push(1))
    await loadPricing({
      state: { path: { directory: "/tmp/x-late" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    expect(calls.length).toBe(1)
    let late = 0
    const lateDispose = onPricingFirstFill(() => late++)
    expect(late).toBe(0)
    d2()
    lateDispose()
    clearPricing()
    await loadPricing({
      state: { path: { directory: "/tmp/x-pre" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    let pre = 0
    const preDispose = onPricingFirstFill(() => pre++)
    expect(pre).toBe(0)
    await loadPricing({
      state: { path: { directory: "/tmp/x-pre" } },
      client: { v2: { model: { list: async () => goodData } } },
    } as never)
    expect(pre).toBe(0)
    preDispose()
  })

  test("targeted schedule uses current root and handles no-root", async () => {
    disposeReconcile()
    expect(getCurrentRoot()).toBeNull()
    const apiNoRoot = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          children: async () => ({ data: [] }),
          get: async () => ({ data: undefined }),
        },
      },
      state: {
        path: { directory: "/tmp" },
        session: { status: () => undefined },
      },
    } as never
    expect(() => scheduleForcedReconcile(apiNoRoot, 10)).not.toThrow()
    expect(getCurrentRoot()).toBeNull()
    const root = "s-pricing-root"
    let messagesCalls = 0
    const sessApi = {
      client: {
        session: {
          messages: async () => {
            messagesCalls++
            return {
              data: [
                {
                  info: {
                    id: "m1",
                    sessionID: root,
                    role: "assistant",
                    cost: 0,
                    providerID: "openai",
                    modelID: "gpt-4o",
                    tokens: {
                      input: 1000,
                      output: 500,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                },
              ],
            }
          },
          children: async () => ({ data: [] }),
          get: async () => ({ data: undefined }),
        },
        v2: { model: { list: async () => goodData } },
      },
      state: {
        path: { directory: "/tmp/test-pricing-sched" },
        session: { status: () => undefined },
      },
    } as unknown as Parameters<typeof activateRoot>[0]
    activateRoot(sessApi as never, root)
    await waitFor(() => snapshot()?.rootID === root)
    expect(getCurrentRoot()).toBe(root)
    const before = messagesCalls
    scheduleForcedReconcile(sessApi as never, 20)
    await new Promise((r) => setTimeout(r, 45))
    expect(messagesCalls).toBeGreaterThan(before)
    disposeReconcile()
  })

  test("tokenmeter wiring subscribes before load and disposes", async () => {
    const source = await Bun.file(
      new URL("../src/tokenmeter.tsx", import.meta.url),
    ).text()
    expect(source).toContain("onPricingFirstFill")
    expect(source).toContain("scheduleForcedReconcile")
    expect(source).not.toContain("invalidateAllUsage")
    expect(source.indexOf("onPricingFirstFill")).toBeLessThan(
      source.indexOf("loadPricing(api"),
    )
    expect(source).toContain("disposePricingFirstFill")
  })
})
