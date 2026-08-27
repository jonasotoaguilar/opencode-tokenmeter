// biome-ignore-all lint/style/noNonNullAssertion: harness uses host-realistic dialog stack
// biome-ignore-all lint/suspicious/noExplicitAny: harness uses host-realistic dialog stack
// Real host contract regression: dialog.replace invokes previous onClose before installing new item.
// Previous harness assumed replace was silent; this test encodes the actual OpenCode TUI contract
// from packages/tui/src/ui/dialog.tsx (replace loops over stack and calls onClose, clear loops and calls onClose).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { __resetBrowserActivityForTest } from "../src/tokenmeter/browser/browser-activity"
import { NAV } from "../src/tokenmeter/browser/constants"
import { showProjectDetail } from "../src/tokenmeter/browser/project-dialog"
import { showBrowserDialog } from "../src/tokenmeter/browser/projects-dialog"
import { showSessionDetail } from "../src/tokenmeter/browser/session-dialog"
import { clearPricing } from "../src/tokenmeter/pricing"
import {
  __setPricingFetchForTest,
  clearRemotePricing,
} from "../src/tokenmeter/pricing-remote"

function ensureGit(p: string) {
  try {
    mkdirSync(join(p, ".git"), { recursive: true })
  } catch {}
}
function stubPricing() {
  try {
    clearPricing()
    clearRemotePricing()
    __setPricingFetchForTest(
      (async () =>
        ({
          ok: true,
          json: async () => ({}),
        }) as unknown as Response) as unknown as typeof fetch,
    )
  } catch {}
}

// Faithful host: replace and clear both invoke previous onClose before mutating, per dialog.tsx
function hostRealContract() {
  type S = { render: () => unknown; onClose?: () => void }
  let stack: S[] = []
  let rc = 0
  let cc = 0
  let oc = 0
  let cap: any = null
  const dlg = {
    replace(r: () => unknown, c?: () => void) {
      const prev = [...stack]
      for (const it of prev) {
        if (it.onClose) {
          oc++
          try {
            it.onClose()
          } catch {}
        }
      }
      rc++
      // Even if previous onClose cleared the stack, we still install the new item
      stack = [{ render: r, onClose: c }]
    },
    clear() {
      const prev = [...stack]
      const had = prev.length > 0
      for (const it of prev) {
        if (it.onClose) {
          oc++
          try {
            it.onClose()
          } catch {}
        }
      }
      stack = []
      if (had) cc++
    },
    get depth() {
      return stack.length
    },
    get open() {
      return stack.length > 0
    },
  } as any
  const capture = (p: any) => {
    cap = p
    return null as any
  }
  const get = () => {
    if (!stack[0]) throw new Error("no render")
    ;(stack[0].render as () => unknown)()
    const v = cap!
    cap = null
    return v as {
      title: string
      options: Array<{ title: string; value: string; category?: string }>
      onSelect?: (v: any) => void
    }
  }
  return {
    dlg,
    capture,
    get,
    rc: () => rc,
    cc: () => cc,
    oc: () => oc,
    stack: () => stack,
  }
}

function mkApiReal(
  hostDir: string,
  stateDir: string,
  a: string,
  b: string,
  hr: ReturnType<typeof hostRealContract>,
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
  const map: Record<string, unknown[]> = {
    [a]: [
      {
        id: "s1",
        title: "one",
        time: { created: 1, updated: 2 },
        parentID: null,
        tokens: { input: 10, output: 5 },
        cost: 0.1,
        model: { providerID: "openai", id: "gpt-4o" },
      },
    ],
    [b]: [
      {
        id: "s2",
        title: "two",
        time: { created: 1, updated: 3 },
        parentID: null,
        tokens: { input: 5, output: 5 },
        cost: 0.05,
        model: { providerID: "openai", id: "gpt-4o" },
      },
    ],
  }
  const projMap: Record<string, unknown[]> = { projA: map[a]!, projB: map[b]! }
  return {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => ({ data: projects }) as never,
        current: async () => ({ data: { id: "projA" } }) as never,
      },
      session: {
        list: async (p: Record<string, unknown>) => {
          const d = p.directory as string
          if (d && (map as any)[d]) return { data: (map as any)[d] } as never
          return { data: [] } as never
        },
        get: async (p: Record<string, unknown>) =>
          ({
            data: {
              id: p.sessionID,
              projectID: "projA",
              title: "one",
              time: { created: 1, updated: 2 },
              tokens: { input: 10, output: 5 },
              cost: 0.1,
              model: { providerID: "openai", id: "gpt-4o" },
            },
          }) as never,
        messages: async () => ({ data: [] }) as never,
        children: async () => ({ data: [] }) as never,
      },
      model: { list: async () => ({ data: [] }) },
      v2: {
        model: { list: async () => ({ data: [] }) },
        session: {
          list: async (p: Record<string, unknown>) => {
            const pid = p.project as string
            if (pid && projMap[pid]) return { data: projMap[pid] } as never
            return { data: [] } as never
          },
        },
      },
    },
    route: { current: { params: { sessionID: "s1" } } },
    currentSessionID: "s1",
    ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
  } as any
}

