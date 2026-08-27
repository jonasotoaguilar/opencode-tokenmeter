/** @jsxImportSource @opentui/solid */
/**
 * Project detail dialog.
 * Shows sidebar-style Overview aggregated from sidebar pipeline plus
 * a selectable ROOT-only session list with title root count and
 * compact/precise/cache settings. Supports Back/Close and once-guarded close.
 */

import { textColumns, truncateToColumns } from "../text"
import { NAV } from "./constants"
import { iso, overviewRows } from "./dialog-shared"
import { type BrowserProjectDetail, loadProjectDetail } from "./project-detail"
import { showBrowserDialog } from "./projects-dialog"
import { showSessionDetail } from "./session-dialog"
import type { BrowserDialogApi } from "./types"

function buildProjectOptions(
  detail: BrowserProjectDetail | null,
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
  let t = "TokenMeter: Project"
  let o: Array<{
    title: string
    value: string
    description?: string
    category?: string
    disabled?: boolean
  }> = []
  if (loading) {
    t = "TokenMeter: Project — loading…"
    o = [
      { title: "Loading sessions…", value: "__loading", category: "Overview" },
    ]
  } else if (error) {
    o = [
      { title: error, value: "__error", category: "Overview" },
      { title: "← Back to projects", value: "__back", category: NAV },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else if (!detail) {
    o = [
      {
        title: "Unable to load project",
        value: "__error",
        category: "Overview",
      },
      { title: "← Back to projects", value: "__back", category: NAV },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else {
    const count = detail.sessions.length
    const suffix = ` (${count})`
    const prefix = "TokenMeter: "
    const maxTitleCols = 46
    const maxLabelCols = Math.max(
      8,
      maxTitleCols - textColumns(prefix) - textColumns(suffix),
    )
    const name = truncateToColumns(detail.label, maxLabelCols)
    t = `TokenMeter: ${name}${suffix}`
    const ov: typeof o = [...overviewRows(detail.usage)]
    if (detail.period) {
      const s = iso(detail.period.start)
      const eIso = iso(detail.period.end)
      if (s !== "—" && eIso !== "—") {
        ov.push({
          title: `Period: ${s} → ${eIso}`,
          value: "__period",
          category: "Overview",
        })
      }
    }
    ov.push({
      title: `Sessions: ${detail.usage.sessions}`,
      value: "__sessions",
      category: "Overview",
    })
    const cur = detail.sessions.find((s) => s.isCurrent) ?? null
    const others = detail.sessions.filter((s) => !s.isCurrent)
    if (detail.sessions.length === 0) {
      o = [
        ...ov,
        { title: "No sessions found", value: "__empty", category: "Sessions" },
        { title: "← Back to projects", value: "__back", category: NAV },
        { title: "× Close", value: "__close", category: NAV },
      ]
    } else {
      const rows: typeof o = []
      if (cur)
        rows.push({
          title: `★ ${truncateToColumns(cur.title?.trim() ? cur.title!.trim() : cur.id, 24)}`,
          value: cur.id,
          description: cur.time.updated ? iso(cur.time.updated) : "—",
          category: "Current Session",
        })
      for (let i = 0; i < others.length; i++) {
        const s = others[i]!
        rows.push({
          title: truncateToColumns(
            s.title?.trim() ? s.title!.trim() : s.id,
            24,
          ),
          value: s.id,
          description: s.time.updated ? iso(s.time.updated) : "—",
          category:
            i === 0 && !cur
              ? "Sessions"
              : rows.length === 0 || (cur && i === 0)
                ? "Sessions"
                : undefined,
        })
      }
      if (!cur && rows.length > 0 && !rows[0]!.category)
        rows[0]!.category = "Sessions"
      else if (cur && others.length > 0) {
        const idx = rows.findIndex((r) => others.some((x) => x.id === r.value))
        if (idx >= 0) rows[idx]!.category = "Sessions"
      }
      o = [
        ...ov,
        ...rows,
        { title: "← Back to projects", value: "__back", category: NAV },
        { title: "× Close", value: "__close", category: NAV },
      ]
    }
  }
  return { title: t, options: o }
}

export function showProjectDetail(api: BrowserDialogApi, pid: string): void {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    api.ui.dialog.clear()
  }
  const render = (
    loading: boolean,
    error: string | null,
    detail: BrowserProjectDetail | null,
  ) => {
    const { title, options } = buildProjectOptions(detail, error, loading)
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
          if (x.value === "__back") {
            showBrowserDialog(api)
            return
          }
          if (x.value.startsWith("__")) return
          const s = detail?.sessions.find((v) => v.id === x.value)
          if (s) showSessionDetail(api, s.id, detail!.id)
        }}
      />
    )
  }
  api.ui.dialog.replace(() => render(true, null, null), close)
  void (async () => {
    let detail: BrowserProjectDetail | null = null
    let error: string | null = null
    try {
      detail = await loadProjectDetail(
        api as unknown as import("./types").BrowserApi,
        pid,
      )
    } catch {
      error = "Unable to load project"
      detail = null
    }
    if (closed) return
    api.ui.dialog.replace(() => render(false, error, detail), close)
  })()
}
