// Combined V2 finalization + Close lifecycle regression: actual SDK envelope, eligibility, real host replace→onClose
// FAILS on v1.3.1 unmodified (outer SessionsResponse mis-parsed as false, unknown coerced to empty)
// PASSES after tri-state + correct unwrapping, with Close intact
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __resetBrowserActivityForTest } from "../src/tokenmeter/browser/browser-activity"
import { NAV } from "../src/tokenmeter/browser/constants"
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

function v2Envelope(data: unknown[]): unknown {
  return {
    data: { data, cursor: { next: null, previous: null } },
    request: { timeout: false } as unknown,
    response: {} as unknown,
  }
}

function badEnvelope(): unknown {
  return { data: { foo: 123 }, request: {}, response: {} }
}

type HR = ReturnType<typeof hostRealContract>

function mkApiV2(
  hostDir: string,
  stateDir: string,
  a: string,
  b: string,
  hr: HR,
  v2Impl: (p: Record<string, unknown>) => Promise<unknown>,
) {
  const projects = [
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
  return {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => ({ data: projects }) as never,
        current: async () => ({ data: { id: "projA" } }) as never,
      },
      session: { list: async () => ({ data: [] }) as never },
      v2: { session: { list: v2Impl } },
    },
    ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
  } as unknown
}

describe("v2 finalization + Close systemic cluster", () => {
  test("real envelope: provisional visible then final retains projects and Close works", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-lc-")
    const hostDir = tmpGit("tm-lh-")
    const a = tmpGit("tm-la-")
    const b = tmpGit("tm-lb-")
    const hr = hostRealContract()
    const api = mkApiV2(hostDir, dir, a, b, hr, async (p) => {
      const pid = p.project as string
      if (pid === "projA") return v2Envelope([{ id: "s1", projectID: "projA" }])
      if (pid === "projB") return v2Envelope([{ id: "s2", projectID: "projB" }])
      return v2Envelope([])
    })
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (2)")
    expect(view.options.some((o) => o.value === "projA")).toBe(true)
    expect(view.options.some((o) => o.value === "projB")).toBe(true)
    const ccBefore = hr.cc()
    const closeOpt = view.options.find((o) => o.value === "__close")!
    view.onSelect!({ title: closeOpt.title, value: "__close" } as never)
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.dlg.open).toBe(false)
    for (const d of [dir, hostDir, a, b])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("real empty success removes only empty project, Close still works", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-ec-")
    const hostDir = tmpGit("tm-eh-")
    const a = tmpGit("tm-ea-")
    const b = tmpGit("tm-eb-")
    const hr = hostRealContract()
    const api = mkApiV2(hostDir, dir, a, b, hr, async (p) => {
      const pid = p.project as string
      if (pid === "projA") return v2Envelope([{ id: "s1", projectID: "projA" }])
      return v2Envelope([])
    })
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (1)")
    expect(view.options.some((o) => o.value === "projA")).toBe(true)
    expect(view.options.some((o) => o.value === "projB")).toBe(false)
    const ccBefore = hr.cc()
    view.onSelect!({
      title: view.options.find((o) => o.value === "__close")!.title,
      value: "__close",
    } as never)
    expect(hr.cc()).toBe(ccBefore + 1)
    for (const d of [dir, hostDir, a, b])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("unknown error retains provisional and Close via Escape works", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-uc-")
    const hostDir = tmpGit("tm-uh-")
    const a = tmpGit("tm-ua-")
    const b = tmpGit("tm-ub-")
    const hr = hostRealContract()
    const api = mkApiV2(hostDir, dir, a, b, hr, async (p) => {
      const pid = p.project as string
      if (pid === "projA") throw new Error("transport timeout")
      if (pid === "projB") return badEnvelope()
      return v2Envelope([])
    })
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (2)")
    expect(view.options.some((o) => o.value === "projA")).toBe(true)
    expect(view.options.some((o) => o.value === "projB")).toBe(true)
    const topOnClose = (hr.stack()[0] as { onClose?: () => void })?.onClose
    expect(topOnClose).toBeDefined()
    const ccBefore = hr.cc()
    topOnClose!()
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.dlg.open).toBe(false)
    topOnClose!()
    expect(hr.cc()).toBe(ccBefore + 1)
    for (const d of [dir, hostDir, a, b])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("eligibility: non-git/HOME direct child never provisional, Close works", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-gc-")
    const hostDir = tmpGit("tm-gh-")
    const good = tmpGit("tm-good-")
    const hr = hostRealContract()
    const projects = [
      {
        id: "good",
        name: "good",
        worktree: good,
        time: { created: 1, updated: 2 },
      },
      {
        id: "bad",
        name: "bad",
        worktree: "/nope-xyz-not-a-dir",
        time: { created: 1, updated: 3 },
      },
    ]
    const api = {
      state: { path: { directory: hostDir, state: dir } },
      client: {
        project: {
          list: async () => ({ data: projects }) as never,
          current: async () => ({ data: { id: "good" } }) as never,
        },
        session: { list: async () => ({ data: [] }) as never },
        v2: {
          session: {
            list: async () => v2Envelope([{ id: "s1", projectID: "good" }]),
          },
        },
      },
      ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
    } as unknown
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 350))
    const view = hr.get()
    expect(view.options.some((o) => o.value === "good")).toBe(true)
    expect(view.options.some((o) => o.value === "bad")).toBe(false)
    const ccBefore = hr.cc()
    view.onSelect!({
      title: view.options.find((o) => o.value === "__close")!.title,
      value: "__close",
    } as never)
    expect(hr.cc()).toBe(ccBefore + 1)
    for (const d of [dir, hostDir, good])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })
})
