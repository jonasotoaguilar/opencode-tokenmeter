/** @jsxImportSource @opentui/solid */
/**
 * Projects list dialog.
 * First paint from project.list + current pin; async probe filters
 * to existing directories with a nonempty limit-1 session probe.
 * Title is count only; no Overview tokens/cost.
 */

import { textColumns, truncateToColumns } from "../text"
import { withConcurrency } from "./concurrency"
import { BROWSER_CONCURRENCY, FETCH_TIMEOUT_MS, NAV } from "./constants"
import { dirExists, iso } from "./dialog-shared"
import { resolveBrowseDirectory } from "./directories"
import { isSafeDirectory } from "./is-safe-directory"
import { showProjectDetail } from "./project-dialog"
import { withTimeout } from "./timeout"
import type { BrowserDialogApi } from "./types"

function probeHasSessions(
  api: BrowserDialogApi,
  directory: string,
): Promise<boolean> {
  if (!isSafeDirectory(directory)) return Promise.resolve(false)
  return withTimeout(
    (
      api.client.session.list as (
        p: Record<string, unknown>,
      ) => Promise<unknown>
    ).call(api.client.session, {
      directory,
      scope: "project",
      limit: 1,
    }) as Promise<{ data?: unknown }>,
    FETCH_TIMEOUT_MS,
  )
    .then((res) => {
      const data = (res as { data?: unknown })?.data as unknown[] | undefined
      return Array.isArray(data) && data.length > 0
    })
    .catch(() => false)
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
        category: "Current",
      })
    for (let i = 0; i < others.length; i++) {
      const r = others[i]!
      list.push({
        title: truncateToColumns(r.label, 24),
        value: r.id,
        description: r.lastActive ? iso(r.lastActive) : "—",
        category: i === 0 ? "Others" : undefined,
      })
    }
    if (!cur && list.length > 0 && !list[0]!.category)
      list[0]!.category = "Others"
    else if (cur && others.length > 0) {
      const f = list.find((x) => others.some((o) => o.id === x.value))
      if (f) f.category = "Others"
    }
    o = [...list, { title: "× Close", value: "__close", category: NAV }]
  }
  return { title: t, options: o }
}

export function showBrowserDialog(api: BrowserDialogApi): void {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    api.ui.dialog.clear()
  }
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
          if (sel) showProjectDetail(api, sel.id)
        }}
      />
    )
  }
  api.ui.dialog.replace(() => render(true, null, null), close)
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
      const filtered: BrowserRow[] = []
      await withConcurrency(rowsRaw, BROWSER_CONCURRENCY, async (row) => {
        let dir: string | null = null
        try {
          dir = await resolveBrowseDirectory(
            api,
            row.id,
            row.worktree,
            currentID,
          )
        } catch {
          dir = null
        }
        if (!dir || !isSafeDirectory(dir)) return
        if (!dirExists(dir)) return
        let has = false
        try {
          has = await probeHasSessions(api, dir)
        } catch {
          has = false
        }
        if (!has) return
        filtered.push({
          id: row.id,
          label: row.label,
          lastActive: row.lastActive,
          isCurrent: row.isCurrent,
        })
      })
      const curRows = filtered.filter((r) => r.isCurrent)
      const rest = filtered
        .filter((r) => !r.isCurrent)
        .sort((a, b) => b.lastActive - a.lastActive)
      const ordered = [...curRows, ...rest]
      if (closed) return
      api.ui.dialog.replace(() => render(false, null, ordered), close)
    } catch {
      if (closed) return
      api.ui.dialog.replace(
        () => render(false, "Unable to load projects", []),
        close,
      )
    }
  })()
}
