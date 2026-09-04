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
  const durableDir = mkdtempSync(join(tmpdir(), "tokenmeter-scroll-durable-"))
  const prevDurable = process.env.TOKENMETER_DURABLE_DIR
  process.env.TOKENMETER_DURABLE_DIR = durableDir
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
      rmSync(durableDir, { recursive: true, force: true })
      if (prevDurable === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = prevDurable
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
async function mountGroups(
  rootID: string,
  agents: string[],
  sV1: Record<string, unknown>,
) {
  purgeTreeCache()
  const state = groupState(
    rootID,
    agents.map((agent, i) => ({
      id: `${rootID}_${i}`,
      agent,
      input: 4000,
      output: 200,
    })),
  )
  const { slot, dispose } = await mount(state, sV1)
  const setup = await testRender(
    () => slot({ theme: THEME }, { session_id: rootID }) as never,
    { width: 60, height: 20 },
  )
  await waitFor(() => snapshot()?.rootID === rootID)
  await waitFor(() => (snapshot()?.groups.length ?? 0) === agents.length)
  await waitFrame(setup, (f) => f.includes("↳ alpha"))
  return { setup, dispose }
}
describe("Subagents scroll navigation", () => {
  test("three collapsed agents fit the 6-row viewport with no overflow", async () => {
    const rootID = "ses_scroll_three"
    const { setup, dispose } = await mountGroups(
      rootID,
      ["alpha", "beta", "gamma"],
      { numbers: "compact", cache: "combined" },
    )
    const box = must(findBox(setup))
    expect(box.viewport.height).toBe(6)
    expect(box.scrollHeight).toBe(6)
    expect(box.height).toBe(6)
    expect(box.verticalScrollBar.visible).toBe(false)
    const frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ alpha (1 task) ${GLYPH.expand}`)
    expect(frame).toContain(`↳ beta (1 task) ${GLYPH.expand}`)
    expect(frame).toContain(`↳ gamma (1 task) ${GLYPH.expand}`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("fourth collapsed agent overflows; wheel snaps by agent boundary, clamped", async () => {
    const rootID = "ses_scroll_four"
    const { setup, dispose } = await mountGroups(
      rootID,
      ["alpha", "beta", "delta", "gamma"],
      { numbers: "compact", cache: "combined" },
    )
    const box = must(findBox(setup))
    expect(box.viewport.height).toBe(6)
    expect(box.scrollHeight).toBe(8)
    expect(box.verticalScrollBar.visible).toBe(true)
    expect(box.scrollTop).toBe(0)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    let frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ beta (1 task) ${GLYPH.expand}`)
    expect(frame).not.toContain("↳ alpha")
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ alpha (1 task) ${GLYPH.expand}`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("compact expanded agent: wheel steps over its 4 rows, symmetric", async () => {
    const rootID = "ses_scroll_compact"
    const { setup, dispose } = await mountGroups(
      rootID,
      ["alpha", "beta", "gamma"],
      { numbers: "compact", cache: "combined" },
    )
    await clickAgent(setup, setup.captureCharFrame(), "beta")
    await waitFrame(setup, (f) =>
      f.includes(`↳ beta (1 task) ${GLYPH.collapse}`),
    )
    const box = must(findBox(setup))
    // 2 + 4 + 2 rows: boundaries 0, 2, 6; viewport 6 clamps max to 2.
    expect(box.scrollHeight).toBe(8)
    expect(box.viewport.height).toBe(6)
    box.scrollTo(0)
    await loop(setup.renderer)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    let frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ beta (1 task) ${GLYPH.collapse}`)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ alpha (1 task) ${GLYPH.expand}`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("precise expanded agent: wheel steps over its 6 rows, symmetric", async () => {
    const rootID = "ses_scroll_precise"
    const { setup, dispose } = await mountGroups(rootID, ["alpha", "beta"], {
      numbers: "precise",
      cache: "combined",
    })
    await clickAgent(setup, setup.captureCharFrame(), "alpha")
    await waitFrame(setup, (f) =>
      f.includes(`↳ alpha (1 task) ${GLYPH.collapse}`),
    )
    const box = must(findBox(setup))
    // 6 + 2 rows: boundaries 0, 6; viewport 6 clamps max to 2.
    expect(box.scrollHeight).toBe(8)
    expect(box.viewport.height).toBe(6)
    let frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ alpha (1 task) ${GLYPH.collapse}`)
    expect(frame).not.toContain("↳ beta")
    box.scrollTo(0)
    await loop(setup.renderer)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ beta (1 task) ${GLYPH.expand}`)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    wheel(box, "up")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(0)
    expect(box.scrollTop).toBeLessThanOrEqual(
      box.scrollHeight - box.viewport.height,
    )
    disposeReconcile()
    dispose()
  }, 20000)

  test("expanding the edge agent keeps its header visible; detail opens downward", async () => {
    const rootID = "ses_scroll_edge"
    const { setup, dispose } = await mountGroups(
      rootID,
      ["alpha", "beta", "delta", "gamma"],
      { numbers: "compact", cache: "combined" },
    )
    const box = must(findBox(setup))
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    await clickAgent(setup, setup.captureCharFrame(), "gamma")
    await waitFrame(setup, (f) =>
      f.includes(`↳ gamma (1 task) ${GLYPH.collapse}`),
    )
    // The header row stays put; the detail grows below the fold.
    expect(box.scrollTop).toBe(2)
    let frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ gamma (1 task) ${GLYPH.collapse}`)
    // One gesture down reaches the open detail: boundaries 0, 2, 4, 6.
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(4)
    frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ gamma (1 task) ${GLYPH.collapse}`)
    expect(frame).toContain("4K tokens")
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(4)
    disposeReconcile()
    dispose()
  }, 20000)

  test("collapsing the bottom agent clamps back without blank jump", async () => {
    const rootID = "ses_scroll_clamp"
    const { setup, dispose } = await mountGroups(
      rootID,
      ["alpha", "beta", "delta", "gamma"],
      { numbers: "compact", cache: "combined" },
    )
    const box = must(findBox(setup))
    // Gamma sits below the fold at top 0; one gesture down brings its
    // header into view so it can be opened.
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(2)
    await clickAgent(setup, setup.captureCharFrame(), "gamma")
    await waitFrame(setup, (f) =>
      f.includes(`↳ gamma (1 task) ${GLYPH.collapse}`),
    )
    expect(box.scrollHeight).toBe(10)
    wheel(box, "down")
    await loop(setup.renderer)
    expect(box.scrollTop).toBe(4)
    await clickAgent(setup, setup.captureCharFrame(), "gamma")
    await waitFrame(setup, (f) =>
      f.includes(`↳ gamma (1 task) ${GLYPH.expand}`),
    )
    // Total shrinks 10 -> 8 (max 4 -> 2): the stale offset clamps, no blank
    // rows, and the collapsed header stays visible.
    expect(box.scrollTop).toBe(2)
    const frame = setup.captureCharFrame()
    expect(frame).toContain(`↳ beta (1 task) ${GLYPH.expand}`)
    expect(frame).toContain(`↳ gamma (1 task) ${GLYPH.expand}`)
    disposeReconcile()
    dispose()
  }, 20000)
})
