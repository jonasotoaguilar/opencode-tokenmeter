/**
 * Durable deletion UPSERT — same checkpoint row, no tombstone ledger.
 * Verifies merge of payload + observed high-water and monotonic idempotency.
 */
import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import {
  checkpointActiveProject,
  readCheckpoints,
} from "../src/tokenmeter/durable/checkpoints"
import { checkpointDeletedSession } from "../src/tokenmeter/durable/deleted"
import type { ProjectSessionLike } from "../src/tokenmeter/types"
import { dbPathFor, sess, tmpDurable } from "./durable-helpers"

describe("durable deletion UPSERT", () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = tmpDurable()
    dbPath = dbPathFor(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("deletion performs same checkpoint upsert and no tombstone ledger", () => {
    const alias = "/proj/dir"
    const live = sess(
      "s1",
      "projA",
      { input: 1000, output: 500, reasoning: 200 },
      0.01,
    )
    checkpointActiveProject(dbPath, "projA", alias, [live])
    const observed = {
      cost: 0.01,
      input: 1000,
      output: 500,
      reasoning: 200,
      cacheRead: 0,
      cacheWrite: 0,
      cache: 0,
      total: 1700,
    } as const
    const payload = {
      id: "s1",
      projectID: "projA",
      cost: 0,
      tokens: {},
    } as unknown as ProjectSessionLike
    const ok = checkpointDeletedSession(
      dbPath,
      payload,
      alias,
      observed as never,
    )
    expect(ok).toBe(false)
    const cps = readCheckpoints(dbPath, "projA", alias)
    const s1 = cps.get("s1")
    expect(s1?.input).toBe(1000)
    expect(s1?.cache).toBe((s1?.cacheRead ?? 0) + (s1?.cacheWrite ?? 0))
    const largeObserved = {
      cost: 0.05,
      input: 5000,
      output: 1000,
      reasoning: 500,
      cacheRead: 100,
      cacheWrite: 50,
      cache: 150,
      total: 6650,
    } as const
    const ok2 = checkpointDeletedSession(
      dbPath,
      payload,
      alias,
      largeObserved as never,
    )
    expect(ok2).toBe(true)
    const cps2 = readCheckpoints(dbPath, "projA", alias)
    const s1b = cps2.get("s1")
    expect(s1b?.input).toBe(5000)
    expect(s1b?.cache).toBe(150)
    expect(s1b?.cache).toBe((s1b?.cacheRead ?? 0) + (s1b?.cacheWrite ?? 0))
    const db = new Database(dbPath)
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).not.toContain("tombstones")
    expect(tables.map((t) => t.name)).toContain("checkpoints")
    db.close()
  })

  test("rejects missing id/project and null dbPath", () => {
    expect(checkpointDeletedSession(null, { id: "s1" } as never)).toBe(false)
    expect(checkpointDeletedSession(dbPath, { id: "" } as never)).toBe(false)
    expect(checkpointDeletedSession(dbPath, { projectID: "p1" } as never)).toBe(
      false,
    )
    expect(
      checkpointDeletedSession(dbPath, { id: "s1", projectID: "" } as never),
    ).toBe(false)
  })
})
