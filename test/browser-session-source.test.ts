import { describe, expect, test } from "bun:test"
import { isSafeDirectory } from "../src/tokenmeter/browser/is-safe-directory"
import {
  curSID,
  fetchInfo,
  toInfo,
} from "../src/tokenmeter/browser/session-info"
import {
  fetchMsgs,
  modelOf,
  provOf,
  shortLabel,
} from "../src/tokenmeter/browser/session-messages"
import {
  fetchSessionsForBrowse,
  fetchSessionsForProject,
} from "../src/tokenmeter/browser/session-source"

describe("browser session-source", () => {
  test("fetchSessionsForBrowse returns null (error, not empty) when v2 unavailable", async () => {
    const api = { state: { path: { directory: "/tmp" } }, client: {} } as never
    expect(await fetchSessionsForBrowse(api, "proj1")).toBeNull()
  })
  test("fetchSessionsForBrowse returns successful [] (legitimate cache wipe) when v2 returns empty", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: { v2: { session: { list: async () => ({ data: [] }) } } },
    } as never
    expect(await fetchSessionsForBrowse(api, "proj1")).toEqual([])
  })
  test("fetchSessionsForBrowse returns null on transport error, malformed, or truncated", async () => {
    const errApi = {
      state: { path: { directory: "/tmp" } },
      client: {
        v2: {
          session: {
            list: async () => {
              throw new Error("offline")
            },
          },
        },
      },
    } as never
    expect(await fetchSessionsForBrowse(errApi, "proj1")).toBeNull()
    const malformedApi = {
      state: { path: { directory: "/tmp" } },
      client: {
        v2: { session: { list: async () => ({ data: "not-array" }) } },
      },
    } as never
    expect(await fetchSessionsForBrowse(malformedApi, "proj1")).toBeNull()
  })
  test("fetchSessionsForBrowse filters by projectID and paginates", async () => {
    let calls = 0
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        v2: {
          session: {
            list: async (p: Record<string, unknown>) => {
              calls++
              if (calls === 1)
                return {
                  data: [
                    { id: "s1", projectID: "proj1" },
                    { id: "s2", projectID: "other" },
                  ],
                  cursor: { next: "c2" },
                }
              return { data: [{ id: "s3", projectID: "proj1" }] }
            },
          },
        },
      },
    } as never
    expect(
      (await fetchSessionsForBrowse(api, "proj1"))!.map((s) => s.id),
    ).toEqual(["s1", "s3"])
  })
  test("fetchSessionsForProject delegates", async () => {
    const api = {
      state: { path: { directory: "/tmp" } },
      client: {
        v2: {
          session: {
            list: async () => ({ data: [{ id: "a", projectID: "p1" }] }),
          },
        },
      },
    } as never
    expect(await fetchSessionsForProject(api, "p1")).toEqual([
      { id: "a", projectID: "p1" },
    ])
  })
  test("isSafeDirectory", () => {
    expect(isSafeDirectory("/tmp")).toBe(true)
    expect(isSafeDirectory("/")).toBe(false)
  })
})
describe("browser session-info", () => {
  test("curSID extracts", () => {
    expect(
      curSID({ route: { current: { params: { sessionID: "s1" } } } } as never),
    ).toBe("s1")
    expect(
      curSID({ route: { current: { params: { session_id: "s2" } } } } as never),
    ).toBe("s2")
    expect(curSID({ currentSessionID: "s3" } as never)).toBe("s3")
    expect(curSID({} as never)).toBeNull()
    const api = {} as never
    Object.defineProperty(api, "route", {
      get() {
        throw new Error("boom")
      },
    })
    expect(curSID(api)).toBeNull()
  })
  test("toInfo maps", () => {
    expect(toInfo(undefined, "s1")).toBeNull()
    expect(toInfo({ id: "other" } as never, "s1")).toBeNull()
    const s = {
      id: "s1",
      projectID: "p1",
      title: "hi",
      time: { created: 1, updated: 2 },
      tokens: {},
      cost: 0,
      model: {},
    } as never
    expect(toInfo(s, "s1")?.projectID).toBe("p1")
    expect(toInfo({ id: "s1", time: {} } as never, "s1")?.time.created).toBe(0)
    expect(toInfo({ id: "s1", title: "  " } as never, "s1")?.title).toBe("  ")
  })
  test("fetchInfo prefers state then client then list", async () => {
    const payload = {
      id: "sA",
      projectID: "p1",
      time: { created: 1, updated: 2 },
    }
    expect(
      await fetchInfo(
        {
          state: {
            session: { get: (id: string) => (id === "sA" ? payload : null) },
          },
        } as never,
        "sA",
      ),
    ).not.toBeNull()
    expect(
      await fetchInfo(
        {
          state: { session: { get: () => ({ id: "other" }) } },
          client: { session: { get: async () => ({ data: payload }) } },
        } as never,
        "sA",
      ),
    ).not.toBeNull()
    expect(
      await fetchInfo(
        {
          client: { session: { get: async () => ({ data: payload }) } },
        } as never,
        "sA",
      ),
    ).not.toBeNull()
    expect(
      await fetchInfo(
        {
          client: { session: { list: async () => ({ data: [payload] }) } },
        } as never,
        "sA",
      ),
    ).not.toBeNull()
    expect(
      await fetchInfo(
        { client: { session: { list: async () => ({ data: [] }) } } } as never,
        "miss",
      ),
    ).toBeNull()
    expect(await fetchInfo({} as never, "s1")).toBeNull()
  })
})
describe("browser session-messages", () => {
  test("shortLabel and prov/model", () => {
    expect(shortLabel("openai/gpt-4o")).toBe("gpt-4o")
    expect(shortLabel("a/b:c")).toBe("c")
    expect(shortLabel("a/b/")).toBe("a/b/")
    expect(provOf({ providerID: "openai" })).toBe("openai")
    expect(provOf({ model: { providerID: "anthropic" } })).toBe("anthropic")
    expect(provOf({})).toBe("unknown")
    expect(modelOf({ modelID: "x" })).toBe("x")
    expect(modelOf({})).toBe("unknown")
  })
  test("fetchMsgs prefers client then state", async () => {
    const m = { id: "m1", info: { id: "m1", role: "assistant" } }
    expect(
      await fetchMsgs(
        {
          client: { session: { messages: async () => ({ data: [m] }) } },
        } as never,
        "s1",
      ),
    ).toEqual([{ id: "m1", role: "assistant" }])
    expect(
      await fetchMsgs(
        {
          client: {
            session: { messages: async () => [{ info: { id: "m2" } }] },
          },
        } as never,
        "s1",
      ),
    ).toEqual([{ info: { id: "m2" } }])
    expect(
      await fetchMsgs(
        {
          state: { session: { messages: () => [{ info: { id: "m3" } }] } },
        } as never,
        "s1",
      ),
    ).toEqual([{ id: "m3" }])
    expect(await fetchMsgs({} as never, "s1")).toEqual([])
    expect(
      await fetchMsgs(
        {
          client: {
            session: {
              messages: async () => {
                throw new Error("boom")
              },
            },
          },
          state: {
            session: {
              messages: () => {
                throw new Error("boom")
              },
            },
          },
        } as never,
        "s1",
      ),
    ).toEqual([])
  })
})