describe("real contract: Close must survive host replace→onClose", () => {
  test("root Close works after provisional and final replaces, is once-guarded", async () => {
    __resetBrowserActivityForTest()
    stubPricing()
    const dir = mkdtempSync(join(tmpdir(), "tm-rc-"))
    const hostDir = mkdtempSync(join(tmpdir(), "tm-rh-"))
    const a = mkdtempSync(join(tmpdir(), "tm-ra-"))
    const b = mkdtempSync(join(tmpdir(), "tm-rb-"))
    ensureGit(dir)
    ensureGit(hostDir)
    ensureGit(a)
    ensureGit(b)
    const hr = hostRealContract()
    const api = mkApiReal(hostDir, dir, a, b, hr)
    showBrowserDialog(api)
    // wait for async provisional + V2 probes to settle
    await new Promise((r) => setTimeout(r, 250))
    const view = hr.get()
    expect(view.title).toBe("TokenMeter: Browse Usage (2)")
    expect(
      view.options.some((o) => o.value === "__close" && o.category === NAV),
    ).toBe(true)
    // Before user close, dialog must still be open and close must not have been spuriously invoked by intermediate replaces
    // Real host invokes onClose on replace, but a correct plugin must suppress that for content updates.
    // Buggy v1.3.0 will have triggered onClose during provisional replace and thus closed the generation,
    // making the subsequent user Close a no-op (cc stays 0). So we assert it DOES close.
    const closeOpt = view.options.find((o) => o.value === "__close")!
    const ccBefore = hr.cc()
    const ocBefore = hr.oc()
    view.onSelect!({ title: closeOpt.title, value: "__close" } as any)
    expect(hr.cc()).toBe(ccBefore + 1)
    // onClose should have been invoked exactly once for the user close (not twice via re-entrancy)
    expect(hr.oc()).toBe(ocBefore + 1)
    expect(hr.dlg.open).toBe(false)
    // second click must be idempotent
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
    const dir = mkdtempSync(join(tmpdir(), "tm-pc-"))
    const hostDir = mkdtempSync(join(tmpdir(), "tm-ph-"))
    const w = mkdtempSync(join(tmpdir(), "tm-pw-"))
    ensureGit(dir)
    ensureGit(hostDir)
    ensureGit(w)
    const hr = hostRealContract()
    const api: any = {
      state: { path: { directory: hostDir, state: dir } },
      client: {
        project: {
          list: async () => ({
            data: [
              {
                id: "projA",
                name: "alpha",
                worktree: w,
                time: { created: 1700000000000, updated: 1700000005000 },
              },
            ],
          }),
          current: async () => ({ data: { id: "projA" } }),
        },
        session: {
          list: async (p: any) => {
            const d = p.directory as string
            if (d === w)
              return {
                data: [
                  {
                    id: "s1",
                    title: "one",
                    time: { created: 1, updated: 5 },
                    parentID: null,
                    tokens: {
                      input: 10,
                      output: 5,
                      cache: { read: 0, write: 0 },
                    },
                    cost: 0.1,
                    model: { providerID: "openai", id: "gpt-4o" },
                  },
                  {
                    id: "s2",
                    title: "two",
                    time: { created: 2, updated: 4 },
                    parentID: null,
                    tokens: {
                      input: 5,
                      output: 5,
                      cache: { read: 0, write: 0 },
                    },
                    cost: 0.05,
                    model: { providerID: "openai", id: "gpt-4o" },
                  },
                ],
              }
            return { data: [] }
          },
          get: async () => ({ data: { id: "s1", projectID: "projA" } }),
          messages: async () => ({ data: [] }),
          children: async () => ({ data: [] }),
        },
        model: { list: async () => ({ data: [] }) },
        v2: {
          model: { list: async () => ({ data: [] }) },
          session: { list: async () => ({ data: [] }) },
        },
      },
      route: { current: { params: { sessionID: "s1" } } },
      currentSessionID: "s1",
      ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
    }
    showProjectDetail(api, "projA")
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
    const dir = mkdtempSync(join(tmpdir(), "tm-sc-"))
    const hostDir = mkdtempSync(join(tmpdir(), "tm-sh-"))
    ensureGit(dir)
    ensureGit(hostDir)
    const hr = hostRealContract()
    const api: any = {
      state: { path: { directory: hostDir, state: dir } },
      client: {
        project: {
          list: async () => ({
            data: [
              {
                id: "projA",
                name: "alpha",
                worktree: hostDir,
                time: { created: 1, updated: 2 },
              },
            ],
          }),
          current: async () => ({ data: { id: "projA" } }),
        },
        session: {
          list: async () => ({ data: [] }),
          get: async (p: any) => ({
            data: {
              id: p.sessionID,
              projectID: "projA",
              title: "Alpha",
              time: { created: 1000, updated: 2000 },
              tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              cost: 0,
            },
          }),
          messages: async () => ({ data: [] }),
          children: async () => ({ data: [] }),
        },
        model: { list: async () => ({ data: [] }) },
        v2: {
          model: { list: async () => ({ data: [] }) },
          session: { list: async () => ({ data: [] }) },
        },
      },
      route: { current: { params: { sessionID: "s1" } } },
      currentSessionID: "s1",
      ui: { dialog: hr.dlg, DialogSelect: hr.capture, toast() {} },
    }
    showSessionDetail(api, "s1", "projA")
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
    const dir = mkdtempSync(join(tmpdir(), "tm-ec-"))
    const hostDir = mkdtempSync(join(tmpdir(), "tm-eh-"))
    const a = mkdtempSync(join(tmpdir(), "tm-ea-"))
    const b = mkdtempSync(join(tmpdir(), "tm-eb-"))
    ensureGit(dir)
    ensureGit(hostDir)
    ensureGit(a)
    ensureGit(b)
    const hr = hostRealContract()
    const api = mkApiReal(hostDir, dir, a, b, hr)
    showBrowserDialog(api)
    await new Promise((r) => setTimeout(r, 250))
    // Simulate Escape: host calls stack top onClose then slices (we model as clear via onClose + slice, but our dlg models Escape as directly invoking onClose then clearing)
    // The plugin's onClose should clear exactly once and be idempotent.
    const topOnClose = (hr.stack()[0] as any)?.onClose as
      | (() => void)
      | undefined
    expect(topOnClose).toBeDefined()
    const ccBefore = hr.cc()
    topOnClose!()
    // onClose for browser does clear, so cc should increment
    expect(hr.cc()).toBe(ccBefore + 1)
    expect(hr.dlg.open).toBe(false)
    // second Escape should be idempotent
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
    const dir = mkdtempSync(join(tmpdir(), "tm-lc-"))
    const hostDir = mkdtempSync(join(tmpdir(), "tm-lh-"))
    const w = mkdtempSync(join(tmpdir(), "tm-lw-"))
    ensureGit(dir)
    ensureGit(hostDir)
    ensureGit(w)
    const hr = hostRealContract()
    // Make project.list slow so we can close during loading
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
    // Immediately close while still loading
    const loadingView = hr.get()
    const closeOpt = loadingView.options.find((o) => o.value === "__close")
    // For project detail loading, options are Loading... without close? Check buildProjectOptions: loading has no close, only Overview.
    // Root loading also has no close? Actually root loading has no close either.
    // So we test that closing via onClose during loading still prevents reopen.
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
