/** @jsxImportSource @opentui/solid */
/**
 * Projects list dialog.
 * First paint from project.list + current pin; provisional filters via
 * sync eligibility (exists, directory, .git, not /, not HOME, not ~/foo);
 * async probe filters to V2 limit-1 session presence (api.client.v2.session.list({project,limit:1})).
 * Title is count only; no Overview tokens/cost.
 */

import { textColumns, truncateToColumns } from "../text"
import { createBrowserActivity } from "./browser-activity"
import { withConcurrency } from "./concurrency"
import { BROWSER_CONCURRENCY, FETCH_TIMEOUT_MS, NAV } from "./constants"
import { iso } from "./dialog-shared"
import { isEligibleProjectPath } from "./eligibility"
import { isSafeDirectory } from "./is-safe-directory"
import { showProjectDetail } from "./project-dialog"
import { withTimeout } from "./timeout"
import type { BrowserDialogApi } from "./types"

function probeHasSessionsV2(
  api: BrowserDialogApi,
  projectID: string,
): Promise<boolean | null> {
  const v2 = (
    api as unknown as { client: { v2?: { session?: { list?: unknown } } } }
  ).client.v2?.session
  const fn = v2?.list as
    | ((p: Record<string, unknown>) => Promise<unknown>)
    | undefined
  if (typeof fn !== "function") return Promise.resolve(null)
  return withTimeout(
    fn.call(v2, { project: projectID, limit: 1 }) as Promise<unknown>,
    FETCH_TIMEOUT_MS,
  )
    .then((res) => {
      if (!res || typeof res !== "object") return null
      const d1 = (res as Record<string, unknown>).data
      let arr: unknown[] | null = null
      if (Array.isArray(d1)) arr = d1
      else if (d1 && typeof d1 === "object") {
        const inner = (d1 as Record<string, unknown>).data
        if (Array.isArray(inner)) arr = inner as unknown[]
      }
      if (arr === null) return null
      return arr.length > 0
    })
    .catch(() => null)
}

type BrowserRow = {
  id: string
  label: string
  lastActive: number
  isCurrent: boolean
}

