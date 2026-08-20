import { afterEach, describe, expect, test } from "bun:test"
import {
  formatMilestone,
  handleProjectMilestone,
  MILESTONE_KV_KEY,
  milestoneDuration,
  milestoneExponentForTotal,
  milestoneTitle,
  milestoneVariant,
  resetMilestoneState,
} from "../src/tokenmeter/milestone"
import { loadSettings, SETTINGS_KV_KEY } from "../src/tokenmeter/settings"
import type { ProjectUsage } from "../src/tokenmeter/types"

type ToastCall = {
  title?: string
  message: string
  variant?: string
  duration?: number
}
type FakeKv = {
  kv: {
    get: <V>(k: string, f?: V) => V
    set: (k: string, v: unknown) => void
    ready: boolean
  }
  store: Map<string, unknown>
}
const makeFakeKv = (
  initial: Record<string, unknown> = {},
  ready = true,
): FakeKv => {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    kv: {
      ready,
      get<V>(k: string, f?: V): V {
        return (store.has(k) ? store.get(k) : f) as V
      },
      set(k: string, v: unknown) {
        store.set(k, v)
      },
    },
    store,
  }
}
const makeApi = (fake: FakeKv, toasts: ToastCall[]) => ({
  kv: fake.kv,
  ui: {
    toast(input: ToastCall) {
      toasts.push(input)
    },
  },
})
const usage = (id: string, context: number): ProjectUsage => ({
  id,
  sessions: 1,
  cost: 0,
  context,
  input: context,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cache: 0,
})
const settingsApi = (fake: FakeKv) => ({ kv: fake.kv })
afterEach(() => resetMilestoneState())

describe("milestone pure detector", () => {
  test("thresholds labels variants titles", () => {
    expect(milestoneExponentForTotal(0)).toBeNull()
    expect(milestoneExponentForTotal(1_000_000)).toBe(6)
    expect(milestoneExponentForTotal(100_000_000)).toBe(8)
    expect(formatMilestone(6)).toBe("1M")
    expect(formatMilestone(8)).toBe("100M")
    expect(milestoneVariant(6)).toBe("info")
    expect(milestoneVariant(8)).toBe("warning")
    expect(milestoneDuration(6)).toBeLessThan(milestoneDuration(9))
    expect(milestoneTitle(7)).toContain("◆")
  })
})

describe("milestone toast policy", () => {
  test("polling jump drop monotonic", () => {
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const api = makeApi(fake, toasts)
    loadSettings(settingsApi(fake))
    handleProjectMilestone(api, usage("proj-a", 500_000))
    expect(toasts).toHaveLength(0)
    handleProjectMilestone(api, usage("proj-a", 1_200_000))
    expect(toasts).toHaveLength(1)
    handleProjectMilestone(api, usage("proj-a", 1_200_000))
    expect(toasts).toHaveLength(1)
    handleProjectMilestone(api, usage("proj-b", 900_000))
    handleProjectMilestone(api, usage("proj-b", 12_000_000))
    expect(toasts).toHaveLength(2)
    expect(toasts[1].message).toContain("10M")
    expect(
      (fake.store.get(MILESTONE_KV_KEY) as Record<string, number>)["proj-b"],
    ).toBe(7)
    handleProjectMilestone(api, usage("proj-b", 5_000_000))
    expect(toasts).toHaveLength(2)
    handleProjectMilestone(api, usage("proj-b", 11_000_000))
    expect(toasts).toHaveLength(2)
    handleProjectMilestone(api, usage("proj-b", 100_000_000))
    expect(toasts).toHaveLength(3)
  })

  test("startup baseline and restart", () => {
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const api = makeApi(fake, toasts)
    loadSettings(settingsApi(fake))
    handleProjectMilestone(api, usage("c", 12_000_000))
    expect(toasts).toHaveLength(0)
    handleProjectMilestone(api, usage("c", 150_000_000))
    expect(toasts).toHaveLength(1)
    const fake2 = makeFakeKv({ [MILESTONE_KV_KEY]: { e: 7 } })
    const t2: ToastCall[] = []
    const a2 = makeApi(fake2, t2)
    loadSettings({ kv: fake2.kv } as never)
    resetMilestoneState()
    handleProjectMilestone(a2, usage("e", 12_000_000))
    expect(t2).toHaveLength(0)
    handleProjectMilestone(a2, usage("e", 100_000_000))
    expect(t2).toHaveLength(1)
    const f3 = makeFakeKv({}, false)
    const t3: ToastCall[] = []
    const a3b = makeApi(f3, t3)
    loadSettings({ kv: f3.kv } as never)
    handleProjectMilestone(a3b, usage("unav", 500_000))
    handleProjectMilestone(a3b, usage("unav", 1_200_000))
    expect(t3).toHaveLength(1)
    ;(f3.kv as { ready: boolean }).ready = true
    f3.store.set(MILESTONE_KV_KEY, { unav: 5 })
    handleProjectMilestone(a3b, usage("unav", 1_200_000))
    expect(t3).toHaveLength(1)
    handleProjectMilestone(a3b, usage("unav", 12_000_000))
    expect(t3).toHaveLength(2)
    expect(
      (f3.store.get(MILESTONE_KV_KEY) as Record<string, number>).unav,
    ).toBe(7)
  })

  test("isolation disabled failures copy", () => {
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const api = makeApi(fake, toasts)
    loadSettings(settingsApi(fake))
    handleProjectMilestone(api, usage("a", 400_000))
    handleProjectMilestone(api, usage("b", 400_000))
    handleProjectMilestone(api, usage("a", 1_100_000))
    handleProjectMilestone(api, usage("b", 1_100_000))
    expect(toasts).toHaveLength(2)
    const f2 = makeFakeKv()
    f2.store.set(SETTINGS_KV_KEY, { milestones: false })
    const t3: ToastCall[] = []
    const a3 = makeApi(f2, t3)
    loadSettings({ kv: f2.kv } as never)
    handleProjectMilestone(a3, usage("j", 1_100_000))
    expect(t3).toHaveLength(0)
    expect((f2.store.get(MILESTONE_KV_KEY) as Record<string, number>).j).toBe(6)
    f2.store.set(SETTINGS_KV_KEY, { milestones: true })
    loadSettings({ kv: f2.kv } as never)
    handleProjectMilestone(a3, usage("j", 12_000_000))
    expect(t3).toHaveLength(1)
    const bad = makeFakeKv()
    ;(bad.kv as unknown as { set: (k: string, v: unknown) => void }).set =
      () => {
        throw new Error("disk")
      }
    const t2: ToastCall[] = []
    const a2 = makeApi(bad, t2)
    loadSettings({ kv: bad.kv } as never)
    handleProjectMilestone(a2, usage("h", 600_000))
    handleProjectMilestone(a2, usage("h", 1_100_000))
    expect(t2).toHaveLength(1)
    expect(() =>
      handleProjectMilestone(
        makeApi(makeFakeKv({ [MILESTONE_KV_KEY]: { bad: "x" } }), []),
        usage("bad", 12_000_000),
      ),
    ).not.toThrow()
    const f3 = makeFakeKv()
    const tk: ToastCall[] = []
    const ap = makeApi(f3, tk)
    loadSettings(settingsApi(f3))
    handleProjectMilestone(ap, usage("k", 300_000))
    handleProjectMilestone(ap, usage("k", 100_000_000))
    expect(tk[0].message).toBe("Project reached 100M tokens")
    expect(tk[0].variant).toBe("warning")
  })
})
