/**
 * Durable union reconciliation — overlap, checkpoint-only, duplicate dedupe,
 * monotonic high-water, alias recovery/isolation.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkpointActiveProject,
  readCheckpoints,
} from "../src/tokenmeter/durable/checkpoints"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"
import { dbPathFor, sess, tmpDurable } from "./durable-helpers"

describe("durable checkpoints — union and monotonic", () => {
  let dir: string
  let dbPath: string
  beforeEach(() => {
    dir = tmpDurable()
    dbPath = dbPathFor(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("cache/state deleted while durable remains → total recovers after restart (checkpoint-only survives)", async () => {
    const alias = "/proj/dir"
    const live = [
      sess("s1", "projA", { input: 1000, output: 500, reasoning: 200 }, 0.01),
      sess("s2", "projA", { input: 2000, output: 700, reasoning: 300 }, 0.02),
    ]
    const changed = checkpointActiveProject(dbPath, "projA", alias, live)
    expect(changed).toBe(2)
    const checkpoints = readCheckpoints(dbPath, "projA", alias)
    expect(checkpoints.size).toBe(2)
    const usage = reconcileProjectUsage("projA", [], checkpoints, alias)
    expect(usage.sessions).toBe(2)
    expect(usage.context).toBe(1700 + 3000)
    expect(usage.input).toBe(3000)
    expect(usage.cache).toBe(usage.cacheRead + usage.cacheWrite)
    for (const row of checkpoints.values()) {
      expect(row.cache).toBe(row.cacheRead + row.cacheWrite)
      expect(row.context).toBe(
        row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite,
      )
    }
  })

  test("live/checkpoint overlap counts once, checkpoint-only counts, duplicate live rows count once", () => {
    const alias = "/proj/dir"
    const s1 = sess(
      "s1",
      "projA",
      { input: 1000, output: 500, reasoning: 200 },
      0.01,
    )
    checkpointActiveProject(dbPath, "projA", alias, [s1])
    const liveDup = [
      s1,
      { ...s1 },
      sess("s2", "projA", { input: 200, output: 100 }, 0.005),
    ]
    const cps = readCheckpoints(dbPath, "projA", alias)
    const usage = reconcileProjectUsage("projA", liveDup as never, cps, alias)
    expect(usage.sessions).toBe(2)
    expect(usage.input).toBe(1200)
    expect(usage.cache).toBe(usage.cacheRead + usage.cacheWrite)
    checkpointActiveProject(dbPath, "projA", alias, [
      sess("s3", "projA", { input: 50, output: 10 }, 0.001),
    ])
    const cps2 = readCheckpoints(dbPath, "projA", alias)
    const usage2 = reconcileProjectUsage("projA", liveDup as never, cps2, alias)
    expect(usage2.sessions).toBe(3)
    expect(usage2.cache).toBe(usage2.cacheRead + usage2.cacheWrite)
  })

  test("reappearing session updates same row monotonically, never regresses", () => {
    const alias = "/proj/dir"
    const v1 = sess(
      "s1",
      "projA",
      { input: 1000, output: 500, reasoning: 200 },
      0.01,
    )
    checkpointActiveProject(dbPath, "projA", alias, [v1])
    const v2 = sess(
      "s1",
      "projA",
      {
        input: 2000,
        output: 700,
        reasoning: 300,
        cache: { read: 100, write: 50 },
      },
      0.02,
    )
    const changed = checkpointActiveProject(dbPath, "projA", alias, [v2])
    expect(changed).toBe(1)
    const cps = readCheckpoints(dbPath, "projA", alias)
    const row = cps.get("s1")!
    expect(row.input).toBe(2000)
    expect(row.cacheRead).toBe(100)
    expect(row.cache).toBe(row.cacheRead + row.cacheWrite)
    expect(row.context).toBe(
      row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite,
    )
    const vSmall = sess("s1", "projA", { input: 10, output: 10 }, 0)
    const changed2 = checkpointActiveProject(dbPath, "projA", alias, [vSmall])
    expect(changed2).toBe(0)
    const cps2 = readCheckpoints(dbPath, "projA", alias)
    expect(cps2.get("s1")!.input).toBe(2000)
  })

  test("project ID regenerated for same canonical worktree recovers/adopts; different worktree isolated", () => {
    const aliasA = "/proj/dir"
    const aliasB = "/other/dir"
    const s1 = sess("s1", "proj_old", { input: 1000, output: 500 }, 0.01)
    checkpointActiveProject(dbPath, "proj_old", aliasA, [s1])
    const recovered = readCheckpoints(dbPath, "proj_new", aliasA)
    expect(recovered.size).toBe(1)
    expect(recovered.get("s1")!.projectID).toBe("proj_old")
    const usageRecovered = reconcileProjectUsage(
      "proj_new",
      [],
      recovered,
      aliasA,
    )
    expect(usageRecovered.sessions).toBe(1)
    expect(usageRecovered.cache).toBe(
      usageRecovered.cacheRead + usageRecovered.cacheWrite,
    )
    const isolated = readCheckpoints(dbPath, "proj_new", aliasB)
    expect(isolated.size).toBe(0)
    const usageIsolated = reconcileProjectUsage(
      "proj_new",
      [],
      isolated,
      aliasB,
    )
    expect(usageIsolated.sessions).toBe(0)
  })

  test("cache invariant holds after every merge", () => {
    const alias = "/proj/dir"
    const s1 = sess(
      "s1",
      "projA",
      { input: 100, output: 50, cache: { read: 10, write: 20 } },
      0.01,
    )
    const s2 = sess(
      "s1",
      "projA",
      { input: 200, output: 70, cache: { read: 15, write: 5 } },
      0.02,
    )
    checkpointActiveProject(dbPath, "projA", alias, [s1])
    checkpointActiveProject(dbPath, "projA", alias, [s2])
    const cps = readCheckpoints(dbPath, "projA", alias)
    const row = cps.get("s1")!
    expect(row.cache).toBe(row.cacheRead + row.cacheWrite)
    expect(row.cacheRead).toBe(15)
    expect(row.cacheWrite).toBe(20)
    expect(row.context).toBe(
      row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite,
    )
    const usage = reconcileProjectUsage("projA", [s2] as never, cps, alias)
    expect(usage.cache).toBe(usage.cacheRead + usage.cacheWrite)
  })
})
