import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/tokenmeter"
import {
  MILESTONE_KV_KEY,
  resetMilestoneState,
} from "../src/tokenmeter/milestone"
import {
  __clearSnapshotListenersForTest,
  setProjectSnapshot,
  subscribeProjectSnapshot,
} from "../src/tokenmeter/project"
import { loadSettings, SETTINGS_KV_KEY } from "../src/tokenmeter/settings"
import type { ProjectUsage } from "../src/tokenmeter/types"

// Direct subscription harness — proves the wired lifecycle, not just the pure detector.
// On unmodified main this suite would fail: the `createEffect(() => projectSnapshot())`
// never re-ran because `solid-js` resolves to `dist/server.js` in Node/Bun where
// `createEffect`/`createSignal` are no-ops, so `handleProjectMilestone` was never
// called after the initial null and no toast ever fired. The subscription added in
// this fix is notified directly from `setProjectSnapshot`, so it fires regardless
// of the Solid build.

type ToastCall = {
  title?: string
  message: string
  variant?: string
  duration?: number
}

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

function makeFakeKv(initial: Record<string, unknown> = {}, ready = true) {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    store,
    kv: {
      ready,
      get: <V>(k: string, f?: V) =>
        store.has(k) ? (store.get(k) as V) : (f as V),
      set: (k: string, v: unknown) => void store.set(k, v),
    },
  }
}

