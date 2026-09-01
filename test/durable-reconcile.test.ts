import { describe, expect, test } from "bun:test"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"

describe("durable reconcile — pure union logic", () => {
  test("reconciles empty and single session", () => {
    const empty = reconcileProjectUsage("projA", [], new Map())
    expect(empty.sessions).toBe(0)
    expect(empty.cost).toBe(0)
    const sing = reconcileProjectUsage("projA", [{ id: "s1", projectID: "projA", tokens: { input: 10, output: 5 }, cost: 0.01 } as never], new Map())
    expect(sing.sessions).toBe(1)
    expect(sing.input).toBe(10)
  })
})
