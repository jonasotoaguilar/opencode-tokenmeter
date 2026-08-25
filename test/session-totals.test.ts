import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  computeFingerprint,
  migrateSessionTotals,
  readSessionTotals,
} from "../src/tokenmeter/session-totals"

function tmp() {
  const d = mkdtempSync(join(tmpdir(), "st-"))
  return { d, p: join(d, "tokenmeter.sqlite") }
}
function clean(d: string) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {}
}
describe("session totals PR2A", () => {
  test("fresh creates final schema", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db = new Database(p)
      expect(
        (db.query("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      ).toBe(1)
      expect(
        (
          db.query("PRAGMA journal_mode").get() as { journal_mode: string }
        ).journal_mode.toLowerCase(),
      ).toBe("wal")
      const t = (
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string
        }[]
      ).map((x) => x.name)
      expect(t).toContain("session_totals")
      const sql = (
        db
          .query("SELECT sql FROM sqlite_master WHERE name='session_totals'")
          .get() as { sql: string }
      ).sql
      for (const c of [
        "project_id TEXT NOT NULL",
        "session_id TEXT NOT NULL",
        "cost_reported REAL NOT NULL",
        "cost_estimated REAL NOT NULL",
        "input INTEGER NOT NULL",
        "revision INTEGER NOT NULL",
        "fingerprint TEXT NOT NULL",
        "pricing_version TEXT NOT NULL",
        "is_deleted INTEGER NOT NULL",
        "PRIMARY KEY (project_id, session_id)",
      ])
        expect(sql).toContain(c)
      const idx =
        (
          db
            .query(
              "SELECT sql FROM sqlite_master WHERE name='idx_session_totals_stale'",
            )
            .get() as { sql: string } | null
        )?.sql ?? ""
      expect(idx).toContain("WHERE is_deleted = 0")
      expect(idx).toContain("cost_estimated > 0")
      db.close()
    } finally {
      clean(d)
    }
  })
  test("legacy drops projects and tombstones", () => {
    const { d, p } = tmp()
    try {
      const l = new Database(p)
      l.exec("PRAGMA journal_mode = WAL")
      l.exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, cost REAL)")
      l.exec(
        "CREATE TABLE tombstones (session_id TEXT, project_id TEXT, PRIMARY KEY(session_id, project_id))",
      )
      l.exec("INSERT INTO projects VALUES ('x',1)")
      l.exec("INSERT INTO tombstones VALUES ('s','x')")
      l.exec("PRAGMA user_version = 0")
      l.close()
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db = new Database(p)
      const n = (
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string
        }[]
      ).map((x) => x.name)
      expect(n).toContain("session_totals")
      expect(n).not.toContain("projects")
      let threw = false
      try {
        db.query("SELECT * FROM projects").get()
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
      db.close()
    } finally {
      clean(d)
    }
  })
  test("idempotent reopen preserves data", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db1 = new Database(p)
      db1.exec(
        "INSERT INTO session_totals (project_id, session_id, cost_reported, revision, fingerprint, pricing_version, is_deleted, updated_at) VALUES ('p1','s1',1.5,1,'fp','hv1',0,1)",
      )
      db1.close()
      expect(migrateSessionTotals(p).ok).toBe(true)
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db2 = new Database(p)
      const r = db2
        .query(
          "SELECT cost_reported, revision FROM session_totals WHERE project_id='p1'",
        )
        .get() as { cost_reported: number; revision: number }
      expect(r.cost_reported).toBe(1.5)
      expect(r.revision).toBe(1)
      db2.close()
    } finally {
      clean(d)
    }
  })
  test("one row per project session", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db = new Database(p)
      db.exec(
        "INSERT INTO session_totals (project_id, session_id, cost_reported, cost_estimated, input, revision, fingerprint, pricing_version, is_deleted, updated_at) VALUES ('proj-a','sess-1',1.23,0.45,10,1,'fp1','h1',0,1)",
      )
      db.exec(
        "INSERT INTO session_totals (project_id, session_id, cost_reported, cost_estimated, input, revision, fingerprint, pricing_version, is_deleted, updated_at) VALUES ('proj-a','sess-2',2.0,1.0,5,1,'fp2','h1',0,2)",
      )
      expect(
        (
          db
            .query("SELECT * FROM session_totals WHERE project_id='proj-a'")
            .all() as unknown[]
        ).length,
      ).toBe(2)
      db.close()
      const read = readSessionTotals(p, "proj-a", "sess-1")
      expect(read && typeof read === "object" && "projectId" in read).toBe(true)
      if (read && typeof read === "object" && "projectId" in read) {
        expect(read.projectId).toBe("proj-a")
        expect(read.costReported).toBe(1.23)
        expect(read.fingerprint).toBe("fp1")
      }
    } finally {
      clean(d)
    }
  })
  test("two connections migrate without corruption", () => {
    const { d, p } = tmp()
    try {
      const l = new Database(p)
      l.exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, cost REAL)")
      l.exec(
        "CREATE TABLE tombstones (session_id TEXT, project_id TEXT, PRIMARY KEY(session_id, project_id))",
      )
      l.exec("PRAGMA user_version = 0")
      l.close()
      expect(migrateSessionTotals(p).ok).toBe(true)
      expect(migrateSessionTotals(p).ok).toBe(true)
      const db = new Database(p)
      const n = (
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string
        }[]
      ).map((x) => x.name)
      expect(n).toContain("session_totals")
      expect(n).not.toContain("projects")
      db.close()
    } finally {
      clean(d)
    }
  })
  test("fingerprint deterministic", () => {
    const e = [
      {
        id: "msg-2",
        cost: 0.5,
        input: 10,
        output: 20,
        reasoning: 5,
        cacheRead: 1,
        cacheWrite: 2,
      },
      {
        id: "msg-1",
        cost: 1.0,
        input: 5,
        output: 10,
        reasoning: 2,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ]
    const fp = computeFingerprint(e)
    expect(computeFingerprint([...e].reverse())).toBe(fp)
    expect(fp).toHaveLength(64)
    expect(fp).toBe(
      createHash("sha256")
        .update("msg-1:1:5:10:2:0:0|msg-2:0.5:10:20:5:1:2")
        .digest("hex"),
    )
    expect(
      computeFingerprint([
        {
          id: "msg-1",
          cost: 1.0,
          input: 5,
          output: 11,
          reasoning: 2,
          cacheRead: 0,
          cacheWrite: 0,
        },
        {
          id: "msg-2",
          cost: 0.5,
          input: 10,
          output: 20,
          reasoning: 5,
          cacheRead: 1,
          cacheWrite: 2,
        },
      ]),
    ).not.toBe(fp)
  })
  test("uninvoked and no additive SQL", () => {
    expect(readFileSync("src/tokenmeter/db.ts", "utf8")).not.toContain(
      "session_totals",
    )
    expect(readFileSync("src/tokenmeter.tsx", "utf8")).not.toContain(
      "session-totals",
    )
    const src = readFileSync("src/tokenmeter/session-totals.ts", "utf8")
    expect(src).not.toContain("message_id")
    expect(src).not.toMatch(/cost\s*=\s*cost\s*\+/)
    expect(src).toContain("BEGIN IMMEDIATE")
    expect(src).toContain("PRAGMA user_version")
    expect(src).toContain("PRAGMA busy_timeout = 5000")
  })
})
