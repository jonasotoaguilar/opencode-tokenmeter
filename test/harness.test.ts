/**
 * Real-module behavior harness for the TokenMeter usage sidebar.
 *
 * Imports the ACTUAL modules (math, groups, store, reconcile, tree, format,
 * text, glyphs, project) and drives them with a fake SDK client following the
 * opencode-plugin unit-test pattern. Asserts the approved corrections:
 *  - headline context = one snapshot per session (max observed), so repeated
 *    messages with the same input context can never inflate the headline
 *  - cumulative input/output/reasoning/cache/cost stay separate from the
 *    snapshot, with RAW output and RAW reasoning preserved independently;
 *    the displayed output real (output + reasoning) is computed exactly once
 *  - the Project clock context is input + raw output + raw reasoning per
 *    session with cache EXCLUDED — the cache metric of the second row is its
 *    only home, so a huge cache never inflates the clock to near the total
 *  - the Project section sums ALL project sessions the client
 *    session.list endpoint returns — listed with `scope: "project"` (no
 *    directory scoping, no roots filtering, children included), then
 *    filtered by session.projectID — and a failed lookup/list keeps
 *    the previous snapshot, surfaces the stable "Unable to load project
 *    data" message (projectError) and never touches Session
 *  - post-delete: session.deleted passes the deleted session's projectID as
 *    a projectIDHint, so a failed project.current()/session.list right
 *    after the delete recovers the snapshot from the ledger (same total,
 *    tombstone included) with NO projectError; without a hint or ledger
 *    entries the stable error still surfaces
 *  - the Project total comes from the persistent kv ledger
 *    (tokenmeter.project.history.v1): live sessions upsert by ID (replace,
 *    never accumulate), disappeared sessions tombstone and keep their
 *    contribution, session.deleted preserves the delete payload or the last
 *    known snapshot, and the ledger is idempotent across repeated refreshes;
 *    an empty/malformed/unpersisted ledger NEVER zeroes a Project the live
 *    list carries tokens for — the live total is the fallback and the ledger
 *    is normalized and persisted from the live sessions
 *  - costs render with EXACTLY two decimals everywhere (headline, Project
 *    and groups) via fmtCost — no 3/4-decimal precision
 *  - agent groups order by context total descending; cost/runs/name only
 *    break ties
 *  - idle invalidation rehydrates a session's usage from the current
 *    messages, reflecting removed/changed messages instead of merging only
 *  - width/glyph helpers produce column-safe lines at every sidebar width
 *  - no unreliable glyphs or textual tok/in/out/cache/run labels in the UI;
 *    the task count renders as `· <U+E20F> N task` in the expanded metrics
 *    row and on per-agent group rows
 *  - the Subagents row is the only toggle: an accent `Subagents` label with
 *    the chevron button right after it (visible margin); collapsed shows
 *    ONLY that row, while expanded adds the `🖿 N agents · <U+E20F> N task`
 *    metrics row (lowercase `agents`) and then the group list
 *  - each group renders exactly three rows: indented name + task count,
 *    indented context + thinking + fire cost, indented three-value
 *    input · output real · cache breakdown — the name is the elastic segment
 *    of row 1 and truncates there; the tree marker yields only when the name
 *    cannot keep one column; the indented metric rows never overflow
 *  - the subtitles read Project and Session (singular), both accent-colored
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  breakdownSegments,
  formatAgents,
  formatBreakdown,
  formatGroupLine,
  formatGroupMeta,
  formatHeadline,
  formatHeadlineRow,
  formatTaskCount,
  GROUP_ROW_INDENT,
  MIN_BREAKDOWN_WIDTH,
} from "../src/tokenmeter/format"
import { GLYPH } from "../src/tokenmeter/glyphs"
import {
  PROJECT_HISTORY_KEY,
  persistDeletedSession,
} from "../src/tokenmeter/ledger"
import {
  realOutput,
  sumMessages,
  sumProjectSessions,
  usageOf,
} from "../src/tokenmeter/math"
import { fmtCompact, fmtCost } from "../src/tokenmeter/numbers"
import {
  disposeProjectRefresh,
  PROJECT_REFRESH_DELAY,
  projectError,
  projectLoading,
  projectSnapshot,
  refreshProject,
  scheduleProjectRefresh,
  setProjectError,
  setProjectSnapshot,
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
  ProjectLedger,
  ProjectSessionLike,
  SessionInfo,
  UsageMessage,
} from "../src/tokenmeter/types"

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
  test("usageOf context is input + output + reasoning — tokens.total unused, cache excluded", () => {
    // The provider total is NOT used for the displayed context (it may
    // include cache); context is always the no-cache formula.
    const withTotal = usageOf(
      msg("m1", "ses_root", {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 10, write: 5 },
        total: 200,
      }),
    )
    expect(withTotal?.context).toBe(125)
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
    expect(absent?.context).toBe(125)
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
    expect(usage.context).toBe(2 * (10 + 20 + 5))
  })

  test("REGRESSION: a huge cache changes ONLY the cache metric, never either hourglass headline", () => {
    const sessions: ProjectSessionLike[] = [
      {
        id: "a",
        projectID: "p",
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 9000000, write: 500000 },
        },
      },
      {
        id: "b",
        projectID: "p",
        tokens: {
          input: 2000,
          output: 700,
          reasoning: 300,
          cache: { read: 8000000, write: 0 },
        },
      },
    ]
    const usage = sumProjectSessions("p", sessions)
    // Context is ONE no-cache snapshot per session (input + raw output +
    // raw reasoning); the enormous cache appears ONLY in the cache metric,
    // never in either hourglass headline.
    expect(usage.context).toBe(1700 + 3000)
    expect(usage.cache).toBe(9500000 + 8000000)
    expect(realOutput(usage.output, usage.reasoning)).toBe(1700)
    expect(usage.sessions).toBe(2)
  })
})

describe("session aggregation (max context, cumulative breakdowns)", () => {
  test("total is the max observed context snapshot, not the sum", () => {
    const map = new Map<string, ReturnType<typeof usageOf>>()
    map.set("m1", usageOf(msg("m1", "ses_x", { input: 1000, output: 0 })))
    map.set("m2", usageOf(msg("m2", "ses_x", { input: 3000, output: 0 })))
    map.set("m3", usageOf(msg("m3", "ses_x", { input: 2000, output: 0 })))
    const s = sumMessages(
      map as Map<string, NonNullable<ReturnType<typeof usageOf>>>,
    )
    expect(s.total).toBe(3000)
    expect(s.input).toBe(6000)
  })

  test("cumulative in/out/cache/cost stay separate from the context snapshot", () => {
    const map = new Map<string, NonNullable<ReturnType<typeof usageOf>>>()
    map.set(
      "m1",
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
      )!,
    )
    map.set(
      "m2",
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
      )!,
    )
    const s = sumMessages(map)
    // Context is the max no-cache snapshot (500+100+50), never tokens.total.
    expect(s.total).toBe(650)
    expect(s.input).toBe(1000)
    expect(s.output).toBe(200)
    expect(s.reasoning).toBe(100)
    expect(s.cache).toBe(100)
    expect(s.cost).toBeCloseTo(0.2)
  })

  test("message-ID replacement (retry/streaming upsert) keeps one snapshot per message", () => {
    const map = new Map<string, NonNullable<ReturnType<typeof usageOf>>>()
    map.set("m1", usageOf(msg("m1", "ses_x", { input: 1000, output: 0 }))!)
    map.set("m1", usageOf(msg("m1", "ses_x", { input: 2500, output: 0 }))!)
    const s = sumMessages(map)
    expect(s.total).toBe(2500)
    expect(s.input).toBe(2500)
  })
})

describe("project aggregation (project.ts)", () => {
  /** Shared in-memory kv fake: survives across refreshProject calls. */
  const makeKv = () => {
    const store = new Map<string, unknown>()
    return {
      store,
      kv: {
        get: <V = unknown>(key: string, fallback?: V): V =>
          store.has(key) ? (store.get(key) as V) : (fallback as V),
        set: (key: string, value: unknown) => void store.set(key, value),
      },
    }
  }

  const projApi = (
    project: { id: string; worktree?: string } | null,
    sessions: ProjectSessionLike[],
    kvEnv: ReturnType<typeof makeKv> = makeKv(),
  ) => ({
    ...kvEnv,
    state: { path: { directory: "/proj/dir" } },
    client: {
      project: {
        current: async ({ directory }: { directory: string }) => {
          expect(directory).toBe("/proj/dir")
          return { data: project ?? undefined }
        },
      },
      session: {
        list: async (params: { directory: string; scope: "project" }) => {
          // Directory binds the request to the active server instance, while
          // project scope still crosses worktrees. Children stay included.
          expect(params.directory).toBe("/proj/dir")
          expect(params.scope).toBe("project")
          expect("roots" in (params as Record<string, unknown>)).toBe(false)
          expect("archived" in (params as Record<string, unknown>)).toBe(false)
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
    expect(usage?.sessions).toBe(3)
    expect(usage?.input).toBe(3500)
    expect(usage?.output).toBe(1300)
    expect(usage?.reasoning).toBe(550)
    expect(usage?.cache).toBe(200)
    expect(usage?.cost).toBeCloseTo(0.035)
    // Context: input + raw output + raw reasoning per session (cache excluded).
    expect(usage?.context).toBe(1700 + 3000 + 650)
    expect(realOutput(usage!.output, usage!.reasoning)).toBe(1850)
    disposeProjectRefresh()
  })

  test("the kv ledger is idempotent: persists a session after it disappears from session.list, never duplicates refreshes and replaces updates", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    const s1 = (
      over: Partial<ProjectSessionLike> = {},
    ): ProjectSessionLike => ({
      id: "s1",
      projectID: "proj1",
      cost: 0.01,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 200,
        cache: { read: 100, write: 50 },
      },
      ...over,
    })
    // First refresh: the live session is upserted into the ledger. Context is
    // input + raw output + raw reasoning (cache excluded); cache is separate.
    await refreshProject(projApi({ id: "proj1" }, [s1()], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)

    // Repeating the refresh with the same live list must not duplicate.
    await refreshProject(projApi({ id: "proj1" }, [s1()], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)

    // Updating the session replaces its snapshot (same ID, new values).
    const updated = s1({
      cost: 0.02,
      tokens: {
        input: 2000,
        output: 700,
        reasoning: 300,
        cache: { read: 25, write: 25 },
      },
    })
    await refreshProject(projApi({ id: "proj1" }, [updated], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(3000)
    expect(projectSnapshot()?.cache).toBe(50)

    // The session disappears from the live list: it becomes a tombstone and
    // keeps contributing its last known snapshot — no token loss on delete.
    await refreshProject(projApi({ id: "proj1" }, [], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(3000)
    expect(projectSnapshot()?.cache).toBe(50)
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"]).toMatchObject({
      input: 2000,
      output: 700,
      reasoning: 300,
      cache: 50,
    })
    expect(ledger.projects["proj1"]["s1"].deletedAt).toBeDefined()
    disposeProjectRefresh()
  })

  test("session.deleted preserves the delete payload when it carries usage, else the last known snapshot", async () => {
    const kvEnv = makeKv()
    // A previously-refreshed session leaves a snapshot in the ledger.
    await refreshProject(
      projApi(
        { id: "proj1" },
        [
          {
            id: "s1",
            projectID: "proj1",
            cost: 0.01,
            tokens: { input: 1000, output: 500, reasoning: 200 },
          },
        ],
        kvEnv,
      ) as never,
    )
    // Delete payload WITHOUT usage: the last known snapshot survives.
    persistDeletedSession(kvEnv.kv, {
      id: "s1",
      projectID: "proj1",
      title: "gone",
    })
    let ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"]).toMatchObject({
      cost: 0.01,
      input: 1000,
      output: 500,
      reasoning: 200,
    })
    expect(ledger.projects["proj1"]["s1"].deletedAt).toBeDefined()

    // Delete payload WITH token/cost data: it becomes the final snapshot.
    persistDeletedSession(kvEnv.kv, {
      id: "s2",
      projectID: "proj1",
      cost: 0.005,
      tokens: {
        input: 500,
        output: 100,
        reasoning: 50,
        cache: { read: 25, write: 25 },
      },
    })
    ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s2"]).toMatchObject({
      cost: 0.005,
      input: 500,
      output: 100,
      reasoning: 50,
      cache: 50,
    })
    expect(ledger.projects["proj1"]["s2"].deletedAt).toBeDefined()

    // A deleted session that was NEVER observed creates no phantom entry.
    persistDeletedSession(kvEnv.kv, { id: "ghost", projectID: "proj1" })
    ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["ghost"]).toBeUndefined()
    disposeProjectRefresh()
  })

  test("REGRESSION: a session observed via messages keeps its usage in the ledger when list and delete payloads carry no usage", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    // The plugin observed the session's messages (authoritative client data);
    // the REAL list/delete payload shapes carry no token/cost fields.
    upsertMessageUsage(
      msg(
        "m1",
        "s1",
        { input: 1000, output: 500, reasoning: 200, total: 1700 },
        0.01,
      ),
    )
    await refreshProject(
      projApi(
        { id: "proj1" },
        [{ id: "s1", projectID: "proj1" }],
        kvEnv,
      ) as never,
    )
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.01)
    // session.deleted with a usage-less payload: the observed snapshot must
    // be persisted BEFORE the store forgets the session, and the total must
    // survive the post-delete refresh (tombstone keeps contributing).
    persistDeletedSession(
      kvEnv.kv,
      { id: "s1", projectID: "proj1", title: "gone" },
      observedSessionUsage("s1"),
    )
    await refreshProject(projApi({ id: "proj1" }, [], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.01)
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"].deletedAt).toBeDefined()
    disposeProjectRefresh()
    forgetSession("s1")
  })

  test("REGRESSION: observed-usage ledger entries are idempotent and replace, never accumulate", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    upsertMessageUsage(
      msg(
        "m1",
        "s1",
        { input: 1000, output: 500, reasoning: 200, total: 1700 },
        0.01,
      ),
    )
    const live = [{ id: "s1", projectID: "proj1" }]
    await refreshProject(projApi({ id: "proj1" }, live, kvEnv) as never)
    await refreshProject(projApi({ id: "proj1" }, live, kvEnv) as never)
    await refreshProject(projApi({ id: "proj1" }, live, kvEnv) as never)
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(Object.keys(ledger.projects["proj1"])).toHaveLength(1)
    expect(projectSnapshot()?.context).toBe(1700)
    // The session grows (a second message lands): the observed snapshot is
    // the session's cumulative sum and REPLACES the previous entry — still
    // exactly one entry, never accumulated twice.
    upsertMessageUsage(
      msg(
        "m2",
        "s1",
        { input: 2000, output: 700, reasoning: 300, total: 3000 },
        0.02,
      ),
    )
    await refreshProject(projApi({ id: "proj1" }, live, kvEnv) as never)
    expect(Object.keys(ledger.projects["proj1"])).toHaveLength(1)
    expect(projectSnapshot()?.sessions).toBe(1)
    // Raw fields are cumulative; context is the max observed snapshot.
    expect(projectSnapshot()?.context).toBe(3000)
    disposeProjectRefresh()
    forgetSession("s1")
  })

  test("REGRESSION: Project and Session hourglass headlines are the same no-cache quantity — Project >= a member Session by membership, not by cache", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    // Exact screenshot fixture: input 29k, output 117, reasoning 103, cache
    // 18k. The Session headline must be the no-cache context (29.2k), NOT
    // 46k and NOT 47.2k — cache never enters either headline.
    upsertMessageUsage(
      msg(
        "m1",
        "s1",
        {
          input: 29000,
          output: 117,
          reasoning: 103,
          cache: { read: 18000, write: 0 },
          total: 46000,
        },
        1.23,
      ),
    )
    const sessionContext = observedSessionUsage("s1")!.total
    expect(sessionContext).toBe(29220)
    await refreshProject(
      projApi(
        { id: "proj1" },
        [{ id: "s1", projectID: "proj1" }],
        kvEnv,
      ) as never,
    )
    expect(projectSnapshot()?.sessions).toBe(1)
    // Project is the sum of per-session no-cache contexts; the current
    // session is a member, so Project >= Session by membership.
    expect(projectSnapshot()?.context).toBe(sessionContext)
    expect(projectSnapshot()?.context).toBeGreaterThanOrEqual(29220)
    // The cache stays ONLY in the cache metric.
    expect(projectSnapshot()?.cache).toBe(18000)
    // The ledger entry carries the observed no-cache context snapshot.
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"].context).toBe(29220)
    // Deleting the session keeps the same no-cache context in the tombstone.
    persistDeletedSession(
      kvEnv.kv,
      { id: "s1", projectID: "proj1" },
      observedSessionUsage("s1"),
    )
    await refreshProject(projApi({ id: "proj1" }, [], kvEnv) as never)
    expect(projectSnapshot()?.context).toBe(29220)
    expect(projectSnapshot()?.cache).toBe(18000)
    disposeProjectRefresh()
    forgetSession("s1")
  })

  test("REGRESSION: observed ledger context is the MAX no-cache message context snapshot, never the cumulative sum", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    upsertMessageUsage(
      msg(
        "m1",
        "s1",
        { input: 100, output: 10, reasoning: 5, total: 1000 },
        0.01,
      ),
    )
    upsertMessageUsage(
      msg(
        "m2",
        "s1",
        { input: 200, output: 20, reasoning: 10, total: 3000 },
        0.02,
      ),
    )
    await refreshProject(
      projApi(
        { id: "proj1" },
        [{ id: "s1", projectID: "proj1" }],
        kvEnv,
      ) as never,
    )
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    // Raw fields are cumulative; context is the max observed no-cache
    // snapshot (230 = 200+20+10), never tokens.total (3000) and never the
    // cumulative context sum (345 = 115+230).
    expect(ledger.projects["proj1"]["s1"]).toMatchObject({
      input: 300,
      output: 30,
      reasoning: 15,
    })
    expect(ledger.projects["proj1"]["s1"].context).toBe(230)
    expect(projectSnapshot()?.context).toBe(230)
    disposeProjectRefresh()
    forgetSession("s1")
  })

  test("REGRESSION: payload-only ledger entries get no-cache context = input + output + reasoning", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    await refreshProject(
      projApi(
        { id: "proj1" },
        [
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
        ],
        kvEnv,
      ) as never,
    )
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"].context).toBe(1700)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)
    disposeProjectRefresh()
  })

  test("REGRESSION: pre-fix ledger entries without a context field keep contributing with the no-cache fallback", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    kvEnv.kv.set(PROJECT_HISTORY_KEY, {
      v: 1,
      projects: {
        proj1: {
          s_old: {
            cost: 0.01,
            input: 1000,
            output: 500,
            reasoning: 200,
            cache: 150,
            deletedAt: new Date().toISOString(),
          },
        },
      },
    })
    await refreshProject(projApi({ id: "proj1" }, [], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    // Pre-fix entry without context: no-cache fallback, cache excluded.
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)
    disposeProjectRefresh()
  })

  test("REGRESSION: post-delete — a failing project.current() with the projectIDHint recovers Project from the ledger, same contribution, no error, tombstone kept", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const kvEnv = makeKv()
    const s1 = (
      over: Partial<ProjectSessionLike> = {},
    ): ProjectSessionLike => ({
      id: "s1",
      projectID: "proj1",
      cost: 0.01,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 200,
        cache: { read: 100, write: 50 },
      },
      ...over,
    })
    // First load: the live session is persisted into the ledger.
    await refreshProject(projApi({ id: "proj1" }, [s1()], kvEnv) as never)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)
    // session.deleted (payload without usage) tombstones the entry.
    persistDeletedSession(kvEnv.kv, {
      id: "s1",
      projectID: "proj1",
      title: "gone",
    })
    // The context lookup now fails — right after a delete project.current()
    // can be momentarily unresolved. The refresh carries the projectIDHint.
    const failing = {
      ...kvEnv,
      state: { path: { directory: "/proj/dir" } },
      client: {
        project: {
          current: async () => {
            throw new Error("boom")
          },
        },
      },
    }
    await refreshProject(failing as never, "proj1")
    // Recovered from the ledger: the SAME contribution as before the delete
    // (tombstone included) and NO error — the delete must not flash the
    // stable failure message.
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cache).toBe(150)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.01)
    expect(projectError()).toBeNull()
    // The tombstone is still in the ledger, keeping its snapshot.
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"]).toMatchObject({
      cost: 0.01,
      input: 1000,
      output: 500,
      reasoning: 200,
      cache: 150,
    })
    expect(ledger.projects["proj1"]["s1"].deletedAt).toBeDefined()
    disposeProjectRefresh()
  })

  test("REGRESSION: post-delete — a failing session.list recovers by the resolved project ID even when a later debounce lost the hint", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const kvEnv = makeKv()
    await refreshProject(
      projApi(
        { id: "proj1" },
        [
          {
            id: "s1",
            projectID: "proj1",
            cost: 0.01,
            tokens: { input: 1000, output: 500, reasoning: 200 },
          },
        ],
        kvEnv,
      ) as never,
    )
    expect(projectSnapshot()?.context).toBe(1700)
    // The list endpoint fails while the hint names the deleted project.
    const failing = {
      ...kvEnv,
      state: { path: { directory: "/proj/dir" } },
      client: {
        project: {
          current: async ({ directory }: { directory: string }) => {
            expect(directory).toBe("/proj/dir")
            return { data: { id: "proj1" } }
          },
        },
        session: {
          list: async ({
            directory,
            scope,
          }: {
            directory: string
            scope: "project"
          }) => {
            expect(directory).toBe("/proj/dir")
            expect(scope).toBe("project")
            throw new Error("boom")
          },
        },
      },
    }
    await refreshProject(failing as never)
    expect(projectSnapshot()?.sessions).toBe(1)
    expect(projectSnapshot()?.context).toBe(1700)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.01)
    expect(projectError()).toBeNull()
    disposeProjectRefresh()
  })

  test("REGRESSION: post-delete recovery needs BOTH the hint and ledger entries — otherwise the stable error stays", async () => {
    // (a) A hint, but the ledger has no entries for that project: nothing to
    // recover from — the stable error still surfaces.
    setProjectSnapshot(null)
    setProjectError(null)
    let kvEnv = makeKv()
    const failCurrent = () => ({
      ...kvEnv,
      state: { path: { directory: "/proj/dir" } },
      client: {
        project: {
          current: async () => {
            throw new Error("boom")
          },
        },
      },
    })
    await refreshProject(failCurrent() as never, "proj1")
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")

    // (b) Ledger entries exist, but NO hint: the refresh cannot know which
    // project to recover, so it must not guess — the stable error stays.
    setProjectError(null)
    kvEnv = makeKv()
    await refreshProject(
      projApi(
        { id: "proj1" },
        [
          {
            id: "s1",
            projectID: "proj1",
            tokens: { input: 1000, output: 500, reasoning: 200 },
          },
        ],
        kvEnv,
      ) as never,
    )
    expect(projectSnapshot()?.context).toBe(1700)
    setProjectSnapshot(null)
    await refreshProject(failCurrent() as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
    disposeProjectRefresh()
  })

  test("REGRESSION: kv initially empty — Project falls back to the live total and normalizes/persists the ledger", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    const sessions: ProjectSessionLike[] = [
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
      {
        id: "s2",
        projectID: "proj1",
        cost: 0.02,
        tokens: { input: 2000, output: 700, reasoning: 300 },
      },
    ]
    await refreshProject(projApi({ id: "proj1" }, sessions, kvEnv) as never)
    // The live total wins — Project is never zeroed by a fresh ledger.
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(1700 + 3000)
    expect(projectSnapshot()?.cache).toBe(150)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.03)
    // The ledger was rebuilt and persisted from the live sessions.
    const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s1"]).toMatchObject({
      cost: 0.01,
      input: 1000,
      output: 500,
      reasoning: 200,
      cache: 150,
    })
    // Repeating the refresh stays idempotent: no double count, same total.
    await refreshProject(projApi({ id: "proj1" }, sessions, kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4700)
    expect(projectSnapshot()?.cache).toBe(150)
    disposeProjectRefresh()
  })

  test("REGRESSION: malformed or unexpected kv shape never zeroes Project when the live list carries tokens", async () => {
    const sessions: ProjectSessionLike[] = [
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
    ]
    for (const garbage of [
      "garbage",
      { projects: null },
      { projects: [1, 2, 3] },
      { v: 2, projects: {} },
      null,
      42,
    ]) {
      setProjectSnapshot(null)
      const kvEnv = makeKv()
      kvEnv.kv.set(PROJECT_HISTORY_KEY, garbage)
      await refreshProject(projApi({ id: "proj1" }, sessions, kvEnv) as never)
      // The malformed ledger is normalized away; the live total is shown.
      expect(projectSnapshot()?.sessions).toBe(1)
      expect(projectSnapshot()?.context).toBe(1700)
      expect(projectSnapshot()?.cache).toBe(150)
      // And the persisted ledger is a well-formed shape for the next refresh.
      const ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
      expect(ledger.v).toBe(1)
      expect(ledger.projects["proj1"]["s1"]).toMatchObject({
        input: 1000,
        output: 500,
        reasoning: 200,
      })
    }
    disposeProjectRefresh()
  })

  test("REGRESSION: a session that disappears after the fallback becomes a tombstone that keeps contributing; reappearing replaces in place", async () => {
    setProjectSnapshot(null)
    const kvEnv = makeKv()
    const s1 = (
      over: Partial<ProjectSessionLike> = {},
    ): ProjectSessionLike => ({
      id: "s1",
      projectID: "proj1",
      cost: 0.01,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 200,
        cache: { read: 100, write: 50 },
      },
      ...over,
    })
    const s2 = (
      over: Partial<ProjectSessionLike> = {},
    ): ProjectSessionLike => ({
      id: "s2",
      projectID: "proj1",
      cost: 0.02,
      tokens: { input: 2000, output: 700, reasoning: 300 },
      ...over,
    })
    // First refresh on an empty kv: fallback path, ledger persisted.
    await refreshProject(projApi({ id: "proj1" }, [s1(), s2()], kvEnv) as never)
    expect(projectSnapshot()?.context).toBe(4700)
    // s2 disappears from the live list: tombstone keeps its contribution.
    await refreshProject(projApi({ id: "proj1" }, [s1()], kvEnv) as never)
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(4700)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.03)
    let ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s2"].deletedAt).toBeDefined()
    // s2 reappears with UPDATED usage: snapshot replaced in place, no duplicate.
    await refreshProject(
      projApi(
        { id: "proj1" },
        [
          s1(),
          s2({
            cost: 0.05,
            tokens: { input: 4000, output: 900, reasoning: 500 },
          }),
        ],
        kvEnv,
      ) as never,
    )
    expect(projectSnapshot()?.sessions).toBe(2)
    expect(projectSnapshot()?.context).toBe(1700 + 5400)
    expect(projectSnapshot()?.cost).toBeCloseTo(0.06)
    ledger = kvEnv.store.get(PROJECT_HISTORY_KEY) as ProjectLedger
    expect(ledger.projects["proj1"]["s2"].deletedAt).toBeUndefined()
    disposeProjectRefresh()
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
    expect(projectError()!).not.toContain("undefined is not an object")
    disposeProjectRefresh()
  })

  test("project.current without data is an error, not a silent placeholder", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    await refreshProject(projApi(null, []) as never)
    expect(projectSnapshot()).toBeNull()
    expect(projectError()).toBe("Unable to load project data")
    disposeProjectRefresh()
  })

  test("session.list without data is an error, not a silent empty list", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const api = {
      kv: makeKv().kv,
      state: { path: { directory: "/proj/dir" } },
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
    disposeProjectRefresh()
  })

  test("projectLoading is true while the refresh runs and flips back to false on success AND on failure (finally)", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
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
    const run = refreshProject(projApi({ id: "proj1" }, sessions) as never)
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
      state: { path: { directory: "/proj/dir" } },
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
    expect(projectError()!).not.toContain("boom")

    // Starting a refresh clears the error immediately, so an in-flight or
    // successful refresh never shows a stale error.
    setProjectError("stale error")
    const clearing = refreshProject(projApi({ id: "proj1" }, sessions) as never)
    expect(projectError()).toBeNull()
    await clearing
    expect(projectError()).toBeNull()
    disposeProjectRefresh()
  })

  test("Project list failure keeps the placeholder and surfaces the stable error; no throw", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    const api = {
      kv: makeKv().kv,
      state: { path: { directory: "/proj/dir" } },
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
    expect(projectError()!).not.toContain("boom")
  })

  test("REGRESSION: a client exposing only the old experimental.session.list path fails with the stable message, never a raw undefined error", async () => {
    setProjectSnapshot(null)
    setProjectError(null)
    // The production failure: `experimental` does not exist on the runtime
    // client, so only the old shape yields `undefined is not an object`.
    const api = {
      kv: makeKv().kv,
      state: { path: { directory: "/proj/dir" } },
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
    expect(projectError()!).not.toContain("undefined is not an object")
    expect(projectError()!).not.toContain("\n    at ")
    disposeProjectRefresh()
  })

  test("REGRESSION: project.ts targets the stable client API only — no experimental, no archived, no raw error capture", () => {
    const src = readFileSync(
      new URL("../src/tokenmeter/project.ts", import.meta.url),
      "utf8",
    )
    expect(src).toMatch(
      /session\.list\(\{\s*directory,\s*scope: "project",\s*\}\)/,
    )
    expect(src).toContain("project.current({ directory })")
    expect(src).toContain("Unable to load project data")
    expect(src).not.toContain("experimental")
    expect(src).not.toContain("archived")
    expect(src).not.toContain("String(error)")
    expect(src).not.toContain("error.message")
  })

  test("scheduleProjectRefresh debounces and disposes its timer", async () => {
    setProjectSnapshot(null)
    disposeProjectRefresh()
    const api = projApi({ id: "proj1" }, [
      {
        id: "s1",
        projectID: "proj1",
        tokens: { input: 100, output: 50, reasoning: 10 },
      },
    ])
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
    disposeProjectRefresh()
  })
})