function buildBrowserOptions(
  data: BrowserRow[] | null,
  error: string | null,
  loading: boolean,
): {
  title: string
  options: Array<{
    title: string
    value: string
    description?: string
    category?: string
    disabled?: boolean
  }>
} {
  let t = "TokenMeter: Browse Usage"
  let o: Array<{
    title: string
    value: string
    description?: string
    category?: string
    disabled?: boolean
  }> = []
  if (loading) {
    t = "TokenMeter: Browse Usage — loading…"
    o = [
      { title: "Loading projects…", value: "__loading", category: "Overview" },
    ]
  } else if (error) {
    o = [
      { title: error, value: "__error", category: "Overview" },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else if (!data || data.length === 0) {
    o = [
      { title: "No projects found", value: "__empty", category: "Overview" },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else {
    t = `TokenMeter: Browse Usage (${data.length})`
    const cur = data.find((r) => r.isCurrent) ?? null
    const others = data.filter((r) => !r.isCurrent)
    const list: typeof o = []
    if (cur)
      list.push({
        title: `★ ${truncateToColumns(cur.label, 24)}`,
        value: cur.id,
        description: cur.lastActive ? iso(cur.lastActive) : "—",
        category: "Current Project",
      })
    for (let i = 0; i < others.length; i++) {
      const r = others[i]!
      list.push({
        title: truncateToColumns(r.label, 24),
        value: r.id,
        description: r.lastActive ? iso(r.lastActive) : "—",
        category: i === 0 ? "Projects" : undefined,
      })
    }
    if (!cur && list.length > 0 && !list[0]!.category)
      list[0]!.category = "Projects"
    else if (cur && others.length > 0) {
      const f = list.find((x) => others.some((o) => o.id === x.value))
      if (f) f.category = "Projects"
    }
    o = [...list, { title: "× Close", value: "__close", category: NAV }]
  }
  return { title: t, options: o }
}

export function showBrowserDialog(api: BrowserDialogApi): void {
  const activity = createBrowserActivity(api)
  const { isActive, deactivate, close, onClose, withSuppress } = activity
  const render = (
    loading: boolean,
    error: string | null,
    data: BrowserRow[] | null,
  ) => {
    const { title, options } = buildBrowserOptions(data, error, loading)
    return (
      <api.ui.DialogSelect
        title={title}
        options={options}
        onSelect={(x) => {
          if (!x) return
          if (x.value === "__close") {
            close()
            return
          }
          if (x.value.startsWith("__")) return
          const sel = data?.find((r) => r.id === x.value)
          if (sel) {
            deactivate()
            showProjectDetail(api, sel.id)
          }
        }}
      />
    )
  }
  api.ui.dialog.replace(() => render(true, null, null), onClose)
  void (async () => {
    try {
      const rawList = (await withTimeout(
        api.client.project.list() as unknown as Promise<{ data?: unknown }>,
        FETCH_TIMEOUT_MS,
      )) as { data?: unknown }
      const projects = rawList?.data as
        | Array<{
            id: string
            name?: string
            worktree?: string
            time?: { created?: number; updated?: number }
          }>
        | undefined
      if (!Array.isArray(projects)) throw new Error("Unable to load projects")
      let currentID: string | null = null
      try {
        const hostDir = (
          api as unknown as { state: { path: { directory: string } } }
        ).state.path.directory as string
        if (isSafeDirectory(hostDir)) {
          const cur = (await withTimeout(
            api.client.project.current({
              directory: hostDir,
            }) as unknown as Promise<{ data?: { id?: string } }>,
            FETCH_TIMEOUT_MS,
          )) as { data?: { id?: string } }
          currentID = cur?.data?.id ?? null
        }
      } catch {
        currentID = null
      }
      const rowsRaw: Array<{
        id: string
        label: string
        lastActive: number
        isCurrent: boolean
        worktree?: string
      }> = []
      for (const proj of projects) {
        const pid = (proj as { id?: unknown })?.id as string | undefined
        if (typeof pid !== "string" || !pid) continue
        const label =
          typeof (proj as { name?: unknown }).name === "string" &&
          (proj as { name: string }).name.trim()
            ? (proj as { name: string }).name.trim()
            : (proj as { worktree?: string }).worktree
                ?.split("/")
                .pop()
                ?.trim() || pid
        const created =
          typeof (proj as { time?: { created?: unknown } }).time?.created ===
          "number"
            ? (proj as { time: { created: number } }).time.created
            : 0
        const updated =
          typeof (proj as { time?: { updated?: unknown } }).time?.updated ===
          "number"
            ? (proj as { time: { updated: number } }).time.updated
            : created
        rowsRaw.push({
          id: pid,
          label,
          lastActive: updated,
          isCurrent: pid === currentID,
          worktree: (proj as { worktree?: string }).worktree,
        })
      }
      // Provisional eligible list: sync filesystem eligibility (exists, directory, .git, not / or HOME or ~/foo).
      // Invalid/deleted entries never flash.
      const eligibleRows = rowsRaw.filter((row) => {
        if (
          typeof row.worktree === "string" &&
          isEligibleProjectPath(row.worktree)
        )
          return true
        if (row.isCurrent) {
          try {
            const host = (
              api as unknown as { state: { path: { directory: string } } }
            ).state.path.directory as string
            if (isEligibleProjectPath(host)) return true
          } catch {}
        }
        return false
      })
      const provisionalSafe: BrowserRow[] = eligibleRows.map((row) => ({
        id: row.id,
        label: row.label,
        lastActive: row.lastActive,
        isCurrent: row.isCurrent,
      }))
      const curProv = provisionalSafe.filter((r) => r.isCurrent)
      const restProv = provisionalSafe
        .filter((r) => !r.isCurrent)
        .sort((a, b) => b.lastActive - a.lastActive)
      const provisionalOrdered = [...curProv, ...restProv]
      if (isActive()) {
        withSuppress(() =>
          api.ui.dialog.replace(
            () => render(false, null, provisionalOrdered),
            onClose,
          ),
        )
      }
      const filtered: BrowserRow[] = []
      await withConcurrency(eligibleRows, BROWSER_CONCURRENCY, async (row) => {
        let probe: boolean | null = null
        try {
          probe = await probeHasSessionsV2(api, row.id)
        } catch {
          probe = null
        }
        if (probe === false) return
        filtered.push({
          id: row.id,
          label: row.label,
          lastActive: row.lastActive,
          isCurrent: row.isCurrent,
        })
      }).catch(() => {})
      const curRows = filtered.filter((r) => r.isCurrent)
      const rest = filtered
        .filter((r) => !r.isCurrent)
        .sort((a, b) => b.lastActive - a.lastActive)
      const ordered = [...curRows, ...rest]
      if (!isActive()) return
      withSuppress(() =>
        api.ui.dialog.replace(() => render(false, null, ordered), onClose),
      )
    } catch {
      if (!isActive()) return
      withSuppress(() =>
        api.ui.dialog.replace(
          () => render(false, "Unable to load projects", []),
          onClose,
        ),
      )
    }
  })().catch(() => {})
}
