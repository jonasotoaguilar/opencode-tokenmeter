import { describe, expect, test } from "bun:test"
import { PROJECT_POLL_DELAY } from "../src/tokenmeter/project"
import { MAINTENANCE_DELAY } from "../src/tokenmeter/reconcile"

describe("perf: 30s polling", () => {
  test("project polling is 30s", () => {
    expect(PROJECT_POLL_DELAY).toBe(30_000)
  })
  test("maintenance delay is 30s", () => {
    expect(MAINTENANCE_DELAY).toBe(30_000)
  })
})
