// biome-ignore-all lint/style/noNonNullAssertion: test harness - non-null after guard
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadProjectDetail } from "../src/tokenmeter/browser/project-detail"
import { discoverTree } from "../src/tokenmeter/browser/session-tree"
import type { BrowserApi } from "../src/tokenmeter/browser/types"

function mkS(
  id: string,
  pid: string,
  cost: number,
  i: number,
  o: number,
  r: number,
  cr: number,
  cw: number,
  c: number,
  u: number,
  t?: string,
  parentID?: string,
) {
  const s: Record<string, unknown> = {
    id,
    projectID: pid,
    cost,
    tokens: {
      input: i,
      output: o,
      reasoning: r,
      cache: { read: cr, write: cw },
    },
    time: { created: c, updated: u },
    title: t,
  }
  if (parentID !== undefined) s.parentID = parentID
  return s as never
}
function mkP(
  id: string,
  name: string | undefined,
  wt: string | undefined,
  c: number,
  u: number,
) {
  return { id, name, worktree: wt, time: { created: c, updated: u } } as never
}
function harness(
  o: Partial<{
    projects: unknown[]
    sessions: unknown[]
    currentSessionID: string
  }>,
) {
  const dir = mkdtempSync(join(tmpdir(), "tm-pd-"))
  const host = mkdtempSync(join(tmpdir(), "tm-host-"))
  const projects = o.projects ?? [
    mkP("projA", "alpha", host, 1700000000000, 1700000000000),
  ]
  const sessions = o.sessions ?? []
  const api = {
    state: { path: { directory: host, state: dir } },
    route: o.currentSessionID
      ? { current: { params: { sessionID: o.currentSessionID } } }
      : undefined,
    currentSessionID: o.currentSessionID,
    client: {
      project: {
        list: async () => ({ data: projects }),
        current: async () => ({
          data: { id: (projects[0] as { id: string }).id },
        }),
        directories: async () => ({ data: [host] }),
      },
      session: {
        list: async (p: Record<string, unknown>) => {
          const d = p.directory as string
          if (d === host) return { data: sessions }
          return { data: [] }
        },
      },
      v2: { session: { list: async () => ({ data: [] }) } },
    },
  } as unknown as BrowserApi
  return {
    api,
    dir,
    host,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
      try {
        rmSync(host, { recursive: true, force: true })
      } catch {}
    },
  }
}
describe("project detail", () => {
  const base = 1700000000000
  test("root-only filter", async () => {
    const h = harness({
      projects: [mkP("projA", "alpha", "/tmp/a", base, base)],
      sessions: [
        mkS(
          "s1",
          "projA",
          1,
          100,
          50,
          10,
          20,
          5,
          base + 1000,
          base + 5000,
          "one",
        ),
        mkS(
          "s2",
          "projA",
          0.5,
          10,
          10,
          0,
          0,
          0,
          base + 2000,
          base + 8000,
          undefined,
          "parent123",
        ),
        mkS("s3", "projA", 0.2, 5, 5, 0, 0, 0, base + 3000, base + 6000),
      ],
      currentSessionID: "s1",
    })
    const d = await loadProjectDetail(h.api, "projA")
    expect(d.sessions.length).toBe(2)
    expect(d.sessions.some((s) => s.id === "s2")).toBe(false)
    h.cleanup()
  })
  test("period and pin", async () => {
    const h = harness({
      projects: [mkP("projA", "alpha", "/tmp/a", base, base)],
      sessions: [
        mkS(
          "s1",
          "projA",
          1,
          100,
          50,
          0,
          0,
          0,
          base + 1000,
          base + 5000,
          "one",
        ),
        mkS("s2", "projA", 0.5, 10, 10, 0, 0, 0, base + 2000, base + 8000),
        mkS("s3", "projA", 0.2, 5, 5, 0, 0, 0, base + 3000, base + 6000),
      ],
      currentSessionID: "s2",
    })
    const d = await loadProjectDetail(h.api, "projA")
    expect(d.period).toEqual({ start: base + 1000, end: base + 8000 })
    expect(d.sessions[0]!.id).toBe("s2")
    h.cleanup()
  })
  test("empty period null", async () => {
    const h = harness({
      projects: [mkP("projA", "alpha", undefined, 1, 2)],
      sessions: [],
    })
    expect((await loadProjectDetail(h.api, "projA")).period).toBeNull()
    h.cleanup()
  })
})
describe("browser session-tree", () => {
  test("via children bfs", async () => {
    const api = {
      client: {
        session: {
          children: async (p: unknown) =>
            ({
              data:
                (p as { sessionID: string }).sessionID === "root"
                  ? [{ id: "a" }, { id: "b" }]
                  : (p as { sessionID: string }).sessionID === "a"
                    ? [{ id: "c" }]
                    : [],
            }) as unknown,
        },
      },
    } as never
    expect((await discoverTree(api, "root")).sort()).toEqual(
      ["a", "b", "c", "root"].sort(),
    )
  })
  test("children errors and fallback", async () => {
    const api = {
      client: {
        session: {
          children: async (p: unknown) => {
            if ((p as { sessionID: string }).sessionID === "a")
              throw new Error("boom")
            return {
              data: [{ id: "a" }, { id: 123 as unknown as string }],
            } as unknown
          },
        },
      },
    } as never
    expect(await discoverTree(api, "root")).toEqual(["root", "a"])
    const bad = {
      client: { session: { children: async () => ({ data: "bad" }) } },
    } as never
    expect(await discoverTree(bad, "root")).toEqual(["root"])
    const list = {
      client: {
        session: {
          list: async () => ({
            data: [
              { id: "a", parentID: "root" },
              { id: "b", parentId: "a" },
            ],
          }),
        },
      },
    } as never
    expect((await discoverTree(list, "root")).sort()).toEqual(
      ["a", "b", "root"].sort(),
    )
    expect(
      await discoverTree(
        {
          client: {
            session: {
              list: async () => {
                throw new Error("boom")
              },
            },
          },
        } as never,
        "root",
      ),
    ).toEqual(["root"])
  })
})
