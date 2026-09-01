/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import plugin from "../src/tokenmeter"
import { GLYPH } from "../src/tokenmeter/glyphs"
import {
  disposeProjectRefresh,
  setProjectError,
  setProjectLoading,
  setProjectSnapshot,
} from "../src/tokenmeter/project"
import { disposeReconcile } from "../src/tokenmeter/reconcile"
import { snapshot } from "../src/tokenmeter/store"
import { purgeTreeCache } from "../src/tokenmeter/tree"
import type { SessionInfo, UsageMessage } from "../src/tokenmeter/types"

function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("must")
  return v
}
function loop(r: unknown): Promise<void> | void {
  return (r as unknown as { loop(): Promise<void> | void }).loop()
}
const THEME = {
  current: {
    accent: RGBA.fromHex("#ff69b4"),
    primary: RGBA.fromHex("#7aa2f7"),
    textMuted: RGBA.fromHex("#a9b1d6"),
    text: RGBA.fromHex("#a8b4dc"),
    warning: RGBA.fromHex("#ffcc00"),
    success: RGBA.fromHex("#00ff88"),
    info: RGBA.fromHex("#00aaff"),
    error: RGBA.fromHex("#ff4500"),
    background: RGBA.fromHex("#1a1b26"),
  },
}
const msg = (
  id: string,
  sid: string,
  tokens: UsageMessage["tokens"],
  cost = 0,
): UsageMessage => ({ id, sessionID: sid, role: "assistant", tokens, cost })
type MutableApi = {
  sessions: Record<string, UsageMessage[]>
  clientSessions?: Record<string, UsageMessage[]>
  children: Record<string, SessionInfo[]>
  metas: Record<string, SessionInfo>
}
async function waitFor(c: () => boolean, t = 3000): Promise<void> {
  const s = Date.now()
  while (!c()) {
    if (Date.now() - s > t) throw new Error("waitFor timeout")
    await new Promise((r) => setTimeout(r, 5))
  }
}
async function waitFrame(
  s: Awaited<ReturnType<typeof testRender>>,
  p: (f: string) => boolean,
  t = 3000,
): Promise<string> {
  const st = Date.now()
  while (Date.now() - st < t) {
    await loop(s.renderer)
    const f = s.captureCharFrame()
    if (p(f)) return f
    await new Promise((r) => setTimeout(r, 30))
  }
  throw new Error("waitFrame timeout")
}
function findBox(s: Awaited<ReturnType<typeof testRender>>): BoxHandle | null {
  const w = (n: { getChildren?: () => unknown[] }): unknown => {
    const k = typeof n.getChildren === "function" ? n.getChildren() : []
    for (const c of k) {
      if (
        c !== null &&
        typeof c === "object" &&
        (c as { constructor?: { name?: string } }).constructor?.name ===
          "ScrollBoxRenderable"
      )
        return c
      const f = w(c as { getChildren?: () => unknown[] })
      if (f) return f
    }
    return null
  }
  return w(s.renderer.root) as BoxHandle | null
}
type BoxHandle = {
  getChildren: () => { constructor: { name: string } }[]
  scrollTop: number
  scrollHeight: number
  scrollTo: (n: number) => void
  viewport: { height: number }
  height: number
  verticalScrollBar: { visible: boolean }
  scrollAcceleration: { tick: (n?: number) => number; reset: () => void }
}
async function clickAgent(
  s: Awaited<ReturnType<typeof testRender>>,
  frame: string,
  name: string,
): Promise<void> {
  const ls = frame.split(/[\r\n]+/)
  const idx = ls.findIndex((l) => {
    const t = l.trim().replace(/█.*$/, "").trim()
    return (
      (t.startsWith(`↳ ${name} (`) && t.endsWith(GLYPH.expand)) ||
      (t.startsWith(`↳ ${name} (`) && t.endsWith(GLYPH.collapse))
    )
  })
  expect(idx).toBeGreaterThanOrEqual(0)
  const row = ls[idx]
  if (!row) throw new Error(name)
  const clean = row.replace(/█.*$/, "")
  const end = [...clean.trimEnd()].length - 1
  await s.mockMouse.click(end, idx)
}
function groupState(
  rootID: string,
  groups: Array<{ id: string; agent: string; input: number; output: number }>,
): MutableApi {
  return {
    sessions: {
      [rootID]: [msg("r1", rootID, { input: 2000, output: 100 }, 0.01)],
      ...Object.fromEntries(
        groups.map((g) => [
          g.id,
          [msg(`${g.id}_m`, g.id, { input: g.input, output: g.output }, 0.01)],
        ]),
      ),
    },
    children: { [rootID]: groups.map((g) => ({ id: g.id, agent: g.agent })) },
    metas: {
      [rootID]: { id: rootID, title: "Root" },
      ...Object.fromEntries(
        groups.map((g) => [g.id, { id: g.id, agent: g.agent }]),
      ),
    },
  }
}
async function mount(state: MutableApi, sV1?: Record<string, unknown>) {
  const disposes: Array<() => void> = []
  const kv = new Map<string, unknown>([["tokenmeter.sidebar.expanded", true]])
  if (sV1 !== undefined) kv.set("tokenmeter.settings.v1", sV1)
  let slot: ((c: unknown, p: unknown) => unknown) | undefined
  setProjectSnapshot(null)
  setProjectLoading(false)
  setProjectError(null)
  disposeProjectRefresh()
  const dir = mkdtempSync(join(tmpdir(), "tokenmeter-scroll-"))
  const api = {
    kv: {
      ready: true,
      get: <V = unknown>(k: string, fb?: V) =>
        (kv.has(k) ? (kv.get(k) as V) : fb) as V,
      set: (k: string, v: unknown) => void kv.set(k, v),
    },
    event: {
      on: (t: string, h: (e: unknown) => void) => {
        new Map().set(t, h)
        return (() => void 0) as unknown as () => void
      },
      onActual: new Map<string, (e: unknown) => void>(),
    },
    keymap: { registerLayer: () => () => {} },
    ui: {
      dialog: { replace: () => {}, clear: () => {} },
      DialogSelect: () => null as unknown as never,
      Prompt: () => null as unknown as never,
    },
    theme: { current: THEME.current },
    lifecycle: {
      onDispose: (fn: () => void) => {
        disposes.push(fn)
        return () => void 0
      },
    },
    slots: {
      register: (reg: { slots: Record<string, unknown> }) =>
        (slot = reg.slots.sidebar_content as typeof slot),
    },
    route: {
      get current() {
        return { name: "home", params: {} } as {
          name: string
          params: Record<string, unknown>
        }
      },
    },
    state: {
      path: { directory: "/proj/dir", state: dir },
      session: {
        messages: (sid: string) => state.sessions[sid] ?? [],
        status: () => undefined,
      },
    },
    client: {
      project: {
        current: async () => ({ data: { id: "proj_test", worktree: "/wt" } }),
      },
      session: {
        list: async () => ({ data: [] }),
        messages: async ({ sessionID }: { sessionID: string }) => ({
          data: ((state.clientSessions ?? state.sessions)[sessionID] ?? []).map(
            (info) => ({ info }),
          ),
        }),
        children: async ({ sessionID }: { sessionID: string }) => ({
          data: state.children[sessionID] ?? [],
        }),
        get: async ({ sessionID }: { sessionID: string }) => ({
          data: state.metas[sessionID],
        }),
      },
    },
  } as unknown as {
    kv: unknown
    event: { on: (t: string, h: (e: unknown) => void) => () => void }
    keymap: unknown
    ui: unknown
    theme: unknown
    lifecycle: unknown
    slots: unknown
    route: unknown
    state: unknown
    client: unknown
  } // Simplified event wiring: capture handlers manually
  const handlers = new Map<string, (e: unknown) => void>()
  ;(
    api as unknown as {
      event: { on: (t: string, h: (e: unknown) => void) => () => void }
    }
  ).event.on = (t: string, h: (e: unknown) => void) => {
    handlers.set(t, h)
    return () => {
      handlers.delete(t)
    }
  }
  // need to keep handlers for fire if needed (not used here)
  await plugin.tui(api as never, undefined as never, undefined as never)
  return {
    slot: slot as NonNullable<typeof slot>,
    dispose: () => {
      for (const fn of disposes) fn()
      disposeProjectRefresh()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
function wheel(h: BoxHandle, dir: "up" | "down") {
  ;(h as unknown as { onMouseEvent: (e: unknown) => void }).onMouseEvent({
    type: "scroll",
    x: 0,
    y: 0,
    scroll: { direction: dir, delta: 1 },
    modifiers: {},
  })
}
describe("Subagents scroll step #49", () => {
  test("wheel tick moves 2 rows per step, clamps, expanded details remain reachable", async () => {
    const rootID = "ses_scroll_49"
    purgeTreeCache()
    const state = groupState(rootID, [
      { id: "s1", agent: "alpha", input: 4000, output: 200 },
      { id: "s2", agent: "beta", input: 4000, output: 200 },
      { id: "s3", agent: "gamma", input: 4000, output: 200 },
    ])
    const { slot, dispose } = await mount(state, {
      numbers: "compact",
      cache: "combined",
    })
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => (snapshot()?.groups.length ?? 0) === 3)
    await waitFrame(setup, (f) => f.includes("↳ alpha"))
    const box = must(findBox(setup))
    expect(box.viewport.height).toBe(4)
    expect(box.scrollHeight).toBe(6)
    expect(box.height).toBe(4)
    expect(box.verticalScrollBar.visible).toBe(true)
    expect(box.scrollAcceleration.tick()).toBe(2)
    expect(box.scrollTop).toBe(0)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    await clickAgent(setup, setup.captureCharFrame(), "beta")
    await waitFrame(setup, (f) =>
      f.includes(`↳ beta (1 task) ${GLYPH.collapse}`),
    )
    const exp = must(findBox(setup))
    expect(exp.scrollHeight).toBe(8)
    expect(exp.viewport.height).toBe(4)
    expect(exp.verticalScrollBar.visible).toBe(true)
    expect(exp.scrollAcceleration.tick()).toBe(2)
    exp.scrollTo(0)
    await loop(setup.renderer)
    expect(exp.scrollTop).toBe(0)
    wheel(exp, "down")
    await loop(setup.renderer)
    expect(exp.scrollTop).toBe(2)
    wheel(exp, "down")
    await loop(setup.renderer)
    expect(exp.scrollTop).toBe(4)
    wheel(exp, "down")
    await loop(setup.renderer)
    expect(exp.scrollTop).toBe(4)
    exp.scrollTo(exp.scrollHeight)
    await waitFrame(setup, (f) => f.includes("4K tokens"))
    expect(setup.captureCharFrame()).toContain("4K tokens")
    disposeReconcile()
    dispose()
    purgeTreeCache()
    const stateP = groupState(`${rootID}_p`, [
      { id: "sp1", agent: "alpha", input: 4000, output: 200 },
      { id: "sp2", agent: "beta", input: 4000, output: 200 },
      { id: "sp3", agent: "gamma", input: 4000, output: 200 },
    ])
    const mountP = await mount(stateP, {
      numbers: "precise",
      cache: "combined",
    })
    const setupP = await testRender(
      () =>
        mountP.slot({ theme: THEME }, { session_id: `${rootID}_p` }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === `${rootID}_p`)
    await waitFor(() => (snapshot()?.groups.length ?? 0) === 3)
    await waitFrame(setupP, (f) => f.includes("↳ alpha"))
    await clickAgent(setupP, setupP.captureCharFrame(), "alpha")
    await waitFrame(setupP, (f) =>
      f.includes(`↳ alpha (1 task) ${GLYPH.collapse}`),
    )
    const precise = must(findBox(setupP))
    expect(precise.scrollHeight).toBe(10)
    expect(precise.viewport.height).toBe(4)
    expect(precise.scrollAcceleration.tick()).toBe(2)
    precise.scrollTo(0)
    await loop(setupP.renderer)
    wheel(precise, "down")
    await loop(setupP.renderer)
    expect(precise.scrollTop).toBe(2)
    wheel(precise, "down")
    await loop(setupP.renderer)
    expect(precise.scrollTop).toBe(4)
    wheel(precise, "down")
    await loop(setupP.renderer)
    expect(precise.scrollTop).toBe(6)
    wheel(precise, "down")
    await loop(setupP.renderer)
    expect(precise.scrollTop).toBe(6)
    expect(precise.scrollTop).toBeLessThanOrEqual(
      precise.scrollHeight - precise.viewport.height,
    )
    precise.scrollTo(precise.scrollHeight)
    await waitFrame(setupP, (f) => f.includes("gamma"))
    expect(setupP.captureCharFrame()).toContain("gamma")
    disposeReconcile()
    mountP.dispose()
  }, 20000)
})
