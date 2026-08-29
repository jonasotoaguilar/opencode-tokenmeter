/**
 * Real-module behavior harness for the TokenMeter usage sidebar.
 *
 * Imports the ACTUAL modules (math, groups, store, reconcile, tree, format,
 * text, glyphs, project) and drives them with a fake SDK client following the
 * opencode-plugin unit-test pattern. Asserts the approved corrections:
 *  - headline spend = per-session CUMULATIVE TOKEN SPEND: each session
 *    contributes `Σ input + Σ output + Σ reasoning + Σ cache.read +
 *    Σ cache.write` across ALL its assistant messages — the exact
 *    reconstruction of OpenCode's billed `tokens.total` (verified against a
 *    real payload: 3167 + 249 + 64 + 66816 + 0 = 70296) — summed across the
 *    root and its recursive descendants, each session ID exactly once.
 *    Cache tokens are billed separately, so they are CUMULATIVE, never a
 *    "latest message" term. Compaction or a smaller later message set can
 *    never lower the stored/displayed spend (each component keeps a
 *    per-field high-water: cost/input/output/reasoning/cacheRead/cacheWrite)
 *  - cumulative input/output/reasoning/cacheRead/cacheWrite/cost stay
 *    separate, with RAW output and RAW reasoning preserved independently;
 *    the displayed output real (output + reasoning) is computed exactly
 *    once. Because every per-session spend includes its cumulative input +
 *    output + reasoning, the coins total is always >= the session's
 *    cumulative input + real output
 *  - the Project coins total reads each ledger entry's EXPLICITLY STORED
 *    complete per-session spend — never derived from cumulative raw fields,
 *    never a per-field maximum across moments, and exactly
 *    `input + output + reasoning + cacheRead + cacheWrite` (so never below
 *    input + output + reasoning); payload-only sessions (never observed via
 *    messages) contribute the payload spend `input + output + reasoning +
 *    cache.read + cache.write` from the payload's own fields
 *  - the Project section sums ALL project sessions the client
 *    session.list endpoint returns — listed with `scope: "project"` (no
 *    directory scoping, no roots filtering, children included) and an
 *    explicit bounded limit (the SDK defaults to 100 rows), then
 *    filtered by session.projectID — plus durable per-session checkpoints
 *    outside the host state directory (`checkpoints.sqlite` under OS data
 *    dir, never `api.state.path.state` nor `api.kv`). A truncated list
 *    (length at the cap) fails closed: prior snapshot preserved, stable
 *    error surfaced. A failed lookup/list keeps the previous snapshot,
 *    surfaces the stable "Unable to load project data" message (projectError)
 *    and never touches Session
 *  - post-delete: session.deleted UPSERTs the delete payload's usage (payload
 *    + last known observed usage merged monotonically, cost reported-wins)
 *    into the same durable checkpoint row BEFORE the refresh — monotonic
 *    WAL `MAX()` + cost `CASE` so concurrent/duplicate deliveries keep
 *    high-water and count once; a delete with no usage is no-op. Passes the
 *    deleted session's projectID as a projectIDHint, so a failing
 *    project.current() right after the delete keeps the projectID and the
 *    refresh still unions the live list plus checkpoints (same total, no
 *    projectError); without a hint the stable error still surfaces
 *  - the Project total = authoritative live session.list **union** checkpoints
 *    by session ID (live + checkpoint merge monotonically and count once,
 *    checkpoint-only survives, duplicate live rows once, alias recovery for
 *    regenerated projectID, cache/context invariants); concurrent instances
 *    immediately see each other's committed writes via WAL. The obsolete
 *    `tokenmeter.sqlite` tombstone/aggregate and v4 kv ledger are never
 *    read/written except for one-time migration
 *  - a single bounded polling timer (~2 s, PROJECT_POLL_DELAY) refreshes
 *    Project on top of the event-driven fast path so a sibling OpenCode
 *    process working in the same project appears in the sidebar; ticks
 *    never overlap an in-flight refresh, duplicate starts are no-ops, and
 *    disposal stops the timer
 *  - costs render with EXACTLY two decimals everywhere via fmtCost — no
 *    3/4-decimal precision
 *  - agent groups order by spend total descending; cost/runs/name only
 *    break ties
 *  - idle invalidation rehydrates a session's usage from the current
 *    messages, reflecting removed/changed messages instead of merging only
 *  - width helpers produce column-safe lines at every sidebar width
 *  - the corrected contract renders NO metric icons: labels identify each
 *    metric and the disclosure chevrons `▶`/`▼` are the only per-row
 *    glyphs besides the agent-entry `↳`; the primary token+cost line
 *    renders in the main-text tone with the `$amount` in light red while
 *    the input/output and reason/cache lines render in the derived detail
 *    tone; the detail lines read
 *    `<total> tokens · $<spend>`, `<input> input · <realOutput> output` and
 *    `<reasoning> reason · <cache> cache` (compact) or the five
 *    single-metric rows (precise)
 *  - the Subagents global row toggles `▶ Subagents (N agents · M tasks)`
 *    ⇄ `▼ Subagents` (aggregate only while collapsed); the three section
 *    titles (Project/Session/Subagents) render in the semantic yellow
 *    `theme().warning` — the `●` heading marker is gone entirely; expanded
 *    renders the
 *    agent list in a REAL scrollbox containing ALL groups — no slice, no
 *    clipped cue, no hidden count
 *  - each compact agent entry is `↳ <name> (<N> tasks) ▶` (`↳` branch and
 *    the TRAILING per-agent chevron in the main-text tone, agent name in
 *    the light-blue/cyan theme().info tone, count and parentheses in the
 *    derived detail tone; the trailing chevron flips `▼` while open) plus
 *    the elastic
 *    `<tokens> tokens · $<spend>` L1;
 *    expanding REPLACES the compact rows with the mode-aware detail rows
 *    (compact: three, precise: five; L1 rendered exactly once), and
 *    one-open exclusivity is
 *    index-keyed and transient (reset on mount/session change, never
 *    persisted)
 *  - the subtitles read Project and Session (singular), both accent-colored
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkpointDeletedSession } from "../src/tokenmeter/durable/deleted"
import { durableDbPath } from "../src/tokenmeter/durable/paths"
import { formatAgentLine, formatMetricLines } from "../src/tokenmeter/format"
import { formatCachePair } from "../src/tokenmeter/format-cache"
import { formatCompactSummary } from "../src/tokenmeter/format-detail"
import { GLYPH } from "../src/tokenmeter/glyphs"
import {
  PROJECT_DB_FILE,
  projectDbPath,
  readDeletedAggregate,
  recordDeletedSession,
} from "../src/tokenmeter/legacy-db"
import {
  realOutput,
  sumMessages,
  sumProjectSessions,
  usageOf,
} from "../src/tokenmeter/math"
import { fmtCost } from "../src/tokenmeter/numbers"
import {
  disposeProjectRefresh,
  PROJECT_REFRESH_DELAY,
  PROJECT_SESSION_LIMIT,
  projectError,
  projectLoading,
  projectSnapshot,
  refreshProject,
  scheduleProjectRefresh,
  setProjectError,
  setProjectSnapshot,
  startProjectPolling,
} from "../src/tokenmeter/project"
import {
  activateRoot,
  disposeReconcile,
  reconcile,
} from "../src/tokenmeter/reconcile"
import {
  forgetSession,
  invalidateUsage,
  observedSessionUsage,
  removeMessageUsage,
  snapshot,
  upsertMessageUsage,
} from "../src/tokenmeter/store"
import {
  clampSidebarWidth,
  contentWidth,
  resolveSidebarWidth,
  textColumns,
  truncateToColumns,
} from "../src/tokenmeter/text"
import {
  getSessionAgent,
  getSessionTitle,
  parseTitleAgent,
  purgeTreeCache,
  rememberSession,
} from "../src/tokenmeter/tree"
import type {
  ProjectSessionLike,
  SessionInfo,
  UsageMessage,
} from "../src/tokenmeter/types"

function must<T>(value: T | null | undefined, message?: string): T {
  if (value == null) throw new Error(message ?? "Unexpected nullish value")
  return value
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

const fakeApi = (
  sessions: Record<string, UsageMessage[]>,
  children: Record<string, SessionInfo[]>,
  metas: Record<string, SessionInfo>,
) => ({
  client: {
    session: {
      messages: async ({ sessionID }: { sessionID: string }) => ({
        data: (sessions[sessionID] ?? []).map((info) => ({ info })),
      }),
      children: async ({ sessionID }: { sessionID: string }) => ({
        data: children[sessionID] ?? [],
      }),
      get: async ({ sessionID }: { sessionID: string }) => ({
        data: metas[sessionID],
      }),
    },
  },
  state: {
    session: {
      messages: () => [],
      status: () => undefined,
    },
  },
})

async function waitFor(check: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error("waitFor: timeout waiting for snapshot")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("context snapshot policy (math.ts)", () => {
  test("usageOf context is the message spend — input + output + reasoning + cache read/write; tokens.total unused", () => {
    // The provider total is NOT used for the displayed spend; a message's
    // standalone contribution is the sum of ALL five billed channels, which
    // reconstructs tokens.total exactly.
    const withTotal = usageOf(
      msg("m1", "ses_root", {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 10, write: 5 },
        total: 200,
      }),
    )
    expect(withTotal?.context).toBe(140)
    expect(withTotal?.cacheRead).toBe(10)
    expect(withTotal?.cacheWrite).toBe(5)
    const absent = usageOf(
      msg("m2", "ses_root", {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 10, write: 5 },
      }),
    )
    expect(absent?.context).toBe(140)
  })

  test("REGRESSION: real-payload parity — the spend formula reconstructs the verified 70,296 total exactly", () => {
    // Verified against a real OpenCode session (ses_011740ed4ffe7vHkmKoHsR1faj,
    // 2 assistant messages): input 3167 + output 249 + reasoning 64 +
    // cache.read 66816 + cache.write 0 = 70296 == the provider tokens.total.
    const m1 = must(
      usageOf(
        msg("m1", "ses_root", {
          input: 2000,
          output: 150,
          reasoning: 40,
          cache: { read: 40000, write: 0 },
          total: 42190,
        }),
      ),
    )
    const m2 = must(
      usageOf(
        msg("m2", "ses_root", {
          input: 1167,
          output: 99,
          reasoning: 24,
          cache: { read: 26816, write: 0 },
          total: 28106,
        }),
      ),
    )
    const s = sumMessages(
      new Map([
        ["m1", m1],
        ["m2", m2],
      ]),
    )
    // The session spend is the sum of ALL five channels across ALL messages
    // — 70296 == the verified tokens.total of the real session.
    expect(s.total).toBe(70296)
    expect(s.input).toBe(3167)
    expect(s.output).toBe(249)
    expect(s.reasoning).toBe(64)
    expect(s.cacheRead).toBe(66816)
    expect(s.cacheWrite).toBe(0)
  })

  test("REGRESSION: screenshot parity — the spend formula reproduces the atomic 48,891 total exactly", () => {
    const m1 = must(
      usageOf(
        msg("m1", "ses_root", {
          input: 27773,
          output: 17,
          reasoning: 109,
          cache: { read: 20992, write: 0 },
        }),
      ),
    )
    // The single observed message contributes the full five-channel spend.
    expect(m1.context).toBe(27773 + 17 + 109 + 20992)
    const s = sumMessages(new Map([["m1", m1]]))
    // The live session showed exactly 48,891; the spend formula must
    // reproduce it field-for-field.
    expect(s.total).toBe(48891)
    expect(s.input).toBe(27773)
    expect(s.output).toBe(17)
    expect(s.reasoning).toBe(109)
    expect(s.cacheRead).toBe(20992)
  })

  test("an assistant message with zero output contributes its tokens — cache read/write are cumulative spend", () => {
    // A mid-thinking message (reasoning but no output yet) contributes its
    // input + reasoning cumulatively, and its cache read/write count into
    // the session spend like every other billed channel.
    const thinking = usageOf(
      msg("m1", "ses_root", {
        input: 1000,
        output: 0,
        reasoning: 500,
        cache: { read: 99999, write: 0 },
      }),
    )
    expect(thinking?.context).toBe(1000 + 500 + 99999)
    expect(thinking?.reasoning).toBe(500)
    const s = sumMessages(new Map([["m1", must(thinking)]]))
    expect(s.total).toBe(1000 + 500 + 99999)
  })

  test("non-assistant messages produce no usage", () => {
    expect(usageOf({ id: "m1", role: "user", tokens: { input: 5 } })).toBeNull()
    expect(usageOf(undefined)).toBeNull()
  })
})

describe("output real accounting (raw output + raw reasoning, exactly once)", () => {
  test("realOutput is raw output + raw reasoning", () => {
    expect(realOutput(1000, 400)).toBe(1400)
    expect(realOutput(0, 0)).toBe(0)
  })

  test("sumProjectSessions keeps raw output and raw reasoning separate; output real is their sum", () => {
    const sessions: ProjectSessionLike[] = [
      {
        id: "a",
        projectID: "p",
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
      },
      {
        id: "b",
        projectID: "p",
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ]
    const usage = sumProjectSessions("p", sessions)
    expect(usage.output).toBe(1200)
    expect(usage.reasoning).toBe(500)
    expect(realOutput(usage.output, usage.reasoning)).toBe(1700)
    expect(usage.sessions).toBe(2)
    // The list payload carries only CUMULATIVE fields; the payload-only
    // spend context is input + output + reasoning + cache.read + cache.write
    // per session (1850 + 3000), so context can never fall below the
    // cumulative input + real output.
    expect(usage.context).toBe(1850 + 3000)
    expect(usage.cacheRead).toBe(100)
    expect(usage.cacheWrite).toBe(50)
    expect(usage.cache).toBe(150)
    expect(usage.context).toBeGreaterThanOrEqual(
      usage.input + realOutput(usage.output, usage.reasoning),
    )
  })

  test("REGRESSION: per-session reasoning is never summed twice into output real", () => {
    const sessions: ProjectSessionLike[] = [
      {
        id: "a",
        projectID: "p",
        tokens: { input: 10, output: 20, reasoning: 5 },
      },
      {
        id: "b",
        projectID: "p",
        tokens: { input: 10, output: 20, reasoning: 5 },
      },
    ]
    const usage = sumProjectSessions("p", sessions)
    // Two sessions: raw output 40, raw reasoning 10, output real 50 — each
    // session's reasoning contributes exactly once.
    expect(usage.output).toBe(40)
    expect(usage.reasoning).toBe(10)
    expect(realOutput(usage.output, usage.reasoning)).toBe(50)
    expect(usage.context).toBe(70)
  })

  test("REGRESSION: cache read/write are CUMULATIVE spend — an old message's cache enters the session total", () => {
    // Message m1 carries a huge cache; message m2 (later) carries none. Both
    // messages' cache tokens are billed, so the session spend accumulates
    // them all: m1's 9.5M cache enters the total, and the separately
    // displayed cache metric is the same cumulative sum.
    const m1 = must(
      usageOf(
        msg("m1", "ses_x", {
          input: 100,
          output: 20,
          reasoning: 5,
          cache: { read: 9000000, write: 500000 },
        }),
      ),
    )
    const m2 = must(
      usageOf(msg("m2", "ses_x", { input: 2000, output: 700, reasoning: 300 })),
    )
    expect(m1.context).toBe(9500125)
    expect(m2.context).toBe(3000)
    const map = new Map([
      ["m1", m1],
      ["m2", m2],
    ])
    const s = sumMessages(map)
    // Spend formula: 2100 + 720 + 305 + 9000000 + 500000 = 9503125 — the
    // old message's cache is accumulated into the total (and the total is
    // always >= cumulative input + output + reasoning).
    expect(s.total).toBe(2100 + 720 + 305 + 9000000 + 500000)
    expect(s.total).toBeGreaterThanOrEqual(s.input + s.output + s.reasoning)
    expect(s.cache).toBe(9500000)
    expect(s.cacheRead).toBe(9000000)
    expect(s.cacheWrite).toBe(500000)
    expect(s.input).toBe(2100)
    expect(s.output).toBe(720)
    expect(s.reasoning).toBe(305)
  })

  test("REGRESSION: cache read/write accumulate into the session spend across messages", () => {
    const m1 = must(
      usageOf(
        msg("m1", "ses_x", {
          input: 100,
          output: 20,
          cache: { read: 100, write: 0 },
        }),
      ),
    )
    const m2 = must(
      usageOf(
        msg("m2", "ses_x", {
          input: 2000,
          output: 700,
          cache: { read: 3000, write: 500 },
        }),
      ),
    )
    const s = sumMessages(
      new Map([
        ["m1", m1],
        ["m2", m2],
      ]),
    )
    expect(s.total).toBe(2100 + 720 + 3100 + 500)
    expect(s.cache).toBe(3600)
    expect(s.cacheRead).toBe(3100)
    expect(s.cacheWrite).toBe(500)
  })
})

describe("session aggregation (complete-session spend, cumulative breakdowns)", () => {
  test("REGRESSION: total is the spend formula — Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write — never the maximum atomic snapshot", () => {
    const map = new Map<string, NonNullable<ReturnType<typeof usageOf>>>()
    map.set(
      "m1",
      must(usageOf(msg("m1", "ses_x", { input: 1000, output: 100 }))),
    )
    map.set(
      "m2",
      must(usageOf(msg("m2", "ses_x", { input: 3000, output: 300 }))),
    )
    map.set(
      "m3",
      must(usageOf(msg("m3", "ses_x", { input: 2000, output: 200 }))),
    )
    const s = sumMessages(map)
    // The largest single-message snapshot is 3300, but the spend formula is
    // the cumulative sum: 6000 + 600 = 6600 — never below cumulative
    // input (6000), which the max-atomic regression violated.
    expect(s.total).toBe(6600)
    expect(s.total).toBeGreaterThanOrEqual(s.input + s.output + s.reasoning)
    expect(s.input).toBe(6000)
  })

  test("cumulative in/out/cache/cost stay separate from the complete-session spend", () => {
    const map = new Map<string, NonNullable<ReturnType<typeof usageOf>>>()
    map.set(
      "m1",
      must(
        usageOf(
          msg(
            "m1",
            "ses_x",
            {
              input: 500,
              output: 100,
              reasoning: 50,
              cache: { read: 30, write: 20 },
              total: 700,
            },
            0.1,
          ),
        ),
      ),
    )
    map.set(
      "m2",
      must(
        usageOf(
          msg(
            "m2",
            "ses_x",
            {
              input: 500,
              output: 100,
              reasoning: 50,
              cache: { read: 30, write: 20 },
              total: 700,
            },
            0.1,
          ),
        ),
      ),
    )
    const s = sumMessages(map)
    // Each message contributes 700 (i+o+r+cr+cw); the spend sums them all:
    // 1000 + 200 + 100 + 60 + 40 = 1400 — every billed cache token counts.
    // tokens.total is unused.
    expect(s.total).toBe(1400)
    expect(s.input).toBe(1000)
    expect(s.output).toBe(200)
    expect(s.reasoning).toBe(100)
    expect(s.cache).toBe(100)
    expect(s.cacheRead).toBe(60)
    expect(s.cacheWrite).toBe(40)
    expect(s.cost).toBeCloseTo(0.2)
  })

  test("message-ID replacement (retry/streaming upsert) keeps one contribution per message", () => {
    const map = new Map<string, NonNullable<ReturnType<typeof usageOf>>>()
    map.set(
      "m1",
      must(usageOf(msg("m1", "ses_x", { input: 1000, output: 100 }))),
    )
    map.set(
      "m1",
      must(usageOf(msg("m1", "ses_x", { input: 2500, output: 250 }))),
    )
    const s = sumMessages(map)
    expect(s.total).toBe(2750)
    expect(s.input).toBe(2500)
  })

  test("REGRESSION: a later SMALLER message set cannot lower the session spend high-water (store level, per-component maxima)", () => {
    const rootID = "ses_hw_live"
    forgetSession(rootID)
    // Full observation: spend 10500 + 1050 = 11550.
    upsertMessageUsage(msg("m1", rootID, { input: 10000, output: 1000 }))
    upsertMessageUsage(msg("m2", rootID, { input: 500, output: 50 }))
    const full = must(observedSessionUsage(rootID))
    expect(full.total).toBe(11550)
    expect(full.input).toBe(10500)
    // Compaction: the old message is gone, the map computes 550 — the
    // per-component high-water (input 10500, output 1050) must survive, so
    // the spend stays 11550 and the displayed components never lower.
    removeMessageUsage(rootID, "m1")
    const compacted = must(observedSessionUsage(rootID))
    expect(compacted.input).toBe(10500)
    expect(compacted.output).toBe(1050)
    expect(compacted.total).toBe(11550)
    expect(compacted.total).toBeGreaterThanOrEqual(
      compacted.input + compacted.output + compacted.reasoning,
    )
    forgetSession(rootID)
  })

  test("REGRESSION: a zero-output tail's cache still counts into the spend — cache is cumulative", () => {
    const m1 = must(
      usageOf(
        msg("m1", "ses_z", {
          input: 100,
          output: 100,
          cache: { read: 200, write: 0 },
        }),
      ),
    )
    const tail = must(
      usageOf(
        msg("m2", "ses_z", {
          input: 0,
          output: 0,
          cache: { read: 9999, write: 0 },
        }),
      ),
    )
    const s = sumMessages(
      new Map([
        ["m1", m1],
        ["m2", tail],
      ]),
    )
    // m2's zero-output message still billed 9999 cache tokens; they count
    // into the session spend like every other billed channel.
    expect(s.total).toBe(100 + 100 + 200 + 9999)
  })

  test("REGRESSION: replacing an existing message keeps one contribution per message — cache stays cumulative", () => {
    const m1 = must(usageOf(msg("m1", "ses_o", { input: 100, output: 10 })))
    const m2 = must(
      usageOf(
        msg("m2", "ses_o", {
          input: 200,
          output: 20,
          cache: { read: 300, write: 0 },
        }),
      ),
    )
    const map = new Map([
      ["m1", m1],
      ["m2", m2],
    ])
    // Replace m1's value (retry/streaming upsert): the key keeps its
    // insertion position, the map still holds exactly one contribution per
    // message, and every billed cache token stays in the spend.
    map.set("m1", must(usageOf(msg("m1", "ses_o", { input: 500, output: 50 }))))
    const s = sumMessages(map)
    expect(s.total).toBe(700 + 70 + 300)
    expect(s.input).toBe(700)
  })
})

describe("project aggregation (project.ts)", () => {
  /** Temp state/durable directories created by this block; removed after each test. */
  const tmps: string[] = []
  const durableTmps: string[] = []
  const tmpStateDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenmeter-test-"))
    tmps.push(dir)
    return dir
  }
  let savedDurable: string | undefined
  // Isolate durable checkpoints per test so union does not leak across tests
  const isolateDurable = () => {
    savedDurable = process.env.TOKENMETER_DURABLE_DIR
    const dir = mkdtempSync(join(tmpdir(), "tokenmeter-durable-"))
    durableTmps.push(dir)
    process.env.TOKENMETER_DURABLE_DIR = dir
  }
  const restoreDurable = () => {
    if (savedDurable === undefined)
      delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
    else process.env.TOKENMETER_DURABLE_DIR = savedDurable
    savedDurable = undefined
    for (const dir of durableTmps.splice(0))
      rmSync(dir, { recursive: true, force: true })
  }
  // Ensure env restored even when test throws
  beforeEach(() => isolateDurable())
  afterEach(() => {
    disposeProjectRefresh()
    for (const dir of tmps.splice(0))
      rmSync(dir, { recursive: true, force: true })
    restoreDurable()
  })

  const projApi = (
    project: { id: string; worktree?: string } | null,
    sessions: ProjectSessionLike[],
    stateDir: string = tmpStateDir(),
  ) => ({
    state: { path: { directory: "/proj/dir", state: stateDir } },
    client: {
      project: {
        current: async ({ directory }: { directory: string }) => {
          expect(directory).toBe("/proj/dir")
          return { data: project ?? undefined }
        },
      },
      session: {
        list: async (params: {
          directory: string
          scope: "project"
          limit: number
        }) => {
          // Directory binds the request to the active server instance, while
          // project scope still crosses worktrees. Children stay included.
          // The explicit limit is REQUIRED: the SDK defaults to 100 rows and
          // a project with more live sessions would silently undercount.
          expect(params.directory).toBe("/proj/dir")
          expect(params.scope).toBe("project")
          expect(params.limit).toBe(PROJECT_SESSION_LIMIT)
          return { data: sessions }
        },
      },
    },
  })

  test("Project sums ALL project sessions by projectID — across directories and children — other projects excluded", async () => {
    setProjectSnapshot(null)
    const sessions: ProjectSessionLike[] = [
      // A session of the project from the CURRENT directory.
      {
        id: "s1",
        projectID: "proj1",
        directory: "/proj/dir",
        cost: 0.01,
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
      },
      // A session of the SAME project from ANOTHER directory/worktree: the
      // list call omits directory, so it must be summed too.
      {
        id: "s2",
        projectID: "proj1",
        directory: "/wt/sibling",
        cost: 0.02,
        tokens: {
          input: 2000,
          output: 700,
          reasoning: 300,
          cache: { read: 0, write: 0 },
        },
      },
      // A CHILD (delegated) session of the project: roots is omitted, so it
      // must be summed too.
      {
        id: "s3",
        projectID: "proj1",
        parentID: "s1",
        cost: 0.005,
        tokens: {
          input: 500,
          output: 100,
          reasoning: 50,
          cache: { read: 25, write: 25 },
        },
      },
      // A session of ANOTHER project must be excluded.
      {
        id: "other",
        projectID: "proj2",
        cost: 99,
        tokens: { input: 999999, output: 999999, reasoning: 999999 },
      },
    ]
    await refreshProject(
      projApi({ id: "proj1", worktree: "/wt" }, sessions) as never,
    )
    const usage = projectSnapshot()
    expect(usage?.id).toBe("proj1")
    // Every live row counts by sessionID — delegations are plain rows too,
    // and no live snapshot is ever persisted.
    expect(usage?.sessions).toBe(3)
    expect(usage?.input).toBe(3500)
    expect(usage?.output).toBe(1300)
    expect(usage?.reasoning).toBe(550)
    expect(usage?.cache).toBe(200)
    expect(usage?.cost).toBeCloseTo(0.035)
    // The list payload carries only CUMULATIVE fields; the payload-only
    // spend context is input + output + reasoning + cache.read + cache.write
    // per session (1850 + 3000 + 700), so Project spend is never below
    // Project cumulative input + real output.
    expect(usage?.context).toBe(5550)
    expect(usage?.cacheRead).toBe(125)
    expect(usage?.cacheWrite).toBe(75)
    expect(usage?.cache).toBe(200)
    expect(must(usage).context).toBeGreaterThanOrEqual(
      must(usage).input + realOutput(must(usage).output, must(usage).reasoning),
    )
    expect(realOutput(must(usage).output, must(usage).reasoning)).toBe(1850)
  })

  test("REGRESSION: Project counts each unique session exactly once — a duplicated sessionID in the live list is summed once", async () => {
    setProjectSnapshot(null)
    const stateDir = tmpStateDir()
    const s1 = (): ProjectSessionLike => ({
      id: "s1",
      projectID: "proj1",
      cost: 0.01,
      tokens: { input: 1000, output: 500, reasoning: 200 },
    })
    const s2: ProjectSessionLike = {
      id: "s2",
      projectID: "proj1",
      cost: 0.02,
      tokens: { input: 2000, output: 700, reasoning: 300 },
    }
    // s1 appears TWICE in the live list (a duplicated payload): the live sum
    // is keyed by sessionID, so the session contributes exactly once.
    await refreshProject(
      projApi({ id: "proj1" }, [s1(), s1(), s2], stateDir) as never,
    )
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.input).toBe(3000)
    // Payload-only sessions use the input + output + reasoning fallback:
    // 1700 + 3000, always >= the cumulative metrics.
    expect(projectSnapshot()?.context).toBe(4700)
    expect(projectSnapshot()?.cache).toBe(0)
    // A repeated refresh with the duplicated list stays idempotent.
    await refreshProject(
      projApi({ id: "proj1" }, [s1(), s1(), s2], stateDir) as never,
    )
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4700)
  })

  test("REGRESSION: the list call receives an explicit bounded limit; exact-cap saturation fails closed with the prior snapshot and the stable error", async () => {
    setProjectSnapshot(null)
    const stateDir = tmpStateDir()
    const params: Array<Record<string, unknown>> = []
    const api = {
      state: { path: { directory: "/proj/dir", state: stateDir } },
      client: {
        project: { current: async () => ({ data: { id: "proj1" } }) },
        session: {
          list: async (p: {
            directory: string
            scope: "project"
            limit: number
          }) => {
            params.push({ ...p })
            return { data: [] }
          },
        },
      },
    }
    // First refresh establishes a snapshot (empty live list, no deletions).
    await refreshProject(api as never)
    expect(params).toHaveLength(1)
    expect(params[0]).toMatchObject({
      directory: "/proj/dir",
      scope: "project",
      limit: PROJECT_SESSION_LIMIT,
    })
    expect(projectSnapshot()?.sessions).toBe(0)
    // Exact-cap saturation: a result AT the limit is a TRUNCATED list — the
    // total would silently undercount, so it must fail closed: prior
    // snapshot preserved, stable error surfaced, no partial total.
    const saturated = {
      state: { path: { directory: "/proj/dir", state: stateDir } },
      client: {
        project: { current: async () => ({ data: { id: "proj1" } }) },
        session: {
          list: async () => ({
            data: Array.from({ length: PROJECT_SESSION_LIMIT }, (_, i) => ({
              id: `s${i}`,
              projectID: "proj1",
              tokens: { input: 1, output: 1, reasoning: 1 },
            })),
          }),
        },
      },
    }
    await refreshProject(saturated as never)
    expect(projectError()).toBe("Unable to load project data")
    expect(projectLoading()).toBe(false)
    // The truncated total never replaced the prior snapshot.
    expect(projectSnapshot()?.sessions).toBe(0)
    expect(projectSnapshot()?.context).toBe(0)
  })

  test("REGRESSION: one instance immediately sees another instance's committed delete — same-project refresh reads updated client totals plus the shared durable checkpoint", async () => {
    setProjectSnapshot(null)
    const stateDir = tmpStateDir()
    const durableDir = mkdtempSync(join(tmpdir(), "tokenmeter-durable-"))
    const prevDurable = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = durableDir
    try {
      const durablePath = durableDbPath()!
      const s2: ProjectSessionLike = {
        id: "s2",
        projectID: "proj1",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      }
      const api = projApi({ id: "proj1" }, [s2], stateDir)
      await refreshProject(api as never)
      expect(projectSnapshot()?.sessions).toBe(1)
      expect(projectSnapshot()?.context).toBe(3000)
      // A DIFFERENT process (its own connection) checkpoints s1.
      checkpointDeletedSession(
        durablePath,
        {
          id: "s1",
          projectID: "proj1",
          cost: 0.01,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          },
        },
        "/proj/dir",
      )
      // The refresh reads the shared durable checkpoint immediately via union.
      await refreshProject(api as never)
      expect(projectSnapshot()?.sessions).toBe(2)
      expect(projectSnapshot()?.context).toBe(4850)
      expect(projectSnapshot()?.input).toBe(3000)
      expect(projectSnapshot()?.cache).toBe(150)
      expect(projectError()).toBeNull()
    } finally {
      if (prevDurable === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = prevDurable
      rmSync(durableDir, { recursive: true, force: true })
    }
  })

  test("REGRESSION: post-delete — a failing project.current() with the projectIDHint keeps the project total (live list + durable checkpoint), no error flash", async () => {
    setProjectSnapshot(null)
    const stateDir = tmpStateDir()
    const durableDir = mkdtempSync(join(tmpdir(), "tokenmeter-durable-"))
    const prevDurable = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = durableDir
    try {
      const durablePath = durableDbPath()!
      const sessions: ProjectSessionLike[] = [
        {
          id: "ps2",
          projectID: "proj_x",
          cost: 0.02,
          tokens: { input: 2000, output: 700, reasoning: 300 },
        },
      ]
      const api = projApi(null, sessions, stateDir)
      checkpointDeletedSession(
        durablePath,
        {
          id: "ps1",
          projectID: "proj_x",
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          },
        },
        "/proj/dir",
      )
      await refreshProject(api as never, "proj_x")
      expect(projectError()).toBeNull()
      expect(projectSnapshot()?.sessions).toBe(2)
      expect(projectSnapshot()?.context).toBe(4850)
      setProjectSnapshot(null)
      setProjectError(null)
      await refreshProject(api as never)
      expect(projectError()).toBe("Unable to load project data")
      expect(projectSnapshot()).toBeNull()
    } finally {
      if (prevDurable === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = prevDurable
      rmSync(durableDir, { recursive: true, force: true })
    }
  })

  test("REGRESSION: payload and observed usage merge per-component — a delete carries both and the field maxima win", async () => {
    const stateDir = tmpStateDir()
    const dbPath = projectDbPath(stateDir)
    // The payload snapshot (server fields) is smaller on input but larger on
    // cache than the plugin's observed message aggregate: the persisted
    // entry must keep each field's maximum, exactly like the store.
    recordDeletedSession(
      dbPath,
      {
        id: "s1",
        projectID: "proj1",
        cost: 0.05,
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
      },
      {
        cost: 0.01,
        input: 2000,
        output: 700,
        reasoning: 300,
        cacheRead: 0,
        cacheWrite: 0,
        cache: 0,
        total: 3000,
      },
    )
    expect(readDeletedAggregate(dbPath, "proj1")).toMatchObject({
      cost: 0.05,
      input: 2000,
      output: 700,
      reasoning: 300,
      cacheRead: 100,
      cacheWrite: 50,
      cache: 150,
      context: 3150,
    })
  })

  test("REGRESSION: post-delete — a failing project.current() with the projectIDHint keeps the project total (live list + deleted aggregate), no error flash", async () => {
    setProjectSnapshot(null)
    const stateDir = tmpStateDir()
    const dbPath = projectDbPath(stateDir)
    const sessions: ProjectSessionLike[] = [
      {
        id: "ps2",
        projectID: "proj_x",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ]
    // project.current() returns no data: the transient context gap right
    // after a delete.
    const api = projApi(null, sessions, stateDir)
    // The delete already recorded the aggregate (written BEFORE the refresh).
    recordDeletedSession(dbPath, {
      id: "ps1",
      projectID: "proj_x",
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 200,
        cache: { read: 100, write: 50 },
      },
    })
    await refreshProject(api as never, "proj_x")
    expect(projectError()).toBeNull()
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4850)
    // Without a hint the same failure surfaces the stable error.
    setProjectSnapshot(null)
    setProjectError(null)
    await refreshProject(api as never)
    expect(projectError()).toBe("Unable to load project data")
    expect(projectSnapshot()).toBeNull()
  })

  test("Project lookup failure keeps the previous snapshot and surfaces the stable error; no throw", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const api = { client: {} }
    await refreshProject(api as never)
    expect(projectSnapshot()).toBeNull()
    // A rejected/missing lookup surfaces the stable message — never a raw
    // runtime error ("undefined is not an object", stacks, etc).
    expect(projectError()).toBe("Unable to load project data")
    expect(must(projectError())).not.toContain("undefined is not an object")
  })

  test("project.current without data is an error, not a silent placeholder", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    await refreshProject(projApi(null, []) as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
  })

  test("session.list without data is an error, not a silent empty list", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const api = {
      state: { path: { directory: "/proj/dir", state: tmpStateDir() } },
      client: {
        project: { current: async () => ({ data: { id: "p" } }) },
        session: {
          list: async () => ({ data: undefined }),
        },
      },
    }
    await refreshProject(api as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
  })

  test("projectLoading is true while the refresh runs and flips back to false on success AND on failure (finally)", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const stateDir = tmpStateDir()
    const sessions: ProjectSessionLike[] = [
      {
        id: "s1",
        projectID: "proj1",
        cost: 0.01,
        tokens: { input: 1000, output: 500, reasoning: 200 },
      },
    ]
    // Success path: loading is observable synchronously and settles to false,
    // and any stale error is cleared.
    const run = refreshProject(
      projApi({ id: "proj1" }, sessions, stateDir) as never,
    )
    expect(projectLoading()).toBe(true)
    await run
    expect(projectLoading()).toBe(false)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectError()).toBeNull()

    // Failure path: the finally still clears the loading flag, so the panel
    // never keeps the indicator after an error. The lookup rejects after an
    // await, so the flag is observably true while the refresh is in flight.
    setProjectSnapshot(null)
    const failing = {
      state: { path: { directory: "/proj/dir", state: stateDir } },
      client: {
        project: {
          current: async () => {
            throw new Error("boom")
          },
        },
      },
    }
    const runFail = refreshProject(failing as never)
    expect(projectLoading()).toBe(true)
    await runFail
    expect(projectLoading()).toBe(false)
    expect(projectSnapshot()).toBeNull()
    // Raw runtime detail never surfaces: always the stable message.
    expect(projectError()).toBe("Unable to load project data")
    expect(must(projectError())).not.toContain("boom")

    // Starting a refresh clears the error immediately, so an in-flight or
    // successful refresh never shows a stale error.
    setProjectError("stale error")
    const clearing = refreshProject(
      projApi({ id: "proj1" }, sessions, stateDir) as never,
    )
    expect(projectError()).toBeNull()
    await clearing
    expect(projectError()).toBeNull()
  })

  test("Project list failure keeps the placeholder and surfaces the stable error; no throw", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const api = {
      state: { path: { directory: "/proj/dir", state: tmpStateDir() } },
      client: {
        project: { current: async () => ({ data: { id: "p" } }) },
        session: {
          list: async () => {
            throw new Error("boom")
          },
        },
      },
    }
    await refreshProject(api as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
    expect(must(projectError())).not.toContain("boom")
  })

  test("REGRESSION: a client exposing only the old experimental.session.list path fails with the stable message, never a raw undefined error", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    // The production failure: `experimental` does not exist on the runtime
    // client, so only the old shape yields `undefined is not an object`.
    const api = {
      state: { path: { directory: "/proj/dir", state: tmpStateDir() } },
      client: {
        project: { current: async () => ({ data: { id: "p" } }) },
        experimental: {
          session: {
            list: async () => ({ data: [{ id: "s1", projectID: "p" }] }),
          },
        },
      },
    }
    await refreshProject(api as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
    expect(must(projectError())).not.toContain("undefined is not an object")
    expect(must(projectError())).not.toContain("\n    at ")
  })

  test("REGRESSION: project.ts targets the stable client API only — explicit limit, no experimental, no archived, no kv, no raw error capture", () => {
    const src = readFileSync(
      new URL("../src/tokenmeter/project.ts", import.meta.url),
      "utf8",
    )
    expect(src).toMatch(
      /session\.list\(\{\s*directory,\s*scope: "project",\s*limit: PROJECT_SESSION_LIMIT,\s*\}\)/,
    )
    expect(src).toContain("project.current({ directory })")
    expect(src).toContain("Unable to load project data")
    expect(src).not.toContain("experimental")
    expect(src).not.toContain("archived")
    expect(src).not.toContain("api.kv")
    expect(src).not.toContain("kv.ready")
    expect(src).not.toContain("String(error)")
    expect(src).not.toContain("error.message")
  })

  test("scheduleProjectRefresh debounces and disposes its timer", async () => {
    setProjectSnapshot(null)
    disposeProjectRefresh()
    const stateDir = tmpStateDir()
    const api = projApi(
      { id: "proj1" },
      [
        {
          id: "s1",
          projectID: "proj1",
          tokens: { input: 100, output: 50, reasoning: 10 },
        },
      ],
      stateDir,
    )
    // Two rapid schedules collapse into one debounced refresh.
    scheduleProjectRefresh(api as never)
    scheduleProjectRefresh(api as never, PROJECT_REFRESH_DELAY * 2)
    // Disposal before the delay fires cancels the refresh.
    disposeProjectRefresh()
    await sleep(PROJECT_REFRESH_DELAY + 100)
    expect(projectSnapshot()).toBeNull()
    // Without disposal the debounced refresh lands.
    scheduleProjectRefresh(api as never, 20)
    await waitFor(() => projectSnapshot()?.sessions === 1)
    expect(projectSnapshot()?.input).toBe(100)
  })

  test("REGRESSION: polling — a single timer refreshes Project on the cadence, never overlaps, and disposes cleanly", async () => {
    setProjectSnapshot(null)
    disposeProjectRefresh()
    const stateDir = tmpStateDir()
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const list = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls += 1
      // Slower than the tick: an overlapping poll would stack calls.
      await sleep(25)
      inFlight -= 1
      return {
        data: [
          {
            id: "s1",
            projectID: "proj1",
            tokens: { input: 100, output: 50, reasoning: 10 },
          },
        ],
      }
    }
    const api = {
      state: { path: { directory: "/proj/dir", state: stateDir } },
      client: {
        project: { current: async () => ({ data: { id: "proj1" } }) },
        session: { list },
      },
    }
    startProjectPolling(api as never, 20)
    startProjectPolling(api as never, 20) // duplicate start is a no-op
    await waitFor(() => calls >= 3)
    expect(projectSnapshot()?.sessions).toBe(1)
    // Ticks never overlap: at most one refresh in flight at any moment.
    expect(maxInFlight).toBe(1)
    disposeProjectRefresh()
    const before = calls
    await sleep(100)
    expect(calls).toBe(before)
  })
})
describe("reconcile snapshot (root + recursive descendants)", () => {
  test("REGRESSION: the Session coins total is the sum of per-session spends (each session once) — components stay cumulative", async () => {
    const rootID = "ses_root_reg"
    const childID = "ses_child_reg"
    const sessions = {
      [rootID]: [
        msg("r1", rootID, { input: 50000, output: 2000 }, 0.01),
        msg("r2", rootID, { input: 50000, output: 2000 }, 0.01),
        msg("r3", rootID, { input: 50000, output: 2000 }, 0.01),
        msg("r4", rootID, { input: 50000, output: 2000 }, 0.01),
      ],
      [childID]: [
        msg("c1", childID, { input: 10000, output: 500 }, 0.005),
        msg("c2", childID, { input: 10000, output: 500 }, 0.005),
        msg("c3", childID, { input: 10000, output: 500 }, 0.005),
      ],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [childID]: {
        id: childID,
        agent: "sdd-apply",
        title: "fix (@sdd-apply subagent)",
      },
    }
    forgetSession(rootID)
    forgetSession(childID)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[childID]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    // Each session contributes its complete spend — the root sums ALL of
    // its messages (4 × 52000), the child sums all of its (3 × 10500), so
    // the coins total is 208000 + 31500 — never below the cumulative input +
    // real output (which, with no cache anywhere, it equals exactly).
    expect(snap.totalTokens).toBe(4 * 52000 + 3 * 10500)
    expect(snap.totalTokens).toBe(
      snap.input + realOutput(snap.output, snap.reasoning),
    )
    expect(snap.input).toBe(4 * 50000 + 3 * 10000)
    expect(snap.output).toBe(4 * 2000 + 3 * 500)
    expect(snap.reasoning).toBe(0)
    expect(snap.cache).toBe(0)
    expect(snap.cost).toBeCloseTo(4 * 0.01 + 3 * 0.005)
    expect(snap.delegations).toBe(1)
    expect(snap.agents).toBe(1)
    expect(snap.groups).toHaveLength(1)
    // The group sums each delegated session's complete spend exactly once
    // (the child's three messages collapse into its one 31500 total).
    expect(snap.groups[0].total).toBe(3 * 10500)
    expect(snap.groups[0].input).toBe(30000)
    expect(snap.groups[0].output).toBe(1500)
    expect(snap.groups[0].reasoning).toBe(0)
    expect(snap.groups[0].cacheRead).toBe(0)
    expect(snap.groups[0].cacheWrite).toBe(0)
    expect(snap.groups[0].cost).toBeCloseTo(0.015)
    disposeReconcile()
  })

  test("REGRESSION: output and reasoning aggregate separately, never merged into a generated sum", async () => {
    const rootID = "ses_split_reg"
    const childID = "ses_split_child"
    const sessions = {
      [rootID]: [
        msg(
          "r1",
          rootID,
          { input: 5000, output: 1000, reasoning: 400, total: 7000 },
          0.01,
        ),
      ],
      [childID]: [
        msg("c1", childID, { input: 2000, output: 500, reasoning: 200 }, 0.005),
      ],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [childID]: { id: childID, agent: "general" },
    }
    forgetSession(rootID)
    forgetSession(childID)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[childID]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    expect(snap.output).toBe(1500)
    expect(snap.reasoning).toBe(600)
    expect(realOutput(snap.output, snap.reasoning)).toBe(2100)
    // tokens.total (7000) is NOT used for context: 6400 = 5000+1000+400.
    expect(snap.totalTokens).toBe(6400 + 2700)
    expect(snap.input).toBe(7000)
    expect(snap.groups[0].output).toBe(500)
    expect(snap.groups[0].reasoning).toBe(200)
    expect(realOutput(snap.groups[0].output, snap.groups[0].reasoning)).toBe(
      700,
    )
    disposeReconcile()
  })

  test("REGRESSION: per-session spend is the ATOMIC snapshot — cache INCLUDED, tokens.total still unused", async () => {
    const rootID = "ses_root_total"
    const childID = "ses_child_total"
    const sessions = {
      [rootID]: [
        msg(
          "r1",
          rootID,
          {
            input: 50000,
            output: 2000,
            cache: { read: 3000, write: 0 },
            total: 55000,
          },
          0.02,
        ),
      ],
      [childID]: [msg("c1", childID, { input: 10000, output: 500 }, 0.005)],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [childID]: { id: childID, agent: "build" },
    }
    forgetSession(rootID)
    forgetSession(childID)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[childID]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    // 55000 = 50000+2000+3000: the session's billed cache read IS part of
    // its complete spend (matching the provider total); tokens.total (55000
    // here) is coincidental and still never read.
    // Child: 10500.
    expect(snap.totalTokens).toBe(55000 + 10500)
    expect(snap.cache).toBe(3000)
    expect(snap.cacheRead).toBe(3000)
    expect(snap.cacheWrite).toBe(0)
    expect(snap.groups[0].total).toBe(10500)
    disposeReconcile()
  })

  test("REGRESSION: invalidateUsage rehydrates and reflects removed/changed messages — components keep their per-field maxima", async () => {
    const rootID = "ses_inval"
    const sessions: Record<string, UsageMessage[]> = {
      [rootID]: [
        msg("m1", rootID, { input: 1000, output: 100 }, 0.01),
        msg("m2", rootID, { input: 2000, output: 200 }, 0.02),
      ],
    }
    forgetSession(rootID)
    purgeTreeCache()
    activateRoot(fakeApi(sessions, {}, {}), rootID)
    await waitFor(() => snapshot()?.rootID === rootID)
    expect(must(snapshot()).input).toBe(3000)

    // The final message.updated is MISSED: only the current messages now
    // carry the completed totals, with m1 removed and m2 grown. Invalidation
    // must force a full rehydrate (replace, not merge) so removals land.
    sessions[rootID] = [
      msg("m2", rootID, { input: 2000, output: 200, total: 2500 }, 0.02),
    ]
    invalidateUsage(rootID)
    await reconcile(fakeApi(sessions, {}, {}), rootID)
    await waitFor(() => must(snapshot()).input === 3000)
    // The rehydrated map computes 2200, but the per-field high-waters
    // (input 3000, cost 0.03) preserve the full spend (3300, observed at
    // full size) — removal can never lower the displayed spend.
    expect(must(snapshot()).totalTokens).toBe(3300)
    expect(must(snapshot()).input).toBe(3000)
    expect(must(snapshot()).cost).toBeCloseTo(0.03)
    disposeReconcile()
  })

  test("repeated runs of the same agent collapse into one group", async () => {
    const rootID = "ses_root_groups"
    const c1 = "ses_c1_groups"
    const c2 = "ses_c2_groups"
    const sessions = {
      [rootID]: [msg("r1", rootID, { input: 1000, output: 100 })],
      [c1]: [msg("a1", c1, { input: 4000, output: 200 })],
      [c2]: [msg("b1", c2, { input: 6000, output: 300 })],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [c1]: { id: c1, agent: "sdd-apply" },
      [c2]: { id: c2, agent: "sdd-apply" },
    }
    for (const id of [rootID, c1, c2]) forgetSession(id)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[c1], metas[c2]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    expect(snap.delegations).toBe(2)
    expect(snap.agents).toBe(1)
    expect(snap.groups).toHaveLength(1)
    expect(snap.groups[0].runs).toBe(2)
    expect(snap.groups[0].total).toBe(4200 + 6300)
    expect(snap.groups[0].input).toBe(10000)
    expect(snap.groups[0].output).toBe(500)
    expect(snap.groups[0].reasoning).toBe(0)
    expect(snap.totalTokens).toBe(1100 + 4200 + 6300)
    disposeReconcile()
  })

  test("distinct agent types count (general + explore = 2) with per-group delegation runs", async () => {
    const rootID = "ses_root_agents"
    const c1 = "ses_c1_agents"
    const c2 = "ses_c2_agents"
    const c3 = "ses_c3_agents"
    const sessions = {
      [rootID]: [msg("r1", rootID, { input: 1000, output: 100 })],
      [c1]: [msg("a1", c1, { input: 4000, output: 200 })],
      [c2]: [msg("b1", c2, { input: 6000, output: 300 })],
      [c3]: [msg("d1", c3, { input: 2000, output: 100 })],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [c1]: { id: c1, agent: "general" },
      [c2]: { id: c2, agent: "general" },
      [c3]: { id: c3, agent: "explore" },
    }
    for (const id of [rootID, c1, c2, c3]) forgetSession(id)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[c1], metas[c2], metas[c3]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    expect(snap.delegations).toBe(3)
    expect(snap.agents).toBe(2)
    expect(snap.groups).toHaveLength(2)
    const general = snap.groups.find((g) => g.name === "general")
    const explore = snap.groups.find((g) => g.name === "explore")
    expect(general?.runs).toBe(2)
    expect(explore?.runs).toBe(1)
    disposeReconcile()
  })

  test("groups order by spend total descending; cost/runs/name only break ties", async () => {
    const rootID = "ses_order_root"
    const c1 = "ses_order_1"
    const c2 = "ses_order_2"
    const c3 = "ses_order_3"
    const sessions = {
      [rootID]: [msg("r1", rootID, { input: 100, output: 10 })],
      // alpha: low context, HIGH cost — a cost-first sort would list it first.
      [c1]: [msg("a1", c1, { input: 1000, output: 100 }, 0.5)],
      // beta: high context, low cost — total-first sort puts it on top.
      [c2]: [msg("b1", c2, { input: 5000, output: 500 }, 0.01)],
      // zeta: ties alpha on total AND cost AND runs; name breaks the tie.
      [c3]: [msg("d1", c3, { input: 1000, output: 100 }, 0.5)],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [c1]: { id: c1, agent: "alpha" },
      [c2]: { id: c2, agent: "beta" },
      [c3]: { id: c3, agent: "zeta" },
    }
    for (const id of [rootID, c1, c2, c3]) forgetSession(id)
    purgeTreeCache()
    activateRoot(
      fakeApi(sessions, { [rootID]: [metas[c1], metas[c2], metas[c3]] }, metas),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const names = must(snapshot()).groups.map((g) => g.name)
    // Spend total desc: beta (5.5k) first; alpha and zeta tie on total
    // (1.1k), cost and runs, so the name tiebreak puts alpha before zeta.
    expect(names).toEqual(["beta", "alpha", "zeta"])
    disposeReconcile()
  })

  test("REGRESSION: recursive delegation — grandchildren are discovered, grouped and summed; spend equals input + real output at every level", async () => {
    const rootID = "ses_root_nested"
    const childID = "ses_child_nested"
    const grand1 = "ses_grand_nested"
    const grand2 = "ses_grand2_nested"
    const sessions = {
      [rootID]: [
        msg("r1", rootID, { input: 40000, output: 2000, reasoning: 500 }, 0.05),
        msg("r2", rootID, { input: 40000, output: 2000, reasoning: 500 }, 0.05),
      ],
      [childID]: [
        msg(
          "c1",
          childID,
          { input: 20000, output: 1000, reasoning: 250 },
          0.02,
        ),
      ],
      [grand1]: [
        msg("g1", grand1, { input: 5000, output: 300, reasoning: 100 }, 0.01),
      ],
      [grand2]: [
        msg("g2", grand2, { input: 3000, output: 200, reasoning: 50 }, 0.01),
      ],
    }
    const metas: Record<string, SessionInfo> = {
      [rootID]: { id: rootID, title: "Root" },
      [childID]: { id: childID, agent: "sdd-apply" },
      [grand1]: { id: grand1, agent: "sdd-apply" },
      [grand2]: { id: grand2, agent: "explore" },
    }
    for (const id of [rootID, childID, grand1, grand2]) forgetSession(id)
    purgeTreeCache()
    activateRoot(
      fakeApi(
        sessions,
        {
          [rootID]: [metas[childID]],
          [childID]: [metas[grand1], metas[grand2]],
        },
        metas,
      ),
      rootID,
    )
    await waitFor(() => snapshot()?.rootID === rootID)
    const snap = must(snapshot())
    // The tree walk is recursive: the grandchild sessions are descendants
    // of the root even though they are children of a child.
    expect(snap.delegations).toBe(3)
    expect(snap.agents).toBe(2)
    expect(snap.groups).toHaveLength(2)
    const sdd = snap.groups.find((g) => g.name === "sdd-apply")
    const explore = snap.groups.find((g) => g.name === "explore")
    expect(sdd?.runs).toBe(2)
    expect(sdd?.total).toBe(21250 + 5400)
    expect(sdd?.input).toBe(25000)
    expect(sdd?.output).toBe(1300)
    expect(sdd?.reasoning).toBe(350)
    // Single-message descendants: the group total equals their cumulative
    // input + real output here (one message per session).
    expect(sdd?.total).toBe(
      must(sdd).input + realOutput(must(sdd).output, must(sdd).reasoning),
    )
    expect(explore?.runs).toBe(1)
    expect(explore?.total).toBe(3250)
    // Session spend: the root has TWO messages, so it contributes its
    // complete spend (85000 = 2 × 42500); the descendants each contribute
    // their complete spend. Total = 85000 + 21250 + 5400 + 3250 = 114900
    // — each session ID exactly once, and with no cache anywhere the spend
    // equals the cumulative input + real output exactly.
    expect(snap.totalTokens).toBe(85000 + 21250 + 5400 + 3250)
    expect(snap.totalTokens).toBe(
      snap.input + realOutput(snap.output, snap.reasoning),
    )
    expect(snap.input).toBe(108000)
    expect(snap.output).toBe(5500)
    expect(snap.reasoning).toBe(1400)
    disposeReconcile()
  })

  test("REGRESSION: compaction cannot lower the Session spend — a smaller later message set keeps the per-component high-water", async () => {
    const rootID = "ses_compact"
    const sessions: Record<string, UsageMessage[]> = {
      [rootID]: [
        msg("m1", rootID, { input: 10000, output: 1000, total: 11000 }, 0.01),
        msg("m2", rootID, { input: 60000, output: 3000, total: 63000 }, 0.02),
      ],
    }
    forgetSession(rootID)
    purgeTreeCache()
    activateRoot(fakeApi(sessions, {}, {}), rootID)
    await waitFor(() => snapshot()?.rootID === rootID)
    // Spend formula: 70000 + 4000 = 74000.
    expect(must(snapshot()).totalTokens).toBe(74000)
    expect(must(snapshot()).input).toBe(70000)

    // session.compacted rewrites the client to a SMALLER message set: the
    // historical per-component maxima (input 70000, output 4000, cost 0.03)
    // must survive the rehydrate.
    sessions[rootID] = [msg("m2", rootID, { input: 2000, output: 200 })]
    invalidateUsage(rootID)
    await reconcile(fakeApi(sessions, {}, {}), rootID)
    // Components keep their per-field maxima; the coins total keeps the
    // historical spend (74000), never 2200.
    expect(must(snapshot()).totalTokens).toBe(74000)
    expect(must(snapshot()).input).toBe(70000)
    expect(must(snapshot()).output).toBe(4000)
    expect(must(snapshot()).cost).toBeCloseTo(0.03)
    disposeReconcile()
  })
})

describe("tree session identity (title fallback and (@agent subagent) parsing)", () => {
  test("getSessionTitle returns the remembered title or the generic subagent fallback", () => {
    purgeTreeCache()
    expect(getSessionTitle("unknown_session")).toBe("subagent")
    rememberSession({ id: "s_titled", title: "Root" })
    expect(getSessionTitle("s_titled")).toBe("Root")
  })

  test("parseTitleAgent extracts the agent from a (@agent subagent) title suffix", () => {
    expect(parseTitleAgent("build (@sdd-apply subagent)")).toBe("sdd-apply")
    expect(parseTitleAgent("build (@sdd-apply)")).toBe("sdd-apply")
    expect(parseTitleAgent("plain title")).toBeNull()
    expect(parseTitleAgent(undefined)).toBeNull()
  })

  test("REGRESSION: a title-only session resolves its agent through the suffix parser", () => {
    purgeTreeCache()
    rememberSession({
      id: "s_title_agent",
      title: "fix (@code-review subagent)",
    })
    expect(getSessionAgent("s_title_agent")).toBe("code-review")
  })
})

describe("width resolution and column-safe text (text.ts)", () => {
  test("resolveSidebarWidth walks the ctx width chain", () => {
    expect(resolveSidebarWidth({ width: 40 })).toBe(40)
    expect(resolveSidebarWidth({ columns: 38 })).toBe(38)
    expect(resolveSidebarWidth({ cols: 37 })).toBe(37)
    expect(resolveSidebarWidth({ size: { width: 36 } })).toBe(36)
    expect(resolveSidebarWidth({ viewport: { width: 35 } })).toBe(35)
    expect(resolveSidebarWidth({ bounds: { width: 33 } })).toBe(33)
    expect(resolveSidebarWidth({})).toBeUndefined()
    expect(resolveSidebarWidth(null)).toBeUndefined()
  })

  test("clampSidebarWidth falls back to 38 and clamps to 24-52", () => {
    expect(clampSidebarWidth(undefined)).toBe(38)
    expect(clampSidebarWidth(10)).toBe(24)
    expect(clampSidebarWidth(80)).toBe(52)
    expect(clampSidebarWidth(40)).toBe(40)
    expect(contentWidth(38)).toBe(36)
    expect(contentWidth(24)).toBe(22)
  })

  test("textColumns counts wide glyphs as 2 and Nerd Font PUA glyphs as 1", () => {
    expect(textColumns("abc")).toBe(3)
    expect(textColumns("界")).toBe(2)
    expect(textColumns("\uEDE8")).toBe(1)
    expect(textColumns("\u{F0238}")).toBe(1)
    expect(textColumns("\u{F06A9}")).toBe(1)
    expect(textColumns("\u{E20F}")).toBe(1)
    expect(textColumns("\u{EE9C}")).toBe(1)
  })

  test("truncateToColumns never exceeds the budget and never splits a wide char", () => {
    expect(truncateToColumns("TokenMeter 1.0.1", 17)).toBe("TokenMeter 1.0.1")
    expect(truncateToColumns("TokenMeter 1.0.1", 10)).toBe("TokenMete…")
    expect(truncateToColumns("界界界", 3)).toBe("界…")
    expect(truncateToColumns("abcdef", 0)).toBe("")
    expect(truncateToColumns("abcdef", 1)).toBe("…")
  })
})

describe("cost formatting (always exactly two decimals)", () => {
  test("fmtCost renders every magnitude with two decimals — no 3/4-decimal precision anywhere", () => {
    expect(fmtCost(0)).toBe("$0.00")
    expect(fmtCost(0.004)).toBe("$0.00")
    expect(fmtCost(0.005)).toBe("$0.01")
    expect(fmtCost(0.03)).toBe("$0.03")
    expect(fmtCost(0.015)).toBe("$0.02")
    expect(fmtCost(1.09)).toBe("$1.09")
    expect(fmtCost(1)).toBe("$1.00")
    expect(fmtCost(1234.5)).toBe("$1234.50")
    expect(fmtCost(12.345)).toBe("$12.35")
    expect(fmtCost(-1)).toBe("$0.00")
    expect(fmtCost(NaN)).toBe("$0.00")
  })
})

describe("formatCachePair — conditional R|W semantics (corrected contract)", () => {
  test("REGRESSION: cache pair is conditional R|W — zero sides omitted, both zero renders 0, never a slash", () => {
    expect(formatCachePair(45000000, 10000)).toBe("R45M|W10K")
    expect(formatCachePair(45000000, 0)).toBe("R45M")
    expect(formatCachePair(0, 10000)).toBe("W10K")
    expect(formatCachePair(0, 0)).toBe("0")
    // fmtCompact runs on every side; negatives clamp to zero like the rest
    // of the numeric pipeline.
    expect(formatCachePair(-5, 3000)).toBe("W3K")
    expect(formatCachePair(0, -5)).toBe("0")
    // The slash syntax is gone everywhere in the pair output.
    for (const pair of [
      formatCachePair(45000000, 10000),
      formatCachePair(45000000, 0),
      formatCachePair(0, 10000),
      formatCachePair(0, 0),
    ]) {
      expect(pair).not.toContain("/")
    }
  })
})

describe("corrected-contract formatter width frames (PR 2)", () => {
  // Spec scenario: 10M total, $92.24, 152K input, 215M real output,
  // 414K reasoning, 212M combined cache.
  const view = {
    totalTokens: 10_000_000,
    cost: 92.24,
    input: 152_000,
    output: 214_586_000,
    reasoning: 414_000,
    cacheRead: 212_000_000,
    cacheWrite: 0,
  }
  const joined = (segments: { text: string }[]): string =>
    segments.map((segment) => segment.text).join("")

  test("formatCompactSummary fits the full line at the default width and degrades at the narrowest content width (22)", () => {
    expect(
      joined(formatCompactSummary(view, "compact", contentWidth(38))),
    ).toBe("10M tokens · $92.24")
    expect(
      joined(formatCompactSummary(view, "compact", contentWidth(24))),
    ).toBe("10M tokens · $92.24")
  })

  test("formatCompactSummary never overflows its width frame", () => {
    for (let width = 22; width <= 52; width += 2) {
      expect(
        textColumns(joined(formatCompactSummary(view, "compact", width))),
      ).toBeLessThanOrEqual(width)
    }
  })

  test("the three detail lines fit the default content width (36)", () => {
    const [line1, line2, line3] = formatMetricLines(view, {
      cache: "combined",
      numbers: "compact",
    })
    for (const line of [line1, line2, line3]) {
      expect(textColumns(joined(line))).toBeLessThanOrEqual(contentWidth(38))
    }
  })

  test("formatAgentLine composes the render-site `↳` entry within the width frame", () => {
    const at36 = formatAgentLine({ name: "General", runs: 5 }, 36, false)
    expect(`${at36.indent}${at36.name}${at36.tasks}${at36.chevron}`).toBe(
      "↳ General (5 tasks) ▶",
    )
    const open36 = formatAgentLine({ name: "General", runs: 5 }, 36, true)
    expect(
      `${open36.indent}${open36.name}${open36.tasks}${open36.chevron}`,
    ).toBe("↳ General (5 tasks) ▼")
    const at22 = formatAgentLine(
      { name: "General", runs: 5 },
      contentWidth(24),
      false,
    )
    expect(
      textColumns(`${at22.indent}${at22.name}${at22.tasks}${at22.chevron}`),
    ).toBeLessThanOrEqual(contentWidth(24))
  })
})

describe("glyph and label hygiene (no unreliable glyphs, no text labels)", () => {
  const glyphsSrc = readFileSync(
    new URL("../src/tokenmeter/glyphs.ts", import.meta.url),
    "utf8",
  )
  const panelSrc = readFileSync(
    new URL("../src/tokenmeter/panel/index.tsx", import.meta.url),
    "utf8",
  )
  const groupRowsSrc = readFileSync(
    new URL("../src/tokenmeter/panel/group-rows.tsx", import.meta.url),
    "utf8",
  )
  const sectionSrc = readFileSync(
    new URL("../src/tokenmeter/panel/section.tsx", import.meta.url),
    "utf8",
  )
  const projectSectionSrc = readFileSync(
    new URL("../src/tokenmeter/panel/project-section.tsx", import.meta.url),
    "utf8",
  )
  const formatSrc = readFileSync(
    new URL("../src/tokenmeter/format.ts", import.meta.url),
    "utf8",
  )
  const entrySrc = readFileSync(
    new URL("../src/tokenmeter.tsx", import.meta.url),
    "utf8",
  )

  test("glyph constants are the disclosure chevrons and the agent indent — the heading marker is gone", () => {
    // The glyph diet deleted every pre-correction metric glyph AND the `●`
    // heading marker; the module now exports exactly the two disclosure
    // chevrons and the `↳` agent-entry tree branch. The section titles
    // carry the warning tone instead of any marker glyph.
    expect(GLYPH.expand).toBe("▶")
    expect(GLYPH.collapse).toBe("▼")
    expect(GLYPH.indent).toBe("↳")
    expect(Object.keys(GLYPH)).toEqual(["expand", "collapse", "indent"])
  })

  test("the pre-correction metric glyphs are gone from glyphs.ts and the panels", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      sectionSrc,
      formatSrc,
    ]) {
      expect(source).not.toContain("hourglass")
      expect(source).not.toContain("\\uF4E3")
      expect(source).not.toContain("\\u{F4E3}")
      expect(source).not.toContain("\\uEDE8")
      expect(source).not.toContain("\\uF472")
      expect(source).not.toContain("\\u{F0238}")
      expect(source).not.toContain("\\u{F06A9}")
      expect(source).not.toContain("\\u{E20F}")
      expect(source).not.toContain("\\u{EE9C}")
      expect(source).not.toContain("GLYPH.coins")
      expect(source).not.toContain("GLYPH.fire")
      expect(source).not.toContain("GLYPH.robot")
      expect(source).not.toContain("GLYPH.tasks")
    }
    expect(glyphsSrc).not.toMatch(
      /GLYPH\s*=\s*\{[^}]*?(coins|cache|fire|robot|tasks|reasoning|up|down|tree)/,
    )
  })

  test("no unreliable glyphs, no person glyph, no useTerminalDimensions anywhere in the plugin", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      sectionSrc,
      projectSectionSrc,
      formatSrc,
      entrySrc,
    ]) {
      for (const bad of ["⏱", "🔥", "▥", "useTerminalDimensions", "\uF415"])
        expect(source).not.toContain(bad)
    }
  })

  test("the old U+F0CA tasks glyph and the old U+F0AE/U+EB67 tasklist glyphs are gone", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      sectionSrc,
      projectSectionSrc,
      formatSrc,
    ]) {
      expect(source).not.toContain("tasklist")
      expect(source).not.toContain("\\uEB67")
      expect(source).not.toContain("\\uF0AE")
      expect(source).not.toContain("\\u{F0AE}")
      expect(source).not.toContain("\\uF0CA")
      expect(source).not.toContain("\\u{F0CA}")
    }
  })

  test("the corrected-contract metric labels live only in format.ts; the panels keep no label literals", () => {
    // The corrected contract identifies metrics with labels + color, so the
    // label strings belong to the pure formatters; the panels must compose
    // formatter segments, never hardcode label text.
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      sectionSrc,
      projectSectionSrc,
    ]) {
      expect(source).not.toMatch(/\btok\b/)
      expect(source).not.toContain('" in"')
      expect(source).not.toContain('" out"')
      expect(source).not.toContain('" cache"')
    }
    expect(formatSrc).toContain('labelSegment("tokens")')
    expect(formatSrc).not.toContain('labelSegment("spent")')
    expect(formatSrc).toContain('labelSegment("in")')
    expect(formatSrc).toContain('labelSegment("out")')
    // The reasoning DISPLAY label is exactly `reason` in every metric row;
    // the data field/role stays `reasoning`.
    expect(formatSrc).toContain('labelSegment("reason")')
    expect(formatSrc).not.toContain('labelSegment("reasoning")')
    expect(formatSrc).toContain('labelSegment("cache")')
  })

  test("the Subagents global row is composed in the panel from formatCount — no formatter-owned header string", () => {
    // The panel renders the Subagents global row directly: the left chevron
    // (main-text tone), the title text (warning tone) and the collapsed
    // aggregate caption built from the pure `formatCount` helpers. The
    // former formatSubagentsHeader formatter was deleted with the heading
    // marker — no formatter owns the global row's frame.
    expect(formatSrc).toContain("task")
    expect(formatSrc).toContain("agents")
    expect(formatSrc).not.toContain("formatSubagentsHeader")
    expect(panelSrc).toContain("Subagents")
    expect(panelSrc).toContain("formatCount(")
    expect(panelSrc).toContain('formatCount(snap().agents, "agent")')
    expect(panelSrc).toContain('formatCount(snap().delegations, "task")')
  })

  test("panel colors and layout match the approved theme contract: warning-yellow section titles, master disclosure row, chevron disclosure, clean title, expanded metrics row", () => {
    // The section labels live in the shared Section component
    // (theme().warning — the complete title text carries the semantic
    // yellow, never a marker glyph; parameterized title); the panel routes
    // both sections through it. The title-text element is click-to-toggle
    // like the chevron (spec: chevron OR section title-text click).
    expect(sectionSrc).toMatch(
      /fg=\{theme\(\)\.warning\}\s*selectable=\{false\}\s*onMouseDown=\{props\.onToggle\}\s*>[\s\S]*?\{props\.title\}/,
    )
    expect(panelSrc).toContain('title="Project"')
    expect(panelSrc).toContain('title="Session"')
    expect(panelSrc).not.toContain("Sessions")
    expect(panelSrc.indexOf("Project")).toBeLessThan(
      panelSrc.indexOf("Session"),
    )
    // The master disclosure row: LEFTMOST `▶`/`▼` chevron before the
    // truncated TokenMeter title, no version literal. Both the chevron and
    // the title text toggle the transient master state; there is NO
    // Settings/Back screen toggle (the palette dialog replaced the in-panel
    // settings screen — spec: no toggle text, no screen replaces metrics).
    expect(panelSrc).toMatch(/truncateToColumns\(\s*"TokenMeter"/)
    expect(panelSrc).not.toContain("1.0.1")
    expect(panelSrc).not.toContain(
      '{"  " + (props.expanded() ? GLYPH.collapse : GLYPH.expand)}',
    )
    expect(panelSrc).toContain("masterCollapsed")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(panelSrc).toContain("{`${masterChevron()} `}")
    expect(panelSrc).not.toContain("Settings")
    expect(panelSrc).not.toContain("Back")
    // Each section header row has TWO clickable elements: the leading
    // chevron (main-text tone) and the title text — the COMPLETE title
    // renders in the semantic yellow theme().warning, no marker glyph of
    // any kind (spec: chevron OR title-text click toggles). The chevron
    // stays the LEFTMOST glyph. In the panel: the master chevron + master
    // title plus the three clickable parts of the Subagents global row
    // (chevron, warning title, aggregate caption) — five onMouseDown total
    // (no Settings toggle).
    expect(sectionSrc.match(/onMouseDown/g)).toHaveLength(2)
    expect(panelSrc.match(/onMouseDown/g)).toHaveLength(5)
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(sectionSrc).toContain("{`${chevron()} `}")
    expect(sectionSrc).toContain("onMouseDown={props.onToggle}>")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(sectionSrc.indexOf("{`${chevron()} `}")).toBeLessThan(
      sectionSrc.indexOf("{props.title}"),
    )
    // The complete title text renders in theme().warning; the `●` heading
    // marker is gone — no dot glyph anywhere in the panels.
    expect(sectionSrc).toContain("fg={theme().warning}")
    expect(sectionSrc).not.toContain("GLYPH.dot")
    expect(panelSrc).not.toContain("GLYPH.dot")
    expect(sectionSrc).not.toContain("●")
    expect(panelSrc).not.toContain("●")
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(sectionSrc.indexOf("{`${chevron()} `}")).toBeLessThan(
      sectionSrc.indexOf("{props.title}"),
    )
    // The Subagents global row: LEFTMOST chevron (main-text tone),
    // warning-yellow title text, muted aggregate caption — the caption
    // renders only while collapsed, so the expanded header has NO counts at
    // all. The caption text comes from the pure formatCount helpers.
    expect(panelSrc).toMatch(
      /fg=\{theme\(\)\.warning\}[^>]*>\s*Subagents\s*<\/text>/,
    )
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(panelSrc).toContain("{`${chevron()} `}")
    expect(panelSrc).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
      '{` (${formatCount(snap().agents, "agent")} · ${formatCount(snap().delegations, "task")})`}',
    )
    expect(panelSrc).toContain('props.subagentsPref() === "expanded"')
    expect(panelSrc).not.toContain("formatAgents")
    expect(panelSrc).not.toContain("formatTaskCount")
    expect(panelSrc).not.toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
      '{` ${props.subagentsPref() === "expanded" ? GLYPH.collapse : GLYPH.expand}`}',
    )
    // The compact summary row is the section's elastic L1; its tone comes
    // from the shared tone module (segmentTone: main-text except the
    // $amount in light red), not a per-role color map.
    expect(sectionSrc).toContain("formatCompactSummary(")
    expect(sectionSrc).toContain("segmentTone(theme, 0, segment.role)")
    // The expanded detail renders the mode-aware rows through
    // formatDetailLines (compact: three, precise: five) — the old
    // fits-gate that OMITTED non-fitting lines is gone (spec: detail rows
    // degrade elastically, values never hidden).
    expect(sectionSrc).toContain("formatDetailLines(")
    expect(sectionSrc).not.toContain("formatMetricLines(")
    expect(sectionSrc).not.toContain("fits(")
    // Per-agent entries (group-rows.tsx): `↳`-indented header
    // `↳ <name> (<N> tasks) ▶` (`↳` branch and the TRAILING per-agent
    // chevron in the main-text tone, agent name in the light-blue/cyan
    // theme().info tone, task count and parentheses in the derived detail
    // tone — all click-to-toggle; the trailing chevron flips `▶` → `▼`
    // while open) followed by
    // the elastic compact L1 rendered through formatCompactSummary in the
    // primary text tone. Opening REPLACES the compact L1 with the mode-aware
    // detail rows (formatDetailLines — L1 once by construction, rendered in
    // the main-text tone while the secondary rows stay in the derived
    // detail tone; the fits-gate that omitted detail rows is gone). The
    // header carries the nested-list leading indent (GROUP_INDENT) and the
    // metric rows the four-column indent (AGENT_METRIC_INDENT), aligned
    // under the agent name after the `↳` branch (`  ↳ `).
    expect(groupRowsSrc).toContain("formatAgentLine(")
    expect(groupRowsSrc).toContain("formatCompactSummary(")
    expect(groupRowsSrc).toContain("formatDetailLines(")
    expect(groupRowsSrc).not.toContain("formatMetricLines(")
    expect(groupRowsSrc).not.toContain("fits(")
    expect(groupRowsSrc).toContain("fg={theme().info}")
    expect(groupRowsSrc).toContain("fg={detailTone(theme)}")
    expect(groupRowsSrc).toMatch(
      /fg=\{theme\(\)\.text\}\s*selectable=\{false\}\s*onMouseDown=\{props\.onToggle\}/,
    )
    expect(groupRowsSrc).toMatch(
      /fg=\{detailTone\(theme\)\}\s*selectable=\{false\}\s*onMouseDown=\{props\.onToggle\}/,
    )
    expect(groupRowsSrc).not.toMatch(
      /fg=\{theme\(\)\.(primary|success|textMuted)\}\s*selectable=\{false\}\s*onMouseDown=\{props\.onToggle\}/,
    )
    expect(groupRowsSrc).toContain("AGENT_METRIC_INDENT")
    expect(groupRowsSrc).toContain("agent().indent")
    expect(groupRowsSrc).toContain("agent().chevron")
    expect(groupRowsSrc).toContain("agent().name")
    expect(groupRowsSrc).toContain("agent().tasks")
    expect(groupRowsSrc).not.toContain("line().robot")
    expect(groupRowsSrc).not.toContain("line().marker")
    expect(groupRowsSrc).not.toContain("meta()")
    // The headline formatter is gone, and so is the semantic color module:
    // tone comes from the shared tone module (tone.ts) — theme roles only,
    // no colors.ts import, no SPEND_GOLD literal anywhere.
    expect(sectionSrc).not.toContain("formatHeadline")
    expect(sectionSrc).not.toContain("metricColor")
    expect(groupRowsSrc).not.toContain("metricColor")
    expect(sectionSrc).not.toContain('from "./colors"')
    expect(groupRowsSrc).not.toContain('from "./colors"')
    // Section placeholders survive: the loading `…` and the empty copies;
    // the old `(detail clipped)` cue is gone from the corrected contract.
    expect(sectionSrc).toContain("fg={theme().textMuted}>…</text>")
    expect(panelSrc).toContain('emptyCopy="No usage yet"')
    expect(panelSrc).toContain('emptyCopy="No sessions"')
    expect(sectionSrc).not.toContain('"(detail clipped)"')
    // Agent disclosure is a one-open accordion keyed by INDEX: the panel
    // holds `openGroupIndex: number | null` (transient — reset on
    // mount/session change, never kv). Each compact entry toggles its own
    // index; opening one closes the other by construction.
    expect(panelSrc).toContain("openGroupIndex")
    expect(panelSrc).toContain("createSignal<number | null>(null)")
    expect(panelSrc).toMatch(
      /setOpenGroupIndex\(\s*openGroupIndex\(\) === index\(\) \? null : index\(\),?\s*\)/,
    )
    // The expanded agent list is a REAL scroll container that holds ALL
    // groups through the `For` — no slice, no clipped cue, no hidden count.
    // Viewport caps at 4 rows (two collapsed agents) and shrinks for fewer
    // rows: height = min(actual visible rows, 4) so a single collapsed group
    // occupies 2 rows, not 4 with blank space (#25). Overflow gates the
    // scrollbar: scrollY is only enabled when totalRows > 4 (#33).
    expect(panelSrc).toContain("<scrollbox")
    expect(panelSrc).toContain("subagentsLayout")
    expect(panelSrc).toContain("height={subagentsLayout().height}")
    expect(panelSrc).toContain("scrollY={subagentsLayout().overflow}")
    expect(panelSrc).toContain("<For each={snap().groups}>")
    expect(panelSrc).not.toContain("slice(")
    expect(panelSrc).not.toContain("MAX_VISIBLE_GROUPS")
    expect(panelSrc).not.toContain("more — scroll")
  })

  test("the tone hierarchy derives ONLY from theme roles plus one relative RGBA blend — no arbitrary hex in tone.ts", () => {
    const toneSrc = readFileSync(
      new URL("../src/tokenmeter/panel/tone.ts", import.meta.url),
      "utf8",
    )
    // Secondary rows and task metadata: textMuted blended 50% toward the
    // active background through the installed RGBA API (toInts/fromInts).
    expect(toneSrc).toContain("theme().textMuted")
    expect(toneSrc).toContain("theme().background")
    expect(toneSrc).toContain("toInts()")
    expect(toneSrc).toContain("RGBA.fromInts(")
    expect(toneSrc).toContain("/ 2")
    // Primary token+cost rows: main text except the `$amount` in the
    // light-red error tone.
    expect(toneSrc).toContain('role === "spend"')
    expect(toneSrc).toContain("theme().error")
    expect(toneSrc).toContain("theme().text")
    // The tone module is the ONLY place metric tone lives: no hex literals,
    // no accent/primary/success on metric data.
    expect(toneSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(toneSrc).not.toContain("theme().accent")
    expect(toneSrc).not.toContain("theme().primary")
    expect(toneSrc).not.toContain("theme().success")
    // The panels consume the shared tone module instead of duplicating
    // tone branches.
    expect(sectionSrc).toContain('from "./tone"')
    expect(groupRowsSrc).toContain('from "./tone"')
    expect(groupRowsSrc).toContain("detailTone(theme)")
  })

  test("the Project loading fallback is the static `…` placeholder — no spinner, no interval, no frame cycling", () => {
    // While the section has no snapshot and no error the placeholder is a
    // plain muted ellipsis; loading never animates.
    expect(sectionSrc).toContain("fg={theme().textMuted}>…</text>")
    // The spinner is gone: no indicator component, no interval machinery,
    // no loading glyph and no rotation frames anywhere in the panel modules.
    for (const source of [
      panelSrc,
      sectionSrc,
      groupRowsSrc,
      projectSectionSrc,
    ]) {
      expect(source).not.toContain("LoadingIndicator")
      expect(source).not.toContain("SPINNER_INTERVAL_MS")
      expect(source).not.toContain("SPINNER_FRAMES")
      expect(source).not.toContain("GLYPH.loading")
      expect(source).not.toContain("setInterval")
      expect(source).not.toContain("clearInterval")
      expect(source).not.toContain("\\u{EB19}")
      for (const frame of ["◴", "◷", "◶", "◵"])
        expect(source).not.toContain(frame)
    }
    // A failed refresh surfaces a visible error line (project-section.tsx,
    // rendered by the Project variant of section.tsx): theme().error,
    // showing ONLY the stable PROJECT_ERROR_MESSAGE (no "Error: " prefix, no
    // raw runtime message), truncated to the content width so it never
    // overflows.
    expect(sectionSrc).toContain("ProjectError")
    expect(sectionSrc).toContain('variant === "project"')
    expect(projectSectionSrc).toContain("projectError()")
    expect(projectSectionSrc).toContain(
      "truncateToColumns(message(), props.inner())",
    )
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source snippet asserts exact template placeholder syntax
    expect(projectSectionSrc).not.toContain("Error: ${message()}")
    expect(projectSectionSrc).toContain("fg={props.theme().error}")
    // Session keeps its own neutral fallback without a loading state.
    expect(sectionSrc).toContain("when={props.view()}")
    expect(sectionSrc).toContain("fallback=")
    // The entry loads the settings once and carries no version literal and
    // no hand-rolled expanded kv wiring.
    expect(entrySrc).toContain("loadSettings(api)")
    expect(entrySrc).not.toContain("EXPANDED_KV_KEY")
    expect(entrySrc).not.toContain("1.0.1")
    expect(entrySrc).toContain("subagentsPref")
    expect(entrySrc).toContain("cycleSubagents")
  })
})

