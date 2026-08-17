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
 * Subagents row, the chevron position and the real scrollbox holding ALL
 * agent groups.
 */
/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA, rgbToHex } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import plugin from "../src/tokenmeter"
import { GLYPH } from "../src/tokenmeter/glyphs"
import { UsagePanel } from "../src/tokenmeter/panel"
import { showSettingsDialog } from "../src/tokenmeter/panel/settings-dialog"
import { detailTone } from "../src/tokenmeter/panel/tone"
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
import {
  cycleFooter,
  cycleFooterMetric,
  cycleNumbers,
  cycleSubagents,
  SETTINGS_KV_KEY,
  SUBAGENTS_KV_KEY,
  settings,
  subagentsPref,
} from "../src/tokenmeter/settings"
import {
  TOGGLE_COMMAND_NAME,
  TOGGLE_SHORTCUT_KV_KEY,
  toggleShortcut,
} from "../src/tokenmeter/shortcut"
import {
  observedSessionUsage,
  snapshot,
  upsertMessageUsage,
  usageMap,
} from "../src/tokenmeter/store"
import { purgeTreeCache } from "../src/tokenmeter/tree"
import type {
  ProjectSessionLike,
  SessionInfo,
  UsageMessage,
} from "../src/tokenmeter/types"

const THEME = {
  current: {
    // Deliberately PINK accent: the main-text/muted metric tones must NOT
    // follow the theme accent, so the render tests prove the tone contract
    // is theme-independent (a theme that maps accent to pink must still
    // render white primary lines and dimmed secondary lines).
    accent: RGBA.fromHex("#ff69b4"),
    // Primary blue mirroring the tokyo-night-dev theme the plugin runs
    // under (blue #7aa2f7): reserved for the palette dialog accent —
    // agent names use theme().info and metric lines never use it, distinct
    // from the near-white theme().text (primary lines) and theme().textMuted
    // (which the detail tone is derived from).
    primary: RGBA.fromHex("#7aa2f7"),
    textMuted: RGBA.fromHex("#a9b1d6"),
    text: RGBA.fromHex("#a8b4dc"),
    warning: RGBA.fromHex("#ffcc00"),
    success: RGBA.fromHex("#00ff88"),
    info: RGBA.fromHex("#00aaff"),
    error: RGBA.fromHex("#ff4500"),
    // Active background of the tokyo-night-dev theme the plugin runs
    // under; the detail tone blends textMuted toward it (tone.ts).
    background: RGBA.fromHex("#1a1b26"),
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

/**
 * Clicks the disclosure chevron of a section header row (e.g. `▶ Project`)
 * at its rendered frame coordinates, driving the real `onMouseDown` handler
 * through the headless renderer's mock mouse. The chevron is the LEFTMOST
 * glyph of the row (column 0), so the click lands on the first cell.
 */
async function clickRowChevron(
  setup: Awaited<ReturnType<typeof testRender>>,
  frame: string,
  rowLabel: string,
): Promise<void> {
  const lines = frame.split(/[\r\n]+/)
  const idx = lines.findIndex((line) => {
    const trimmed = line.trimEnd()
    return (
      trimmed === `${GLYPH.expand} ${rowLabel}` ||
      trimmed === `${GLYPH.collapse} ${rowLabel}`
    )
  })
  expect(idx).toBeGreaterThanOrEqual(0)
  const row = lines[idx]
  if (row === undefined) {
    throw new Error(`clickRowChevron: row "${rowLabel}" not found in frame`)
  }
  await setup.mockMouse.click(0, idx)
}

/** Counts non-overlapping occurrences of `needle` in a rendered frame. */
function countOccurrences(frame: string, needle: string): number {
  return frame.split(needle).length - 1
}

/**
 * Clicks a compact agent row (`↳ <name> (<N> tasks) ▶` closed /
 * `↳ <name> (<N> tasks) ▼` open) at its end column, driving the real
 * `onMouseDown` detail toggle on the row. The header stays put while open —
 * only the trailing per-agent chevron flips — and the detail lines appear
 * below it. The end column counts CODE POINTS (the indent glyphs are single
 * codepoints, so UTF-16 length equals the rendered cell width here).
 */
async function clickAgentRow(
  setup: Awaited<ReturnType<typeof testRender>>,
  frame: string,
  name: string,
): Promise<void> {
  const lines = frame.split(/[\r\n]+/)
  const idx = lines.findIndex((line) => {
    // Agent rows carry the nested-list leading indent, so the marker match
    // must tolerate the leading padding; the TRAILING per-agent chevron may
    // read `▶` (closed) or `▼` (open).
    const trimmed = line.trim()
    return (
      (trimmed.startsWith(`↳ ${name} (`) && trimmed.endsWith(GLYPH.expand)) ||
      (trimmed.startsWith(`↳ ${name} (`) && trimmed.endsWith(GLYPH.collapse))
    )
  })
  expect(idx).toBeGreaterThanOrEqual(0)
  const row = lines[idx]
  if (row === undefined) {
    throw new Error(`clickAgentRow: agent "${name}" not found in frame`)
  }
  const endColumn = [...row.trimEnd()].length - 1
  await setup.mockMouse.click(endColumn, idx)
}

/**
 * Clicks the Subagents global row at its LEFTMOST cell — the disclosure
 * chevron (`▶ Subagents (…)` / `▼ Subagents`), driving the real
 * `onMouseDown` cycle-subagents handler through the mock mouse.
 */
async function clickSubagentsHeader(
  setup: Awaited<ReturnType<typeof testRender>>,
  frame: string,
): Promise<void> {
  const lines = frame.split(/[\r\n]+/)
  const idx = lines.findIndex((line) => {
    const trimmed = line.trim()
    return (
      trimmed.startsWith(`${GLYPH.expand} Subagents`) ||
      trimmed.startsWith(`${GLYPH.collapse} Subagents`)
    )
  })
  expect(idx).toBeGreaterThanOrEqual(0)
  await setup.mockMouse.click(0, idx)
}

/**
 * Clicks the master disclosure row's LEFTMOST cell — the `▶`/`▼` chevron
 * (`▶ TokenMeter` / `▼ TokenMeter`, always the first glyph) — driving the
 * real `onMouseDown` master toggle through the mock mouse.
 */
async function clickMasterChevron(
  setup: Awaited<ReturnType<typeof testRender>>,
  frame: string,
): Promise<void> {
  const lines = frame.split(/[\r\n]+/)
  const idx = lines.findIndex(
    (line) =>
      line.trim().startsWith(`${GLYPH.expand} TokenMeter`) ||
      line.trim().startsWith(`${GLYPH.collapse} TokenMeter`),
  )
  expect(idx).toBeGreaterThanOrEqual(0)
  await setup.mockMouse.click(0, idx)
}

/**
 * Clicks the master disclosure row's TITLE TEXT (column 3 — inside
 * `TokenMeter`, not the chevron at column 0 nor the right-side Settings
 * toggle) — the spec's "Chevron OR title-text click MUST toggle".
 */
async function clickMasterTitle(
  setup: Awaited<ReturnType<typeof testRender>>,
  frame: string,
): Promise<void> {
  const lines = frame.split(/[\r\n]+/)
  const idx = lines.findIndex((line) => line.includes("TokenMeter"))
  expect(idx).toBeGreaterThanOrEqual(0)
  await setup.mockMouse.click(3, idx)
}

/**
 * Finds the real `ScrollBoxRenderable` of the Subagents list in the
 * headless renderer tree (the only scrollbox the panel mounts), so tests
 * can assert its content and drive real scrolling.
 */
function findScrollbox(
  setup: Awaited<ReturnType<typeof testRender>>,
): ScrollBoxHandle | null {
  const walk = (node: { getChildren?: () => unknown[] }): unknown => {
    const kids =
      typeof node.getChildren === "function" ? node.getChildren() : []
    for (const kid of kids) {
      if (
        kid !== null &&
        typeof kid === "object" &&
        (kid as { constructor?: { name?: string } }).constructor?.name ===
          "ScrollBoxRenderable"
      )
        return kid
      const found = walk(kid as { getChildren?: () => unknown[] })
      if (found) return found
    }
    return null
  }
  return walk(setup.renderer.root) as ScrollBoxHandle | null
}

type ScrollBoxHandle = {
  getChildren: () => { constructor: { name: string } }[]
  scrollHeight: number
  scrollTo: (position: number) => void
}

/**
 * Host `api.ui.DialogSelect` stand-in (installed `TuiDialogSelectProps`):
 * renders the title + one row per option so frames are assertable, and
 * records the props so tests can drive the REAL `onSelect` wiring. The
 * production module builds the options from the live settings signals; the
 * mock only presents them. Options carrying `category` are grouped under a
 * native category header row (the installed `TuiDialogSelectOption`
 * contract: the host DialogSelect renders grouped category subsections).
 */
type DialogOption = { title: string; value: string; category?: string }
type DialogSelectMockProps = {
  title: string
  options: DialogOption[]
  onSelect?: (option: DialogOption) => void
}
const dialogProps: Array<DialogSelectMockProps> = []
// Host-side simulation: the real DialogSelect keeps its filter query in
// component-internal state (its own `store.filter`), never in props — the
// installed API only exposes the outbound `onFilter`. The mock mirrors that:
// a per-instance signal whose setter is exposed through this ref so tests
// can type a query, plus a marker row that renders it. Because the query
// lives INSIDE the instance, recreating the dialog (replace churn) is the
// only thing that can reset it.
const mockDialogSelectApiRef: {
  current: { setFilter: (query: string) => void } | null
} = { current: null }
function MockDialogSelect(props: DialogSelectMockProps) {
  dialogProps.push(props)
  const [filter, setFilter] = createSignal("")
  mockDialogSelectApiRef.current = { setFilter }
  return (
    <box flexDirection="column">
      <text>{props.title}</text>
      {props.options.map((opt, index) => {
        const prev = props.options[index - 1]
        return (
          <>
            {prev?.category !== opt.category && opt.category ? (
              <text>{opt.category}</text>
            ) : null}
            <text>{opt.title}</text>
          </>
        )
      })}
      {filter() ? <text>{`[filter: ${filter()}]`}</text> : null}
    </box>
  )
}

/**
 * Host `api.ui.Prompt` stand-in (installed `TuiPromptProps`): the
 * `session_prompt` slot renders with `replace`, so the production component
 * must re-render the native prompt AND forward the host props. The mock
 * records every prop it receives and renders a marker row so frames prove
 * the prompt row renders directly above the TokenMeter line with no gap.
 */
type PromptMockProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: unknown) => void
}
const promptProps: Array<PromptMockProps> = []
function MockPrompt(props: PromptMockProps) {
  promptProps.push(props)
  return <text>{`[prompt:${props.sessionID ?? ""}]`}</text>
}

