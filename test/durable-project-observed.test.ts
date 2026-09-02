import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkpointActiveProject,
  readCheckpoints,
} from "../src/tokenmeter/durable/checkpoints"
import { observedToEntry } from "../src/tokenmeter/durable/merge"
import { durableDbPath } from "../src/tokenmeter/durable/paths"
import { reconcileProjectUsage } from "../src/tokenmeter/durable/reconcile"
import type { CheckpointRow } from "../src/tokenmeter/durable/types"
import { clearPricing } from "../src/tokenmeter/pricing"
import {
  disposeProjectRefresh,
  projectSnapshot,
  refreshProject,
  setProjectSnapshot,
} from "../src/tokenmeter/project"
import {
  forgetSession,
  observedSessionUsage,
  usageMap,
} from "../src/tokenmeter/store"
import type { MessageUsage } from "../src/tokenmeter/types"

const mk = (c: number, s: MessageUsage["source"]): MessageUsage => ({
  cost: c,
  source: s,
  input: 1000,
  output: 500,
  reasoning: 100,
  cacheRead: 50,
  cacheWrite: 25,
  context: 1675,
})
const seed = (sid: string, us: MessageUsage[]) => {
  forgetSession(sid)
  const m = usageMap(sid)
  m.clear()
  for (let i = 0; i < us.length; i++) m.set(`m${i}`, us[i]!)
  observedSessionUsage(sid)
}
const obsMap = (
  pid: string,
  alias: string,
  ids: string[],
): Map<string, CheckpointRow> | null => {
  const m = new Map<string, CheckpointRow>()
  for (const sid of ids) {
    const o = observedSessionUsage(sid)
    if (!o) continue
    const e = observedToEntry(o, sid, pid, alias)
    if (e) m.set(sid, e)
  }
  return m.size ? m : null
}
const sess = (
  id: string,
  pid: string,
  cost: number,
  input = 1000,
): unknown => ({
  id,
  projectID: pid,
  cost,
  tokens: {
    input,
    output: 500,
    reasoning: 100,
    cache: { read: 50, write: 25 },
  },
})
describe("durable project observed cost", () => {
  let dir: string
  let db: string
  let restore: () => void
  beforeEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
    dir = mkdtempSync(join(tmpdir(), "obs-"))
    const saved = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = dir
    restore = () => {
      if (saved === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = saved
    }
    db = durableDbPath()!
  })
  afterEach(() => {
    clearPricing()
    setProjectSnapshot(null)
    disposeProjectRefresh()
    restore()
    rmSync(dir, { recursive: true, force: true })
  })
  test("observed cost precedence, delegated once, unloaded list", async () => {
    const s1 = "sess-mixed",
      s2 = "sess-full",
      p = "sess-principal",
      c = "sess-child",
      loaded = "sess-loaded",
      unloaded = "sess-unloaded",
      state = mkdtempSync(join(tmpdir(), "obs-state-"))
    seed(s1, [mk(6, "reported"), mk(6.97, "reported")])
    seed(s2, [mk(5, "reported")])
    seed(p, [mk(7, "reported")])
    seed(c, [mk(5.97, "reported")])
    seed(loaded, [mk(10, "reported")])
    forgetSession(unloaded)
    checkpointActiveProject(
      db,
      "projM",
      "/proj/m",
      [sess(s1, "projM", 1.2) as never],
      obsMap("projM", "/proj/m", [s1]),
    )
    expect(readCheckpoints(db, "projM", "/proj/m").get(s1)!.cost).toBeCloseTo(
      12.97,
    )
    expect(readCheckpoints(db, "projM", "/proj/m").get(s1)!.costSource).toBe(
      "observed",
    )
    checkpointActiveProject(
      db,
      "projF",
      "/proj/f",
      [sess(s2, "projF", 15) as never],
      obsMap("projF", "/proj/f", [s2]),
    )
    expect(readCheckpoints(db, "projF", "/proj/f").get(s2)!.cost).toBeCloseTo(
      15,
    )
    const pc = observedSessionUsage(p)!.cost,
      cc = observedSessionUsage(c)!.cost
    const sessions = [
      sess(p, "projT", 1) as never,
      {
        id: c,
        projectID: "projT",
        cost: 0.5,
        parentID: p,
        tokens: { input: 500, output: 200 },
      } as never,
    ]
    checkpointActiveProject(
      db,
      "projT",
      "/proj/t",
      sessions,
      obsMap("projT", "/proj/t", [p, c]),
    )
    expect(
      reconcileProjectUsage(
        "projT",
        sessions as never,
        readCheckpoints(db, "projT", "/proj/t"),
        "/proj/dir",
      ).cost,
    ).toBeCloseTo(pc + cc)
    await refreshProject({
      state: { path: { directory: "/proj/t", state } },
      client: {
        project: {
          current: async () => ({
            data: { id: "projT", worktree: "/proj/dir" },
          }),
        },
        session: { list: async () => ({ data: sessions }) },
      },
    } as never)
    expect(projectSnapshot()?.cost).toBeCloseTo(pc + cc)
    const s2b = [
      sess(loaded, "projU", 1) as never,
      sess(unloaded, "projU", 2, 500) as never,
    ]
    checkpointActiveProject(
      db,
      "projU",
      "/proj/u",
      s2b,
      obsMap("projU", "/proj/u", [loaded, unloaded]),
    )
    const cps = readCheckpoints(db, "projU", "/proj/u")
    expect(cps.get(loaded)?.cost).toBeCloseTo(10)
    expect(cps.get(unloaded)?.cost).toBeCloseTo(2)
    for (const sid of [s1, s2, p, c, loaded, unloaded]) forgetSession(sid)
    rmSync(state, { recursive: true, force: true })
  })
  test("heal, idle zero, no SDK calls, source survives", async () => {
    const sid = "sess-heal"
    checkpointActiveProject(db, "projH", "/proj/h", [
      sess(sid, "projH", 1.2) as never,
    ])
    expect(readCheckpoints(db, "projH", "/proj/h").get(sid)?.cost).toBeCloseTo(
      1.2,
    )
    seed(sid, [mk(12.97, "reported")])
    checkpointActiveProject(
      db,
      "projH",
      "/proj/h",
      [sess(sid, "projH", 1.2) as never],
      obsMap("projH", "/proj/h", [sid]),
    )
    expect(readCheckpoints(db, "projH", "/proj/h").get(sid)?.cost).toBeCloseTo(
      12.97,
    )
    const sid2 = "sess-idle"
    seed(sid2, [mk(3.3, "reported")])
    const s = [sess(sid2, "projI", 3.3, 100) as never],
      m = obsMap("projI", "/proj/i", [sid2])
    expect(checkpointActiveProject(db, "projI", "/proj/i", s, m)).toBe(1)
    expect(checkpointActiveProject(db, "projI", "/proj/i", s, m)).toBe(0)
    const state = mkdtempSync(join(tmpdir(), "obs-state-")),
      sid3 = "sess-nocall"
    seed(sid3, [mk(4, "reported")])
    const sessions = [sess(sid3, "projN", 0.5, 100) as never]
    let cur = 0,
      list = 0,
      msg = 0
    const api = {
      state: { path: { directory: "/proj/dir", state } },
      client: {
        project: {
          current: async () => {
            cur++
            return { data: { id: "projN", worktree: "/proj/dir" } }
          },
        },
        session: {
          list: async () => {
            list++
            return { data: sessions }
          },
          messages: async () => {
            msg++
            return { data: [] }
          },
          get: async () => {
            msg++
            return { data: undefined }
          },
        },
      },
    }
    await refreshProject(api as never)
    expect(cur).toBe(1)
    expect(list).toBe(1)
    expect(msg).toBe(0)
    const sid4 = "sess-source"
    seed(sid4, [mk(8.5, "reported")])
    checkpointActiveProject(
      db,
      "projS",
      "/proj/s",
      [sess(sid4, "projS", 0.5, 100) as never],
      obsMap("projS", "/proj/s", [sid4]),
    )
    expect(readCheckpoints(db, "projS", "/proj/s").get(sid4)?.costSource).toBe(
      "observed",
    )
    for (const s of [sid, sid2, sid3, sid4]) forgetSession(s)
    rmSync(state, { recursive: true, force: true })
  })
})
