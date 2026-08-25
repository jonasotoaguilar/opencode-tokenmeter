import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as R from "../src/tokenmeter/repair"

describe("repair PR3", () => {
  test("all", () => {
    const a = new Map([
      ["a:b", { input: 1, output: 2, cache: { read: 3, write: 4 } }],
      ["c:d", { input: 5, output: 6, cache: { read: 7, write: 8 } }],
    ])
    expect(R.computePricingHash(a)).toBe(
      createHash("sha256").update("a:b:1:2:3:4|c:d:5:6:7:8").digest("hex"),
    )
    expect(
      R.computePricingHash(
        new Map([
          ["a:b", { input: 9, output: 2, cache: { read: 3, write: 4 } }],
          ["c:d", { input: 5, output: 6, cache: { read: 7, write: 8 } }],
        ]),
      ),
    ).not.toBe(R.computePricingHash(a))
    const p = new Map([
      ["openai:gpt-4o", { input: 5, output: 15, cache: { read: 1, write: 2 } }],
    ])
    const msgs = [
      {
        id: "m2",
        role: "assistant",
        cost: 2,
        providerID: "openai",
        modelID: "gpt-4o",
        tokens: { input: 10, output: 20 },
      },
      {
        id: "m1",
        role: "assistant",
        cost: 0,
        providerID: "openai",
        modelID: "gpt-4o",
        tokens: { input: 5, output: 10 },
      },
    ]
    const t = R.totalsFromMessages(msgs as never, p)
    expect(t.costReported).toBe(2)
    expect(t.costEstimated).toBeGreaterThan(0)
    expect(t.fingerprint).toHaveLength(64)
    expect(
      R.totalsFromMessages([...msgs].reverse() as never, p).fingerprint,
    ).toBe(t.fingerprint)
    expect(
      R.shouldScheduleRepair({ ok: false, reason: "conflict" } as never),
    ).toBe(true)
    expect(R.shouldScheduleRepair({ ok: false, reason: "busy" })).toBe(false)
    expect(R.isEmptyOrTruncated([], {} as never)).toBe(true)
    expect(
      R.selectPricingRepairCandidates(
        [
          { isDeleted: false, costEstimated: 0.5, pricingVersion: "hv1" },
          { isDeleted: true, costEstimated: 0.5, pricingVersion: "hv1" },
        ] as never[],
        "hv2",
      ).length,
    ).toBe(1)
    expect(R.PRICING_REPAIR_BATCH_SIZE).toBe(8)
    expect(R.PRICING_REPAIR_CONCURRENCY).toBe(1)
    expect(
      R.nextRepairBatch([1, 2, 3, 4, 5, 6, 7, 8, 9] as never, 0),
    ).toHaveLength(8)
    const q = R.createRepairQueue()
    const g0 = q.generation
    expect(q.enqueue("s1").wasNew).toBe(true)
    expect(q.generation).toBe(g0 + 1)
    expect(q.enqueue("s1").wasNew).toBe(false)
    expect(q.queued.has("*")).toBe(false)
    expect(readFileSync("src/tokenmeter/repair.ts", "utf8")).not.toContain(
      'from "./store"',
    )
  })
})
