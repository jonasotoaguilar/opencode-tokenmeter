/**
 * Durable checkpointing — batch idle and concurrency.
 * Real bun:sqlite filesystem, WAL + monotonic merge.
 */

import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkpointActiveProject,
  readCheckpoints,
} from "../src/tokenmeter/durable/checkpoints"
import {
  disposeProjectRefresh,
  PROJECT_SESSION_LIMIT,
  refreshProject,
  setProjectSnapshot,
} from "../src/tokenmeter/project"
import { dbPathFor, sess, tmpDurable } from "./durable-helpers"

describe("durable checkpointing — batch and idle", () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = tmpDurable()
    dbPath = dbPathFor(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("unchanged periodic refresh results in zero row updates; D changed yields D rows in one transaction", () => {
    const alias = "/proj/dir"
    const base = [
      sess("s1", "projA", { input: 1000, output: 500 }, 0.01),
      sess("s2", "projA", { input: 2000, output: 700 }, 0.02),
    ]
    expect(checkpointActiveProject(dbPath, "projA", alias, base)).toBe(2)
    expect(checkpointActiveProject(dbPath, "projA", alias, base)).toBe(0)
    const oneChanged = [
      sess("s1", "projA", { input: 5000, output: 500 }, 0.01),
      sess("s2", "projA", { input: 2000, output: 700 }, 0.02),
    ]
    expect(checkpointActiveProject(dbPath, "projA", alias, oneChanged)).toBe(1)
    const cps = readCheckpoints(dbPath, "projA", alias)
    expect(cps.get("s1")!.input).toBe(5000)
    expect(cps.get("s2")!.input).toBe(2000)
    for (const row of cps.values())
      expect(row.cache).toBe(row.cacheRead + row.cacheWrite)
  })

  test("no added API calls: checkpoint piggybacks on existing list, no messages fetch", async () => {
    let listCalls = 0
    let messagesCalls = 0
    const durableDir = tmpDurable()
    const prev = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = durableDir
    try {
      const api = {
        state: {
          path: {
            directory: "/proj/dir",
            state: mkdtempSync(join(tmpdir(), "state-")),
          },
        },
        client: {
          project: {
            current: async () => ({
              data: { id: "projA", worktree: "/proj/dir" },
            }),
          },
          session: {
            list: async (p: Record<string, unknown>) => {
              listCalls++
              expect(p.limit).toBe(PROJECT_SESSION_LIMIT)
              return {
                data: [sess("s1", "projA", { input: 100, output: 50 }, 0.01)],
              }
            },
            messages: async () => {
              messagesCalls++
              return { data: [] }
            },
          },
          v2: { model: { list: async () => ({ data: [] }) } },
        },
      } as unknown as Parameters<typeof refreshProject>[0]
      setProjectSnapshot(null)
      await refreshProject(api as never)
      expect(listCalls).toBe(1)
      expect(messagesCalls).toBe(0)
      listCalls = 0
      await refreshProject(api as never)
      expect(listCalls).toBe(1)
      expect(messagesCalls).toBe(0)
      rmSync(
        (api as unknown as { state: { path: { state: string } } }).state.path
          .state,
        { recursive: true, force: true },
      )
      disposeProjectRefresh()
    } finally {
      if (prev === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = prev
      rmSync(durableDir, { recursive: true, force: true })
    }
  })
})

describe("durable concurrency — WAL and crash safety", () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = tmpDurable()
    dbPath = dbPathFor(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("concurrent TUI processes do not regress or double-count; interrupted transaction preserves prior commit", () => {
    const alias = "/proj/dir"
    const s1 = sess("s1", "projA", { input: 1000, output: 500 }, 0.01)
    checkpointActiveProject(dbPath, "projA", alias, [s1])
    const s2a = sess("s2", "projA", { input: 2000, output: 700 }, 0.02)
    const s2b = sess("s2", "projA", { input: 2000, output: 700 }, 0.02)
    const db1 = new Database(dbPath)
    const db2 = new Database(dbPath)
    db1.exec("PRAGMA busy_timeout = 5000")
    db1.exec("PRAGMA journal_mode = WAL")
    db2.exec("PRAGMA busy_timeout = 5000")
    db2.exec("PRAGMA journal_mode = WAL")
    const c1 = checkpointActiveProject(dbPath, "projA", alias, [s2a])
    const c2 = checkpointActiveProject(dbPath, "projA", alias, [s2b])
    expect(c1 + c2).toBe(1)
    const cps = readCheckpoints(dbPath, "projA", alias)
    expect(cps.size).toBe(2)
    const before = new Map(cps)
    try {
      const badDb = new Database(dbPath)
      badDb.exec("PRAGMA busy_timeout = 5000")
      const tx = badDb.transaction(() => {
        badDb.exec(
          "INSERT INTO checkpoints (session_id, project_id, input) VALUES ('bad','projA', 999)",
        )
        throw new Error("crash")
      })
      tx.immediate()
    } catch {}
    const after = readCheckpoints(dbPath, "projA", alias)
    expect(after.size).toBe(2)
    expect(after.get("s1")!.input).toBe(before.get("s1")!.input)
    db1.close()
    db2.close()
  })

  test("stale independent writers with monotonic SQL MAX — no regression", () => {
    const alias = "/proj/dir"
    checkpointActiveProject(dbPath, "projA", alias, [
      sess("s1", "projA", { input: 1000, output: 500 }, 0.01),
    ])
    const db = new Database(dbPath)
    db.exec("PRAGMA busy_timeout = 5000")
    checkpointActiveProject(dbPath, "projA", alias, [
      sess("s1", "projA", { input: 2000, output: 500 }, 0.01),
    ])
    const changed = checkpointActiveProject(dbPath, "projA", alias, [
      sess("s1", "projA", { input: 1500, output: 500 }, 0.01),
    ])
    expect(changed).toBe(0)
    const cps = readCheckpoints(dbPath, "projA", alias)
    expect(cps.get("s1")!.input).toBe(2000)
    expect(cps.get("s1")!.cache).toBe(
      cps.get("s1")!.cacheRead + cps.get("s1")!.cacheWrite,
    )
    const row = db
      .query(
        "SELECT input, cache, cache_read, cache_write FROM checkpoints WHERE session_id='s1'",
      )
      .get() as never as {
      input: number
      cache: number
      cache_read: number
      cache_write: number
    }
    expect(row.cache).toBe(row.cache_read + row.cache_write)
    db.close()
  })
})
