import { describe, expect, test } from "bun:test"
import {
  entryFromSession,
  hasUsageRow,
  mergeCost,
  mergeRows,
  observedToEntry,
  rowsEqual,
} from "../src/tokenmeter/durable/merge"
import type { CheckpointRow } from "../src/tokenmeter/durable/types"
import type { ProjectSessionLike, SessionUsage } from "../src/tokenmeter/types"

const row = (o: Partial<CheckpointRow> = {}): CheckpointRow => ({
  sessionID: "s1",
  projectID: "p1",
  projectAlias: "/proj",
  cost: 1,
  costSource: "reported",
  input: 10,
  output: 20,
  reasoning: 5,
  cacheRead: 3,
  cacheWrite: 7,
  cache: 10,
  context: 45,
  updatedAt: 100,
  checkpointAt: 200,
  version: 1,
  ...o,
})
describe("durable merge — hasUsageRow", () => {
  test("zero vs positive", () => {
    expect(
      hasUsageRow(
        row({
          cost: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cache: 0,
          context: 0,
        }),
      ),
    ).toBe(false)
    expect(
      hasUsageRow(
        row({
          cost: 0.01,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cache: 0,
          context: 0,
        }),
      ),
    ).toBe(true)
    expect(
      hasUsageRow(
        row({
          cost: 0,
          input: 1,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cache: 0,
          context: 1,
        }),
      ),
    ).toBe(true)
  })
})
describe("durable merge — entryFromSession", () => {
  test("maps tokens and rejects empty", () => {
    const r = entryFromSession(
      {
        id: "s1",
        projectID: "p1",
        cost: 0.5,
        tokens: {
          input: 100,
          output: 50,
          reasoning: 10,
          cache: { read: 20, write: 5 },
        },
      } as ProjectSessionLike,
      "/proj",
    )
    expect(r).not.toBeNull()
    expect(r?.input).toBe(100)
    expect(r?.output).toBe(50)
    expect(r?.cache).toBe(25)
    expect(r?.context).toBe(185)
    expect(r?.cost).toBe(0.5)
    expect(
      entryFromSession(
        {
          id: "s2",
          projectID: "p1",
          cost: 0,
          tokens: {},
        } as ProjectSessionLike,
        "/proj",
      ),
    ).toBeNull()
  })
  test("updatedAt and non-finite", () => {
    expect(
      entryFromSession(
        {
          id: "s1",
          projectID: "p1",
          cost: 1,
          tokens: { input: 1 },
          time: { updated: 999, created: 111 },
        } as unknown as ProjectSessionLike,
        "/a",
      )?.updatedAt,
    ).toBe(999)
    expect(
      entryFromSession(
        {
          id: "s1",
          projectID: "p1",
          cost: 1,
          tokens: { input: 1 },
          time: { created: 555 },
        } as unknown as ProjectSessionLike,
        "/a",
      )?.updatedAt,
    ).toBe(555)
    expect(
      entryFromSession(
        {
          id: "s1",
          projectID: "p1",
          cost: Number.NaN,
          tokens: { input: Number.POSITIVE_INFINITY },
        } as unknown as ProjectSessionLike,
        "/a",
      ),
    ).toBeNull()
  })
})
describe("durable merge — observedToEntry", () => {
  test("maps observed", () => {
    const r = observedToEntry(
      {
        cost: 1.5,
        input: 10,
        output: 20,
        reasoning: 2,
        cacheRead: 3,
        cacheWrite: 4,
        cache: 7,
        total: 39,
      } as SessionUsage,
      "s9",
      "p9",
      "/alias",
    )
    expect(r).not.toBeNull()
    expect(r?.sessionID).toBe("s9")
    expect(r?.cost).toBe(1.5)
    expect(r?.context).toBe(39)
    expect(
      observedToEntry(
        {
          cost: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cache: 0,
          total: 0,
        } as SessionUsage,
        "s1",
        "p1",
        "/a",
      ),
    ).toBeNull()
  })
})
describe("durable merge — mergeCost", () => {
  test("reported wins, max otherwise", () => {
    const rep = (c: number) => ({ cost: c, costSource: "reported" as const })
    const est = (c: number) => ({ cost: c, costSource: "estimated" as const })
    expect(mergeCost(rep(5), est(10)).cost).toBe(5)
    expect(mergeCost(est(10), rep(5)).cost).toBe(5)
    expect(mergeCost(rep(3), rep(7)).cost).toBe(7)
    expect(mergeCost(est(4), est(9)).cost).toBe(9)
    expect(
      mergeCost({ cost: 0, costSource: "reported" as const }, est(2)).cost,
    ).toBe(2)
  })
})
describe("durable merge — mergeRows", () => {
  test("high-water and alias", () => {
    const m = mergeRows(
      row({
        input: 10,
        output: 5,
        reasoning: 1,
        cacheRead: 2,
        cacheWrite: 8,
        cost: 1,
        costSource: "estimated",
        updatedAt: 100,
        checkpointAt: 200,
        projectAlias: "/a",
      }),
      row({
        input: 7,
        output: 20,
        reasoning: 9,
        cacheRead: 10,
        cacheWrite: 3,
        cost: 5,
        costSource: "reported",
        updatedAt: 300,
        checkpointAt: 150,
        projectAlias: "/b",
      }),
    )
    expect(m.input).toBe(10)
    expect(m.output).toBe(20)
    expect(m.cache).toBe(18)
    expect(m.context).toBe(57)
    expect(m.cost).toBe(5)
    expect(m.updatedAt).toBe(300)
    expect(m.projectAlias).toBe("/b")
  })
  test("alias fallback", () => {
    expect(
      mergeRows(row({ projectAlias: "/a" }), row({ projectAlias: "" }))
        .projectAlias,
    ).toBe("/a")
  })
})
describe("durable merge — rowsEqual", () => {
  test("equality ignores ids", () => {
    const a = row({ cost: 1, projectAlias: "/a", updatedAt: 10 })
    expect(
      rowsEqual(
        a,
        row({
          cost: 1,
          projectAlias: "/a",
          updatedAt: 10,
          sessionID: "s2",
          checkpointAt: 999,
          version: 99,
        }),
      ),
    ).toBe(true)
    expect(rowsEqual(a, row({ cost: 2 }))).toBe(false)
    expect(rowsEqual(a, row({ projectAlias: "/other" }))).toBe(false)
  })
})
