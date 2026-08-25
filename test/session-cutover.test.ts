import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  casReplace,
  markDeleted,
  migrateSessionTotals,
  readTree,
  sumProject,
} from "../src/tokenmeter/session-totals"

function tmp() {
  const d = mkdtempSync(join(tmpdir(), "cut-"))
  return { d, p: join(d, "tokenmeter.sqlite") }
}
function clean(d: string) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {}
}
describe("cutover", () => {
  test("SUM includes deleted and peer", () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const a = {
        costReported: 1,
        costEstimated: 0.5,
        input: 10,
        output: 20,
        reasoning: 5,
        cacheRead: 2,
        cacheWrite: 3,
        cache: 5,
        context: 40,
        fingerprint: "fa",
        pricingVersion: "hv1",
        updatedAt: 1,
      }
      const b = {
        costReported: 2,
        costEstimated: 1,
        input: 15,
        output: 25,
        reasoning: 6,
        cacheRead: 4,
        cacheWrite: 1,
        cache: 5,
        context: 51,
        fingerprint: "fb",
        pricingVersion: "hv1",
        updatedAt: 2,
      }
      expect(casReplace(p, "proj-a", "s1", 0, a).ok).toBe(true)
      expect(casReplace(p, "proj-a", "s2", 0, b).ok).toBe(true)
      expect(
        casReplace(p, "proj-b", "s9", 0, {
          ...a,
          costReported: 99,
          fingerprint: "fx",
        }).ok,
      ).toBe(true)
      expect(markDeleted(p, "proj-a", "s2", 500).ok).toBe(true)
      const sum = sumProject(p, "proj-a") as unknown as {
        costReported: number
        sessions: number
        cost: number
      }
      expect(sum.costReported).toBe(3)
      expect(sum.sessions).toBe(2)
      expect(sum.cost).toBe(4.5)
      // Tree read filters to tree IDs only
      const tree = readTree(p, "proj-a", ["s1"]) as unknown as Array<{
        sessionId: string
      }>
      expect(tree).toHaveLength(1)
      expect(tree[0]!.sessionId).toBe("s1")
    } finally {
      clean(d)
    }
  })
  test("clean-break — no legacy dual-read, no tombstones, no list poll", () => {
    const db = readFileSync("src/tokenmeter/db.ts", "utf8")
    const proj = readFileSync("src/tokenmeter/project.ts", "utf8")
    const tok = readFileSync("src/tokenmeter.tsx", "utf8")
    const rec = readFileSync("src/tokenmeter/reconcile.ts", "utf8")
    const all = db + proj + tok + rec
    expect(all).not.toContain("tombstones")
    expect(all).not.toContain("PROJECT_SESSION_LIMIT")
    expect(all).not.toContain("session.list")
    expect(all).not.toContain("recordDeletedSession")
    expect(all).not.toContain("readDeleted")
    expect(all).not.toContain("history.v4")
    expect(all).not.toContain("invalidateAllUsage")
    expect(all).not.toContain("client.model.list")
    // New path is present
    expect(proj).toContain("sumProject")
    expect(rec).toContain("readTree")
    expect(tok).toContain("migrateSessionTotals")
    expect(tok).toContain("markDeleted")
    // No placeholder pricing hash
    expect(tok).not.toContain("computePricingHash(new Map")
    expect(rec).not.toContain("computePricingHash(new Map")
    expect(proj).not.toContain("legacy-db")
    expect(db).not.toContain("legacy")
  })
  test("runtime SUM — project refresh publishes SQLite totals with no session.list", async () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const t = {
        costReported: 1.5,
        costEstimated: 0.5,
        input: 100,
        output: 50,
        reasoning: 10,
        cacheRead: 5,
        cacheWrite: 5,
        cache: 10,
        context: 170,
        fingerprint: "fp1",
        pricingVersion: "hv1",
        updatedAt: 1,
      }
      expect(casReplace(p, "proj-a", "s1", 0, t).ok).toBe(true)
      const mod = await import("../src/tokenmeter/project")
      const api: unknown = {
        state: { path: { directory: "/proj/dir", state: d } },
        client: {
          project: { current: async () => ({ data: { id: "proj-a" } }) },
        },
      }
      await (
        mod as { refreshProject: (a: unknown) => Promise<void> }
      ).refreshProject(api as never)
      expect(
        (
          mod as { projectSnapshot: () => { cost: number } | null }
        ).projectSnapshot()?.cost,
      ).toBe(2)
      ;(mod as { setProjectSnapshot: (v: null) => void }).setProjectSnapshot(
        null,
      )
    } finally {
      clean(d)
    }
  })
  test("cached tree publish before host RPC — readTree sums only tree IDs", async () => {
    const { d, p } = tmp()
    try {
      expect(migrateSessionTotals(p).ok).toBe(true)
      const mk = (id: string, cost: number) => ({
        costReported: cost,
        costEstimated: 0,
        input: 10,
        output: 5,
        reasoning: 1,
        cacheRead: 0,
        cacheWrite: 0,
        cache: 0,
        context: 16,
        fingerprint: `fp-${id}`,
        pricingVersion: "hv1",
        updatedAt: Date.now(),
      })
      expect(casReplace(p, "proj-a", "root", 0, mk("root", 1)).ok).toBe(true)
      expect(casReplace(p, "proj-a", "child", 0, mk("child", 2)).ok).toBe(true)
      expect(casReplace(p, "proj-a", "other", 0, mk("other", 99)).ok).toBe(true)
      const rows = readTree(p, "proj-a", [
        "root",
        "child",
      ]) as unknown as Array<{ costReported: number }>
      const cost = rows.reduce((s, r) => s + r.costReported, 0)
      expect(cost).toBe(3)
      expect(rows).toHaveLength(2)
      // other project/session not in tree is excluded
      const other = readTree(p, "proj-a", [
        "other",
      ]) as unknown as Array<unknown>
      expect(other).toHaveLength(1)
      // empty tree returns empty without SQL error
      const empty = readTree(p, "proj-a", []) as unknown as Array<unknown>
      expect(empty).toHaveLength(0)
    } finally {
      clean(d)
    }
  })
})
