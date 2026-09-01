import { describe, expect, test } from "bun:test"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"
import type { CheckpointRow } from "../src/tokenmeter/durable/types"

function row(id: string, projectID: string, overrides: Partial<CheckpointRow> = {}): CheckpointRow {
  const base: CheckpointRow = {
    sessionID: id,
    projectID,
    projectAlias: "/proj/dir",
    cost: 0.01,
    costSource: "reported",
    input: 100,
    output: 50,
    reasoning: 10,
    cacheRead: 5,
    cacheWrite: 5,
    cache: 10,
    context: 170,
    updatedAt: 1000,
    checkpointAt: 1000,
    version: 1,
  }
  return Object.assign(base, overrides)
}

describe("durable reconcile — pure union logic", () => {
  test("reconciles empty and single session", () => {
    const empty = reconcileProjectUsage("projA", [], new Map())
    expect(empty.sessions).toBe(0)
    expect(empty.cost).toBe(0)
    const sing = reconcileProjectUsage("projA", [{ id: "s1", projectID: "projA", tokens: { input: 10, output: 5 }, cost: 0.01 } as never], new Map())
    expect(sing.sessions).toBe(1)
    expect(sing.input).toBe(10)
  })

  test("duplicate live IDs count once and different project filtered", () => {
    const s1 = { id: "s1", projectID: "projA", tokens: { input: 100, output: 50 }, cost: 0.01 } as never
    const dup = reconcileProjectUsage("projA", [s1, Object.assign({}, s1), { id: "s1", projectID: "projA", tokens: { input: 200, output: 100 }, cost: 0.02 } as never], new Map())
    expect(dup.sessions).toBe(1)
    expect(dup.input).toBe(100)
    const otherProj = reconcileProjectUsage("projA", [{ id: "s2", projectID: "projB", tokens: { input: 100, output: 50 } } as never], new Map())
    expect(otherProj.sessions).toBe(0)
  })

  test("checkpoint-only and live+checkpoint merge monotonically", () => {
    const cp = new Map<string, CheckpointRow>([["s1", row("s1", "projA", { input: 1000, cost: 0.01 })]])
    const live = [{ id: "s1", projectID: "projA", tokens: { input: 2000, output: 700, reasoning: 100, cache: { read: 10, write: 20 } }, cost: 0.02 } as never]
    const merged = reconcileProjectUsage("projA", live, cp)
    expect(merged.sessions).toBe(1)
    expect(merged.input).toBe(2000)
    expect(merged.cacheRead).toBe(10)
    const onlyCp = reconcileProjectUsage("projA", [], cp)
    expect(onlyCp.sessions).toBe(1)
    expect(onlyCp.input).toBe(1000)
  })

  test("cost provenance reported wins and merges correctly", () => {
    const cpReported = new Map<string, CheckpointRow>([["s1", row("s1", "projA", { cost: 0.05, costSource: "reported" })]])
    const liveEstimated = [{ id: "s1", projectID: "projA", tokens: { input: 10, output: 5 }, cost: 0, model: { providerID: "openai", id: "gpt-4o" } } as never]
    const merged1 = reconcileProjectUsage("projA", liveEstimated, cpReported)
    expect(merged1.cost).toBe(0.05)
    const cpEstimated = new Map<string, CheckpointRow>([["s1", row("s1", "projA", { cost: 0.02, costSource: "estimated" })]])
    const liveReported = [{ id: "s1", projectID: "projA", tokens: { input: 10, output: 5 }, cost: 0.03 } as never]
    const merged2 = reconcileProjectUsage("projA", liveReported, cpEstimated)
    expect(merged2.cost).toBe(0.03)
  })

  test("empty usage rows are ignored", () => {
    const emptyRow = row("s1", "projA", { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cache: 0, context: 0 })
    const cp = new Map<string, CheckpointRow>([["s1", emptyRow]])
    const usage = reconcileProjectUsage("projA", [], cp)
    expect(usage.sessions).toBe(0)
    const liveEmpty = [{ id: "s2", projectID: "projA", tokens: {}, cost: 0 } as never]
    const usage2 = reconcileProjectUsage("projA", liveEmpty, new Map())
    expect(usage2.sessions).toBe(0)
  })
})
