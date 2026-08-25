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
      E.getTargetSessionId({
        type: "message.updated",
        properties: { part: { sessionID: "sess-part" } },
      }),
    ).toBe("sess-part")
    expect(
      E.getTargetSessionId({
        type: "session.deleted",
        properties: { info: { id: "sess-del" } },
      }),
    ).toBe("sess-del")
    expect(
      E.getTargetSessionId({
        type: "session.created",
        properties: { info: { id: "sess-gen" } },
      }),
    ).toBe("sess-gen")
    expect(E.isSingleSessionEvent(null)).toBe(false)
    expect(E.isCompactionEvent({ type: "session.compacted" })).toBe(true)
    expect(
      readFileSync("src/tokenmeter/session-events.ts", "utf8"),
    ).not.toContain('from "./store"')
  })
})
