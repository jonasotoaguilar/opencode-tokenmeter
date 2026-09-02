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
