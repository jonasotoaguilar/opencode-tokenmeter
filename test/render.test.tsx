/**
 * Render-level regression harness for the TokenMeter usage sidebar.
 *
 * Mounts the REAL UsagePanel exactly once in the @opentui headless test
 * renderer (via the entry's actual sidebar_content slot), then drives the
 * REAL event wiring and asserts the rendered character frame changes WITHOUT
 * remounting. Store-only tests cannot catch the stale-map refresh bug this
 * guards: the panel must repaint when usage completes.
 *
 * The first test is the first-open regression: the slot mounts with an
 * EMPTY session (no usage), the panel stays on the placeholder, then
 * simulated session-selection/tool activity (message.part.updated) and
 * async message arrival (message.updated) populate the SAME mounted panel —
 * no sidebar remount. The second test drives session switching through the
 * real route-reactive activation (api.route.current read inside the
 * plugin's Solid effect, backed by a signal in the harness). The third
 * proves tool/part activity refreshes an already-populated session. The
 * stale-mirror test separates a stale non-empty in-memory list from a fresh
 * client list and proves invalidation rehydrates the SAME mounted panel
 * from the authoritative client source. Project-section tests cover the
 * projectID crossing, the failure error line, the collapsed/expanded
 * Subagents row, the chevron position and the 3+ group scrollbox.
 */
/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import plugin from "../src/tokenmeter"
import { GLYPH } from "../src/tokenmeter/glyphs"
import {
  disposeProjectRefresh,
  projectError,
  projectLoading,
  projectSnapshot,
  setProjectError,
  setProjectLoading,
  setProjectSnapshot,
} from "../src/tokenmeter/project"
import {
  disposeReconcile,
  MAINTENANCE_DELAY,
  RECONCILE_DELAY,
} from "../src/tokenmeter/reconcile"
import { snapshot } from "../src/tokenmeter/store"
import { purgeTreeCache } from "../src/tokenmeter/tree"
import type {
  ProjectSessionLike,
  SessionInfo,
  UsageMessage,
} from "../src/tokenmeter/types"

const THEME = {
  current: {
    accent: RGBA.fromHex("#ffffff"),
    // Primary blue mirroring the tokyo-night-dev theme the plugin runs
    // under (blue #7aa2f7): the agent names, the robot icons and the agents
    // metric share theme().primary, distinct from the cyan info clock and
    // the near-white theme().text.
    primary: RGBA.fromHex("#7aa2f7"),
    textMuted: RGBA.fromHex("#a9b1d6"),
    text: RGBA.fromHex("#a8b4dc"),
    warning: RGBA.fromHex("#ffcc00"),
    success: RGBA.fromHex("#00ff88"),
    info: RGBA.fromHex("#00aaff"),
    error: RGBA.fromHex("#ff4500"),
  },
}

const msg = (
  id: string,
  sessionID: string,
  tokens: UsageMessage["tokens"],
  cost = 0,
): UsageMessage => ({
  id,
  sessionID,
  role: "assistant",
  tokens,
  cost,
})

type MutableApi = {
  /** In-memory TUI mirror: what api.state.session.messages reports. */
  sessions: Record<string, UsageMessage[]>
  /** Authoritative client list; defaults to the mirror when unset. */
  clientSessions?: Record<string, UsageMessage[]>
  children: Record<string, SessionInfo[]>
  metas: Record<string, SessionInfo>
}

type ProjectState = {
  /** Working project endpoint; `fail` rejects so the failure path is exercised. */
  fail?: boolean
  /** Working project endpoint; `delayMs` keeps the lookup pending so the loading placeholder is observable. */
  delayMs?: number
  current?: { id: string; worktree?: string }
  sessions?: ProjectSessionLike[]
}

async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("waitFor: timeout")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Frame poll that drives the headless renderer loop explicitly. The test
 * renderer's scheduler is idle between frames, so interval-driven updates
 * (the loading spinner) never surface through waitForFrame alone: each poll
 * runs one loop() pass, which repaints whatever changed since the last pass.
 */
async function waitForFrameDriven(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  timeout = 3000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    // The test renderer's loop is private in @opentui/core; its own test
    // harness bypasses it the same way (test-renderer.d.ts).
    // @ts-expect-error - test-only access to the private loop
    await setup.renderer.loop()
    const frame = setup.captureCharFrame()
    if (predicate(frame)) return frame
    await sleep(30)
  }
  throw new Error("waitForFrameDriven: timed out waiting for frame")
}

