// biome-ignore-all lint/style/noNonNullAssertion: harness uses host-realistic dialog stack
// biome-ignore-all lint/suspicious/noExplicitAny: harness uses host-realistic dialog stack
// Real host contract: replace and clear both invoke previous onClose per dialog.tsx.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __resetBrowserActivityForTest } from "../src/tokenmeter/browser/browser-activity"
import { NAV } from "../src/tokenmeter/browser/constants"
import { showProjectDetail } from "../src/tokenmeter/browser/project-dialog"
import { showBrowserDialog } from "../src/tokenmeter/browser/projects-dialog"
import { showSessionDetail } from "../src/tokenmeter/browser/session-dialog"
import {
  mkApiReal,
  mkProjectDetailApi,
  mkSessionDetailApi,
} from "./helpers/real-dialog-apis"
import {
  ensureGit,
  hostRealContract,
  stubPricing,
} from "./helpers/real-dialog-contract"

function tmpGit(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  ensureGit(d)
  return d
}

describe("real contract: Close must survive host replace→onClose", () => {
  test("root Close works after provisional and final replaces, is once-guarded", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-rc-")
    const hostDir = tmpGit("tm-rh-")
    const a = tmpGit("tm-ra-")
    const b = tmpGit("tm-rb-")
    const hr = hostRealContract()
    const api = mkApiReal(hostDir, dir, a, b, hr)
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 250))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (2)")
    expect(
      view.options.some((o) => o.value === "__close" && o.category === NAV),
    ).toBe(true)
    const closeOpt = view.options.find((o) => o.value === "__close")!
    const ccBefore = hr.cc()
    const ocBefore = hr.oc()
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.oc()).toBe(ocBefore + 1)
    expect(hr.dlg.open).toBe(false)
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.oc()).toBe(ocBefore + 1)
    for (const d of [dir, hostDir, a, b])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("project detail Close is once-guarded under real host", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-pc-")
    const hostDir = tmpGit("tm-ph-")
    const w = tmpGit("tm-pw-")
    const hr = hostRealContract()
    const api = mkProjectDetailApi(hostDir, dir, w, hr)
    showProjectDetail(api as never, "projA")
    await new Promise((r) => setTimeout(r, 900))
    const view = hr.get()
    expect(view.options.some((o) => o.value === "__close")).toBe(true)
    const closeOpt = view.options.find((o) => o.value === "__close")!
    const ccBefore = hr.cc()
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    for (const d of [dir, hostDir, w])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("session detail Close is once-guarded under real host", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-sc-")
    const hostDir = tmpGit("tm-sh-")
    const hr = hostRealContract()
    const api = mkSessionDetailApi(hostDir, dir, hr)
    showSessionDetail(api as never, "s1", "projA")
    await new Promise((r) => setTimeout(r, 900))
    const view = hr.get()
    const closeOpt = view.options.find((o) => o.value === "__close")!
    const ccBefore = hr.cc()
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    for (const d of [dir, hostDir])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })

  test("Escape-equivalent onClose clears exactly once under real host", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-ec-")
    const hostDir = tmpGit("tm-eh-")
    const a = tmpGit("tm-ea-")
    const b = tmpGit("tm-eb-")
    const hr = hostRealContract()
    const api = mkApiReal(hostDir, dir, a, b, hr)
    showBrowserDialog(api as never)
    await new Promise((r) => setTimeout(r, 250))
    const topOnClose = (hr.stack()[0] as any)?.onClose as
      | (() => void)
      | undefined
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

  test("Close during loading prevents late async reopen", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = tmpGit("tm-lc-")
    const hostDir = tmpGit("tm-lh-")
    const w = tmpGit("tm-lw-")
    const hr = hostRealContract()
    const api: any = {
      state: { path: { directory: hostDir, state: dir } },
      client: {
        project: {
          list: async () => {
            await new Promise((r) => setTimeout(r, 300))
            return {
              data: [
                {
                  id: "projA",
                  name: "alpha",
                  worktree: w,
                  time: { created: 1700000000000, updated: 1700000005000 },
                },
              ],
            }
          },
          current: async () => ({ data: { id: "projA" } }),
        },
        session: {
          list: async () => ({ data: [] }),
          get: async (p: any) => ({
            data: {
              id: p.sessionID,
              projectID: "projA",
              title: "one",
              time: { created: 1, updated: 2 },
              tokens: { input: 10, output: 5 },
              cost: 0.1,
              model: { providerID: "openai", id: "gpt-4o" },
            },
          }),
          messages: async () => ({ data: [] }),
          children: async () => ({ data: [] }),
        },
        model: { list: async () => ({ data: [] }) },
        v2: {
          model: { list: async () => ({ data: [] }) },
          session: { list: async () => ({ data: [{ id: "s1" }] }) },
        },
      },
      route: { current: { params: { sessionID: "s1" } } },
      currentSessionID: "s1",
      ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
    }
    showProjectDetail(api, "projA")
    const topOnClose = (hr.stack()[0] as any)?.onClose as
      | (() => void)
      | undefined
    topOnClose?.()
    expect(hr.dlg.open).toBe(false)
    await new Promise((r) => setTimeout(r, 500))
    expect(hr.dlg.open).toBe(false)
    for (const d of [dir, hostDir, w])
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {}
  })
})
