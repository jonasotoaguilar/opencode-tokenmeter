// biome-ignore-all lint/style/noNonNullAssertion: harness uses controlled latency
// biome-ignore-all format: compact harness for budget
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NAV } from "../src/tokenmeter/browser/constants"
import { showProjectDetail } from "../src/tokenmeter/browser/project-dialog"
import { showBrowserDialog } from "../src/tokenmeter/browser/projects-dialog"
import { showSessionDetail } from "../src/tokenmeter/browser/session-dialog"
import { clearPricing } from "../src/tokenmeter/pricing"
import { __setPricingFetchForTest, clearRemotePricing } from "../src/tokenmeter/pricing-remote"

function stubPricing(){ clearPricing(); clearRemotePricing(); __setPricingFetchForTest((async () => ({ ok: true, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch) }
function delay<T>(ms: number, v: T): Promise<T> { return new Promise((r) => setTimeout(() => r(v), ms)) }

function ensureGit(p:string){ try{ const {mkdirSync}=require("node:fs") as typeof import("node:fs"); const {join}=require("node:path") as typeof import("node:path"); mkdirSync(join(p,".git"),{recursive:true})}catch{} }
function makePerfHarness(N = 28, probeMs = 100, listMs = 8, curMs = 8, extras: Partial<{ emptyWorktreeFor: string; noSessionFor: string }> = {}) { stubPricing();
  const stateDir = mkdtempSync(join(tmpdir(), "perf-state-"))
  const hostDir = mkdtempSync(join(tmpdir(), "perf-host-"))
  ensureGit(hostDir)
  const worktrees: string[] = []
  const projects: Array<{ id: string; name: string; worktree: string; time: { created: number; updated: number } }> = []
  for (let i = 0; i < N; i++) {
    const wt = mkdtempSync(join(tmpdir(), `perf-wt-${i}-`))
    ensureGit(wt)
    worktrees.push(wt)
    const worktree = extras.emptyWorktreeFor === `proj-${i.toString().padStart(2, "0")}` ? "/nope-xyz" : wt
    projects.push({ id: `proj-${i.toString().padStart(2, "0")}`, name: `proj-${i}`, worktree, time: { created: 1_700_000_000_000 + i * 1000, updated: 1_700_000_100_000 + i * 1000 } })
  }
  const currentID = projects[0]!.id
  let listCalls = 0, curCalls = 0, v2Calls = 0
  type Cap = { title: string; options: Array<{ title: string; value: string; category?: string }>; onSelect?: (o: { title: string; value: string }) => void }
  const caps: Array<{ t: number; cap: Cap }> = []
  let replaceCount = 0
  let clearCount = 0
  let start = performance.now()
  let captured: Cap | null = null
  let onCloseCalls = 0
  const stack: Array<{ render: () => unknown; onClose?: () => void }> = []
  const api = {
    state: { path: { directory: hostDir, state: stateDir } },
    client: {
      project: {
        list: async () => { listCalls++; return delay(listMs, { data: projects } as never) },
        current: async () => { curCalls++; return delay(curMs, { data: { id: currentID } } as never) },
      },
      session: {
        list: async () => ({ data: [] } as never),
        get: async (p: Record<string, unknown>) => ({ data: { id: p.sessionID, projectID: currentID, title: "one", time: { created: 1, updated: 2 }, tokens: { input: 10, output: 5 }, cost: 0.1, model: { providerID: "openai", id: "gpt-4o" } } } as never),
        messages: async () => ({ data: [] } as never),
        children: async () => ({ data: [] } as never),
      },
      model: { list: async () => ({ data: [] }) },
      v2: { model: { list: async () => ({ data: [] }) }, session: { list: async (p: Record<string, unknown>) => { v2Calls++; await delay(probeMs, null); const pid = p.project as string; if (extras.noSessionFor && pid === extras.noSessionFor) return { data: [] } as never; if (pid && projects.some(pr => pr.id === pid)) { const wt = projects.find(pr => pr.id === pid)?.worktree; if (wt === "/nope-xyz") return { data: [] } as never; return { data: [{ id: `s-${pid.slice(-4)}` }] } as never } return { data: [] } as never } } },
    },
    route: { current: { params: { sessionID: "s1" } } },
    currentSessionID: "s1",
    ui: {
      dialog: {
        replace(r: () => unknown, c?: () => void) {
          replaceCount++
          stack.splice(0, stack.length, { render: r, onClose: c })
          try { (r as () => unknown)() } catch {}
          const cCap = captured
          if (cCap) {
            caps.push({ t: performance.now() - start, cap: { ...cCap, options: [...cCap.options] } })
            captured = null
          }
        },
        clear() {
          const closers = stack.map((s) => s.onClose).filter(Boolean) as (() => void)[]
          const had = stack.length > 0
          stack.splice(0, stack.length)
          if (had) clearCount++
          for (const fn of closers) { try { onCloseCalls++; fn() } catch {} }
        },
        get depth() { return stack.length },
        get open() { return stack.length > 0 },
      },
      DialogSelect: (props: Cap) => { captured = props; return null as never },
      toast() {},
    },
  } as never
  const get = () => {
    if (!stack[0]) throw new Error("no render")
    ;(stack[0].render as () => unknown)()
    const v = captured!
    captured = null
    return v
  }
  const getCaps = () => caps
  return { api, get, getCaps, hostDir, stateDir, worktrees, projects, currentID, counts: () => ({ listCalls, curCalls, v2Calls, replaceCount, clearCount, onCloseCalls }), start: () => start, resetStart: () => { start = performance.now() }, cleanup() { for (const d of [stateDir, hostDir, ...worktrees]) try { rmSync(d, { recursive: true, force: true }) } catch {} } }
}

describe("perf P0: Usage first paint", () => {
  // Baseline (main, legacy): 58 calls (list 1 + current 1 + directories 28 + session.list(directory) 28), first usable 18.8ms after P0, settlement ≤900ms, 3 replaces.
  // Candidate (V2): 30 calls (list 1 + current 1 + v2.session.list({project,limit:1}) 28), provisional ≤100ms, final ≤900ms, same replaces.
  test("provisional usable ≤100ms, final ≤900ms, 30 V2 calls", async () => {
    const h = makePerfHarness(28, 100, 8, 8)
    const start = performance.now()
    h.resetStart()
    showBrowserDialog(h.api)
    // provisional should appear quickly: poll via get()
    let provCap: { title: string } | null = null
    let provAt = -1
    for (let i = 0; i < 30; i++) {
      await delay(5, null)
      try {
        const cur = h.get()
        if (cur.title.startsWith("TokenMeter: Browse Usage (") && !cur.title.includes("loading")) {
          if (!provCap) { provCap = cur; provAt = performance.now() - start }
        }
      } catch {}
      if (provCap) break
    }
    expect(provCap).not.toBeNull()
    expect(provAt).toBeLessThanOrEqual(100)
    expect(provCap!.title).toBe("TokenMeter: Browse Usage (28)")
    // capture caps timing via internal getCaps which records on get() already
    // wait for final filtered to settle
    await delay(1000, null)
    const caps = h.getCaps()
    const usable = caps.filter(c => c.cap.title.startsWith("TokenMeter: Browse Usage (") && !c.cap.title.includes("loading"))
    expect(usable.length).toBeGreaterThanOrEqual(2)
    const finalCap = usable[usable.length - 1]!
    expect(finalCap.cap.title).toBe("TokenMeter: Browse Usage (28)")
    expect(finalCap.t).toBeLessThanOrEqual(900)
    const c = h.counts()
    expect(c.listCalls).toBe(1)
    expect(c.curCalls).toBe(1)
    expect(c.v2Calls).toBe(28)
    expect(c.listCalls + c.curCalls + c.v2Calls).toBe(30)
    expect(h.get().options.some((o: { value: string }) => o.value === "/")).toBe(false)
    h.cleanup()
  })

  test("late probe does not replace navigated project detail", async () => {
    const h = makePerfHarness(28, 100, 8, 8)
    showBrowserDialog(h.api)
    await delay(40, null)
    // navigate before probes finish: select provisional project
    const cur = h.get()
    expect(cur.title).toContain("Browse Usage")
    const opt = cur.options.find(o => o.value.startsWith("proj-"))!
    expect(opt).toBeDefined()
    // onSelect deactivates browser before project detail
    cur.onSelect!({ title: opt.title, value: opt.value } as never)
    // project detail should be loading then loaded, not overwritten by browser late probe
    await delay(30, null)
    const proj = h.get()
    // project detail title is "TokenMeter: <label> (count)" or "TokenMeter: Project — loading…"
    expect(proj.title.startsWith("TokenMeter:")).toBe(true)
    expect(proj.title).not.toContain("Browse Usage")
    // wait for background probes to settle (they would have tried to replace browser at ~720ms)
    await delay(900, null)
    const after = h.get()
    // must still be project detail, not browser
    expect(after.title.startsWith("TokenMeter:")).toBe(true)
    expect(after.title).not.toContain("Browse Usage")
    // Back creates fresh browser generation
    const backOpt = after.options.find(o => o.value === "__back")!
    expect(backOpt).toBeDefined()
    backOpt && (after as { onSelect?: (o: never) => void }).onSelect?.({ title: backOpt.title, value: backOpt.value } as never)
    await delay(40, null)
    const back = h.get()
    expect(back.title).toContain("Browse Usage")
    // selecting close deactivates and clears once
    const closeOpt = back.options.find(o => o.value === "__close")!
    const beforeClear = h.counts().clearCount
    const beforeOnClose = h.counts().onCloseCalls
    ;(back as { onSelect?: (o: never) => void }).onSelect?.({ title: closeOpt.title, value: closeOpt.value } as never)
    expect(h.counts().clearCount).toBe(beforeClear + 1)
    expect(h.counts().onCloseCalls).toBe(beforeOnClose + 1)
    // duplicate close must be idempotent
    const dupClear = h.counts().clearCount
    ;(back as { onSelect?: (o: never) => void }).onSelect?.({ title: closeOpt.title, value: closeOpt.value } as never)
    expect(h.counts().clearCount).toBe(dupClear)
    // late probe must not reopen browser
    await delay(900, null)
    // dialog should still be cleared (no render) or still closed; get should throw
    let threw = false
    try { h.get() } catch { threw = true }
    expect(threw).toBe(true)
    h.cleanup()
  })

  test("provisional uses only eligible worktree evidence (git, not HOME child), background V2 filters empty", async () => {
    stubPricing();
    // One project with unsafe worktree, one with missing .git, and empty-session project filtered finally; eligible requires .git and not direct HOME child.
    const stateDir = mkdtempSync(join(tmpdir(), "perf-state-"))
    const hostDir = mkdtempSync(join(tmpdir(), "perf-host-"))
    ensureGit(hostDir)
    const good = mkdtempSync(join(tmpdir(), "perf-good-"))
    ensureGit(good)
    const empty = mkdtempSync(join(tmpdir(), "perf-empty-"))
    ensureGit(empty)
    const noGit = mkdtempSync(join(tmpdir(), "perf-nogit-"))
    // no .git for noGit -> ineligible
    const projects = [
      { id: "proj-good", name: "good", worktree: good, time: { created: 1, updated: 10 } },
      { id: "proj-unsafe", name: "bad", worktree: "/", time: { created: 1, updated: 9 } },
      { id: "proj-empty", name: "empty", worktree: empty, time: { created: 1, updated: 8 } },
      { id: "proj-nogit", name: "nogit", worktree: noGit, time: { created: 1, updated: 7 } },
    ]
    type Cap = { title: string; options: Array<{ title: string; value: string; category?: string }>; onSelect?: (o: never) => void }
    let captured: Cap | null = null
    const stack: Array<{ render: () => unknown; onClose?: () => void }> = []
    const api = {
      state: { path: { directory: hostDir, state: stateDir } },
      client: {
        project: {
          list: async () => ({ data: projects } as never),
          current: async () => ({ data: { id: "proj-good" } } as never),
        },
        session: { list: async () => ({ data: [] } as never) },
        v2: { session: { list: async (p: Record<string, unknown>) => { const pid = p.project as string; if (pid === "proj-good") return { data: [{ id: "s1" }] } as never; if (pid === "proj-empty") return { data: [] } as never; if (pid === "proj-nogit") return { data: [{ id: "s1" }] } as never; return { data: [] } as never } } },
      },
      ui: { dialog: { replace(r: () => unknown, c?: () => void) { stack.splice(0, stack.length, { render: r, onClose: c }) }, clear() { stack.splice(0, stack.length) } }, DialogSelect: (props: Cap) => { captured = props; return null as never }, toast() {} },
    } as never
    const get = () => { if (!stack[0]) throw new Error("no render"); (stack[0].render as () => unknown)(); const v = captured!; captured = null; return v }
    showBrowserDialog(api as never)
    await delay(60, null)
    const prov = get()
    // provisional uses only synchronous safe evidence: good and empty are safe, unsafe "/" excluded; all appear provisionally before session probe
    // empty has session empty, so provisionally it WOULD appear (safe dir) then be filtered; but our earlier harness had empty session probe empty -> provisionally includes empty
    // Check that unsafe never appears provisionally
    expect(prov.options.some(o => o.value === "proj-unsafe")).toBe(false)
    expect(prov.options.some(o => o.value === "proj-good")).toBe(true)
    // empty may or may not be present provisionally depending on isSafeDirectory; it is safe so should be present before filtering
    // Do not assert strict empty provisional presence if timing races; instead check final filtering
    await delay(500, null)
    const fin = get()
    // final should have filtered empty-session project out, still not unsafe/nogit (nogit ineligible never appears)
    expect(fin.options.some(o => o.value === "proj-good")).toBe(true)
    expect(fin.options.some(o => o.value === "proj-empty")).toBe(false)
    expect(fin.options.some(o => o.value === "proj-unsafe")).toBe(false)
    expect(fin.options.some(o => o.value === "proj-nogit")).toBe(false)
    expect(fin.title).toBe("TokenMeter: Browse Usage (1)")
    for (const d of [stateDir, hostDir, good, empty, noGit]) try { rmSync(d, { recursive: true, force: true }) } catch {}
  })

  test("no unhandled rejection and no extra replace loops (≤3 replaces)", async () => {
    const h = makePerfHarness(5, 50, 2, 2)
    // track unhandled rejections
    let unhandled = false
    const handler = () => { unhandled = true }
    process.on("unhandledRejection", handler)
    showBrowserDialog(h.api)
    await delay(500, null)
    process.off("unhandledRejection", handler)
    expect(unhandled).toBe(false)
    expect(h.counts().replaceCount).toBeLessThanOrEqual(3)
    expect(h.counts().replaceCount).toBeGreaterThanOrEqual(2)
    h.cleanup()
  })
})
