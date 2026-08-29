/**
 * Durable deletion and one-time migration.
 * Verifies deletion uses same row and migration is idempotent.
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
import { checkpointDeletedSession } from "../src/tokenmeter/durable/deleted"
import {
  MIGRATED_RESERVED_ID,
  migrateLegacyAggregates,
} from "../src/tokenmeter/durable/migrate"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"
import type { ProjectSessionLike } from "../src/tokenmeter/types"
import { dbPathFor, sess, tmpDurable } from "./durable-helpers"

describe("durable deletion and migration", () => {
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
    expect(cps.get("s1")!.input).toBe(1000)
    expect(cps.get("s1")!.cache).toBe(
      cps.get("s1")!.cacheRead + cps.get("s1")!.cacheWrite,
    )
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
    expect(cps2.get("s1")!.input).toBe(5000)
    expect(cps2.get("s1")!.cache).toBe(150)
    expect(cps2.get("s1")!.cache).toBe(
      cps2.get("s1")!.cacheRead + cps2.get("s1")!.cacheWrite,
    )
    const db = new Database(dbPath)
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).not.toContain("tombstones")
    expect(tables.map((t) => t.name)).toContain("checkpoints")
    db.close()
  })

  test("migration is idempotent and preserves existing all-time history contract", () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "legacy-"))
    const legacyPath = join(legacyDir, "tokenmeter.sqlite")
    const db = new Database(legacyPath)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec(
      `CREATE TABLE projects (project_id TEXT PRIMARY KEY, cost REAL, input INTEGER, output INTEGER, reasoning INTEGER, cache_read INTEGER, cache_write INTEGER, cache INTEGER, context INTEGER)`,
    )
    db.exec(
      `INSERT INTO projects VALUES ('projA', 0.05, 1000, 500, 200, 100, 50, 150, 1850)`,
    )
    db.close()
    const migrated1 = migrateLegacyAggregates(dbPath, legacyPath)
    expect(migrated1).toBe(1)
    const cps1 = readCheckpoints(dbPath, "projA", "")
    expect(cps1.get(MIGRATED_RESERVED_ID)?.input).toBe(1000)
    expect(cps1.get(MIGRATED_RESERVED_ID)?.cache).toBe(150)
    const migrated2 = migrateLegacyAggregates(dbPath, legacyPath)
    expect(migrated2).toBe(0)
    const cps2 = readCheckpoints(dbPath, "projA", "")
    expect(cps2.size).toBe(1)
    const usage = reconcileProjectUsage("projA", [], cps2, "")
    expect(usage.sessions).toBe(1)
    expect(usage.context).toBe(1850)
    expect(usage.cache).toBe(usage.cacheRead + usage.cacheWrite)
    rmSync(legacyDir, { recursive: true, force: true })
  })

  test("if legacy DB already deleted there is nothing to recover, honestly", () => {
    const missingLegacy = join(
      tmpdir(),
      `missing-${Date.now()}`,
      "tokenmeter.sqlite",
    )
    const migrated = migrateLegacyAggregates(dbPath, missingLegacy)
    expect(migrated).toBe(0)
    expect(readCheckpoints(dbPath, "projA", "").size).toBe(0)
  })
})