describe("reconcile snapshot (root + recursive descendants)", () => {
  test("REGRESSION: repeated input-context messages must not sum into the headline", async () => {
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
    const snap = snapshot()!
    expect(snap.totalTokens).toBe(52000 + 10500)
    expect(snap.input).toBe(4 * 50000 + 3 * 10000)
    expect(snap.output).toBe(4 * 2000 + 3 * 500)
    expect(snap.reasoning).toBe(0)
    expect(snap.cache).toBe(0)
    expect(snap.cost).toBeCloseTo(4 * 0.01 + 3 * 0.005)
    expect(snap.delegations).toBe(1)
    expect(snap.agents).toBe(1)
    expect(snap.groups).toHaveLength(1)
    expect(snap.groups[0].total).toBe(10500)
    expect(snap.groups[0].input).toBe(30000)
    expect(snap.groups[0].output).toBe(1500)
    expect(snap.groups[0].reasoning).toBe(0)
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
    const snap = snapshot()!
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

  test("REGRESSION: per-session context is the no-cache snapshot — tokens.total and cache never enter it", async () => {
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
    const snap = snapshot()!
    // 52000 = 50000+2000 (cache 3000 excluded, tokens.total 55000 unused).
    expect(snap.totalTokens).toBe(52000 + 10500)
    expect(snap.cache).toBe(3000)
    expect(snap.groups[0].total).toBe(10500)
    disposeReconcile()
  })

  test("REGRESSION: invalidateUsage rehydrates and reflects removed/changed messages", async () => {
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
    expect(snapshot()!.input).toBe(3000)

    // The final message.updated is MISSED: only the current messages now
    // carry the completed totals, with m1 removed and m2 grown. Invalidation
    // must force a full rehydrate (replace, not merge) so removals land.
    sessions[rootID] = [
      msg("m2", rootID, { input: 2000, output: 200, total: 2500 }, 0.02),
    ]
    invalidateUsage(rootID)
    await reconcile(fakeApi(sessions, {}, {}), rootID)
    await waitFor(() => snapshot()!.input === 2000)
    expect(snapshot()!.totalTokens).toBe(2200)
    expect(snapshot()!.cost).toBeCloseTo(0.02)
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
    const snap = snapshot()!
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
    const snap = snapshot()!
    expect(snap.delegations).toBe(3)
    expect(snap.agents).toBe(2)
    expect(snap.groups).toHaveLength(2)
    const general = snap.groups.find((g) => g.name === "general")
    const explore = snap.groups.find((g) => g.name === "explore")
    expect(general?.runs).toBe(2)
    expect(explore?.runs).toBe(1)
    disposeReconcile()
  })

  test("groups order by context total descending; cost/runs/name only break ties", async () => {
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
    const names = snapshot()!.groups.map((g) => g.name)
    // Context total desc: beta (5.5k) first; alpha and zeta tie on total
    // (1.1k), cost and runs, so the name tiebreak puts alpha before zeta.
    expect(names).toEqual(["beta", "alpha", "zeta"])
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
    expect(textColumns(GLYPH.hourglass)).toBe(1)
    expect(textColumns(GLYPH.fire)).toBe(1)
    expect(textColumns(GLYPH.robot)).toBe(1)
    expect(textColumns(GLYPH.tasks)).toBe(1)
    expect(textColumns(GLYPH.reasoning)).toBe(1)
  })

  test("truncateToColumns never exceeds the budget and never splits a wide char", () => {
    expect(truncateToColumns("TokenMeter 1.0.0", 17)).toBe("TokenMeter 1.0.0")
    expect(truncateToColumns("TokenMeter 1.0.0", 10)).toBe("TokenMete…")
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

  test("REGRESSION: headline, Project and group costs all flow through fmtCost — no 3/4-decimal output survives", () => {
    expect(formatHeadlineRow(1000, 0, 0.005)).toContain("$0.01")
    expect(formatHeadlineRow(1000, 0, 0.03)).toContain("$0.03")
    const group = { name: "g", runs: 1, total: 100, reasoning: 0, cost: 0.005 }
    expect(formatGroupMeta(group).cost).toBe(" · " + GLYPH.fire + " $0.01")
  })
})

describe("panel lines fit the default sidebar width (format.ts)", () => {
  const snap = {
    totalTokens: 1200000,
    cost: 1.23,
    input: 900000,
    output: 400000,
    reasoning: 120000,
    cache: 300000,
  }
  const group = {
    name: "sdd-apply",
    runs: 2,
    running: 0,
    cost: 0.03,
    total: 748900,
    input: 2700000,
    output: 411200,
    reasoning: 100000,
    cache: 10,
  }
  const outputReal = realOutput(snap.output, snap.reasoning)

  test("the three-value breakdown fits the design budget and stays one line", () => {
    const line = formatBreakdown(snap.input, outputReal, snap.cache)
    expect(textColumns(line)).toBeLessThanOrEqual(MIN_BREAKDOWN_WIDTH)
    expect(line.split("\n")).toHaveLength(1)
  })

  test("breakdown keeps a visible gap after every glyph: output real one space, cache two", () => {
    expect(formatBreakdown(snap.input, outputReal, snap.cache)).toContain(
      `${GLYPH.down} ${fmtCompact(outputReal)}`,
    )
    expect(formatBreakdown(snap.input, outputReal, snap.cache)).toContain(
      `${GLYPH.cache}  ${fmtCompact(snap.cache)}`,
    )
  })

  test("REGRESSION: breakdown order is input, output real, cache with the real values", () => {
    expect(formatBreakdown(1, 2, 3)).toBe(
      `${GLYPH.up} 1 · ${GLYPH.down} 2 · ${GLYPH.cache}  3`,
    )
  })

  test("REGRESSION: the breakdown row is fully muted and segments concat to the whole line", () => {
    const segments = breakdownSegments(snap.input, outputReal, snap.cache)
    expect(segments.map((s) => s.accent)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
    expect(segments.map((s) => s.text).join("")).toBe(
      formatBreakdown(snap.input, outputReal, snap.cache),
    )
  })

  test("headline, task and subagent lines fit the default content width", () => {
    const inner = contentWidth(38)
    expect(
      textColumns(
        formatHeadlineRow(snap.totalTokens, snap.reasoning, snap.cost),
      ),
    ).toBeLessThanOrEqual(inner)
    expect(textColumns(formatTaskCount(3))).toBeLessThanOrEqual(inner)
    expect(textColumns(` · ${GLYPH.fire} ${"$12.34"}`)).toBeLessThanOrEqual(
      inner,
    )
    expect(textColumns(formatAgents(3))).toBeLessThanOrEqual(inner)
  })

  test("the headline row degrades at the narrowest clamp (panel hides it, no overflow)", () => {
    expect(
      textColumns(
        formatHeadlineRow(snap.totalTokens, snap.reasoning, snap.cost),
      ),
    ).toBeGreaterThan(contentWidth(24))
    // The three metric values alone still fit; the thinking/cost additions push the row out.
    expect(
      textColumns(formatHeadline({ totalTokens: snap.totalTokens })),
    ).toBeLessThanOrEqual(contentWidth(24))
  })

  test("formatTaskCount carries the U+E20F task glyph, the count and the task text", () => {
    expect(formatTaskCount(3)).toBe(` · ${GLYPH.tasks}  3 task`)
    expect(formatTaskCount(0)).toBe(` · ${GLYPH.tasks}  0 task`)
    expect(formatTaskCount(3)).toContain("task")
  })

  test("formatAgents keeps two spaces between robot and count, the lowercase agents text, and no task", () => {
    expect(formatAgents(3)).toBe(`${GLYPH.robot}  3 agents`)
    expect(formatAgents(1)).toBe(`${GLYPH.robot}  1 agents`)
    expect(formatAgents(3)).toContain("agents")
    expect(formatAgents(3)).not.toContain("task")
    expect(formatAgents(3)).not.toMatch(/Subagents/)
  })

  test("REGRESSION: each group renders exactly three rows — indented primary-blue robot + name + tasks, indented context+thinking+cost, indented three metrics — in order", () => {
    const line = formatGroupLine(group, 36)
    const meta = formatGroupMeta(group)
    const breakdown = formatBreakdown(
      group.input,
      realOutput(group.output, group.reasoning),
      group.cache,
    )
    expect(line.marker + line.robot + line.name + line.tasks).toBe(
      `  ↳ ${GLYPH.robot}  sdd-apply · ${GLYPH.tasks}  2 task`,
    )
    expect(line.robot).toBe(`${GLYPH.robot}  `)
    expect(meta.context + meta.thinking + meta.cost).toBe(
      `${GLYPH.hourglass} 748.9k · ${GLYPH.reasoning}  100.0k · ${GLYPH.fire} $0.03`,
    )
    expect(breakdown).toBe(
      `${GLYPH.up} 2.7M · ${GLYPH.down} 511k · ${GLYPH.cache}  10`,
    )
  })

  test("group rows 2/3 keep the four-column indent at the default width", () => {
    const meta = formatGroupMeta(group)
    const breakdown = formatBreakdown(
      group.input,
      realOutput(group.output, group.reasoning),
      group.cache,
    )
    expect(
      textColumns(GROUP_ROW_INDENT) +
        textColumns(meta.context + meta.thinking + meta.cost),
    ).toBeLessThanOrEqual(contentWidth(38))
    expect(
      textColumns(GROUP_ROW_INDENT) + textColumns(breakdown),
    ).toBeLessThanOrEqual(contentWidth(38))
  })

  test("group row 1 keeps the task count at every clamped width; rows 2-3 never overflow (they hide)", () => {
    const meta = formatGroupMeta(group)
    const breakdown = formatBreakdown(
      group.input,
      realOutput(group.output, group.reasoning),
      group.cache,
    )
    for (let width = 22; width <= 50; width += 2) {
      const line = formatGroupLine(group, width)
      expect(line.tasks).toBe(` · ${GLYPH.tasks}  2 task`)
      expect(textColumns(line.name)).toBeGreaterThanOrEqual(1)
      expect(
        textColumns(line.marker + line.robot + line.name + line.tasks),
      ).toBeLessThanOrEqual(width)
    }
    // At the narrowest clamp the indented metric rows cannot fit: the panel
    // hides them rather than overflowing.
    expect(
      textColumns(GROUP_ROW_INDENT) +
        textColumns(meta.context + meta.thinking + meta.cost),
    ).toBeGreaterThan(contentWidth(24))
  })

  test("group row 1 renders the primary-blue robot icon plus two visible spaces before the name, reserved before truncation", () => {
    const at36 = formatGroupLine(group, 36)
    expect(at36.robot).toBe(`${GLYPH.robot}  `)
    expect(textColumns(at36.robot)).toBe(3)
    expect(at36.marker + at36.robot + at36.name).toContain(
      `${GLYPH.robot}  sdd-apply`,
    )

    const at34 = formatGroupLine({ ...group, name: "very-long-agent-name" }, 34)
    // The robot icon + both spaces are reserved BEFORE the name truncates:
    // the marker and the robot keep their columns while the name loses 3.
    expect(at34.marker).toBe(`  ↳ `)
    expect(at34.robot).toBe(`${GLYPH.robot}  `)
    expect(at34.name).toBe("very-long-agen…")

    const tight = formatGroupLine(group, 8)
    // Only when the name cannot keep even one column do the marker and the
    // robot yield together; the task count always survives.
    expect(tight.marker).toBe("")
    expect(tight.robot).toBe("")
    expect(tight.name).toBe("…")
    expect(tight.tasks).toBe(` · ${GLYPH.tasks}  2 task`)
  })

  test("REGRESSION: long names truncate on row 1 while rows 2-3 keep every metric; the marker and robot yield only in the extreme", () => {
    const at34 = formatGroupLine({ ...group, name: "very-long-agent-name" }, 34)
    expect(at34.marker).toBe(`  ↳ `)
    expect(at34.robot).toBe(`${GLYPH.robot}  `)
    expect(at34.name).toBe("very-long-agen…")
    expect(at34.tasks).toBe(` · ${GLYPH.tasks}  2 task`)

    const at26 = formatGroupLine({ ...group, name: "very-long-agent-name" }, 26)
    expect(at26.marker).toBe(`  ↳ `)
    expect(at26.robot).toBe(`${GLYPH.robot}  `)
    expect(at26.name).toBe("very-l…")
    expect(at26.tasks).toBe(` · ${GLYPH.tasks}  2 task`)
    const meta = formatGroupMeta(group)
    expect(meta.context + meta.thinking + meta.cost).toBe(
      `${GLYPH.hourglass} 748.9k · ${GLYPH.reasoning}  100.0k · ${GLYPH.fire} $0.03`,
    )

    const tight = formatGroupLine(group, 8)
    expect(tight.marker).toBe("")
    expect(tight.robot).toBe("")
    expect(tight.name).toBe("…")
    expect(tight.tasks).toBe(` · ${GLYPH.tasks}  2 task`)
  })

  test("growing values recalculate the row-1 name budget from the real rendered texts", () => {
    const sameWidth = 28
    const plain = formatGroupLine(
      { ...group, name: "very-long-agent-name" },
      sameWidth,
    )
    const grown = formatGroupLine(
      { ...group, name: "very-long-agent-name", runs: 123 },
      sameWidth,
    )
    expect(textColumns(plain.name)).toBeGreaterThan(textColumns(grown.name))
    expect(plain.tasks).toBe(` · ${GLYPH.tasks}  2 task`)
    expect(grown.tasks).toBe(` · ${GLYPH.tasks}  123 task`)
    expect(plain.marker).toBe(`  ↳ `)
    expect(grown.marker).toBe(`  ↳ `)
    expect(plain.robot).toBe(`${GLYPH.robot}  `)
    expect(grown.robot).toBe(`${GLYPH.robot}  `)
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

  test("glyph constants are the documented stable Nerd Font codepoints", () => {
    expect(GLYPH.hourglass).toBe("\uF4E3")
    expect(GLYPH.cache).toBe("\uF472")
    expect(GLYPH.fire).toBe("\u{F0238}")
    expect(GLYPH.robot).toBe("\u{F06A9}")
    expect(GLYPH.tasks).toBe("\u{E20F}")
    expect(GLYPH.reasoning).toBe("\u{EE9C}")
    expect(GLYPH.tree).toBe("↳")
    expect(GLYPH.expand).toBe("▶")
    expect(GLYPH.collapse).toBe("▼")
  })

  test("no unreliable glyphs, no person glyph, no useTerminalDimensions anywhere in the plugin", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      projectSectionSrc,
      formatSrc,
      entrySrc,
    ]) {
      for (const bad of ["⏱", "🔥", "▥", "useTerminalDimensions", "\uF415"])
        expect(source).not.toContain(bad)
    }
  })

  test("the old U+F0CA tasks glyph and the old U+F0AE/U+EB67 tasklist glyphs are gone; U+E20F is the task glyph", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
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
    expect(glyphsSrc).toContain("\\u{E20F}")
  })

  test("no tok/in/out/cache text labels survive in the sources", () => {
    for (const source of [
      glyphsSrc,
      panelSrc,
      groupRowsSrc,
      projectSectionSrc,
      formatSrc,
    ]) {
      expect(source).not.toMatch(/\btok\b/)
      expect(source).not.toContain('" in"')
      expect(source).not.toContain('" out"')
      expect(source).not.toContain('" cache"')
    }
  })

  test("the task text lives in formatTaskCount; the Subagents label is panel-only with the capital S, the metrics row uses lowercase agents", () => {
    expect(formatSrc).toContain("task")
    expect(formatSrc).toContain("agents")
    expect(formatSrc).not.toContain("Subagents")
    expect(formatSrc).not.toMatch(/\bsubagents\b/)
    expect(panelSrc).toContain("Subagents")
    expect(panelSrc).toContain("<text fg={theme().accent}>Subagents</text>")
  })

  test("panel colors and layout match the approved theme contract: accent Project/Session subtitles, clean title, accent Subagents label, chevron after Subagents, expanded metrics row", () => {
    // Subtitles: Project above Session, both accent; the plural is gone.
    expect(panelSrc).toContain("fg={theme().accent}>Project<")
    expect(panelSrc).toContain("fg={theme().accent}>Session<")
    expect(panelSrc).not.toContain("Sessions")
    expect(panelSrc.indexOf("Project")).toBeLessThan(
      panelSrc.indexOf("Session"),
    )
    // The title row is clean: truncated TokenMeter text flush left, no chevron.
    expect(panelSrc).toMatch(/truncateToColumns\(\s*"TokenMeter"/)
    expect(panelSrc).not.toContain(
      '{"  " + (props.expanded() ? GLYPH.collapse : GLYPH.expand)}',
    )
    // The chevron is the ONLY toggle: it sits right after the accent
    // Subagents label with a visible single-space margin, and nothing else
    // is clickable.
    expect(panelSrc.match(/onMouseDown/g)).toHaveLength(1)
    expect(panelSrc).toContain(
      "{` ${props.expanded() ? GLYPH.collapse : GLYPH.expand}`}",
    )
    expect(panelSrc).toMatch(/Subagents<\/text>[\s\S]{0,300}onMouseDown/)
    // The Subagents label is accent; the expanded metrics row renders the
    // lowercase agents counter (primary) and the global task count (success).
    expect(panelSrc).toContain("<text fg={theme().accent}>Subagents</text>")
    expect(panelSrc).toContain(
      "<text fg={theme().primary}>{formatAgents(snap().agents)}</text>",
    )
    expect(panelSrc).toMatch(
      /<text fg=\{theme\(\)\.success\}>\s*\{formatTaskCount\(snap\(\)\.delegations\)\}\s*<\/text>/,
    )
    expect(panelSrc).not.toContain(
      "<text fg={theme().text}>{formatAgents(snap().agents)}</text>",
    )
    expect(panelSrc).not.toContain(
      "<text fg={theme().info}>{formatAgents(snap().agents)}</text>",
    )
    expect(panelSrc).not.toContain(
      "<text fg={theme().textMuted}>{formatAgents(snap().agents)}</text>",
    )
    expect(panelSrc).not.toContain(
      "<text fg={theme().info}>{formatTaskCount(snap().delegations)}</text>",
    )
    // Per-agent rows (group-rows.tsx): indented marker, robot icon left of
    // the agent name in the SAME blue (BOTH theme().primary — the clock
    // stays cyan info), green success task count, info context, accent
    // thinking, error cost.
    expect(groupRowsSrc).toContain("fg={props.theme().text}>{line().marker}")
    expect(groupRowsSrc).toContain("fg={props.theme().primary}>{line().robot}")
    expect(groupRowsSrc).toContain("fg={props.theme().primary}>{line().name}")
    expect(groupRowsSrc).not.toMatch(
      /fg=\{props\.theme\(\)\.(text|info|textMuted)\}>\{line\(\)\.robot\}/,
    )
    expect(groupRowsSrc).not.toMatch(
      /fg=\{props\.theme\(\)\.(text|info|textMuted)\}>\{line\(\)\.name\}/,
    )
    expect(groupRowsSrc).toContain("fg={props.theme().success}>{line().tasks}")
    expect(groupRowsSrc).not.toMatch(
      /fg=\{props\.theme\(\)\.(info|textMuted)\}>\{line\(\)\.tasks\}/,
    )
    expect(groupRowsSrc.indexOf("line().robot")).toBeLessThan(
      groupRowsSrc.indexOf("line().name"),
    )
    // The robot icon + both spaces are reserved before the name truncates,
    // and the group row-1 prefix (marker + robot) is what yields in the extreme.
    expect(formatSrc).toContain("const robot = `")
    expect(formatSrc).toContain("textColumns(robot)")
    expect(groupRowsSrc).toContain("fg={props.theme().info}>{meta().context}")
    expect(groupRowsSrc).toContain(
      "fg={props.theme().accent}>{meta().thinking}",
    )
    expect(groupRowsSrc).toContain("fg={props.theme().error}>{meta().cost}")
    // Project placeholder fallback survives; the Session placeholder is intact.
    expect(panelSrc).toContain("fg={theme().textMuted}>…</text>")
    // Scrollbox gates on 3+ groups and caps at two groups (6 rows).
    expect(panelSrc).toContain("GROUP_SCROLL_THRESHOLD")
    expect(panelSrc).toMatch(
      /<scrollbox\s+height=\{MAX_SCROLLBOX_ROWS\}\s+scrollY\s+viewportCulling=\{false\}\s*>/,
    )
  })

  test("the Project loading fallback is the static `…` placeholder — no spinner, no interval, no frame cycling", () => {
    // While the section has no snapshot and no error the placeholder is a
    // plain muted ellipsis; loading never animates.
    expect(panelSrc).toContain("fg={theme().textMuted}>…</text>")
    // The spinner is gone: no indicator component, no interval machinery,
    // no loading glyph and no rotation frames anywhere in the panel modules.
    for (const source of [panelSrc, groupRowsSrc, projectSectionSrc]) {
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
    // A failed refresh surfaces a visible error line (project-section.tsx):
    // theme().error, showing ONLY the stable PROJECT_ERROR_MESSAGE (no
    // "Error: " prefix, no raw runtime message), truncated to the content
    // width so it never overflows.
    expect(panelSrc).toContain("projectError()")
    expect(projectSectionSrc).toContain("projectError()")
    expect(projectSectionSrc).toContain(
      "truncateToColumns(message(), props.inner())",
    )
    expect(projectSectionSrc).not.toContain("Error: ${message()}")
    expect(projectSectionSrc).toContain("fg={props.theme().error}")
    // Session keeps its own neutral fallback without a loading state.
    expect(panelSrc).toContain(
      "<Show when={view()} fallback={<text fg={theme().textMuted}>…</text>}>",
    )
  })
})