describe("palette command registration (keymap.registerLayer seam)", () => {
  const entrySrc = readFileSync(
    new URL("../src/tokenmeter.tsx", import.meta.url),
    "utf8",
  )
  const panelSrc = readFileSync(
    new URL("../src/tokenmeter/panel/index.tsx", import.meta.url),
    "utf8",
  )

  test("the entry registers the Settings command via keymap.registerLayer — category TokenMeter, never the legacy api.command/registerExCommands", () => {
    // Spec: tokenmeter-command-palette — the modern keymap API registers the
    // command with namespace "palette" and category "TokenMeter"; the
    // deprecated `api.command` surface and `registerExCommands` must not be
    // the registration mechanism; `run` opens the dialog through the shared
    // settings-dialog seam (showSettingsDialog), not an in-panel screen.
    expect(entrySrc).toContain("keymap.registerLayer")
    expect(entrySrc).toContain('namespace: "palette"')
    expect(entrySrc).toContain('category: "TokenMeter"')
    expect(entrySrc).toContain('name: "tokenmeter.settings"')
    expect(entrySrc).toContain('title: "TokenMeter: Settings"')
    expect(entrySrc).toContain("showSettingsDialog(api)")
    expect(entrySrc).not.toMatch(/api\.command[.(]/)
    expect(entrySrc).not.toMatch(/command\.register/)
    expect(entrySrc).not.toContain("registerExCommands")
  })

  test("the panel exposes no in-panel settings seam — the palette dialog replaced the screen", () => {
    // Design: the DialogSelect palette menu replaces the sidebar settings
    // screen; no module-scope `screen` signal or openSettings/showMetrics
    // seam may remain in the panel module (spec: no Settings/Back title
    // toggle, no in-panel view may replace the metric body).
    expect(panelSrc).not.toContain("export function openSettings")
    expect(panelSrc).not.toContain("export function showMetrics")
    expect(panelSrc).not.toMatch(/createSignal<"metrics" \| "settings">/)
    expect(panelSrc).not.toContain("SettingsScreen")
    expect(panelSrc).not.toContain('"Settings"')
    expect(panelSrc).not.toContain('"Back"')
  })
})