async function mountEntry(
  state: MutableApi,
  project: ProjectState = {},
  expanded = true,
  settingsV1?: Record<string, unknown>,
  kvReady = true,
) {
  const handlers = new Map<string, (event: unknown) => void>()
  const disposes: Array<() => void> = []
  // Layers registered through the modern keymap API by the entry — the
  // palette-command seam (spec: tokenmeter-command-palette) plus the
  // toggle-sections layer (shortcut.ts). The mock stores each layer object
  // (commands AND bindings) and returns a real unregister disposer.
  const layers: Array<{
    commands?: Array<Record<string, unknown>>
    bindings?: Array<Record<string, unknown>>
  }> = []
  const kv = new Map<string, unknown>([
    ["tokenmeter.sidebar.expanded", expanded],
  ])
  if (settingsV1 !== undefined) kv.set("tokenmeter.settings.v1", settingsV1)
  // Every durable write the panel issues, in order — the no-kv-write probe
  // for the transient open-group accordion state.
  const kvWrites: string[] = []
  // Host `api.ui.dialog` stand-in (installed `TuiDialogStack`): `replace`
  // stores the render function + the stack-level `onClose` cancel hook (the
  // host fires it on Escape); `clear` records and empties the stack.
  const dialogStack: Array<{
    render: () => unknown
    onClose?: () => void
  }> = []
  // `clears` is exposed through a ref so the counter survives the mock's
  // closure (the api object outlives the mountEntry scope). `replaces`
  // counts every `dialog.replace` call the same way.
  const dialogClearsRef = { value: 0 }
  const dialogReplacesRef = { value: 0 }
  const [route, setRoute] = createSignal<{
    name: string
    params: Record<string, unknown>
  }>({
    name: "home",
    params: {},
  })
  let slot: ((ctx: unknown, props: unknown) => unknown) | undefined
  let footerSlot: ((ctx: unknown, props: unknown) => unknown) | undefined
  // The full registration record so tests can assert WHICH slots the entry
  // registers (the old `app_bottom` placement must be gone for this metric).
  let slotRegistration: { slots: Record<string, unknown> } | undefined
  // Isolate the Project section: a previous test's debounced refresh must
  // never leak into this mount.
  setProjectSnapshot(null)
  setProjectLoading(false)
  setProjectError(null)
  disposeProjectRefresh()
  // Isolated plugin state directory: the entry owns a SQLite store there.
  const stateDir = mkdtempSync(join(tmpdir(), "tokenmeter-render-"))
  const api = {
    kv: {
      ready: kvReady,
      get: <Value = unknown>(key: string, fallback?: Value) =>
        (kv.has(key) ? (kv.get(key) as Value) : fallback) as Value,
      set: (key: string, value: unknown) => {
        kvWrites.push(key)
        void kv.set(key, value)
      },
    },
    event: {
      on: (type: string, handler: (event: unknown) => void) => {
        handlers.set(type, handler)
        return () => void handlers.delete(type)
      },
    },
    keymap: {
      registerLayer: (layer: {
        commands?: Array<Record<string, unknown>>
        bindings?: Array<Record<string, unknown>>
      }) => {
        layers.push(layer)
        return () => {
          const index = layers.indexOf(layer)
          if (index >= 0) layers.splice(index, 1)
        }
      },
    },
    ui: {
      dialog: {
        replace: (render: () => unknown, onClose?: () => void) => {
          dialogReplacesRef.value++
          dialogStack.length = 0
          dialogStack.push({ render, onClose })
        },
        clear: () => {
          dialogClearsRef.value++
          dialogStack.length = 0
        },
      },
      DialogSelect: MockDialogSelect,
      Prompt: MockPrompt,
    },
    theme: {
      current: THEME.current,
    },
    lifecycle: {
      onDispose: (fn: () => void) => {
        disposes.push(fn)
        return () => void 0
      },
    },
    slots: {
      register: (registration: { slots: Record<string, unknown> }) => {
        slotRegistration = registration
        slot = registration.slots.sidebar_content as typeof slot
        footerSlot = registration.slots.session_prompt as typeof footerSlot
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
      path: { directory: "/proj/dir", state: stateDir },
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
    api,
    kvWrites,
    layers,
    dialog: {
      stack: dialogStack,
      clears: () => dialogClearsRef.value,
      replaces: () => dialogReplacesRef.value,
    },
    slot: slot as NonNullable<typeof slot>,
    footerSlot: footerSlot as NonNullable<typeof footerSlot>,
    slotRegistration,
    setRoute,
    dispose: () => {
      disposes.forEach((fn) => {
        fn()
      })
      disposeProjectRefresh()
      rmSync(stateDir, { recursive: true, force: true })
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
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 41000,
    )
    // The Project section also lands (default working fake project), so no
    // placeholder survives anywhere in the frame.
    await waitFor(() => projectSnapshot() !== null)
    await setup.waitForFrame(
      (frame) => frame.includes("41K tokens") && !frame.includes("…"),
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("41K tokens · $0.01")
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
    await setupA.waitForFrame((frame) => frame.includes("41K tokens"))

    // Switching chats changes the route; the plugin's route effect must
    // reactivate the new root WITHOUT any event and without remounting the
    // panel instance that published the previous snapshot.
    setRoute({ name: "session", params: { sessionID: bID } })
    await waitFor(
      () => snapshot()?.rootID === bID && snapshot()?.totalTokens === 705000,
    )
    const setupB = await testRender(
      () => slot({ theme: THEME }, { session_id: bID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await setupB.waitForFrame((frame) => frame.includes("705K tokens"))
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
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

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
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
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
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 41000,
    )
    await waitFor(() => projectSnapshot() !== null)
    await setup.renderOnce()
    const before = setup.captureCharFrame()
    expect(before).toContain("41K tokens · $0.01")
    expect(before).not.toContain("…")

    // The final message.updated is MISSED (simulated): only the current
    // messages now carry the completed totals. The idle event must invalidate
    // and rehydrate so the ALREADY-MOUNTED panel repaints.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.idle", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
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
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 41000,
    )
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

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
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: a TUI mirror truncated to its newest messages must never undercount the Session hourglass — first load of a delegated session reads the authoritative client", async () => {
    // The host TUI caps each session's in-memory mirror (drops the OLDEST
    // messages), so a non-empty mirror is NOT a complete message list. The
    // client is the only complete source: a delegated session discovered
    // after activation must be loaded from the client even when the mirror
    // already holds a (truncated) non-empty list.
    const rootID = "ses_truncated_mirror"
    const childID = "ses_truncated_child"
    const truncatedMirror = [
      msg("c2", childID, { input: 2000, output: 300, reasoning: 100 }),
      msg("c3", childID, { input: 3000, output: 400, reasoning: 200 }),
    ]
    const fullClient = [
      // The oldest message is missing from the mirror; it also carries a
      // large cache that IS part of the session spend.
      msg("c1", childID, {
        input: 45000,
        output: 2000,
        reasoning: 1500,
        cache: { read: 20000, write: 0 },
      }),
      ...truncatedMirror,
    ]
    const state: MutableApi = {
      // The mirror holds ONLY the newest messages (host cap); the client is
      // the full list.
      sessions: { [rootID]: [], [childID]: truncatedMirror },
      clientSessions: { [childID]: fullClient },
      // First discovery sees NO children: the child becomes visible later.
      children: {},
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, title: "Child" },
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
    // The root is EMPTY (no usage yet): no snapshot publishes until the
    // delegated child lands below, so the empty-session placeholder stays.

    // The delegated session becomes visible: session.created purges the tree
    // cache, the debounced reconcile discovers it and loads it. Its flags are
    // untouched (never activated, never invalidated), so the load must STILL
    // read the authoritative client — the truncated mirror holds 6000, the
    // full client list holds 74500 (the complete session spend: Σ input
    // 50000 + Σ output 2700 + Σ reasoning 1800 + Σ cache.read 20000; cache
    // tokens are billed, so c1's 20000 cache counts into the spend).
    state.children = { [rootID]: [{ id: childID, parentID: rootID }] }
    fire("session.created", {
      info: { id: childID, sessionID: childID, parentID: rootID },
    })
    await waitFor(() => snapshot()?.totalTokens === 74500)
    await setup.waitForFrame((frame) => frame.includes("75K tokens"))
    expect(snapshot()?.totalTokens).toBe(74500)
    expect(snapshot()?.cache).toBe(20000)
    expect(snapshot()?.cacheRead).toBe(20000)
    expect(snapshot()?.totalTokens).not.toBe(6000)
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: the deleted aggregate records the FULL client-loaded usage, never the truncated mirror aggregate", async () => {
    // The store map (built by the same load) feeds the deleted aggregate via
    // observedSessionUsage when a delete payload carries no tokens. A
    // truncated mirror must not shrink the recorded aggregate.
    const rootID = "ses_truncated_project"
    const childID = "ses_truncated_project_child"
    const truncatedMirror = [
      msg("c2", childID, { input: 2000, output: 300, reasoning: 100 }),
      msg("c3", childID, { input: 3000, output: 400, reasoning: 200 }),
    ]
    const fullClient = [
      msg("c1", childID, { input: 45000, output: 2000, reasoning: 1500 }),
      ...truncatedMirror,
    ]
    const state: MutableApi = {
      sessions: { [rootID]: [], [childID]: truncatedMirror },
      clientSessions: { [childID]: fullClient },
      children: {},
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, title: "Child" },
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
    // The root is EMPTY (no usage yet): no snapshot publishes until the
    // delegated child lands below.

    state.children = { [rootID]: [{ id: childID, parentID: rootID }] }
    fire("session.created", {
      info: { id: childID, sessionID: childID, parentID: rootID },
    })
    // The child's FULL client list must be observed BEFORE the delete folds
    // it: the truncated mirror alone would shrink the folded aggregate.
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 54500,
    )
    expect(snapshot()?.cache).toBe(0)

    // Delete the delegated session with a payload that carries NO tokens:
    // the SQLite deleted aggregate records the plugin's observed usage. The
    // full client-loaded aggregate (54500) must land in the Project deleted
    // aggregate — not the truncated mirror total (6000).
    fire("session.deleted", {
      info: { id: childID, projectID: "proj_test" },
    })
    await waitFor(() => projectSnapshot()?.context === 54500)
    expect(setup.captureCharFrame()).toContain("55K tokens")
    expect(projectSnapshot()?.context).not.toBe(6000)
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
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

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
    expect(snapshot()?.totalTokens).toBe(41000)
    const stuck = setup.captureCharFrame()
    expect(stuck).toContain("41K tokens · $0.01")
    expect(stuck).not.toContain("52K tokens")
    expect(stuck).not.toContain("(1 task)")

    // The 2s maintenance tick purges the tree cache and re-discovers the
    // child: the SAME mounted panel now sums child tokens and shows one
    // delegation — no remount, no further event needed.
    await waitFor(
      () =>
        snapshot()!.delegations === 1 &&
        snapshot()?.totalTokens === 41000 + 10500,
      6000,
    )
    await setup.waitForFrame((frame) => frame.includes("52K tokens"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("52K tokens · $0.02")
    expect(frame).toContain(`↳ sdd-apply (1 task) ${GLYPH.expand}`)

    // Cleanup is exercised: disposal clears the maintenance timer, so the
    // snapshot object stays put across another maintenance window.
    disposeReconcile()
    const settled = snapshot()
    await sleep(MAINTENANCE_DELAY + 200)
    expect(snapshot()).toBe(settled)
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
    // Seed the store with the project sessions' OBSERVED usage (the real
    // shape: list payloads carry no tokens; messages are authoritative) —
    // captured at delete time into the SQLite deleted aggregate.
    upsertMessageUsage(
      msg(
        "pm1",
        "ps1",
        {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
        0.01,
      ),
    )
    upsertMessageUsage(
      msg("pm2", "ps2", { input: 2000, output: 700, reasoning: 300 }, 0.02),
    )
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
    await setup.waitForFrame((frame) => frame.includes("5K tokens"))
    // The Project detail is collapsed by default (compact): expand it so the
    // labeled metric lines can be pinned below.
    await clickRowChevron(setup, setup.captureCharFrame(), "Project")
    await waitForFrameDriven(setup, (frame) => frame.includes("3K input"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Project")
    expect(frame.indexOf("Project")).toBeLessThan(frame.indexOf("Session"))
    // Project detail: L1 exactly once — Σ input + raw output + raw reasoning
    // + Σ cache.read + Σ cache.write when observed (ps1: 1850, ps2: 3000) ·
    // two-decimal spend; then the two labeled metric lines (real output =
    // raw output + raw reasoning; combined cache 150).
    expect(frame).toContain("5K tokens · $0.03")
    expect(frame).toContain("3K input · 2K output")
    expect(frame).toContain("500 reason · 150 cache")
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
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))
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
    expect(frame).toContain("41K tokens · $0.01")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: session.deleted passes the projectIDHint — a failing project.current() right after the delete keeps the total in the frame", async () => {
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
    // Seed the store with the project sessions' OBSERVED usage (list
    // payloads carry no tokens in the real shape).
    upsertMessageUsage(
      msg(
        "pm1",
        "ps1",
        {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
        0.01,
      ),
    )
    upsertMessageUsage(
      msg("pm2", "ps2", { input: 2000, output: 700, reasoning: 300 }, 0.02),
    )
    const { fire, slot, dispose } = await mountEntry(state, project)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    // First load sums the live sessions of proj_x: 4.85k context total
    // (ps1's complete context includes its 150 cache: 1850 + 3000). Live
    // sessions are never persisted — the list is the live source.
    await waitFor(() => projectSnapshot()?.sessions === 2)
    await setup.waitForFrame((frame) => frame.includes("5K tokens"))
    // The delete lands while project.current() starts failing (the transient
    // context gap right after a delete). The delete handler records ps1 into
    // the SQLite deleted aggregate BEFORE the refresh and passes projectID
    // "proj_x" as the hint; the server drops ps1 from the live list.
    project.fail = true
    project.sessions = [project.sessions![1]!]
    fire("session.deleted", { info: { id: "ps1", projectID: "proj_x" } })
    await sleep(RECONCILE_DELAY + 200)
    // Same total as before the delete (ps1 deleted aggregate + ps2 live), NO
    // error: the hint kept the projectID and the refresh summed the live
    // list plus the shared deleted aggregate.
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4850)
    expect(projectError()).toBeNull()
    await waitForFrameDriven(setup, (frame) => frame.includes("5K tokens"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("5K tokens")
    expect(frame).not.toContain("Unable to load project data")
    disposeReconcile()
    dispose()
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
      (frame) => !frame.includes("…") && frame.includes("41K tokens"),
    )
    const settled = setup.captureCharFrame()
    for (const ch of spinnerChars) expect(settled).not.toContain(ch)
    expect(settled).toContain("Project")
    disposeReconcile()
    dispose()
  }, 20000)

  test("REGRESSION: deleting a session observed via messages keeps its usage in the Project total (real payloads carry no usage)", async () => {
    const rootID = "ses_observed_delete"
    const state: MutableApi = {
      sessions: { [rootID]: [] },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    const project: ProjectState = {
      current: { id: "proj_del", worktree: "/wt" },
      // REAL session.list shape: the payload carries no token/cost fields —
      // usage only ever lives on the session's messages.
      sessions: [{ id: "s_obs", projectID: "proj_del" }],
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
    // The mount-time refresh settles with no usage (payload has none) — the
    // live total is authoritative from the list payload alone.
    await waitFor(() => projectSnapshot() !== null)
    // The session's usage is observed through its messages (authoritative
    // client data); the refresh still reports the payload-only live total,
    // because live usage is NEVER persisted — it is captured at delete time.
    fire("message.updated", {
      info: msg(
        "m1",
        "s_obs",
        { input: 1000, output: 500, reasoning: 200, total: 1700 },
        0.01,
      ),
    })
    fire("project.updated", {})
    await waitFor(() => projectSnapshot()?.context === 0)
    expect(projectSnapshot()?.sessions).toBe(0)

    // The session is deleted with a usage-less payload: the entry handler
    // records the observed snapshot into the SQLite deleted aggregate and
    // the total must survive.
    fire("session.deleted", {
      info: { id: "s_obs", projectID: "proj_del", title: "gone" },
    })
    await waitFor(() => projectSnapshot()?.sessions === 1)
    expect(projectSnapshot()?.context).toBe(1700)
    await setup.waitForFrame((frame) => frame.includes("2K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("2K tokens · $0.01")
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
    await waitFor(() => snapshot()?.totalTokens === 103000)
    await setup.waitForFrame((frame) => frame.includes("103K tokens"))

    // The r2 message disappears from the client; message.removed must
    // invalidate and remove the stored usage so the next reconcile
    // rehydrates WITHOUT it. The cumulative input keeps its per-field
    // high-water (100k); the spend headline KEEPS the historical spend
    // (103000) — a removed message was already observed and can never lower
    // the stored spend or its components.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
    ]
    fire("message.removed", { sessionID: rootID, messageID: "r2" })
    // The message map is actually replaced (rehydration landed), yet the
    // per-field high-water keeps input at 100k and the spend at 103000.
    await waitFor(() => usageMap(rootID).size === 1)
    expect(snapshot()?.input).toBe(100000)
    expect(snapshot()?.totalTokens).toBe(103000)
    // The breakdown row lives in the collapsed-by-default detail: expand the
    // session so the cumulative input high-water is visible in the frame.
    await clickRowChevron(setup, setup.captureCharFrame(), "Session")
    await waitForFrameDriven(
      setup,
      (frame) => frame.includes("103K tokens") && frame.includes("100K input"),
    )
    const after = setup.captureCharFrame()
    expect(after).toContain("103K tokens · $0.03")
    expect(after).toContain("100K input")
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
    await waitFor(() => snapshot()?.totalTokens === 41000)
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

    // The client grows, but a non-idle status must NOT invalidate: the next
    // reconcile keeps the cheap in-memory mirror (42.0k) instead of forcing
    // a client read — no rehydration, no zero flash.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.status", { sessionID: rootID, status: { type: "running" } })
    await sleep(50)
    expect(snapshot()?.totalTokens).toBe(41000)
    expect(setup.captureCharFrame()).toContain("41K tokens · $0.01")

    // The idle status invalidates: the mounted panel rehydrates from the
    // authoritative client and repaints with the new total.
    fire("session.status", { sessionID: rootID, status: { type: "idle" } })
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
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
    await waitFor(() => snapshot()?.totalTokens === 41000)
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.compacted", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
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
    await waitFor(() => snapshot()?.totalTokens === 41000)
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

    // With a sessionID the session is invalidated and rehydrated from the
    // client; the panel must never blank out on an error event.
    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("session.error", { sessionID: rootID })
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    // Without a sessionID the handler still schedules a refresh and the
    // mounted panel keeps its data.
    fire("session.error", {})
    await sleep(50)
    expect(snapshot()?.totalTokens).toBe(746000)
    expect(setup.captureCharFrame()).toContain("746K tokens")
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
    await waitFor(() => snapshot()?.totalTokens === 41000)
    await setup.waitForFrame((frame) => frame.includes("41K tokens"))

    state.sessions[rootID] = [
      msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      msg("r2", rootID, { input: 700000, output: 5000, total: 720000 }, 0.02),
    ]
    fire("message.part.removed", { sessionID: rootID, messageID: "r2" })
    await waitFor(() => snapshot()?.totalTokens === 746000)
    await setup.waitForFrame((frame) => frame.includes("746K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("746K tokens")
    expect(after).not.toContain("41K tokens")
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
    // Seed the store with the project sessions' OBSERVED usage (list
    // payloads carry no tokens in the real shape).
    upsertMessageUsage(
      msg("pe1m", "pe1", { input: 1000, output: 500, reasoning: 200 }),
    )
    upsertMessageUsage(
      msg("pe2m", "pe2", { input: 2000, output: 700, reasoning: 300 }),
    )
    upsertMessageUsage(
      msg("pe3m", "pe3", { input: 3000, output: 900, reasoning: 400 }),
    )
    const { fire, slot, dispose } = await mountEntry(state, project)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => projectSnapshot()?.sessions === 1)
    await setup.waitForFrame((frame) => frame.includes("2K tokens"))

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
    await setup.waitForFrame((frame) => frame.includes("5K tokens"))

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
    await setup.waitForFrame((frame) => frame.includes("9K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("9K tokens")
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("progressive disclosure (compact default, independent detail, empty vs loading, cache modes)", () => {
  const sessionState = (rootID: string): MutableApi => ({
    sessions: {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      ],
    },
    children: {},
    metas: { [rootID]: { id: rootID, title: "Root" } },
  })

  const projectWithSessions: ProjectState = {
    current: { id: "proj_disc", worktree: "/wt" },
    sessions: [
      {
        id: "ps1",
        projectID: "proj_disc",
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
        projectID: "proj_disc",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ],
  }

  const seedProjectUsage = () => {
    upsertMessageUsage(
      msg(
        "pm1",
        "ps1",
        {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
        0.01,
      ),
    )
    upsertMessageUsage(
      msg("pm2", "ps2", { input: 2000, output: 700, reasoning: 300 }, 0.02),
    )
  }

  test("compact default: one summary row per section, no detail rows, no version literal", async () => {
    const rootID = "ses_compact_default"
    purgeTreeCache()
    seedProjectUsage()
    const { slot, dispose } = await mountEntry(
      sessionState(rootID),
      projectWithSessions,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => projectSnapshot() !== null)
    await waitForFrameDriven(
      setup,
      (frame) => frame.includes("5K") && frame.includes("41K"),
    )
    const frame = setup.captureCharFrame()
    // Title carries no version literal.
    expect(frame).toContain("TokenMeter")
    expect(frame).not.toContain("1.0.1")
    // One compact summary row per section: the elastic L1 labeled line
    // (total tokens · two-decimal spend, `$`-prefixed).
    expect(frame).toContain("5K tokens · $0.03")
    expect(frame).toContain("41K tokens · $0.01")
    // No metric icons anywhere: no coins/fire/thinking/arrows.
    expect(frame).not.toContain("\uEDE8")
    expect(frame).not.toContain("\u{F0238}")
    expect(frame).not.toContain("\u{EE9C}")
    expect(frame).not.toContain("↑")
    expect(frame).not.toContain("↓")
    // Every disclosure chevron is the LEFTMOST glyph of its row.
    expect(frame).toContain(`${GLYPH.expand} Project`)
    expect(frame).toContain(`${GLYPH.expand} Session`)
    expect(frame).not.toContain(`Project ${GLYPH.expand}`)
    expect(frame).not.toContain(`Session ${GLYPH.expand}`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("independent disclosure: expanding Project detail leaves Session collapsed", async () => {
    const rootID = "ses_independent"
    purgeTreeCache()
    seedProjectUsage()
    const { slot, dispose } = await mountEntry(
      sessionState(rootID),
      projectWithSessions,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => projectSnapshot() !== null)
    await waitForFrameDriven(setup, (frame) => frame.includes("5K tokens"))
    // Compact first: no detail anywhere (and no metric icons at all).
    expect(setup.captureCharFrame()).not.toContain("\u{EE9C}")
    expect(setup.captureCharFrame()).not.toContain("\uEDE8")

    await clickRowChevron(setup, setup.captureCharFrame(), "Project")
    // Project detail appears: L1 (exactly once, replacing the compact
    // summary) plus the two labeled metric lines, while Session stays
    // collapsed.
    await waitForFrameDriven(setup, (frame) => frame.includes("3K input"))
    const frame = setup.captureCharFrame()
    expect(countOccurrences(frame, "5K tokens · $0.03")).toBe(1)
    expect(frame).toContain("3K input · 2K output")
    expect(frame).toContain("500 reason · 150 cache")
    expect(frame).not.toContain("\uEDE8")
    expect(frame).not.toContain("\u{F0238}")
    // Session detail must NOT render: its labeled lines are absent and its
    // header keeps the collapsed left chevron.
    expect(frame).not.toContain("41K input")
    expect(frame).toContain(`${GLYPH.expand} Session`)
    expect(frame).toContain(`${GLYPH.collapse} Project`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("expanded detail tone hierarchy: primary line white with light-red spend, secondary lines in the derived detail tone, yellow heading dots only on section titles", async () => {
    const rootID = "ses_role_colors"
    const childID = "ses_role_colors_child"
    purgeTreeCache()
    seedProjectUsage()
    // A zero-usage delegated session forms one group, so the Subagents
    // section renders and its title participates in the tone contract
    // (agent names add the info tone to the frame's hues).
    const { slot, dispose } = await mountEntry(
      {
        sessions: {
          [rootID]: [
            msg(
              "r1",
              rootID,
              { input: 40000, output: 1000, total: 42000 },
              0.01,
            ),
          ],
          [childID]: [],
        },
        children: { [rootID]: [{ id: childID, agent: "general" }] },
        metas: {
          [rootID]: { id: rootID, title: "Root" },
          [childID]: { id: childID, agent: "general" },
        },
      },
      projectWithSessions,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitFor(() => projectSnapshot() !== null)
    await waitForFrameDriven(setup, (frame) => frame.includes("5K tokens"))
    await clickRowChevron(setup, setup.captureCharFrame(), "Project")
    await waitForFrameDriven(setup, (frame) => frame.includes("3K input"))
    const frame = setup.captureCharFrame()
    // Exactly three labeled lines (compact mode), each value+label exactly
    // once; the reasoning label reads `reason` and no `spent` word appears.
    expect(countOccurrences(frame, "5K tokens · $0.03")).toBe(1)
    expect(countOccurrences(frame, "3K input · 2K output")).toBe(1)
    expect(countOccurrences(frame, "500 reason · 150 cache")).toBe(1)
    // The compact summary is gone (replaced by L1): no coins/fire icons.
    expect(frame).not.toContain("\uEDE8")
    expect(frame).not.toContain("\u{F0238}")
    expect(frame).not.toContain("spent")
    expect(frame).not.toContain("reasoning")
    // Tone hierarchy (tone.ts): L1 renders in the main-text tone with the
    // $amount in the light-red error tone; the input/output and
    // reason/cache lines render in the derived detail tone (textMuted
    // blended 50% toward the active background).
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const fgOf = (text: string) =>
      spans
        .filter((span) => span.text.includes(text))
        .map((span) => rgbToHex(span.fg))
    const white = rgbToHex(RGBA.fromHex("#a8b4dc"))
    const error = rgbToHex(RGBA.fromHex("#ff4500"))
    const warning = rgbToHex(RGBA.fromHex("#ffcc00"))
    const muted = rgbToHex(RGBA.fromHex("#a9b1d6"))
    const detail = rgbToHex(detailTone(() => THEME.current))
    // L1: tokens/label/separator white, spend light red.
    expect(fgOf("$0.03")).toEqual([error])
    expect(fgOf("$0.01")).toEqual([error])
    expect(fgOf("5K")).toContain(white)
    expect(fgOf(" tokens")).toContain(white)
    // Secondary rows: the derived detail tone, dimmer than textMuted.
    expect(fgOf("3K")).toEqual([detail])
    expect(fgOf("2K")).toEqual([detail])
    expect(fgOf("500")).toEqual([detail])
    expect(fgOf("150")).toEqual([detail])
    // The three section TITLES (Project, Session, Subagents) render in the
    // semantic yellow theme().warning — the complete title text, with no
    // `●` marker glyph anywhere.
    const titleColors = fgOf("Project").concat(
      fgOf("Session"),
      fgOf("Subagents"),
    )
    expect(titleColors).toHaveLength(3)
    expect(titleColors.every((color) => color === warning)).toBe(true)
    // Detail rows align two columns beneath the heading (the summary and
    // detail share the same nested indent), and no `●` marker leads any
    // metric row.
    const frameLines = frame.split(/[\r\n]+/)
    const detailRows = frameLines.filter(
      (line) =>
        line.includes("tokens · $0.03") ||
        line.includes("input · 2K output") ||
        line.includes("reason · 150 cache"),
    )
    expect(detailRows).toHaveLength(3)
    for (const line of detailRows) {
      expect([...line].findIndex((ch) => ch !== " ")).toBe(2)
      expect(line).not.toContain("●")
    }
    // The only content hues in the frame are the contract's tones: white
    // (primary), detail (secondary), error (spend) and warning (section
    // titles), plus textMuted (the Subagents aggregate caption) and info
    // (the Subagents agent name — the group renders in the frame).
    const info = rgbToHex(RGBA.fromHex("#00aaff"))
    const hues = new Set(
      spans
        .filter((span) => span.text.trim().length > 0)
        .map((span) => rgbToHex(span.fg))
        .filter(
          (color) =>
            ![white, detail, error, warning, muted, info].includes(color),
        ),
    )
    expect(hues).toEqual(new Set([]))
    disposeReconcile()
    dispose()
  }, 20000)

  test("detail renders the real output (output + reasoning) exactly once", async () => {
    const rootID = "ses_real_output"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, {
            input: 30000,
            output: 10,
            reasoning: 5,
            total: 30015,
          }),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("30K"))
    await clickRowChevron(setup, setup.captureCharFrame(), "Session")
    await waitForFrameDriven(setup, (frame) => frame.includes(" · 15 output"))
    const frame = setup.captureCharFrame()
    // The real output (output + reasoning) renders exactly once in L2.
    expect(countOccurrences(frame, " · 15 output")).toBe(1)
    expect(frame).not.toContain(" · 10 output")
    disposeReconcile()
    dispose()
  }, 20000)

  test("cache mode: combined shows one summed value; separated shows R|W from the same raw pair", async () => {
    const rootID = "ses_cache_modes"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg(
            "r1",
            rootID,
            {
              input: 1000,
              output: 100,
              reasoning: 0,
              cache: { read: 45000000, write: 10000 },
              total: 45011000,
            },
            0.01,
          ),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    // Default settings: cache is combined — one summed cache value.
    const combined = await mountEntry(state)
    const setupCombined = await testRender(
      () => combined.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setupCombined, (frame) => frame.includes("45M"))
    await clickRowChevron(
      setupCombined,
      setupCombined.captureCharFrame(),
      "Session",
    )
    await waitForFrameDriven(setupCombined, (frame) =>
      frame.includes("45M cache"),
    )
    const combinedFrame = setupCombined.captureCharFrame()
    expect(combinedFrame).toContain("1K input · 100 output")
    expect(combinedFrame).toContain("0 reason · 45M cache")
    expect(combinedFrame).not.toContain("R45M|W10K")
    disposeReconcile()
    combined.dispose()

    // cache=separated renders the same raw pair as R|W.
    purgeTreeCache()
    const separated = await mountEntry(state, {}, true, {
      cache: "separated",
      numbers: "compact",
    })
    const setupSeparated = await testRender(
      () => separated.slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setupSeparated, (frame) => frame.includes("45M"))
    await clickRowChevron(
      setupSeparated,
      setupSeparated.captureCharFrame(),
      "Session",
    )
    await waitForFrameDriven(setupSeparated, (frame) =>
      frame.includes("R45M|W10K"),
    )
    const separatedFrame = setupSeparated.captureCharFrame()
    expect(separatedFrame).toContain("1K input · 100 output")
    expect(separatedFrame).toContain("0 reason · R45M|W10K")
    expect(separatedFrame).not.toContain("45M cache")
    disposeReconcile()
    separated.dispose()
  }, 20000)

  test("zero-usage snapshot shows the empty copy, never the loading `…`", async () => {
    const rootID = "ses_empty"
    const childID = "ses_empty_child"
    const state: MutableApi = {
      sessions: { [rootID]: [], [childID]: [] },
      children: { [rootID]: [{ id: childID, agent: "sdd-apply" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(
      () => snapshot()?.rootID === rootID && snapshot()?.totalTokens === 0,
    )
    await waitFor(() => projectSnapshot() !== null)
    await waitForFrameDriven(
      setup,
      (frame) =>
        frame.includes("No usage yet") && frame.includes("No sessions"),
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("No usage yet")
    expect(frame).toContain("No sessions")
    expect(frame).not.toContain("…")
    disposeReconcile()
    dispose()
  }, 20000)

  test("narrow width: detail rows never wrap and degrade elastically at 22 columns — reasoning/cache values are never omitted", async () => {
    const rootID = "ses_clipped"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg(
            "r1",
            rootID,
            {
              input: 30000,
              output: 10,
              reasoning: 999999,
              cache: { read: 45000000, write: 10000 },
              total: 46010009,
            },
            0.01,
          ),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state)
    const setup = await testRender(
      () => slot({ theme: THEME, width: 24 }, { session_id: rootID }) as never,
      {
        width: 30,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("46M"))
    const compactFrame = setup.captureCharFrame()
    // The compact L1 fits the narrowest content width (22) in full —
    // nothing wraps and no cue ever renders.
    expect(compactFrame).toContain("46M tokens · $0.01")
    expect(compactFrame).not.toContain("(detail clipped)")

    await clickRowChevron(setup, compactFrame, "Session")
    // Open: the THREE elastic lines (compact mode) render — the ladder
    // drops labels and elides/truncates values, but NO line is ever
    // omitted: the reason/cache line renders with BOTH values at 22
    // columns (the trailing label drops first).
    await waitForFrameDriven(setup, (frame) => frame.includes("30K input · 1M"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("46M tokens · $0.01")
    expect(frame).toContain("30K input · 1M")
    expect(frame).toContain("1000K reason · 45M")
    expect(frame).not.toContain("(detail clipped)")
    const detail = frame
      .split(/[\r\n]+/)
      .filter(
        (line) =>
          line.includes("46M tokens · $0.01") ||
          line.includes("30K input · 1M") ||
          line.includes("1000K reason · 45M"),
      )
    expect(detail).toHaveLength(3)
    for (const line of detail) {
      expect([...line.trimEnd()].length).toBeLessThanOrEqual(22)
      // Two-column nested indent: the data sits two columns beneath the
      // heading in both compact and expanded presentation.
      expect([...line].findIndex((ch) => ch !== " ")).toBe(2)
    }
    disposeReconcile()
    dispose()
  }, 20000)

  test("precise at 22 columns: expanded Session renders EXACTLY five rows — every precise value visible, no metric dropped", async () => {
    const rootID = "ses_precise_22"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg(
            "r1",
            rootID,
            {
              input: 3000,
              output: 10,
              reasoning: 500,
              cache: { read: 45000000, write: 10000 },
              total: 45013510,
            },
            0.01,
          ),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state, {}, true, {
      cache: "combined",
      numbers: "precise",
    })
    const setup = await testRender(
      () => slot({ theme: THEME, width: 24 }, { session_id: rootID }) as never,
      {
        width: 30,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("45,013,510"))
    // Collapsed compact L1 at 22 columns: labels/sep yield, the total and
    // the spend survive elision.
    expect(setup.captureCharFrame()).toContain("45,013,510")
    await clickRowChevron(setup, setup.captureCharFrame(), "Session")
    // Expanded (precise): exactly FIVE single-metric rows — total/cost,
    // input, output, reason, cache — every value present at 22 columns
    // (the spend elides to `$…` before the ` tokens` label drops, same
    // ladder as compact), rows degrade individually, a metric is never
    // omitted and the reasoning label reads `reason`.
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("45,010,000 cache"),
    )
    const frame = setup.captureCharFrame()
    const detail = frame
      .split(/[\r\n]+/)
      .filter(
        (line) =>
          line.includes("45,013,510 · $…") ||
          line.includes("3,000 input") ||
          line.includes("510 output") ||
          line.includes("500 reason") ||
          line.includes("45,010,000 cache"),
      )
    expect(detail).toHaveLength(5)
    for (const line of detail) {
      expect([...line.trimEnd()].length).toBeLessThanOrEqual(22)
      // Two-column nested indent: the data sits two columns beneath the
      // heading in both compact and expanded presentation.
      expect([...line].findIndex((ch) => ch !== " ")).toBe(2)
    }
    expect(detail[0]).toContain("45,013,510")
    expect(detail[1]).toContain("3,000 input")
    expect(detail[2]).toContain("510 output")
    expect(detail[3]).toContain("500 reason")
    expect(detail[4]).toContain("45,010,000 cache")
    expect(frame).not.toContain("(detail clipped)")
    expect(frame).not.toContain("reasoning")
    disposeReconcile()
    dispose()
  }, 20000)

  test("precise at 22 columns: expanded Project and every agent also render exactly five rows — all values visible after indentation", async () => {
    // The contract: precise mode MUST render exactly five rows for every
    // expanded Project, Session and agent; at the 22-column floor the
    // section rows get 20 columns (22 − 2) and the agent metric rows get
    // 17 (22 − the full `  ↳ ` prefix of 4 − the scrollbar column), and
    // every value must stay visible.
    const rootID = "ses_precise_five"
    const childID = "ses_precise_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg(
            "r1",
            rootID,
            {
              input: 522000,
              output: 196000,
              reasoning: 140000,
              cache: { read: 18900000, write: 0 },
              total: 19758000,
            },
            0.09,
          ),
        ],
        [childID]: [
          msg(
            "c1",
            childID,
            {
              input: 522000,
              output: 196000,
              reasoning: 140000,
              cache: { read: 18900000, write: 0 },
              total: 19758000,
            },
            0.09,
          ),
        ],
      },
      children: { [rootID]: [{ id: childID, agent: "plan" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "plan" },
      },
    }
    const project: ProjectState = {
      current: { id: "proj_five", worktree: "/wt" },
      sessions: [
        {
          id: "pf1",
          projectID: "proj_five",
          cost: 0.09,
          tokens: {
            input: 522000,
            output: 196000,
            reasoning: 140000,
            cache: { read: 18900000, write: 0 },
          },
        },
      ],
    }
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state, project, true, {
      cache: "combined",
      numbers: "precise",
    })
    const setup = await testRender(
      () => slot({ theme: THEME, width: 24 }, { session_id: rootID }) as never,
      {
        width: 30,
        height: 24,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitFor(() => projectSnapshot() !== null)
    // Compact L1s at 22 columns: the spend elides to `$…` (the preserved
    // compact-summary ladder). The Session sums root + child (39,516,000),
    // the Project view and the agent group each hold the child's
    // 19,758,000.
    await waitForFrameDriven(
      setup,
      (frame) =>
        frame.includes("19,758,000 · $…") && frame.includes("39,516,000 · $…"),
    )

    // Expand Project and Session: each renders exactly the five rows. Each
    // click is followed by a repaint wait so the next row lookup uses a
    // fresh frame (expanding Project shifts Session down).
    await clickRowChevron(setup, setup.captureCharFrame(), "Project")
    await waitForFrameDriven(setup, (frame) => frame.includes("522,000 input"))
    await clickRowChevron(setup, setup.captureCharFrame(), "Session")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("1,044,000 input"),
    )
    const frame = setup.captureCharFrame()
    // Project five rows (the agent's compact summary still shows its own
    // `19,758,000 · $…` L1).
    expect(countOccurrences(frame, "19,758,000 · $…")).toBe(2)
    expect(countOccurrences(frame, "522,000 input")).toBe(1)
    expect(countOccurrences(frame, "336,000 output")).toBe(1)
    expect(countOccurrences(frame, "140,000 reason")).toBe(1)
    expect(countOccurrences(frame, "18,900,000 cache")).toBe(1)
    // Session five rows (root + child: every value doubled).
    expect(countOccurrences(frame, "39,516,000 · $…")).toBe(1)
    expect(countOccurrences(frame, "1,044,000 input")).toBe(1)
    expect(countOccurrences(frame, "672,000 output")).toBe(1)
    expect(countOccurrences(frame, "280,000 reason")).toBe(1)
    expect(countOccurrences(frame, "37,800,000 cache")).toBe(1)
    // Every section detail row starts at column 2 and never overflows 22.
    for (const line of frame.split(/[\r\n]+/)) {
      if (
        line.includes("522,000 input") ||
        line.includes("336,000 output") ||
        line.includes("140,000 reason") ||
        line.includes("18,900,000 cache") ||
        line.includes("1,044,000 input") ||
        line.includes("672,000 output") ||
        line.includes("280,000 reason") ||
        line.includes("37,800,000 cache")
      ) {
        expect([...line].findIndex((ch) => ch !== " ")).toBe(2)
        expect([...line.trimEnd()].length).toBeLessThanOrEqual(22)
      }
    }

    // Open the agent: its detail is the same five rows inside the real
    // scrollbox (header + 5 detail rows = 6 children), aligned under the
    // name after the `  ↳ ` prefix (4 columns).
    await clickAgentRow(setup, setup.captureCharFrame(), "plan")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ plan (1 task) ${GLYPH.collapse}`),
    )
    const agentFrame = setup.captureCharFrame()
    expect(agentFrame).toContain(`↳ plan (1 task) ${GLYPH.collapse}`)
    const scrollbox = findScrollbox(setup)
    expect(scrollbox).not.toBeNull()
    expect(scrollbox!.getChildren().length).toBe(6)
    // Top of the viewport: the header plus the first rows; the agent's L1
    // keeps the total and the `$…` spend marker at 17 columns.
    expect(agentFrame).toContain("19,758,000 · $…")
    expect(agentFrame).toContain("522,000 input")
    // Scroll to the bottom: the last precise rows are visible too — all
    // five values render inside the scroll container. At the 15-column
    // agent floor the cache row degrades to its bare value (the label
    // drops before any value), so the agent's rows now double the section
    // counts.
    scrollbox!.scrollTo(scrollbox!.scrollHeight)
    await waitForFrameDriven(
      setup,
      (frame) => countOccurrences(frame, "18,900,000") === 2,
    )
    const bottom = setup.captureCharFrame()
    expect(countOccurrences(bottom, "336,000 output")).toBe(2)
    expect(countOccurrences(bottom, "140,000 reason")).toBe(2)
    expect(countOccurrences(bottom, "18,900,000")).toBe(2)
    disposeReconcile()
    dispose()
  }, 20000)

  test("a stale legacy view seed is ignored: sections mount closed", async () => {
    const rootID = "ses_seed_mount"
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
    // The legacy view preference was removed from the settings model
    // (tokenmeter-settings spec); the sanitizer ignores the stale field, so
    // the panel must NOT seed any section open from it. (4.3 sweep: the
    // fixture uses a generic stale key — the unshipped legacy field name is
    // gone from the codebase.)
    const { slot, dispose } = await mountEntry(state, {}, true, {
      legacyView: "detailed",
      cache: "combined",
      numbers: "compact",
    })
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Compact default through the real entry flow: L1 exactly once, no L2
    // detail, expand chevron left — the stale seed changed nothing.
    const frame = setup.captureCharFrame()
    expect(countOccurrences(frame, "41K tokens · $0.01")).toBe(1)
    expect(frame).not.toContain("40K input · 1K output")
    expect(frame).toContain(`${GLYPH.expand} Session`)
    disposeReconcile()
    dispose()
  }, 20000)

  test("a session change resets disclosure to the closed seed", async () => {
    const aID = "ses_reset_a"
    const bID = "ses_reset_b"
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
    // The panel is mounted directly with a reactive sessionID prop so the
    // session change lands on the SAME mounted instance (through the plugin
    // slot the host remounts per session switch, which the mount-seed test
    // covers; this test covers the prop-change reset path).
    const { api, dispose } = await mountEntry(state, {}, true, {
      cache: "combined",
      numbers: "compact",
    })
    const [sid, setSid] = createSignal(aID)
    const setup = await testRender(
      () =>
        (
          <UsagePanel
            api={api}
            sessionID={sid()}
            subagentsPref={subagentsPref}
            onToggleSubagents={() => cycleSubagents(api)}
            theme={() => THEME.current}
            width={38}
          />
        ) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === aID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Seeded closed: the L2 detail line is absent until the user opens it.
    expect(setup.captureCharFrame()).not.toContain("40K input · 1K output")

    // The user opens the section; the in-memory choice survives until the
    // session changes (the preference never force-toggles open disclosure).
    await clickRowChevron(setup, setup.captureCharFrame(), "Session")
    await waitForFrameDriven(setup, (frame) => frame.includes("40K input"))
    expect(setup.captureCharFrame()).toContain("40K input · 1K output")

    // Switching sessions resets both sections back to the closed seed.
    setSid(bID)
    await waitFor(() => snapshot()?.rootID === bID)
    await waitForFrameDriven(setup, (frame) => frame.includes("705K tokens"))
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("700K input · 5K output")
    expect(frame).toContain(`${GLYPH.expand} Session`)
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("master disclosure (transient; expanded default; collapsed = ▶ TokenMeter + one L1)", () => {
  // Project L1 = `5K tokens · $0.03`, Session L1 = `41K tokens ·
  // $0.01` — the same values the sibling describes pin.
  const projectState: ProjectState = {
    current: { id: "proj_master", worktree: "/wt" },
    sessions: [
      {
        id: "pm1",
        projectID: "proj_master",
        cost: 0.01,
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
      },
      {
        id: "pm2",
        projectID: "proj_master",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ],
  }

  const seedProjectUsage = () => {
    upsertMessageUsage(
      msg(
        "pm1",
        "pm1",
        {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
        0.01,
      ),
    )
    upsertMessageUsage(
      msg("pm2", "pm2", { input: 2000, output: 700, reasoning: 300 }, 0.02),
    )
  }

  const sessionState = (rootID: string): MutableApi => ({
    sessions: {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      ],
    },
    children: {},
    metas: { [rootID]: { id: rootID, title: "Root" } },
  })

  const mountPanel = async (
    rootID: string,
    state: MutableApi,
    project: ProjectState = {},
    settingsV1?: Record<string, unknown>,
  ) => {
    purgeTreeCache()
    const { slot, dispose, kvWrites } = await mountEntry(
      state,
      project,
      true,
      settingsV1,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    if (project.current) await waitFor(() => projectSnapshot() !== null)
    return { setup, dispose, kvWrites }
  }

  test("starts EXPANDED over the normal sections; the chevron click collapses to ▶ TokenMeter + exactly the Session L1 and no other rows", async () => {
    const rootID = "ses_master_a"
    const childID = "ses_master_a_child"
    seedProjectUsage()
    // One zero-usage delegated group so the expanded frame renders the
    // Subagents section like the other sections (zero groups would hide it).
    const { setup, dispose } = await mountPanel(
      rootID,
      {
        sessions: {
          [rootID]: [
            msg(
              "r1",
              rootID,
              { input: 40000, output: 1000, total: 42000 },
              0.01,
            ),
          ],
          [childID]: [],
        },
        children: { [rootID]: [{ id: childID, agent: "general" }] },
        metas: {
          [rootID]: { id: rootID, title: "Root" },
          [childID]: { id: childID, agent: "general" },
        },
      },
      projectState,
    )
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Expanded default: the master chevron is ▼ and all sections render.
    const expanded = setup.captureCharFrame()
    expect(expanded).toContain(`${GLYPH.collapse} TokenMeter`)
    expect(expanded).toContain(`${GLYPH.expand} Project`)
    expect(expanded).toContain(`${GLYPH.expand} Session`)
    expect(expanded).toContain("Subagents")
    // Master chevron click (leftmost cell) collapses.
    await clickMasterChevron(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsed = setup.captureCharFrame()
    // ▶ TokenMeter plus EXACTLY ONE row — the Session L1 (default source).
    expect(collapsed).toContain(`${GLYPH.expand} TokenMeter`)
    expect(countOccurrences(collapsed, "41K tokens · $0.01")).toBe(1)
    const contentLines = collapsed
      .split(/[\r\n]+/)
      .filter((line) => line.trim().length > 0)
    expect(contentLines).toHaveLength(2)
    // No Project/Session/Subagents rows, no other source's L1.
    expect(collapsed).not.toContain(`${GLYPH.expand} Project`)
    expect(collapsed).not.toContain(`${GLYPH.expand} Session`)
    expect(collapsed).not.toContain("Subagents")
    expect(collapsed).not.toContain("5K tokens · $0.03")
    disposeReconcile()
    dispose()
  }, 20000)

  test("title-text click toggles both ways; the chevron click expands it back", async () => {
    const rootID = "ses_master_b"
    const childID = "ses_master_b_child"
    seedProjectUsage()
    const { setup, dispose } = await mountPanel(
      rootID,
      {
        sessions: {
          [rootID]: [
            msg(
              "r1",
              rootID,
              { input: 40000, output: 1000, total: 42000 },
              0.01,
            ),
          ],
          [childID]: [],
        },
        children: { [rootID]: [{ id: childID, agent: "general" }] },
        metas: {
          [rootID]: { id: rootID, title: "Root" },
          [childID]: { id: childID, agent: "general" },
        },
      },
      projectState,
    )
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Title-text click (column inside "TokenMeter"): collapse.
    await clickMasterTitle(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsed = setup.captureCharFrame()
    expect(countOccurrences(collapsed, "41K tokens · $0.01")).toBe(1)
    expect(collapsed).not.toContain("Subagents")
    // Title-text click again: the normal sections return.
    await clickMasterTitle(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.collapse} TokenMeter`),
    )
    const restored = setup.captureCharFrame()
    expect(restored).toContain(`${GLYPH.expand} Session`)
    expect(restored).toContain("Subagents")
    // The chevron click collapses again — both row parts toggle.
    await clickMasterChevron(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    expect(
      countOccurrences(setup.captureCharFrame(), "41K tokens · $0.01"),
    ).toBe(1)
    disposeReconcile()
    dispose()
  }, 20000)

  test("collapsedSummary source switch: the project source shows exactly the Project L1", async () => {
    const rootID = "ses_master_c"
    seedProjectUsage()
    const { setup, dispose } = await mountPanel(
      rootID,
      sessionState(rootID),
      projectState,
      {
        collapsedSummary: "project",
        cache: "combined",
        numbers: "compact",
      },
    )
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    await clickMasterChevron(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsed = setup.captureCharFrame()
    expect(countOccurrences(collapsed, "5K tokens · $0.03")).toBe(1)
    expect(collapsed).not.toContain("41K tokens · $0.01")
    expect(collapsed).not.toContain(`${GLYPH.expand} Session`)
    expect(collapsed).not.toContain("Subagents")
    disposeReconcile()
    dispose()
  }, 20000)

  test("empty source copy: No usage yet / No sessions, never the loading …", async () => {
    // Session source with a zero-usage snapshot.
    const rootID = "ses_master_d"
    const childID = "ses_master_d_child"
    const a = await mountPanel(rootID, {
      sessions: { [rootID]: [], [childID]: [] },
      children: { [rootID]: [{ id: childID, agent: "sdd-apply" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    })
    await waitForFrameDriven(a.setup, (frame) => frame.includes("No usage yet"))
    await clickMasterChevron(a.setup, a.setup.captureCharFrame())
    await waitForFrameDriven(a.setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsedSession = a.setup.captureCharFrame()
    expect(collapsedSession).toContain("No usage yet")
    expect(collapsedSession).not.toContain("…")
    a.dispose()

    // Project source with a zero-usage project snapshot.
    const rootID2 = "ses_master_e"
    const b = await mountPanel(
      rootID2,
      sessionState(rootID2),
      {
        current: { id: "proj_master", worktree: "/wt" },
        sessions: [
          {
            id: "pm0",
            projectID: "proj_master",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0 },
          },
        ],
      },
      { collapsedSummary: "project", cache: "combined", numbers: "compact" },
    )
    await waitForFrameDriven(b.setup, (frame) => frame.includes("41K tokens"))
    await clickMasterChevron(b.setup, b.setup.captureCharFrame())
    await waitForFrameDriven(b.setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsedProject = b.setup.captureCharFrame()
    expect(collapsedProject).toContain("No sessions")
    expect(collapsedProject).not.toContain("…")
    b.dispose()
  }, 20000)

  test("transient: disclosure clicks never touch kv, and a session change resets master to expanded", async () => {
    // Direct reactive-prop mount so the session change lands on the same
    // mounted instance (host remounts per session switch; the remount
    // always starts expanded, this covers the prop-change reset path).
    const aID = "ses_master_f"
    const bID = "ses_master_g"
    const bChild = "ses_master_g_child"
    purgeTreeCache()
    const state: MutableApi = {
      sessions: {
        [aID]: [
          msg("m1", aID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [bID]: [
          msg("m2", bID, { input: 700000, output: 5000, total: 720000 }, 0.02),
        ],
        // A zero-usage delegated group on the second session so the
        // Subagents section renders after the switch (zero groups hide it).
        [bChild]: [],
      },
      children: { [bID]: [{ id: bChild, agent: "general" }] },
      metas: {
        [aID]: { id: aID, title: "A" },
        [bID]: { id: bID, title: "B" },
        [bChild]: { id: bChild, agent: "general" },
      },
    }
    const { api, dispose, kvWrites } = await mountEntry(state, {}, true, {
      cache: "combined",
      numbers: "compact",
    })
    const [sid, setSid] = createSignal(aID)
    const setup = await testRender(
      () =>
        (
          <UsagePanel
            api={api}
            sessionID={sid()}
            subagentsPref={subagentsPref}
            onToggleSubagents={() => cycleSubagents(api)}
            theme={() => THEME.current}
            width={38}
          />
        ) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === aID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Collapse via the chevron, expand via the title text: zero kv writes.
    await clickMasterChevron(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    expect(setup.captureCharFrame()).toContain("41K tokens · $0.01")
    await clickMasterTitle(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.collapse} TokenMeter`),
    )
    expect(kvWrites).toHaveLength(0)
    // Session change resets master to EXPANDED.
    setSid(bID)
    await waitFor(() => snapshot()?.rootID === bID)
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitForFrameDriven(setup, (frame) => frame.includes("705K tokens"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain(`${GLYPH.collapse} TokenMeter`)
    expect(frame).toContain(`${GLYPH.expand} Session`)
    expect(frame).toContain("Subagents")
    expect(kvWrites).toHaveLength(0)
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("no in-panel settings screen (palette dialog replaces the screen seam)", () => {
  const state = (rootID: string): MutableApi => ({
    sessions: {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      ],
    },
    children: {},
    metas: { [rootID]: { id: rootID, title: "Root" } },
  })

  test("the title row carries no Settings/Back toggle; the metrics body is never replaced", async () => {
    const rootID = "ses_no_screen_toggle"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state(rootID))
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // The master row is exactly `▼ TokenMeter` — no trailing toggle text
    // (spec: the panel title row MUST NOT contain a Settings/Back toggle).
    const metrics = setup.captureCharFrame()
    expect(metrics).toContain(`${GLYPH.collapse} TokenMeter`)
    expect(metrics).toContain("41K tokens · $0.01")
    expect(metrics).not.toContain("Settings")
    expect(metrics).not.toContain("Back")

    // Clicking the right edge of the master row (where the legacy Settings
    // toggle rendered) never swaps the metric body for a settings screen:
    // no preference rows, no Back, metrics still visible on the same mount.
    const lines = metrics.split(/[\r\n]+/)
    const titleIdx = lines.findIndex((line) => line.includes("TokenMeter"))
    expect(titleIdx).toBeGreaterThanOrEqual(0)
    await setup.mockMouse.click(lines[titleIdx].trimEnd().length - 1, titleIdx)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    const after = setup.captureCharFrame()
    expect(after).toContain("41K tokens · $0.01")
    expect(after).not.toContain("collapsedSummary")
    expect(after).not.toContain("Settings")
    expect(after).not.toContain("Back")
    disposeReconcile()
    dispose()
  }, 20000)

  test("collapsing the master renders exactly the summary — no settings rows anywhere", async () => {
    const rootID = "ses_no_screen_master"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(state(rootID))
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    await clickMasterChevron(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} TokenMeter`),
    )
    const collapsed = setup.captureCharFrame()
    expect(collapsed).toContain("41K tokens · $0.01")
    expect(collapsed).not.toContain("Settings")
    expect(collapsed).not.toContain("Back")
    expect(collapsed).not.toContain("collapsedSummary")
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("settings dialog (DialogSelect menu)", () => {
  const state = (rootID: string): MutableApi => ({
    sessions: {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      ],
    },
    children: {},
    metas: { [rootID]: { id: rootID, title: "Root" } },
  })

  /** Renders the i-th `dialog.replace` element in the headless renderer. */
  const renderDialog = async (
    stack: Array<{ render: () => unknown; onClose?: () => void }>,
    index = 0,
  ) => {
    const render = stack[index]?.render
    if (typeof render !== "function")
      throw new Error("renderDialog: no dialog element")
    return testRender(render as never, { width: 60, height: 20 })
  }

  test("opens a DialogSelect with one option per preference showing the current value", async () => {
    const rootID = "ses_dialog_open"
    purgeTreeCache()
    dialogProps.length = 0
    const { api, dialog, dispose } = await mountEntry(state(rootID), {}, false)
    showSettingsDialog(api)
    expect(dialog.stack).toHaveLength(1)
    const setup = await renderDialog(dialog.stack)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("TokenMeter Settings"),
    )
    const frame = setup.captureCharFrame()
    expect(frame).toContain("TokenMeter Settings")
    expect(frame).toContain("Cache: combined")
    expect(frame).toContain("Numbers: compact")
    expect(frame).toContain("Summary: session")
    expect(frame).toContain("Subagents: collapsed")
    expect(frame).toContain("Shortcut: Ctrl+E")
    // The single Settings command's options are grouped into the native
    // category subsections `Sidebar` and `Footer` (installed
    // `TuiDialogSelectOption.category`), each header rendered once before
    // its contiguous run of options.
    expect(frame).toContain("Sidebar")
    expect(frame).toContain("Footer")
    const options = dialogProps[0]?.options ?? []
    expect(options).toHaveLength(11)
    expect(options.slice(0, 5).every((opt) => opt.category === "Sidebar")).toBe(
      true,
    )
    expect(options.slice(5).every((opt) => opt.category === "Footer")).toBe(
      true,
    )
    dispose()
  }, 20000)

  test("selecting an option cycles its preference and the SAME dialog re-renders reactively with the new value", async () => {
    const rootID = "ses_dialog_cycle"
    purgeTreeCache()
    dialogProps.length = 0
    const { api, dialog, kvWrites, dispose } = await mountEntry(
      state(rootID),
      {},
      false,
    )
    showSettingsDialog(api)
    expect(dialog.replaces()).toBe(1)
    const setup = await renderDialog(dialog.stack)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Cache: combined"),
    )

    // Selecting Cache cycles combined -> separated. The dialog is NOT
    // re-opened: the titles re-read the live settings signals, so the same
    // stack entry re-renders reactively and the SAME mounted DialogSelect
    // repaints with the fresh title — no second `replace`.
    const first = dialogProps[0]
    const cacheSelect = first?.onSelect
    const cacheOption = first?.options[0]
    if (cacheSelect && cacheOption) cacheSelect(cacheOption)
    expect(settings().cache).toBe("separated")
    expect(dialog.stack).toHaveLength(1)
    expect(dialog.replaces()).toBe(1)
    expect(kvWrites).toContain(SETTINGS_KV_KEY)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Cache: separated"),
    )
    expect(setup.captureCharFrame()).not.toContain("Cache: combined")

    // Summary cycles session -> project -> session across two selections on
    // the SAME mounted dialog (same props record, same onSelect closure).
    const summarySelect = dialogProps[0]?.onSelect
    const summaryOption = dialogProps[0]?.options[2]
    if (summarySelect && summaryOption) summarySelect(summaryOption)
    expect(settings().collapsedSummary).toBe("project")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Summary: project"),
    )
    summarySelect?.(summaryOption)
    expect(settings().collapsedSummary).toBe("session")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Summary: session"),
    )
    expect(kvWrites.filter((key) => key === SETTINGS_KV_KEY).length).toBe(3)
    expect(dialog.replaces()).toBe(1)
    dispose()
  }, 20000)

  test("REGRESSION: selecting an option keeps the SAME dialog stack entry and render identity — no replace, filter query preserved, titles reactive", async () => {
    const rootID = "ses_dialog_identity"
    purgeTreeCache()
    dialogProps.length = 0
    const { api, dialog, dispose } = await mountEntry(state(rootID), {}, false)
    showSettingsDialog(api)
    const setup = await renderDialog(dialog.stack)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("TokenMeter Settings"),
    )
    const renderBefore = dialog.stack[0]?.render
    const onCloseBefore = dialog.stack[0]?.onClose
    expect(dialog.replaces()).toBe(1)

    // The user types a filter query into the host-owned input. The mock
    // mirrors the host: the query lives INSIDE the DialogSelect instance
    // (the installed API exposes only the outbound `onFilter`), so only
    // recreating the dialog could reset it.
    mockDialogSelectApiRef.current?.setFilter("cach")
    await waitForFrameDriven(setup, (frame) => frame.includes("[filter: cach]"))

    // Selecting an option cycles the preference WITHOUT calling replace
    // again: exactly the same stack entry and render function, exactly one
    // DialogSelect instance (one props record), and the typed query
    // survives on the same instance.
    const props0 = dialogProps[0]
    const cacheOption = props0?.options[0]
    props0?.onSelect?.(cacheOption!)
    expect(settings().cache).toBe("separated")
    expect(dialog.replaces()).toBe(1)
    expect(dialog.stack).toHaveLength(1)
    expect(dialog.stack[0]?.render).toBe(renderBefore)
    expect(dialog.stack[0]?.onClose).toBe(onCloseBefore)
    expect(dialogProps).toHaveLength(1)
    // The SAME mounted instance repaints reactively with the cycled value
    // AND keeps the filter query — no focus/search reset.
    await waitForFrameDriven(
      setup,
      (frame) =>
        frame.includes("Cache: separated") && frame.includes("[filter: cach]"),
    )
    expect(setup.captureCharFrame()).not.toContain("Cache: combined")
    dispose()
  }, 20000)

  test("the Shortcut row shows the current binding and cycling it re-registers the layer on the SAME dialog", async () => {
    const rootID = "ses_dialog_shortcut"
    purgeTreeCache()
    dialogProps.length = 0
    const { api, dialog, layers, kvWrites, dispose } = await mountEntry(
      state(rootID),
      {},
      false,
    )
    showSettingsDialog(api)
    expect(dialog.stack).toHaveLength(1)
    const setup = await renderDialog(dialog.stack)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Shortcut: Ctrl+E"),
    )
    expect(setup.captureCharFrame()).toContain("Shortcut: Ctrl+E")

    // The entry registered the default binding for the toggle layer.
    const toggleLayer = () =>
      layers.find((layer) => layer.commands?.[0]?.name === TOGGLE_COMMAND_NAME)
    expect(toggleLayer()?.bindings?.[0]?.key).toBe("ctrl+e")

    const select = dialogProps[0]?.onSelect
    const shortcutOption = dialogProps[0]?.options[4]
    expect(shortcutOption?.title).toBe("Shortcut: Ctrl+E")
    select?.(shortcutOption!)
    expect(toggleShortcut()).toBe("ctrl+shift+e")
    expect(kvWrites).toContain(TOGGLE_SHORTCUT_KV_KEY)
    // The SAME dialog re-renders reactively with the new label — no replace,
    // focus preserved (the previous-fix contract).
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("Shortcut: Ctrl+Shift+E"),
    )
    expect(dialog.replaces()).toBe(1)
    // The layer was re-registered with the new binding; command preserved.
    expect(toggleLayer()?.bindings?.[0]?.key).toBe("ctrl+shift+e")
    expect(toggleLayer()?.commands?.[0]?.name).toBe(TOGGLE_COMMAND_NAME)

    // Cycle through to Off: the binding disappears, the command stays.
    select?.(shortcutOption!)
    expect(toggleShortcut()).toBe("ctrl+m")
    select?.(shortcutOption!)
    expect(toggleShortcut()).toBe("off")
    await waitForFrameDriven(setup, (frame) => frame.includes("Shortcut: Off"))
    expect(toggleLayer()?.bindings).toEqual([])
    expect(toggleLayer()?.commands?.[0]?.name).toBe(TOGGLE_COMMAND_NAME)
    expect(dialog.replaces()).toBe(1)
    dispose()
  }, 20000)

  test("cancelling closes the dialog without changing preferences", async () => {
    const rootID = "ses_dialog_cancel"
    purgeTreeCache()
    dialogProps.length = 0
    const { api, dialog, dispose } = await mountEntry(state(rootID), {}, false)
    showSettingsDialog(api)
    expect(dialog.clears()).toBe(0)

    // The host fires the stack-level onClose on Escape/cancel; the module
    // wires it to `api.ui.dialog.clear()`.
    const onClose = dialog.stack[0]?.onClose
    expect(onClose).toBeDefined()
    onClose?.()
    expect(dialog.clears()).toBe(1)
    expect(dialog.stack).toHaveLength(0)
    expect(settings().cache).toBe("combined")
    expect(settings().numbers).toBe("compact")
    expect(settings().collapsedSummary).toBe("session")
    expect(subagentsPref()).toBe("collapsed")
    dispose()
  }, 20000)
})

describe("palette command (keymap.registerLayer seam)", () => {
  const state = (rootID: string): MutableApi => ({
    sessions: {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
      ],
    },
    children: {},
    metas: { [rootID]: { id: rootID, title: "Root" } },
  })

  test("registers the Settings command in a TokenMeter-category palette layer; palette run opens the dialog, metrics body unchanged", async () => {
    const rootID = "ses_palette_dialog"
    purgeTreeCache()
    dialogProps.length = 0
    const { slot, layers, dialog, dispose } = await mountEntry(
      state(rootID),
      {},
      false,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))

    // The entry registered exactly two keymap layers: the Settings command
    // in the TokenMeter category (spec: tokenmeter-command-palette —
    // `api.keymap.registerLayer`, namespace "palette", category "TokenMeter")
    // and the toggle-sections layer with its default binding.
    expect(layers).toHaveLength(2)
    const command = layers[0]?.commands?.[0]
    expect(command?.name).toBe("tokenmeter.settings")
    expect(command?.namespace).toBe("palette")
    expect(command?.category).toBe("TokenMeter")
    expect(command?.title).toBe("TokenMeter: Settings")
    expect(command?.run).toBeTypeOf("function")
    if (typeof command?.run !== "function")
      throw new Error("palette run missing")

    const toggleLayer = layers[1]
    expect(toggleLayer?.commands?.[0]?.name).toBe(TOGGLE_COMMAND_NAME)
    expect(toggleLayer?.commands?.[0]?.namespace).toBe("palette")
    expect(toggleLayer?.commands?.[0]?.category).toBe("TokenMeter")
    expect(toggleLayer?.commands?.[0]?.title).toBe(
      "TokenMeter: Expand/Collapse Sections",
    )
    expect(toggleLayer?.bindings).toEqual([
      {
        key: "ctrl+e",
        cmd: TOGGLE_COMMAND_NAME,
        event: "press",
        preventDefault: true,
      },
    ])

    // The host palette dispatches the command by name: run() opens the
    // settings DialogSelect via api.ui.dialog.replace (spec: palette run
    // opens the dialog) while the ALREADY-MOUNTED metric body stays on the
    // frame — no in-panel settings screen ever replaces it.
    command.run()
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    expect(dialog.stack).toHaveLength(1)
    const render = dialog.stack[0]?.render
    if (typeof render !== "function")
      throw new Error("palette dialog render missing")
    const dialogSetup = await testRender(render as never, {
      width: 60,
      height: 20,
    })
    await waitForFrameDriven(dialogSetup, (frame) =>
      frame.includes("TokenMeter Settings"),
    )
    const dialogFrame = dialogSetup.captureCharFrame()
    expect(dialogFrame).toContain("Cache: combined")
    expect(dialogFrame).toContain("Summary: session")
    expect(dialogFrame).toContain("Subagents: collapsed")

    // The sidebar metrics body never changed: same rows, no settings rows.
    const metricsAfter = setup.captureCharFrame()
    expect(metricsAfter).toContain("41K tokens · $0.01")
    expect(metricsAfter).not.toContain("collapsedSummary")
    expect(metricsAfter).not.toContain("Back")
    disposeReconcile()
    dispose()
  }, 20000)

  test("the layer disposers are wired to lifecycle.onDispose: dispose unregisters BOTH layers", async () => {
    const rootID = "ses_palette_dispose"
    purgeTreeCache()
    const { slot, layers, dispose } = await mountEntry(state(rootID))
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    expect(layers).toHaveLength(2)

    // mountEntry.dispose() runs every lifecycle.onDispose handler; the
    // returned registerLayer disposers must be among them, so BOTH the
    // palette layer and the toggle layer disappear from the keymap when the
    // plugin is disposed.
    disposeReconcile()
    dispose()
    expect(layers).toHaveLength(0)
  }, 20000)

  test("running the toggle command expands all sections together and collapses them together (Subagents persists)", async () => {
    const rootID = "ses_toggle_cmd"
    const childID = "ses_toggle_cmd_child"
    purgeTreeCache()
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [childID]: [],
      },
      children: { [rootID]: [{ id: childID, agent: "general" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "general" },
      },
    }
    const project: ProjectState = {
      current: { id: "proj_toggle", worktree: "/wt" },
      sessions: [
        {
          id: "pt1",
          projectID: "proj_toggle",
          cost: 0.01,
          tokens: { input: 1000, output: 500, reasoning: 200 },
        },
      ],
    }
    const { slot, layers, kvWrites, dispose } = await mountEntry(
      state,
      project,
      false,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      {
        width: 60,
        height: 20,
      },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()!.groups.length === 1)
    await waitFor(() => projectSnapshot() !== null)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))

    const toggleLayer = layers.find(
      (layer) => layer.commands?.[0]?.name === TOGGLE_COMMAND_NAME,
    )
    const run = toggleLayer?.commands?.[0]?.run
    if (typeof run !== "function") throw new Error("toggle run missing")

    // All three sections start collapsed.
    let frame = setup.captureCharFrame()
    expect(frame).toContain(`${GLYPH.expand} Project`)
    expect(frame).toContain(`${GLYPH.expand} Session`)
    expect(frame).toContain(`${GLYPH.expand} Subagents`)

    // Palette invocation expands ALL THREE together on the mounted panel.
    run()
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.collapse} Subagents`),
    )
    frame = setup.captureCharFrame()
    expect(frame).toContain(`${GLYPH.collapse} Project`)
    expect(frame).toContain(`${GLYPH.collapse} Session`)
    expect(frame).toContain(`${GLYPH.collapse} Subagents`)
    // The Subagents expansion is durable (cycleSubagents write).
    expect(kvWrites.filter((key) => key === SUBAGENTS_KV_KEY)).toHaveLength(1)

    // A second invocation collapses all three; the Subagents collapse
    // persists too.
    run()
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`${GLYPH.expand} Subagents`),
    )
    frame = setup.captureCharFrame()
    expect(frame).toContain(`${GLYPH.expand} Project`)
    expect(frame).toContain(`${GLYPH.expand} Session`)
    expect(kvWrites.filter((key) => key === SUBAGENTS_KV_KEY)).toHaveLength(2)
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("subagents scrollbox (global disclosure, per-agent compact rows, exclusive replace-on-expand, real scroll)", () => {
  test("REGRESSION: zero subagent groups render NO Subagents heading, no scrollbox and no 0-count caption — zero vertical space", async () => {
    // The session has usage but NO delegations: the snapshot has zero
    // groups. The Subagents section must consume zero vertical space with
    // both the collapsed pref (no `▶ Subagents (0 agents · 0 tasks)`
    // caption) and the expanded pref (no heading + empty scrollbox).
    const rootID = "ses_sub_empty_groups"
    const noGroups: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    for (const expanded of [false, true]) {
      purgeTreeCache()
      const { slot, dispose } = await mountEntry(noGroups, {}, expanded)
      const setup = await testRender(
        () => slot({ theme: THEME }, { session_id: rootID }) as never,
        { width: 60, height: 20 },
      )
      await waitFor(() => snapshot()?.rootID === rootID)
      await waitFor(() => snapshot()!.groups.length === 0)
      await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
      const frame = setup.captureCharFrame()
      // No heading, no caption, no agent rows, no scroll container.
      expect(frame).not.toContain("Subagents")
      expect(frame).not.toContain("agents ·")
      expect(frame).not.toContain("(0 tasks)")
      expect(frame).not.toContain("↳")
      expect(findScrollbox(setup)).toBeNull()
      // Project/Session sections are unaffected.
      expect(frame).toContain(`${GLYPH.expand} Project`)
      expect(frame).toContain(`${GLYPH.expand} Session`)
      expect(frame).toContain("41K tokens · $0.01")
      disposeReconcile()
      dispose()
    }
  }, 20000)

  test("REGRESSION: the Subagents section appears automatically once the first group exists", async () => {
    const rootID = "ses_sub_appears"
    const childID = "ses_sub_appears_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [childID]: [msg("c1", childID, { input: 2000, output: 100 }, 0.001)],
      },
      // First discovery sees NO children: the delegation is invisible.
      children: {},
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, agent: "sdd-apply" },
      },
    }
    purgeTreeCache()
    const { fire, slot, dispose } = await mountEntry(state, {}, false)
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) => frame.includes("41K tokens"))
    // Zero groups on the mounted panel: no Subagents anywhere.
    expect(snapshot()!.groups.length).toBe(0)
    expect(setup.captureCharFrame()).not.toContain("Subagents")

    // The delegated session becomes visible: session.created with a
    // parentID purges the tree cache and the debounced reconcile discovers
    // the child, so the SAME mounted panel gains the Subagents section
    // automatically — no remount.
    state.children = { [rootID]: [{ id: childID, parentID: rootID }] }
    fire("session.created", {
      info: { id: childID, sessionID: childID, parentID: rootID },
    })
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitForFrameDriven(setup, (frame) => frame.includes("Subagents"))
    const frame = setup.captureCharFrame()
    // Collapsed pref: the section appears with the caption showing the real
    // aggregate counts (agent rows only render once expanded).
    expect(frame).toContain("▶ Subagents (1 agent · 1 task)")
    expect(frame).not.toContain("↳ sdd-apply")
    disposeReconcile()
    dispose()
  }, 20000)

  const groupState = (
    rootID: string,
    groups: Array<{
      id: string
      agent: string
      input: number
      output: number
      cost?: number
      runs?: number
    }>,
    root?: { input: number; output: number; cost?: number },
  ): MutableApi => {
    const sessions: MutableApi["sessions"] = {
      [rootID]: [
        msg(
          "r1",
          rootID,
          {
            input: root?.input ?? 1000,
            output: root?.output ?? 100,
          },
          root?.cost ?? 0.001,
        ),
      ],
    }
    const children: MutableApi["children"] = { [rootID]: [] }
    const metas: MutableApi["metas"] = {
      [rootID]: { id: rootID, title: "Root" },
    }
    for (const group of groups) {
      for (let run = 0; run < (group.runs ?? 1); run++) {
        const sid = `${group.id}_${run}`
        sessions[sid] = [
          msg(
            `m_${group.id}_${run}`,
            sid,
            { input: group.input, output: group.output },
            group.cost ?? 0,
          ),
        ]
        children[rootID]!.push({ id: sid, agent: group.agent })
        metas[sid] = { id: sid, agent: group.agent }
      }
    }
    return { sessions, children, metas }
  }

  test("collapsed global row shows the aggregate counts and NO agent list", async () => {
    const rootID = "ses_sub_collapsed"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_sb_build", agent: "build", input: 2000, output: 100 },
        { id: "ses_sb_explore", agent: "explore", input: 2000, output: 100 },
        { id: "ses_sb_general", agent: "general", input: 2000, output: 100 },
        { id: "ses_sb_plan", agent: "plan", input: 2000, output: 100 },
        { id: "ses_sb_test", agent: "test", input: 2000, output: 100 },
        {
          id: "ses_sb_write",
          agent: "write",
          input: 2000,
          output: 100,
          runs: 2,
        },
      ]),
      {},
      false,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 6)
    await waitForFrameDriven(setup, (frame) => frame.includes("Subagents"))
    const collapsed = setup.captureCharFrame()
    // One left-chevron row with aggregate counts — the exact panel frame.
    expect(collapsed).toContain("▶ Subagents (6 agents · 7 tasks)")
    // Collapsed renders NO agent list: no compact agent rows, no cue, no
    // agent names anywhere below the header.
    for (const name of ["build", "explore", "general", "plan", "test", "write"])
      expect(collapsed).not.toContain(`↳ ${name} (`)
    expect(collapsed).not.toContain("more — scroll")
    expect(collapsed).not.toContain("(1 task)")
    disposeReconcile()
    dispose()
  }, 20000)

  test("clicking the global row expands to `▼ Subagents` with NO aggregate and the compact agent list", async () => {
    const rootID = "ses_sub_expand"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_se_build", agent: "build", input: 2000, output: 100 },
        { id: "ses_se_explore", agent: "explore", input: 2000, output: 100 },
        { id: "ses_se_general", agent: "general", input: 2000, output: 100 },
        { id: "ses_se_plan", agent: "plan", input: 2000, output: 100 },
        { id: "ses_se_test", agent: "test", input: 2000, output: 100 },
        {
          id: "ses_se_write",
          agent: "write",
          input: 2000,
          output: 100,
          runs: 2,
        },
      ]),
      {},
      false,
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 6)
    await waitForFrameDriven(setup, (frame) => frame.includes("Subagents"))
    await clickSubagentsHeader(setup, setup.captureCharFrame())
    await waitForFrameDriven(setup, (frame) => frame.includes("▼ Subagents"))
    const frame = setup.captureCharFrame()
    // Expanded header: `▼ Subagents` with NO agent/task counts — the list is
    // the detail.
    expect(frame).toContain("▼ Subagents")
    expect(frame).not.toContain("agents ·")
    expect(frame).not.toContain("(7 tasks)")
    // The compact agent entries render (largest group first): two-line
    // entries inside the scroll viewport.
    expect(frame).toContain(`↳ write (2 tasks) ${GLYPH.expand}`)
    expect(frame).toContain("4K tokens · $0.00")
    expect(frame).toContain(`↳ build (1 task) ${GLYPH.expand}`)
    expect(frame).toContain("2K tokens · $0.00")
    expect(frame).not.toContain("more — scroll")
    disposeReconcile()
    dispose()
  }, 20000)

  test("compact agent two-line entry; clicking replaces it with the three-line detail — L1 exactly once", async () => {
    const rootID = "ses_sub_general"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(
        rootID,
        [
          {
            id: "ses_sg_general",
            agent: "General",
            input: 700000,
            output: 40000,
            cost: 0.022,
            runs: 5,
          },
          { id: "ses_sg_explore", agent: "explore", input: 6000, output: 300 },
        ],
        // A distinct root usage keeps the Session L1 (`3.8M tokens`) from
        // colliding with the General agent's spec-exact `3.7M tokens` L1.
        { input: 100000, output: 10000 },
      ),
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 2)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ General (5 tasks) ${GLYPH.expand}`),
    )
    const compact = setup.captureCharFrame()
    // Compact entry: `↳`-indented header `↳ General (5 tasks) ▶` (closed
    // trailing per-agent chevron) plus the second compact L1 line
    // `3.7M tokens · $0.11`.
    expect(compact).toContain(`↳ General (5 tasks) ${GLYPH.expand}`)
    expect(compact).not.toContain("General (5 tasks) ▼")
    expect(compact).toContain("3.7M tokens · $0.11")
    // No group detail rows while closed.
    expect(compact).not.toContain("3.5M input")
    expect(compact).not.toContain("200K output")

    // Clicking the compact entry replaces its compact lines with the
    // three-line unbulleted detail: the `↳` header stays put and its
    // TRAILING per-agent chevron flips `▶` → `▼`, and the L1 is the same
    // spend line exactly once total — no duplicates. The whole entry keeps
    // the modest two-column nested-list indent (the `↳` marker preserved).
    await clickAgentRow(setup, compact, "General")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("3.5M input · 200K output"),
    )
    const open = setup.captureCharFrame()
    expect(open).toContain(`↳ General (5 tasks) ${GLYPH.collapse}`)
    expect(open).not.toContain(`↳ General (5 tasks) ${GLYPH.expand}`)
    expect(countOccurrences(open, "3.7M tokens · $0.11")).toBe(1)
    expect(open).toContain("3.5M input · 200K output")
    expect(open).toContain("0 reason · 0 cache")
    const agentRow = open
      .split(/[\r\n]+/)
      .find((line) => line.includes(`↳ General (5 tasks) ${GLYPH.collapse}`))
    expect(agentRow).toBeDefined()
    // The Subagents nested-list indent regression: the agent row starts at
    // column 2 (two-column leading spacing before the `↳` marker).
    expect([...(agentRow ?? "")].findIndex((ch) => ch !== " ")).toBe(2)
    // The scrollbox content holds exactly the six rows of the two agents
    // (General open = 4 rows, explore compact = 2 rows) — everything is in
    // the container, nothing sliced away.
    const scrollbox = findScrollbox(setup)
    expect(scrollbox).not.toBeNull()
    expect(scrollbox!.getChildren().length).toBe(6)
    disposeReconcile()
    dispose()
  }, 20000)

  test("exclusive accordion: opening one agent closes the other; clicking the open agent closes it", async () => {
    const rootID = "ses_sub_exclusive"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_sx_explore", agent: "explore", input: 6000, output: 300 },
        { id: "ses_sx_general", agent: "general", input: 4000, output: 200 },
      ]),
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 2)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    expect(setup.captureCharFrame()).not.toContain("6K input · 300 output")

    // Open explore: its detail replaces the compact lines.
    await clickAgentRow(setup, setup.captureCharFrame(), "explore")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("6K input · 300 output"),
    )
    // explore's open detail fills the 4-row viewport: general sits below the
    // fold now, so the REAL scroll container is the only way down to it.
    const scrollbox = findScrollbox(setup)
    expect(scrollbox).not.toBeNull()
    scrollbox!.scrollTo(scrollbox!.scrollHeight)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ general (1 task) ${GLYPH.expand}`),
    )
    // Open general: explore's detail closes (exclusive one-open accordion).
    await clickAgentRow(setup, setup.captureCharFrame(), "general")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("4K input · 200 output"),
    )
    const swapped = setup.captureCharFrame()
    expect(swapped).not.toContain("6K input · 300 output")
    expect(swapped).toContain(`↳ general (1 task) ${GLYPH.collapse}`)

    // Scroll back to the top; clicking the open agent again closes it: no
    // detail rows remain and every compact L1 renders exactly once.
    scrollbox!.scrollTo(0)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    await clickAgentRow(setup, setup.captureCharFrame(), "general")
    await waitForFrameDriven(
      setup,
      (frame) => !frame.includes("4K input · 200 output"),
    )
    const closed = setup.captureCharFrame()
    expect(countOccurrences(closed, "6K tokens · $0.00")).toBe(1)
    expect(countOccurrences(closed, "4K tokens · $0.00")).toBe(1)
    disposeReconcile()
    dispose()
  }, 20000)

  test("the open agent is transient: nothing written to kv, fresh mount starts closed, session change resets", async () => {
    const rootID = "ses_sub_transient"
    purgeTreeCache()
    const first = await mountEntry(
      groupState(rootID, [
        { id: "ses_st_explore", agent: "explore", input: 6000, output: 300 },
        { id: "ses_st_general", agent: "general", input: 4000, output: 200 },
      ]),
    )
    const setup = await testRender(
      () => first.slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    await clickAgentRow(setup, setup.captureCharFrame(), "explore")
    await waitForFrameDriven(setup, (frame) =>
      frame.includes("6K input · 300 output"),
    )
    // Opening a group is transient: no durable write was issued.
    expect(first.kvWrites).toEqual([])
    disposeReconcile()
    first.dispose()

    // A fresh mount starts with no agent detail open.
    purgeTreeCache()
    const second = await mountEntry(
      groupState(rootID, [
        { id: "ses_st_explore", agent: "explore", input: 6000, output: 300 },
        { id: "ses_st_general", agent: "general", input: 4000, output: 200 },
      ]),
    )
    const setup2 = await testRender(
      () => second.slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup2, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    expect(setup2.captureCharFrame()).not.toContain("6K input · 300 output")
    disposeReconcile()
    second.dispose()

    // A session change resets the open agent on the SAME mounted panel.
    const aID = "ses_sub_sess_a"
    const bID = "ses_sub_sess_b"
    const a = groupState(aID, [
      { id: "ses_sa_explore", agent: "explore", input: 6000, output: 300 },
    ])
    const b = groupState(bID, [
      { id: "ses_sb2_explore", agent: "explore", input: 6000, output: 300 },
    ])
    const state: MutableApi = {
      sessions: { ...a.sessions, ...b.sessions },
      children: { ...a.children, ...b.children },
      metas: {
        ...a.metas,
        ...b.metas,
        [aID]: { id: aID, title: "A" },
        [bID]: { id: bID, title: "B" },
      },
    }
    purgeTreeCache()
    const { api, dispose } = await mountEntry(state)
    const [sid, setSid] = createSignal(aID)
    const setup3 = await testRender(
      () =>
        (
          <UsagePanel
            api={api}
            sessionID={sid()}
            subagentsPref={subagentsPref}
            onToggleSubagents={() => cycleSubagents(api)}
            theme={() => THEME.current}
            width={38}
          />
        ) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === aID)
    await waitForFrameDriven(setup3, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    await clickAgentRow(setup3, setup3.captureCharFrame(), "explore")
    await waitForFrameDriven(setup3, (frame) =>
      frame.includes("6K input · 300 output"),
    )
    setSid(bID)
    await waitFor(() => snapshot()?.rootID === bID)
    await waitForFrameDriven(setup3, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    expect(setup3.captureCharFrame()).not.toContain("6K input · 300 output")
    disposeReconcile()
    dispose()
  }, 20000)

  test("all 8 agents render inside the real scrollbox, every one reachable by scrolling, no clipped cue", async () => {
    const rootID = "ses_sub_eight"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_8_build", agent: "build", input: 10000, output: 100 },
        { id: "ses_8_code", agent: "code", input: 9000, output: 100 },
        { id: "ses_8_explore", agent: "explore", input: 8000, output: 100 },
        { id: "ses_8_general", agent: "general", input: 7000, output: 100 },
        { id: "ses_8_plan", agent: "plan", input: 6000, output: 100 },
        { id: "ses_8_review", agent: "review", input: 5000, output: 100 },
        { id: "ses_8_test", agent: "test", input: 4000, output: 100 },
        { id: "ses_8_write", agent: "write", input: 3000, output: 100 },
      ]),
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 8)
    await waitForFrameDriven(setup, (frame) => frame.includes("▼ Subagents"))
    const scrollbox = findScrollbox(setup)
    expect(scrollbox).not.toBeNull()
    // ALL agents are children of the scroll container — nothing sliced: 8
    // agents × 2 compact rows = 16 rows in the content.
    expect(scrollbox!.getChildren().length).toBe(16)
    // The viewport is roughly two compact agents: taller content than the
    // fixed viewport proves real scrolling is required.
    expect(scrollbox!.scrollHeight).toBeGreaterThan(4)
    const top = setup.captureCharFrame()
    expect(top).toContain(`↳ build (1 task) ${GLYPH.expand}`)
    expect(top).toContain(`↳ code (1 task) ${GLYPH.expand}`)
    // Only the viewport renders; the rest of the list is scrolled for.
    expect(top).not.toContain("review")
    expect(top).not.toContain("write")
    expect(top).not.toContain("more — scroll")
    // Scrolling the real scroll container reaches the last agent.
    scrollbox!.scrollTo(scrollbox!.scrollHeight)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ write (1 task) ${GLYPH.expand}`),
    )
    const bottom = setup.captureCharFrame()
    expect(bottom).toContain("3K tokens · $0.00")
    expect(bottom).not.toContain("more — scroll")
    disposeReconcile()
    dispose()
  }, 20000)

  test("one agent renders fully without any scroll interaction", async () => {
    const rootID = "ses_sub_single"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_ss_general", agent: "general", input: 4000, output: 200 },
      ]),
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitFor(() => snapshot()?.groups.length === 1)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ general (1 task) ${GLYPH.expand}`),
    )
    const frame = setup.captureCharFrame()
    // Both compact lines of the single agent render; the content fits the
    // viewport, so no scrolling is needed.
    expect(frame).toContain(`↳ general (1 task) ${GLYPH.expand}`)
    expect(frame).toContain("4K tokens · $0.00")
    const scrollbox = findScrollbox(setup)
    expect(scrollbox).not.toBeNull()
    expect(scrollbox!.scrollHeight).toBeLessThanOrEqual(4)
    disposeReconcile()
    dispose()
  }, 20000)

  test("compact agent colors: ↳ indent+chevron white, name info cyan, tasks in the derived detail tone, primary line white with light-red spend", async () => {
    const rootID = "ses_sub_colors"
    purgeTreeCache()
    const { slot, dispose } = await mountEntry(
      groupState(rootID, [
        { id: "ses_sc_explore", agent: "explore", input: 6000, output: 300 },
        { id: "ses_sc_general", agent: "general", input: 4000, output: 200 },
      ]),
    )
    const setup = await testRender(
      () => slot({ theme: THEME }, { session_id: rootID }) as never,
      { width: 60, height: 20 },
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    await waitForFrameDriven(setup, (frame) =>
      frame.includes(`↳ explore (1 task) ${GLYPH.expand}`),
    )
    const frame = setup.captureCharFrame()
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const fgOf = (text: string): string[] =>
      spans
        .filter((span) => span.text.includes(text))
        .map((span) => rgbToHex(span.fg))
    const white = rgbToHex(RGBA.fromHex("#a8b4dc"))
    const info = rgbToHex(RGBA.fromHex("#00aaff"))
    const error = rgbToHex(RGBA.fromHex("#ff4500"))
    const detail = rgbToHex(detailTone(() => THEME.current))
    // The `↳` indent glyph and the TRAILING per-agent chevron ride
    // theme().text; the agent name renders in the light-blue/cyan
    // theme().info tone (NEVER primary blue, NEVER success green); the task
    // count and parentheses render in the derived detail tone (dimmer than
    // textMuted). The compact token/cost summary renders white with the
    // `$amount` in the light-red error tone — no arbitrary hues appear on
    // agent rows.
    expect(fgOf("↳")).toContain(white)
    expect(fgOf(GLYPH.expand)).toContain(white)
    expect(fgOf("explore")).toContain(info)
    // Both agent entries carry `(1 task)` — every occurrence in the detail
    // tone (dimmer than textMuted).
    expect(fgOf("(1 task)")).toEqual([detail, detail])
    expect(fgOf("6K")).toContain(white)
    expect(fgOf("$0.00")).toContain(error)
    expect(frame).not.toContain("spent")
    // The Subagents nested-list indent regression: every agent HEADER row
    // starts at column 2 (two-column leading spacing before the `↳`
    // marker) and every agent METRIC row starts at column 4 (aligned under
    // the header's name, after the `  ↳ ` prefix).
    const rows = frame.split(/[\r\n]+/).filter((line) => line.includes("↳"))
    for (const row of rows) {
      expect([...row].findIndex((ch) => ch !== " ")).toBe(2)
    }
    const metricRows = frame
      .split(/[\r\n]+/)
      .filter(
        (line) =>
          line.trim().startsWith("6K tokens") ||
          line.trim().startsWith("4K tokens"),
      )
    for (const row of metricRows) {
      expect([...row].findIndex((ch) => ch !== " ")).toBe(4)
    }
    disposeReconcile()
    dispose()
  }, 20000)
})

describe("footer metrics (session_prompt slot: current session only, reactive, settings-driven)", () => {
  /**
   * Mounts the REAL footer slot (entry-registered `session_prompt`) in the
   * headless renderer, exactly like the sidebar tests mount the
   * sidebar_content slot. The host calls this slot with `replace` and passes
   * the visible session's id plus the prompt-row props; the frame contains
   * the re-rendered native prompt row followed by the metric line.
   */
  const mountFooter = async (
    footerSlot: (ctx: unknown, props: unknown) => unknown,
    sessionID: string,
    width = 60,
  ) =>
    testRender(
      () =>
        footerSlot(
          { theme: THEME },
          {
            session_id: sessionID,
            visible: true,
            disabled: false,
            on_submit: () => {},
            ref: () => {},
          },
        ) as never,
      {
        width,
        height: 3,
      },
    )

  test("replaces the native prompt row: forwards host props and renders the metric line directly below with no gap", async () => {
    const rootID = "ses_footer_route"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("f1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    const { footerSlot, slotRegistration, setRoute, dispose } =
      await mountEntry(state)
    // Issue #24 placement fix: the metric registers on `session_prompt`, and
    // the old `app_bottom` registration is gone.
    expect(slotRegistration?.slots.app_bottom).toBeUndefined()
    expect(typeof slotRegistration?.slots.session_prompt).toBe("function")
    // Activate the session through the real route effect so the reconcile
    // fills the store; the footer then derives usage from the slot's
    // session_id prop (no route guessing inside the component).
    setRoute({ name: "session", params: { sessionID: rootID } })
    await waitFor(() => snapshot()?.rootID === rootID)
    const setup = await mountFooter(footerSlot, rootID)
    // Default metrics: input + output only, compact magnitudes, no total.
    await setup.waitForFrame((frame) => frame.includes("in 40K · out 1K"))
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("total")
    // The native prompt row renders FIRST and the metric line lands directly
    // below it (no gap, no blank row): the wrapper is a zero-gap vertical box
    // with the host Prompt on top, following the reference plugin pattern.
    const lines = frame.split(/[\r\n]+/)
    const promptRow = lines.findIndex((line) =>
      line.includes(`[prompt:${rootID}]`),
    )
    const footerRow = lines.findIndex((line) => line.includes("in 40K"))
    expect(promptRow).toBeGreaterThanOrEqual(0)
    expect(footerRow).toBe(promptRow + 1)
    // Right-aligned against the prompt row width with no padding, as an
    // ordinary muted text line — no bold, no custom style.
    const row = lines[footerRow]
    expect(row).toMatch(/^ +in 40K · out 1K$/)
    expect(row?.length).toBe(60)
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const muted = rgbToHex(RGBA.fromHex("#a9b1d6"))
    const fg = spans
      .filter((span) => span.text.includes("in 40K"))
      .map((span) => rgbToHex(span.fg))
    expect(fg).toEqual([muted])
    // Every host slot prop is forwarded to the native Prompt.
    const forwarded = promptProps.at(-1)
    expect(forwarded?.sessionID).toBe(rootID)
    expect(forwarded?.visible).toBe(true)
    expect(forwarded?.disabled).toBe(false)
    expect(typeof forwarded?.onSubmit).toBe("function")
    expect(typeof forwarded?.ref).toBe("function")
    // A session without observed usage renders the native prompt alone — no
    // metric line — and Home never mounts this slot (issue #24 measures the
    // active session only; no Home metric is invented).
    const empty = await mountFooter(footerSlot, "ses_footer_empty")
    await empty.renderOnce()
    const emptyFrame = empty.captureCharFrame()
    expect(emptyFrame).toContain("[prompt:ses_footer_empty]")
    expect(emptyFrame).not.toContain("in ")
    expect(emptyFrame).not.toContain("out ")
    disposeReconcile()
    dispose()
  }, 20000)

  test("excludes delegated descendants (root session only) and never drops after a smaller snapshot", async () => {
    const rootID = "ses_footer_root"
    const childID = "ses_footer_child"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg("r1", rootID, { input: 40000, output: 1000, total: 42000 }, 0.01),
        ],
        [childID]: [
          msg(
            "c1",
            childID,
            { input: 500000, output: 50000, total: 550000 },
            0.5,
          ),
        ],
      },
      children: { [rootID]: [{ id: childID, title: "Child" }] },
      metas: {
        [rootID]: { id: rootID, title: "Root" },
        [childID]: { id: childID, title: "Child" },
      },
    }
    purgeTreeCache()
    const {
      footerSlot,
      fire,
      setRoute,
      state: mutable,
      dispose,
    } = await mountEntry(state)
    setRoute({ name: "session", params: { sessionID: rootID } })
    await waitFor(() => snapshot()?.rootID === rootID)
    const setup = await mountFooter(footerSlot, rootID)
    // The snapshot aggregates root + child (591K), but the footer must show
    // the ROOT session's own usage only — the child's 500K never appears.
    await waitFor(() => snapshot()?.totalTokens === 591000)
    await setup.waitForFrame((frame) => frame.includes("in 40K · out 1K"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("in 40K · out 1K")
    expect(frame).not.toContain("500K")
    expect(frame).not.toContain("591K")

    // Compaction: the root's authoritative messages are replaced by a
    // smaller set. The store re-reads the fresh client messages (the map
    // shrinks), but the per-field high-water keeps every footer value —
    // a smaller later snapshot can never lower the line.
    mutable.clientSessions = {
      [rootID]: [
        msg("r1", rootID, { input: 5000, output: 100, total: 5100 }, 0.001),
      ],
      [childID]: [
        msg(
          "c1",
          childID,
          { input: 500000, output: 50000, total: 550000 },
          0.5,
        ),
      ],
    }
    fire("session.compacted", { sessionID: rootID })
    // The smaller authoritative load lands: the fresh map holds the smaller
    // values while observedSessionUsage still reports the high-water.
    await waitFor(() => usageMap(rootID).get("r1")?.input === 5000)
    expect(observedSessionUsage(rootID)?.input).toBe(40000)
    expect(observedSessionUsage(rootID)?.output).toBe(1000)
    // The published snapshot and the mounted footer both keep their values.
    expect(snapshot()?.totalTokens).toBe(591000)
    await setup.waitForFrame((frame) => frame.includes("in 40K · out 1K"))
    expect(setup.captureCharFrame()).toContain("in 40K · out 1K")
    disposeReconcile()
    dispose()
  }, 20000)

  test("settings drive the footer: disabled hides the line, independent metric toggles change the subset, precise mode applies", async () => {
    const rootID = "ses_footer_settings"
    const state: MutableApi = {
      sessions: {
        [rootID]: [
          msg(
            "f1",
            rootID,
            {
              input: 40000,
              output: 1000,
              reasoning: 800,
              total: 42900,
              cache: { read: 2000, write: 100 },
            },
            0.01,
          ),
        ],
      },
      children: {},
      metas: { [rootID]: { id: rootID, title: "Root" } },
    }
    purgeTreeCache()
    // Persisted footer state: disabled, defaults otherwise.
    const { footerSlot, api, setRoute, dispose } = await mountEntry(
      state,
      {},
      true,
      {
        cache: "combined",
        numbers: "compact",
        collapsedSummary: "session",
        footer: {
          enabled: false,
          input: true,
          output: true,
          reasoning: false,
          cache: false,
          total: false,
        },
      },
    )
    setRoute({ name: "session", params: { sessionID: rootID } })
    await waitFor(() => snapshot()?.rootID === rootID)
    // Wide enough for the full precise-mode line (66 columns).
    const setup = await mountFooter(footerSlot, rootID, 80)
    await setup.renderOnce()
    // Footer disabled: the native prompt row still renders (the slot
    // REPLACES the prompt — returning nothing would remove it), but the
    // metric line is gone.
    const disabledFrame = setup.captureCharFrame()
    expect(disabledFrame).toContain(`[prompt:${rootID}]`)
    expect(disabledFrame).not.toContain("in 40K")

    // Enable the footer through the real settings writer (ready-gated, same
    // kv the loadSettings read from): default subset appears reactively.
    cycleFooter(api)
    await setup.waitForFrame((frame) => frame.includes("in 40K · out 1K"))
    // Independent toggles: reasoning, then total (total-first ordering),
    // then the combined cache metric.
    cycleFooterMetric(api, "reasoning")
    await setup.waitForFrame((frame) =>
      frame.includes("in 40K · out 1K · reason 800"),
    )
    cycleFooterMetric(api, "total")
    await setup.waitForFrame((frame) =>
      frame.includes("total 44K · in 40K · out 1K · reason 800"),
    )
    cycleFooterMetric(api, "cache")
    await setup.waitForFrame((frame) =>
      frame.includes("total 44K · in 40K · out 1K · reason 800 · cache 2K"),
    )
    // The numbers preference applies to the footer line like the sidebar.
    cycleNumbers(api)
    await setup.waitForFrame((frame) =>
      frame.includes(
        "total 43,900 · in 40,000 · out 1,000 · reason 800 · cache 2,100",
      ),
    )
    disposeReconcile()
    dispose()
  }, 20000)
})