function makePluginApi(
  fakeKv: ReturnType<typeof makeFakeKv>,
  toasts: ToastCall[],
) {
  const stateDir = mkdtempSync(join(tmpdir(), "tokenmeter-wiring-"))
  const durableDir = mkdtempSync(join(tmpdir(), "tokenmeter-wiring-durable-"))
  const prevDurable = process.env.TOKENMETER_DURABLE_DIR
  process.env.TOKENMETER_DURABLE_DIR = durableDir
  const handlers = new Map<string, (e: unknown) => void>()
  const disposes: Array<() => void> = []
  return {
    stateDir,
    durableDir,
    prevDurable,
    toasts,
    api: {
      kv: fakeKv.kv,
      ui: {
        toast: (input: ToastCall) => void toasts.push(input),
        dialog: { replace: () => {}, clear: () => {} },
        DialogSelect: () => null,
        Prompt: () => null,
      },
      state: {
        path: { directory: "/tmp", state: stateDir },
        session: { messages: () => [], status: () => undefined },
      },
      client: {
        project: { current: async () => ({ data: { id: "proj-wiring" } }) },
        session: {
          list: async () => ({ data: [] }),
          messages: async () => ({ data: [] }),
          children: async () => ({ data: [] }),
          get: async () => ({ data: undefined }),
        },
      },
      event: {
        on: (type: string, handler: (e: unknown) => void) => {
          handlers.set(type, handler)
          return () => void handlers.delete(type)
        },
      },
      keymap: {
        registerLayer: () => () => {},
      },
      lifecycle: {
        onDispose: (fn: () => void) => {
          disposes.push(fn)
          return () => {}
        },
        signal: new AbortController().signal,
      },
      route: { current: { name: "home", params: {} } },
      theme: { current: {} as never },
      renderer: {} as never,
      slots: { register: () => "" },
      tuiConfig: {} as never,
      keys: {} as never,
      mode: {} as never,
      app: {} as never,
      attention: {} as never,
    } as unknown as Parameters<typeof plugin.tui>[0],
    disposes,
    handlers,
    dispose: () => {
      for (const fn of disposes)
        try {
          fn()
        } catch {}
      rmSync(stateDir, { recursive: true, force: true })
      rmSync(durableDir, { recursive: true, force: true })
      if (prevDurable === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = prevDurable
    },
  }
}

afterEach(() => {
  resetMilestoneState()
  setProjectSnapshot(null)
  __clearSnapshotListenersForTest()
})

describe("milestone wiring (subscription, not Solid effect)", () => {
  test("silent baseline, post-baseline 10M/100M crossing emits exactly one highest toast, duplicate and restart do not re-toast", async () => {
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const harness = makePluginApi(fake, toasts)

    // Load settings with milestones enabled (default)
    loadSettings({ kv: fake.kv } as never)

    // Mount the plugin — this registers the subscription that was broken on main
    await plugin.tui(harness.api, undefined as never, undefined as never)

    // Baseline: first-ever snapshot at 12M (crosses 10M) must be silent, not a burst
    setProjectSnapshot(usage("proj-wiring", 12_000_000))
    expect(toasts).toHaveLength(0)
    // Persisted marker advanced to 7 (10M) even though silent
    expect(
      (fake.store.get(MILESTONE_KV_KEY) as Record<string, number>)[
        "proj-wiring"
      ],
    ).toBe(7)

    // Duplicate refresh at same total must not re-toast (polling ~2 s)
    setProjectSnapshot(usage("proj-wiring", 12_000_000))
    expect(toasts).toHaveLength(0)

    // Polling jump to 150M crosses 100M (exp 8) — exactly one toast for highest crossing
    setProjectSnapshot(usage("proj-wiring", 150_000_000))
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toBe("Project reached 100M tokens")
    expect(toasts[0]!.variant).toBe("warning")

    // Same total again must not duplicate
    setProjectSnapshot(usage("proj-wiring", 150_000_000))
    expect(toasts).toHaveLength(1)

    // Simulate restart: new process, fresh seenProjects/memory but same persisted kv
    // Dispose first plugin so its listener does not steal the next toast
    harness.dispose()
    __clearSnapshotListenersForTest()
    const persisted = fake.store.get(MILESTONE_KV_KEY)
    const fake2 = makeFakeKv({ [MILESTONE_KV_KEY]: persisted })
    const toasts2: ToastCall[] = []
    const harness2 = makePluginApi(fake2, toasts2)
    loadSettings({ kv: fake2.kv } as never)
    resetMilestoneState()
    setProjectSnapshot(null)
    await plugin.tui(harness2.api, undefined as never, undefined as never)

    // Restart with same total must not replay
    setProjectSnapshot(usage("proj-wiring", 150_000_000))
    expect(toasts2).toHaveLength(0)

    // Next higher threshold after restart must still fire exactly once (1B)
    setProjectSnapshot(usage("proj-wiring", 2_000_000_000))
    expect(toasts2).toHaveLength(1)
    expect(toasts2[0]!.message).toBe("Project reached 1B tokens")

    harness2.dispose()
  })

  test("subscription fires even though Solid createEffect is a server no-op", async () => {
    // This test would fail on unmodified main where the milestone watcher was
    // `createEffect(() => { const snap = projectSnapshot(); ... })`.
    // In Node/Bun `solid-js` resolves to `dist/server.js` where `createEffect`
    // is `() => {}` and `createSignal` is a non-tracking stub, so the effect
    // never ran and no toast was ever produced. The subscription fixes that.
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const harness = makePluginApi(fake, toasts)
    loadSettings({ kv: fake.kv } as never)
    await plugin.tui(harness.api, undefined as never, undefined as never)

    // Directly use the subscription primitive to prove it notifies
    let notified = 0
    const dispose = subscribeProjectSnapshot(() => notified++)
    setProjectSnapshot(usage("proj-direct", 500_000))
    expect(notified).toBe(1)
    dispose()
    setProjectSnapshot(usage("proj-direct", 600_000))
    expect(notified).toBe(1)

    // Also prove that the milestone subscription (via plugin) fires
    setProjectSnapshot(usage("proj-wiring-2", 12_000_000)) // baseline silent
    expect(toasts).toHaveLength(0)
    setProjectSnapshot(usage("proj-wiring-2", 150_000_000)) // should toast 100M
    expect(toasts).toHaveLength(1)

    harness.dispose()
  })

  test("disabled milestones still advances marker but defers toast until re-enabled", async () => {
    const fake = makeFakeKv()
    const toasts: ToastCall[] = []
    const harness = makePluginApi(fake, toasts)
    // Start with milestones disabled
    fake.store.set(SETTINGS_KV_KEY, { milestones: false })
    loadSettings({ kv: fake.kv } as never)
    await plugin.tui(harness.api, undefined as never, undefined as never)

    setProjectSnapshot(usage("proj-disabled", 1_200_000)) // baseline first ever, silent
    expect(toasts).toHaveLength(0)
    // Second project at 1.2M would normally toast, but disabled must not
    setProjectSnapshot(usage("proj-disabled-2", 500_000))
    setProjectSnapshot(usage("proj-disabled-2", 1_200_000))
    expect(toasts).toHaveLength(0)
    // Marker must have advanced despite no toast
    expect(
      (fake.store.get(MILESTONE_KV_KEY) as Record<string, number>)[
        "proj-disabled-2"
      ],
    ).toBe(6)

    // Re-enable and cross next threshold — should toast exactly once
    fake.store.set(SETTINGS_KV_KEY, { milestones: true })
    loadSettings({ kv: fake.kv } as never)
    setProjectSnapshot(usage("proj-disabled-2", 12_000_000))
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.message).toContain("10M")

    harness.dispose()
  })
})