async function mountEntry(
  state: MutableApi,
  project: ProjectState = {},
  expanded = true,
) {
  const handlers = new Map<string, (event: unknown) => void>()
  const disposes: Array<() => void> = []
  const kv = new Map<string, unknown>([
    ["tokenmeter.sidebar.expanded", expanded],
  ])
  const [route, setRoute] = createSignal<{
    name: string
    params: Record<string, unknown>
  }>({
    name: "home",
    params: {},
  })
  let slot: ((ctx: unknown, props: unknown) => unknown) | undefined
  // Isolate the Project section: a previous test's debounced refresh must
  // never leak into this mount.
  setProjectSnapshot(null)
  setProjectLoading(false)
  setProjectError(null)
  disposeProjectRefresh()
  const api = {
    kv: {
      get: (key: string, fallback?: unknown) =>
        kv.has(key) ? kv.get(key) : fallback,
      set: (key: string, value: unknown) => void kv.set(key, value),
    },
    event: {
      on: (type: string, handler: (event: unknown) => void) => {
        handlers.set(type, handler)
        return () => void handlers.delete(type)
      },
    },
    lifecycle: {
      onDispose: (fn: () => void) => {
        disposes.push(fn)
        return () => void 0
      },
    },
    slots: {
      register: (registration: { slots: Record<string, unknown> }) => {
        slot = registration.slots.sidebar_content as typeof slot
      },
    },
    // Signal-backed so the plugin's route-reactive effect actually tracks
    // session changes, exactly like the host's route.data signal.
    route: {
      get current() {
        return route()
      },
    },
    state: {
      path: { directory: "/proj/dir" },
      session: {
        messages: (sessionID: string) => state.sessions[sessionID] ?? [],
        status: () => undefined,
      },
    },
    client: {
      project: {
        current: async () => {
          if (project.fail) throw new Error("project boom")
          if (project.delayMs !== undefined) await sleep(project.delayMs)
          return {
            data: project.current ?? { id: "proj_test", worktree: "/wt" },
          }
        },
      },
      session: {
        list: async () => ({ data: project.sessions ?? [] }),
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
  }
  await plugin.tui(api as never, undefined as never, undefined as never)
  const fire = (type: string, properties: Record<string, unknown>) =>
    handlers.get(type)?.({ type, properties })
  return {
    fire,
    slot: slot as NonNullable<typeof slot>,
    setRoute,
    dispose: () => {
      disposes.forEach((fn) => {
        fn()
      })
      disposeProjectRefresh()
    },
    state,
  }
}

describe("render-level live refresh", () => {
  test("REGRESSION: first open with an EMPTY session populates in place via part/message events, no remount", async () => {
    const rootID = "ses_first_open"
    const state: MutableApi = {
      sessions: { [rootID]: [] },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await setup.renderOnce()
    // The session is empty: the panel must show the placeholder, not a stale
    // or zeroed snapshot.
    expect(setup.captureCharFrame()).toContain("…")

    // Session selection + async arrival while the panel stays mounted: a
    // tool part lands, then the assistant message with real usage.
    fire("message.part.updated", {
      part: {
        type: "tool",
        sessionID: rootID,
        messageID: "m1",
        tool: "bash",
        state: { status: "completed" },
      },
    })
    state.sessions[rootID] = [
      msg("m1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
    ]
    fire("message.updated", { info: state.sessions[rootID][0] })
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 42000,
    )
    // The Project section also lands (default working fake project), so no
    // placeholder survives anywhere in the frame.
    await waitFor(() => projectSnapshot() !== null)
    await setup.waitForFrame(
      (frame) => frame.includes("42.0k") && !frame.includes("…"),
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("42.0k")
    expect(frame).toContain("Session")
    expect(frame).not.toContain("Sessions")
    expect(frame).not.toContain("…")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: session switch drives the route-reactive activation; a remounted panel binds the new session", async () => {
    const aID = "ses_switch_a"
    const bID = "ses_switch_b"
    const state: MutableApi = {
      sessions: {
        [aID]: [
          msg("a1", aID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [bID]: [
          msg("b1", bID, { input: 700000, output: 5000, total: 720000 }, 0.02),
        ],
      },
      children: {},
      metas: { [aID]: { id: aID, title: "A" }, [bID]: { id: bID, title: "B" } },
    }
    purgeTreeCache()
    const { slot, setRoute, dispose } = await mountEntry(state)
    setRoute({ name: "session", params: { sessionID: aID } })
    await waitFor(() => snapshot()?.rootID === aID)
    const setupA = await testRender(
      () => slot({ theme: THEME }, { session_id: aID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await setupA.waitForFrame((frame) => frame.includes("42.0k"))

    // Switching chats changes the route; the plugin's route effect must
    // reactivate the new root WITHOUT any event and without remounting the
    // panel instance that published the previous snapshot.
    setRoute({ name: "session", params: { sessionID: bID } })
    await waitFor(
      () => snapshot()?.rootID === bID && snapshot()?.totalTokens === 720000,
    )
    const setupB = await testRender(
      () => slot({ theme: THEME }, { session_id: bID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await setupB.waitForFrame((frame) => frame.includes("720.0k"))
    disposeReconcile()
    dispose()
  }, 20000)

  test("tool/part activity (message.part.updated) refreshes the mounted panel after values grow", async () => {
    const rootID = "ses_tool_refresh"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    // The session grows while open: a patch tool completes and a new message
    // with higher context lands. The part event must invalidate and rehydrate
    // so the ALREADY-MOUNTED panel repaints with the new totals.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("message.part.updated", {
      part: {
        type: "tool",
        sessionID: rootID,
        messageID: "r2",
        tool: "patch",
        state: { status: "completed" },
      },
    })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: first mount populates without events, then repaints after session.idle without remount", async () => {
    const rootID = "ses_live"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    // NO event is fired: the mount-time activation must reconcile and
    // populate the panel on its own. The placeholder "…" must be gone.
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 42000,
    )
    await waitFor(() => projectSnapshot() !== null)
    await setup.renderOnce()
    const before = setup.captureCharFrame()
    expect(before).toContain("42.0k")
    expect(before).not.toContain("…")

    // The final message.updated is MISSED (simulated): only the current
    // messages now carry the completed totals. The idle event must invalidate
    // and rehydrate so the ALREADY-MOUNTED panel repaints.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.idle", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: stale non-empty in-memory mirror must not win over the fresh client list after invalidation", async () => {
    const rootID = "ses_stale_mirror"
    const stale = [
      msg("s1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
    ]
    const fresh = [
      msg("s1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("s2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    const state: MutableApi = {
      // The in-memory mirror and the client agree at first, so the mount
      // populates normally.
      sessions: { [rootID]: stale },
      clientSessions: { [rootID]: stale },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 42000,
    )
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    // The session updates while open, but the TUI's in-memory mirror LAGS:
    // it still holds the old one-message list while the client is fresh.
    // The real update path fires — message.updated upserts the new usage,
    // then a tool part invalidates the session. The next reconcile must
    // bypass the stale mirror and replace the map from the client so the
    // SAME mounted panel repaints with the new total, no remount.
    state.clientSessions![rootID] = fresh
    fire("message.updated", { info: fresh[1] })
    fire("message.part.updated", {
      part: {
        type: "tool",
        sessionID: rootID,
        messageID: "s2",
        tool: "bash",
        state: { status: "completed" },
      },
    })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: delayed delegation recovers via tree maintenance when session.created lacks parentID", async () => {
    const rootID = "ses_delayed_delegation"
    const childID = "ses_delayed_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [childID]: [],
      },
      // First discovery sees NO children: discoverTree caches the empty list.
      children: {},
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    // The child is created while still invisible to client.session.children,
    // and the event carries NO parentID: the whole tree cache is purged, but
    // the first debounced reconcile re-caches the still-empty child list.
    fire("session.created", { info: { id: childID, agent: "sdd-apply" } })
    await sleep(RECONCILE_DELAY + 100)

    // The child becomes visible and its usage arrives — ONLY a message event
    // fires, no tree invalidation. The cached empty child list still hides
    // the delegation: usage is stored, but the snapshot cannot sum a child
    // discoverTree never returns, so the mounted panel must stay unchanged.
    state.children[rootID] = [{ id: childID, agent: "sdd-apply" }]
    state.sessions[childID] = [
      msg("c1", childID, { input: 10000, output: 500 }, 0.005),
    ]
    fire("message.updated", { info: state.sessions[childID][0] })
    await sleep(RECONCILE_DELAY + 100)
    expect(snapshot()!.delegations).toBe(0)
    expect(snapshot()?.totalTokens).toBe(42000)
    const stuck = setup.captureCharFrame()
    expect(stuck).toContain("42.0k")
    expect(stuck).not.toContain("52.5k")
    expect(stuck).not.toContain("↳")

    // The 2s maintenance tick purges the tree cache and re-discovers the
    // child: the SAME mounted panel now sums child tokens and shows one
    // delegation — no remount, no further event needed.
    await waitFor(
      () =>
        snapshot()!.delegations === 1 &&
        snapshot()?.totalTokens === 42000 + 10500,
      6000,
    )
    await setup.waitForFrame((frame) => frame.includes("52.5k"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("52.5k")
    expect(frame).toContain(GLYPH.tasks + "  1")
    expect(frame).toContain("↳")

    // Cleanup is exercised: disposal clears the maintenance timer, so the
    // snapshot object stays put across another maintenance window.
    disposeReconcile()
    const settled = snapshot()
    await sleep(MAINTENANCE_DELAY + 200)
    expect(snapshot()).toBe(settled)
    dispose()
  }, 20000)

  test("REGRESSION: expanded groups render exactly three rows — indented name + task count, indented context + thinking + cost, indented three-value breakdown", async () => {
    const rootID = "ses_groups_render"
    const childID = "ses_child_render"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 5000, output: 500, total: 6000 }, 0.01),
        ],
        [childID]: [msg("c1", childID, { input: 10000, output: 500 }, 0.005)],
      },
      children: {
        [rootID]: [
          {
            id: childID,
            agent: "sdd-apply",
            title: "fix (@sdd-apply subagent)",
          },
        ],
      },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME, width: 52 }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    fire("session.idle", { sessionID: rootID })
    await waitFor(() => snapshot()!.groups.length === 1)
    await setup.waitForFrame((frame) => frame.includes("↳"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Session")
    expect(frame).not.toContain("Sessions")
    // The expanded dropdown keeps the Subagents row and the agents/task
    // metrics row; per-agent task counts live on group row 1.
    expect(frame).toContain("Subagents")
    // Row 1: indented tree marker + blue robot + two spaces + agent name + green task count.
    expect(frame).toContain(
      "  ↳ " + GLYPH.robot + "  sdd-apply · " + GLYPH.tasks + "  1 task",
    )
    // Row 2: four-space indent + info context + accent thinking + error cost.
    expect(frame).toContain(
      "    " +
        GLYPH.hourglass +
        " 10.5k · " +
        GLYPH.reasoning +
        "  0 · " +
        GLYPH.fire +
        " $0.01",
    )
    // Row 3: four-space indent + the three-value breakdown (output real = output + reasoning).
    expect(frame).toContain(
      "    " +
        GLYPH.up +
        " 10k · " +
        GLYPH.down +
        " 500 · " +
        GLYPH.cache +
        "  0",
    )
    // Session rows: headline context · thinking · cost; three-value breakdown.
    expect(frame).toContain(
      GLYPH.hourglass +
        " 16.5k · " +
        GLYPH.reasoning +
        "  0 · " +
        GLYPH.fire +
        " $0.02",
    )
    expect(frame).toContain(
      GLYPH.up + " 15k · " + GLYPH.down + " 1k · " + GLYPH.cache + "  0",
    )
    // Exactly three visual rows per group, in order: row 1 (robot + name +
    // tasks), row 2 (context + thinking + cost), row 3 (the three metrics).
    const lines = frame
      .split(/[\r\n]+/)
      .filter((line) => line.trim().length > 0)
    const idx = lines.findIndex((line) => line.includes("↳"))
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(lines[idx].trimEnd()).toBe(
      "  ↳ " + GLYPH.robot + "  sdd-apply · " + GLYPH.tasks + "  1 task",
    )
    expect(lines[idx + 1].trimEnd()).toBe(
      "    " +
        GLYPH.hourglass +
        " 10.5k · " +
        GLYPH.reasoning +
        "  0 · " +
        GLYPH.fire +
        " $0.01",
    )
    expect(lines[idx + 2].trimEnd()).toBe(
      "    " +
        GLYPH.up +
        " 10k · " +
        GLYPH.down +
        " 500 · " +
        GLYPH.cache +
        "  0",
    )
    expect(lines.length).toBe(idx + 3)
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("Project section (projectID crossing, placeholder, collapse/expand, scrollbox)", () => {
  test("Project sums the project's sessions across directories/worktrees by projectID and renders before Session", async () => {
    const rootID = "ses_proj_cross"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 5000, output: 500, total: 6000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    const project: ProjectState = {
      current: { id: "proj_x", worktree: "/wt" },
      sessions: [
        // Two sessions of the project from different directories/worktrees.
        {
          id: "ps1",
          projectID: "proj_x",
          cost: 0.01,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          },
        },
        {
          id: "ps2",
          projectID: "proj_x",
          cost: 0.02,
          tokens: { input: 2000, output: 700, reasoning: 300 },
        },
        // A session of another project must be excluded.
        {
          id: "ps3",
          projectID: "proj_other",
          cost: 99,
          tokens: { input: 999999, output: 999999, reasoning: 999999 },
        },
      ],
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state, project)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => projectSnapshot()?.sessions === 2)
    await waitFor(() => snapshot()?.rootID === rootID)
    await setup.waitForFrame((frame) => frame.includes("4.7k"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Project")
    expect(frame.indexOf("Project")).toBeLessThan(frame.indexOf("Session"))
    // Project headline: context (input + raw output + raw reasoning per
    // session, cache excluded) · thinking · cost.
    expect(frame).toContain(
      GLYPH.hourglass +
        " 4.7k · " +
        GLYPH.reasoning +
        "  500 · " +
        GLYPH.fire +
        " $0.03",
    )
    // Project breakdown: input · output real · cache.
    expect(frame).toContain(
      GLYPH.up + " 3k · " + GLYPH.down + " 2k · " + GLYPH.cache + "  150",
    )
    disposeReconcile()
    dispose()
  }, 20000)

  test("Project lookup failure shows a visible error while Session keeps working", async () => {
    const rootID = "ses_proj_fail"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state, { fail: true })
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))
    // Give the debounced (300ms) failed project refresh time to run, then
    // drive the repaint: the section must surface a visible error line in
    // theme().error with ONLY the stable message — the `…` placeholder is
    // gone, and no raw runtime detail ("project boom", "Error:", "undefined
    // is not an object") may leak into the frame.
    await sleep(RECONCILE_DELAY + 200)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Unable to load project data"),
    )
    const frame = setup.captureCharFrame()
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
    expect(frame).toContain("Project")
    expect(frame).toContain("Unable to load project data")
    expect(frame).not.toContain("Error:")
    expect(frame).not.toContain("project boom")
    expect(frame).not.toContain("undefined is not an object")
    expect(frame).not.toContain("…")
    expect(frame).toContain("Session")
    expect(frame).toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: session.deleted passes the projectIDHint — a failing project.current() right after the delete recovers Project from the ledger in the frame", async () => {
    const rootID = "ses_proj_delete"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 5000, output: 500, total: 6000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    const project: ProjectState = {
      current: { id: "proj_x", worktree: "/wt" },
      sessions: [
        {
          id: "ps1",
          projectID: "proj_x",
          cost: 0.01,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          },
        },
        {
          id: "ps2",
          projectID: "proj_x",
          cost: 0.02,
          tokens: { input: 2000, output: 700, reasoning: 300 },
        },
      ],
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state, project)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    // First load persists the ledger from the live sessions: both sessions
    // of proj_x, 4.7k context total.
    await waitFor(() => projectSnapshot()?.sessions === 2)
    await setup.waitForFrame((frame) => frame.includes("4.7k"))
    // The delete lands while project.current() starts failing (the transient
    // context gap right after a delete). The delete handler must pass
    // projectID "proj_x" to the refresh, which recovers from the ledger.
    project.fail = true
    fire("session.deleted", { info: { id: "ps1", projectID: "proj_x" } })
    await sleep(RECONCILE_DELAY + 200)
    // Same total as before the delete (ps1 tombstone + ps2 live), NO error:
    // the hint reached the refresh and the ledger powered the recovery.
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4700)
    expect(projectError()).toBeNull()
    await waitForFrameDriven(setup, (frame) => frame.includes("4.7k"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("4.7k")
    expect(frame).not.toContain("Unable to load project data")
    disposeReconcile()
    dispose()
  }, 20000)

  test("collapsed shows ONLY the Subagents toggle row; expanded adds the agents/task metrics row above the groups", async () => {
    const rootID = "ses_collapse_row"
    const childID = "ses_collapse_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 5000, output: 500, total: 6000 }, 0.01),
        ],
        [childID]: [msg("c1", childID, { input: 10000, output: 500 }, 0.005)],
      },
      children: { [rootID]: [{ id: childID, agent: "sdd-apply" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    }
    purgeTreeCache()
    const collapsed = await mountEntry(state, {}, false)
    const setupCollapsed = await testRender(
      () => collapsed.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()!.delegations === 1,
    )
    await setupCollapsed.waitForFrame((frame) => frame.includes("Subagents"))
    const collapsedFrame = setupCollapsed.captureCharFrame()
    // Clean title: no leading gap (flush left like Project/Session), no
    // chevron, and the chevron lives after Subagents instead.
    expect(collapsedFrame).toContain("TokenMeter 1.0.0")
    expect(collapsedFrame).not.toContain(GLYPH.expand + " TokenMeter")
    // Minimized shows only the Subagents row with the chevron right after
    // the label (one visible space); no robot/count/task metrics, no group rows.
    expect(collapsedFrame).toContain("Subagents " + GLYPH.expand)
    expect(collapsedFrame).not.toContain(GLYPH.robot)
    expect(collapsedFrame).not.toContain(GLYPH.tasks)
    expect(collapsedFrame).not.toContain("task")
    expect(collapsedFrame).not.toContain("↳")
    disposeReconcile()
    collapsed.dispose()

    purgeTreeCache()
    const expanded = await mountEntry(state, {}, true)
    const setupExpanded = await testRender(
      () => expanded.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()!.delegations === 1,
    )
    await setupExpanded.waitForFrame((frame) => frame.includes("↳"))
    const expandedFrame = setupExpanded.captureCharFrame()
    expect(expandedFrame).not.toContain(GLYPH.collapse + " TokenMeter")
    // The Subagents row is kept, with the collapse chevron right after it.
    expect(expandedFrame).toContain("Subagents " + GLYPH.collapse)
    // The metrics row renders the lowercase agents counter and the global
    // task count; the group rows follow below.
    expect(expandedFrame).toContain(
      GLYPH.robot + "  1 agents · " + GLYPH.tasks + "  1 task",
    )
    expect(expandedFrame).toContain("↳")
    expect(expandedFrame).toContain(GLYPH.tasks + "  1 task")
    disposeReconcile()
    expanded.dispose()
  }, 20000)

  test("with 3+ groups the panel wraps the groups in a scrollbox capped at 2 groups; fewer groups render inline", async () => {
    const rootID = "ses_scroll"
    const c1 = "ses_scroll_1"
    const c2 = "ses_scroll_2"
    const c3 = "ses_scroll_3"
    const makeState = (): MutableApi => ({
      sessions: {
        [rootID]: [msg("r1", rootID, { input: 1000, output: 100 }, 0.001)],
        [c1]: [msg("a1", c1, { input: 4000, output: 200 })],
        [c2]: [msg("b1", c2, { input: 6000, output: 300 })],
        [c3]: [msg("d1", c3, { input: 10000, output: 400 })],
      },
      children: {
        [rootID]: [
          { id: c1, agent: "general" },
          { id: c2, agent: "explore" },
          { id: c3, agent: "build" },
        ],
      },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [c1]: { id: c1, agent: "general" },
        [c2]: { id: c2, agent: "explore" },
        [c3]: { id: c3, agent: "build" },
      },
    })
    purgeTreeCache()
    const three = await mountEntry(makeState())
    const setupThree = await testRender(
      () => three.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()!.groups.length === 3,
    )
    await setupThree.waitForFrame((frame) => frame.includes("↳"))
    const threeFrame = setupThree.captureCharFrame()
    // The scrollbox shows at most two groups (six rows): the two largest
    // (build, then explore by context) are visible; the third is clipped.
    expect(threeFrame).toContain("build")
    expect(threeFrame).toContain("explore")
    expect(threeFrame).not.toContain("general")
    disposeReconcile()
    three.dispose()

    purgeTreeCache()
    const two = await mountEntry({
      sessions: {
        [rootID]: [msg("r1", rootID, { input: 1000, output: 100 }, 0.001)],
        [c1]: [msg("a1", c1, { input: 4000, output: 200 })],
        [c2]: [msg("b1", c2, { input: 6000, output: 300 })],
      },
      children: {
        [rootID]: [
          { id: c1, agent: "general" },
          { id: c2, agent: "explore" },
        ],
      },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [c1]: { id: c1, agent: "general" },
        [c2]: { id: c2, agent: "explore" },
      },
    })
    const setupTwo = await testRender(
      () => two.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()!.groups.length === 2,
    )
    await setupTwo.waitForFrame((frame) => frame.includes("↳"))
    const twoFrame = setupTwo.captureCharFrame()
    // Fewer than 3 groups: no scrollbox, every group visible.
    expect(twoFrame).toContain("explore")
    expect(twoFrame).toContain("general")
    disposeReconcile()
    two.dispose()
  }, 20000)

  test("REGRESSION: with no snapshot while the project refresh runs, the panel shows the static `…` placeholder — no spinner frames ever render — then the data once it lands", async () => {
    const rootID = "ses_proj_loading"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    // The frame set the deleted spinner used to cycle (U+EB19 base plus the
    // Unicode rotation frames); none of them may ever render.
    const spinnerChars = ["\u{EB19}", "◴", "◷", "◶", "◵"]
    purgeTreeCache()
    // The project lookup is held open long enough to observe the loading
    // placeholder after the debounced refresh starts.
    const { slot, dispose } = await mountEntry(state, { delayMs: 600 })
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    // The Session section still populates while the Project lookup runs.
    await waitFor(
      () => snapshot()?.rootID === rootID && projectLoading() === true,
    )
    // While loading with no snapshot the placeholder is the static `…`.
    await waitForFrameDriven(setup, (frame) => frame.includes("…"))
    const loadingFrame = setup.captureCharFrame()
    expect(loadingFrame).toContain("…")
    for (const ch of spinnerChars) expect(loadingFrame).not.toContain(ch)
    // Once the lookup lands, the placeholder is replaced by the Project data
    // and no loading character is left anywhere in the frame.
    await waitForFrameDriven(
      setup,
      (frame) => !frame.includes("…") && frame.includes("42.0k"),
    )
    const settled = setup.captureCharFrame()
    for (const ch of spinnerChars) expect(settled).not.toContain(ch)
    expect(settled).toContain("Project")
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("entry event wiring (handlers exercised only by real host events)", () => {
  test("message.removed drops the removed message's usage from the mounted panel", async () => {
    const rootID = "ses_removed"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
          msg("r2", rootID, { input: 60000, output: 2000, total: 62000 }, 0.02),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.totalTokens === 62000)
    await setup.waitForFrame((frame) => frame.includes("62.0k"))

    // The r2 message disappears from the client; message.removed must
    // invalidate and remove the stored usage so the next reconcile
    // rehydrates WITHOUT it — a stale mirror would keep 62.0k forever.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
    ]
    fire("message.removed", { sessionID: rootID, messageID: "r2" })
    await waitFor(() => snapshot()?.totalTokens === 42000)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("42.0k")
    expect(after).not.toContain("62.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("session.status running keeps the mirror fast path; idle invalidates and rehydrates", async () => {
    const rootID = "ses_status"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.totalTokens === 42000)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    // The client grows, but a non-idle status must NOT invalidate: the next
    // reconcile keeps the cheap in-memory mirror (42.0k) instead of forcing
    // a client read — no rehydration, no zero flash.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.status", { sessionID: rootID, status: { type: "running" } })
    await sleep(50)
    expect(snapshot()?.totalTokens).toBe(42000)
    expect(setup.captureCharFrame()).toContain("42.0k")

    // The idle status invalidates: the mounted panel rehydrates from the
    // authoritative client and repaints with the new total.
    fire("session.status", { sessionID: rootID, status: { type: "idle" } })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("session.compacted invalidates and rehydrates the mounted panel", async () => {
    const rootID = "ses_compacted"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.totalTokens === 42000)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.compacted", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("session.error keeps the panel alive and refreshes even without a sessionID", async () => {
    const rootID = "ses_error"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.totalTokens === 42000)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    // With a sessionID the session is invalidated and rehydrated from the
    // client; the panel must never blank out on an error event.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.error", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    // Without a sessionID the handler still schedules a refresh and the
    // mounted panel keeps its data.
    fire("session.error", {})
    await sleep(50)
    expect(snapshot()?.totalTokens).toBe(720000)
    expect(setup.captureCharFrame()).toContain("720.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("message.part.removed invalidates and rehydrates the mounted panel", async () => {
    const rootID = "ses_part_removed"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.totalTokens === 42000)
    await setup.waitForFrame((frame) => frame.includes("42.0k"))

    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("message.part.removed", { sessionID: rootID, messageID: "r2" })
    await waitFor(() => snapshot()?.totalTokens === 720000)
    await setup.waitForFrame((frame) => frame.includes("720.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("720.0k")
    expect(after).not.toContain("42.0k")
    disposeReconcile()
    dispose()
  }, 20000)

  test("session.updated metadata reaches group identity on the next reconcile", async () => {
    const rootID = "ses_updated"
    const childID = "ses_updated_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 10000, output: 1000, total: 11000 }, 0.01),
        ],
      },
      children: { [rootID]: [{ id: childID, title: "bootstrap" }] },
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.groups.length === 1)
    await setup.waitForFrame((frame) => frame.includes("subagent"))
    expect(setup.captureCharFrame()).not.toContain("code-review")

    // The host refreshes the session metadata with the resolved agent label;
    // rememberSession must update the cached meta so the next reconcile
    // regroups the child under the new agent name.
    fire("session.updated", {
      info: { id: childID, title: "bootstrap", agent: "code-review" },
    })
    await waitFor(
      () => snapshot()?.groups.some((g) => g.name === "code-review") === true,
    )
    await setup.waitForFrame((frame) => frame.includes("code-review"))
    expect(setup.captureCharFrame()).not.toContain("subagent")
    disposeReconcile()
    dispose()
  }, 20000)

  test("project.updated and project.directories.updated refresh the Project section", async () => {
    const rootID = "ses_proj_events"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 5000, output: 500, total: 6000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    const project: ProjectState = {
      current: { id: "proj_ev", worktree: "/wt" },
      sessions: [
        {
          id: "pe1",
          projectID: "proj_ev",
          cost: 0.01,
          tokens: { input: 1000, output: 500, reasoning: 200 },
        },
      ],
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state, project)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => projectSnapshot()?.sessions === 1)
    await setup.waitForFrame((frame) => frame.includes("1.7k"))

    // The project's session list changes (a session of another worktree
    // joins); both project events must schedule a refresh so the section
    // repaints from the fresh client payload.
    project.sessions = [
      {
        id: "pe1",
        projectID: "proj_ev",
        cost: 0.01,
        tokens: { input: 1000, output: 500, reasoning: 200 },
      },
      {
        id: "pe2",
        projectID: "proj_ev",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ]
    fire("project.updated", {})
    await waitFor(() => projectSnapshot()?.sessions === 2)
    await setup.waitForFrame((frame) => frame.includes("4.7k"))

    project.sessions = [
      {
        id: "pe1",
        projectID: "proj_ev",
        cost: 0.01,
        tokens: { input: 1000, output: 500, reasoning: 200 },
      },
      {
        id: "pe2",
        projectID: "proj_ev",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
      {
        id: "pe3",
        projectID: "proj_ev",
        cost: 0.03,
        tokens: { input: 3000, output: 900, reasoning: 400 },
      },
    ]
    fire("project.directories.updated", {})
    await waitFor(() => projectSnapshot()?.sessions === 3)
    await setup.waitForFrame((frame) => frame.includes("9.0k"))
    const after = setup.captureCharFrame()
    expect(after).toContain("9.0k")
    disposeReconcile()
    dispose()
  }, 20000)
})
