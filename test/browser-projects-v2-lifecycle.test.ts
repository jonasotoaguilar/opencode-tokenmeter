// Root is eligible-only deterministic: no V2 probes, one render, legacy detail authoritative
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __resetBrowserActivityForTest } from "../src/tokenmeter/browser/browser-activity"
import { showBrowserDialog } from "../src/tokenmeter/browser/projects-dialog"
import {
  ensureGit,
  hostRealContract,
  stubPricing,
} from "./helpers/real-dialog-contract"

function tmpGit(p: string): string {
  const d = mkdtempSync(join(tmpdir(), p))
  ensureGit(d)
  return d
}

type HR = ReturnType<typeof hostRealContract>

function mkRootApi(
  hostDir: string,
  stateDir: string,
  a: string,
  b: string,
  hr: HR,
  extraProjects: unknown[] = [],
) {
  const base = [
    {
      id: "projA",
      name: "alpha",
      worktree: a,
      time: { created: 1700000000000, updated: 1700000005000 },
    },
    {
      id: "projB",
      name: undefined,
      worktree: b,
      time: { created: 1700000000000, updated: 1700000008000 },
    },
  ]
  const projects = [...base, ...extraProjects] as never
  let listCalls = 0
  let curCalls = 0
  return {
    api: {
      state: { path: { directory: hostDir, state: stateDir } },
      client: {
        project: {
          list: async () => {
            listCalls++
            return { data: projects } as never
          },
          current: async () => {
            curCalls++
            return { data: { id: "projA" } } as never
          },
        },
        session: { list: async () => ({ data: [] }) as never },
        v2: {
          session: {
            list: async () =>
              ({ data: { data: [], cursor: { next: null } } }) as never,
          },
        },
      },
      ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
    } as unknown,
    counts: () => ({ listCalls, curCalls }),
  }
}

describe("root eligible-only + legacy detail", () => {
  test("current + multiple eligible remain after idle, Close/Escape work, 2 backend calls", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-rlc-")
    const hostDir = tmpGit("tm-rlh-")
    const a = tmpGit("tm-rla-")
    const b = tmpGit("tm-rlb-")
    const c = tmpGit("tm-rlc2-")
    const hr = hostRealContract()
    const { api, counts } = mkRootApi(hostDir, dir, a, b, hr, [
      {
        id: "projC",
        name: "gamma",
        worktree: c,
        time: { created: 1, updated: 1700000009000 },
      },
    ])
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (3)")
    expect(view.options.some((o) => o.value === "projA")).toBe(true)
    expect(view.options.some((o) => o.value === "projB")).toBe(true)
    expect(view.options.some((o) => o.value === "projC")).toBe(true)
    // idle should not filter away
    await new Promise((r) => setTimeout(r, 400))
    const view2 = hr.get()
    expect(view2.title).toBe("TokenMeter: Browse Usage (3)")
    const ccBefore = hr.cc()
    view2.onSelect!({
      title: view2.options.find((o) => o.value === "__close")!.title,
      value: "__close",
    } as never)
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.dlg.open).toBe(false)
    // Escape equivalent via onClose idempotent
    expect(counts().listCalls).toBe(1)
    expect(counts().curCalls).toBe(1)
    expect(counts().listCalls + counts().curCalls).toBe(2)
    for (const d of [dir, hostDir, a, b, c])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("selecting non-current loads its sessions via legacy directory and Back/Close work", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-plc-")
    const hostDir = tmpGit("tm-plh-")
    const a = tmpGit("tm-pla-")
    const b = tmpGit("tm-plb-")
    const hr = hostRealContract()
    // project B has 2 sessions via legacy directory list
    const { api } = mkRootApi(hostDir, dir, a, b, hr)
    // override session.list for project detail to return sessions for B
    const api2 = api as unknown as {
      client: {
        session: { list: (p: Record<string, unknown>) => Promise<unknown> }
      }
    }
    const origList = api2.client.session.list
    api2.client.session.list = async (p: Record<string, unknown>) => {
      const d = p.directory as string
      if (d === b)
        return {
          data: [
            {
              id: "sB1",
              title: "one",
              time: { created: 1, updated: 5 },
              parentID: null,
              tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } },
              cost: 0.1,
              model: { providerID: "openai", id: "gpt-4o" },
            },
            {
              id: "sB2",
              title: "two",
              time: { created: 2, updated: 4 },
              parentID: null,
              tokens: { input: 5, output: 5, cache: { read: 0, write: 0 } },
              cost: 0.05,
              model: { providerID: "openai", id: "gpt-4o" },
            },
          ],
        } as never
      if (d === a)
        return {
          data: [
            {
              id: "sA1",
              title: "a",
              time: { created: 1, updated: 2 },
              parentID: null,
              tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } },
              cost: 0.1,
              model: { providerID: "openai", id: "gpt-4o" },
            },
          ],
        } as never
      return origList(p as never) as never
    }
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const root = hr.get()
    const bOpt = root.options.find((o) => o.value === "projB")!
    root.onSelect!({ title: bOpt.title, value: bOpt.value } as never)
    await new Promise((r) => setTimeout(r, 600))
    const detail = hr.get()
    expect(detail.title).toContain("(2)")
    expect(detail.options.some((o) => o.value === "sB1")).toBe(true)
    expect(detail.options.some((o) => o.value === "sB2")).toBe(true)
    // Back to root
    const backOpt = detail.options.find((o) => o.value === "__back")!
    detail.onSelect!({ title: backOpt.title, value: backOpt.value } as never)
    await new Promise((r) => setTimeout(r, 350))
    const back = hr.get()
    expect(back.title).toBe("TokenMeter: Browse Usage (2)")
    // Close via Escape (onClose)
    const topOnClose = (hr.stack()[0] as { onClose?: () => void })?.onClose
    expect(topOnClose).toBeDefined()
    const ccBefore = hr.cc()
    topOnClose!()
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.dlg.open).toBe(false)
    for (const d of [dir, hostDir, a, b])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("zero-session eligible project remains visible", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-zc-")
    const hostDir = tmpGit("tm-zh-")
    const good = tmpGit("tm-zg-")
    const empty = tmpGit("tm-ze-")
    const hr = hostRealContract()
    const { api } = mkRootApi(hostDir, dir, good, empty, hr)
    // make projB empty zero-session but still eligible with .git — should remain
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (2)")
    expect(view.options.some((o) => o.value === "projA")).toBe(true)
    expect(view.options.some((o) => o.value === "projB")).toBe(true)
    for (const d of [dir, hostDir, good, empty])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })
})
