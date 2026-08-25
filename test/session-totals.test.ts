import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  casReplace,
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
describe("session totals PR2B CAS", () => {
  const totalsA = {
    costReported: 1.23,
    costEstimated: 0.45,
    input: 10,
    output: 20,
    reasoning: 5,
    cacheRead: 2,
    cacheWrite: 3,
    cache: 5,
    context: 40,
    fingerprint: "fp-a",
    pricingVersion: "hv1",
    updatedAt: 100,
  }
  const totalsB = {
    costReported: 2.0,
    costEstimated: 1.0,
    input: 15,
    output: 25,
    reasoning: 6,
    cacheRead: 4,
    cacheWrite: 1,
    cache: 5,
    context: 51,
    fingerprint: "fp-b",
    pricingVersion: "hv1",
    updatedAt: 200,
  }
  test("casReplace inserts at expected 0 with revision 1", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const r = casReplace(p, "proj-a", "sess-1", 0, totalsA)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.row.revision).toBe(1)
        expect(r.row.costReported).toBe(1.23)
        expect(r.row.costEstimated).toBe(0.45)
        expect(r.row.fingerprint).toBe("fp-a")
        expect(r.row.projectId).toBe("proj-a")
        expect(r.row.sessionId).toBe("sess-1")
      }
      const read = readSessionTotals(p, "proj-a", "sess-1")
      expect(read && "revision" in read && read.revision).toBe(1)
    } finally {
      clean(d)
    }
  })
  test("casReplace match commits bump and duplicate unchanged", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      expect(casReplace(p, "proj-a", "sess-1", 0, totalsA).ok).toBe(true)
      const r2 = casReplace(p, "proj-a", "sess-1", 1, totalsB)
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.row.revision).toBe(2)
      const dup = casReplace(p, "proj-a", "sess-1", 2, totalsB)
      expect(dup.ok).toBe(true)
      if (dup.ok) {
        expect((dup as { unchanged?: true }).unchanged).toBe(true)
        expect(dup.row.revision).toBe(2)
      }
      const read = readSessionTotals(p, "proj-a", "sess-1") as unknown as {
        revision: number
      }
      expect(read.revision).toBe(2)
    } finally {
      clean(d)
    }
  })
  test("casReplace conflict returns stored and does not store deltas", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      expect(casReplace(p, "proj-a", "sess-1", 0, totalsA).ok).toBe(true)
      expect(casReplace(p, "proj-a", "sess-1", 1, totalsB).ok).toBe(true)
      const miss = casReplace(p, "proj-a", "sess-1", 1, totalsA)
      expect(miss.ok).toBe(false)
      if (!miss.ok && "reason" in miss) expect(miss.reason).toBe("conflict")
      if (!miss.ok && "stored" in miss)
        expect((miss as { stored: { revision: number } }).stored.revision).toBe(
          2,
        )
      const read = readSessionTotals(p, "proj-a", "sess-1") as unknown as {
        costReported: number
        revision: number
      }
      expect(read.costReported).toBe(2.0)
      expect(read.revision).toBe(2)
      const src = readFileSync("src/tokenmeter/session-totals.ts", "utf8")
      expect(src).not.toMatch(/SET\s+cost_reported\s*=\s*cost_reported\s*\+/)
      expect(src).not.toMatch(/cost\s*=\s*cost\s*\+/)
    } finally {
      clean(d)
    }
  })
  test("casReplace parallel loser repairs no deltas", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      expect(casReplace(p, "proj-a", "sess-1", 0, totalsA).ok).toBe(true)
      const w1 = casReplace(p, "proj-a", "sess-1", 1, totalsB)
      expect(w1.ok).toBe(true)
      const w2 = casReplace(p, "proj-a", "sess-1", 1, {
        ...totalsA,
        fingerprint: "fp-a2",
        updatedAt: 300,
      })
      expect(w2.ok).toBe(false)
      if (!w2.ok && "reason" in w2) expect(w2.reason).toBe("conflict")
      const read = readSessionTotals(p, "proj-a", "sess-1") as unknown as {
        costReported: number
        fingerprint: string
      }
      expect(read.costReported).toBe(2.0)
      expect(read.fingerprint).toBe("fp-b")
    } finally {
      clean(d)
    }
  })
})
