import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import * as E from "../src/tokenmeter/session-events"

describe("session-events PR3", () => {
  test("all", () => {
    expect(
      E.getTargetSessionId({
        type: "message.updated",
        properties: { info: { id: "m1", sessionID: "sess-a" } },
      }),
    ).toBe("sess-a")
    expect(
      E.getTargetSessionId({
        type: "message.removed",
        properties: { sessionID: "sess-b" },
      }),
    ).toBe("sess-b")
    expect(
      E.isRemovalEvent({
        type: "message.removed",
        properties: { sessionID: "sess-b" },
      }),
    ).toBe(true)
    expect(
      E.getTargetSessionId({
        type: "session.compacted",
        properties: { sessionID: "sess-c" },
      }),
    ).toBe("sess-c")
    expect(
      E.getTargetSessionId({
        type: "unknown.event",
        properties: { sessionID: "sess-f" },
      }),
    ).toBe("sess-f")
    expect(
      E.getTargetSessionId({
        type: "message.updated",
        properties: { info: { id: "m1" } },
      }),
    ).toBeNull()
    expect(
      readFileSync("src/tokenmeter/session-events.ts", "utf8"),
    ).not.toContain('from "./store"')
  })
})
