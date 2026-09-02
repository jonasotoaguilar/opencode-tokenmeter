import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PROJECT_DB_FILE,
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
  recordDeletedSession,
} from "../src/tokenmeter/legacy-db"

describe("legacy-db coverage at harness-2 slice", () => {
  test("projectDbPath null and join", () => {
    expect(projectDbPath(undefined)).toBeNull()
    expect(projectDbPath("")).toBeNull()
    const p = projectDbPath("/tmp/state")
    expect(p).toBe(join("/tmp/state", PROJECT_DB_FILE))
  })

  test("withDb fail-contained on null and broken path", () => {
    expect(readDeletedAggregate(null, "projA")).toBeNull()
    expect(
      readDeletedAggregate("/no/such/dir/tokenmeter.sqlite", "projA"),
    ).toBeNull()
    expect(readDeletedSessionIDs(null, "")).toEqual(new Set())
    expect(readDeletedSessionIDs("/no/such/dir/tokenmeter.sqlite", "")).toEqual(
      new Set(),
    )
  })

  test("recordDeletedSession guards and exactly-once aggregate", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-cov-"))
    const dbPath = join(dir, PROJECT_DB_FILE)
    try {
      // guards: missing id/project, empty usage
      recordDeletedSession(null, { id: "s1", projectID: "projA" } as never)
      recordDeletedSession(dbPath, { id: "", projectID: "projA" } as never)
      recordDeletedSession(dbPath, { id: "s1", projectID: "" } as never)
      recordDeletedSession(dbPath, {
        id: "s1",
        projectID: "projA",
        tokens: {},
      } as never)
      expect(readDeletedAggregate(dbPath, "projA")).toBeNull()
      expect(readDeletedSessionIDs(dbPath, "projA").size).toBe(0)

      // valid session with tokens
      const sess = {
        id: "s1",
        projectID: "projA",
        tokens: {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: { read: 5, write: 2 },
        },
        cost: 0.01,
        model: { providerID: "openai", id: "gpt-4o" },
      } as never
      recordDeletedSession(dbPath, sess)
      const agg1 = readDeletedAggregate(dbPath, "projA")
      expect(agg1?.input).toBe(100)
      expect(agg1?.output).toBe(50)
      expect(readDeletedSessionIDs(dbPath, "projA").has("s1")).toBe(true)

      // duplicate is idempotent
      recordDeletedSession(dbPath, sess)
      const agg2 = readDeletedAggregate(dbPath, "projA")
      expect(agg2?.input).toBe(100)
      expect(readDeletedSessionIDs(dbPath, "projA").size).toBe(1)

      // observed high-water via second arg
      const sess2 = {
        id: "s2",
        projectID: "projA",
        tokens: { input: 10, output: 10 },
        cost: 0,
      } as never
      const observed = {
        input: 200,
        output: 100,
        reasoning: 20,
        cacheRead: 10,
        cacheWrite: 5,
        cache: 15,
        context: 335,
        cost: 0.02,
      } as never
      recordDeletedSession(dbPath, sess2, observed)
      const agg3 = readDeletedAggregate(dbPath, "projA")
      // agg is sum of s1 + s2
      expect(agg3?.input).toBe(300)
      expect(readDeletedSessionIDs(dbPath, "projA").size).toBe(2)
      expect(readDeletedSessionIDs(dbPath, "projB").size).toBe(0)
      expect(readDeletedAggregate(dbPath, "projB")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("readDeletedSessionIDs and aggregate isolated by project", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-cov2-"))
    const dbPath = join(dir, PROJECT_DB_FILE)
    try {
      const sA = {
        id: "s1",
        projectID: "projA",
        tokens: { input: 50, output: 50 },
        cost: 0.01,
      } as never
      const sB = {
        id: "s1",
        projectID: "projB",
        tokens: { input: 70, output: 70 },
        cost: 0.02,
      } as never
      recordDeletedSession(dbPath, sA)
      recordDeletedSession(dbPath, sB)
      expect(readDeletedSessionIDs(dbPath, "projA").has("s1")).toBe(true)
      expect(readDeletedSessionIDs(dbPath, "projB").has("s1")).toBe(true)
      expect(readDeletedAggregate(dbPath, "projA")?.input).toBe(50)
      expect(readDeletedAggregate(dbPath, "projB")?.input).toBe(70)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
