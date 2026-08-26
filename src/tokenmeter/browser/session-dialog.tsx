/** @jsxImportSource @opentui/solid */
/**
 * Session detail dialog.
 * Shows provider/model breakdown sorted by cost, Overview middle-dot,
 * message count and Back/Close navigation with once-guarded close.
 */

import { fmtCompact, fmtCost } from "../numbers"
import { textColumns, truncateToColumns } from "../text"
import { NAV } from "./constants"
import { iso, overviewRows } from "./dialog-shared"
import { showProjectDetail } from "./project-dialog"
import { showBrowserDialog } from "./projects-dialog"
import { loadSessionDetail, type SessionDetail } from "./session-detail"
import type { BrowserDialogApi } from "./types"

function buildSessionOptions(
  detail: SessionDetail | null,
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
  let t = "TokenMeter: Session"
  let o: Array<{
    title: string
    value: string
    description?: string
    category?: string
    disabled?: boolean
  }> = []
  if (loading) {
    t = "TokenMeter: Session — loading…"
    o = [
      { title: "Loading session…", value: "__loading", category: "Overview" },
    ]
  } else if (error) {
    o = [
      { title: error, value: "__error", category: "Overview" },
      { title: "← Back to project", value: "__back", category: NAV },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else if (!detail) {
    o = [
      {
        title: "Unable to load session",
        value: "__error",
        category: "Overview",
      },
      { title: "← Back to project", value: "__back", category: NAV },
      { title: "× Close", value: "__close", category: NAV },
    ]
  } else {
    const raw = detail.title?.trim()
      ? detail.title!.trim()
      : detail.label?.trim()
        ? detail.label.trim()
        : detail.id
    const star = detail.isCurrent ? "★ " : ""
    const prefix = `TokenMeter: ${star}`
    const maxTitleCols = 46
    const maxNameCols = Math.max(8, maxTitleCols - textColumns(prefix))
    const name = truncateToColumns(raw, maxNameCols)
    t = `TokenMeter: ${star}${name}`
    const ov: typeof o = [...overviewRows(detail.usage)]
    const created = detail.time?.created ?? 0
    const last = detail.lastActive ?? detail.time?.updated ?? 0
    if (created > 0 && last > 0) {
      const s = iso(created)
      const eIso = iso(last)
      if (s !== "—" && eIso !== "—") {
        ov.push({
          title: `Period: ${s} → ${eIso}`,
          value: "__period",
          category: "Overview",
        })
      }
    }
    ov.push({
      title: `Messages: ${detail.messageCount}`,
      value: "__messages",
      category: "Overview",
    })
    if (detail.providers.length > 0) {
      for (const p of detail.providers) {
        const provName = truncateToColumns(p.providerID, 30)
        ov.push({
          title: provName,
          value: `__prov:${p.providerID}`,
          category: "Providers",
        })
        ov.push({
          title: `  ${fmtCompact(p.context)} tokens · ${fmtCost(p.cost)} · ${p.count} ${p.count === 1 ? "message" : "messages"}`,
          value: `__prov:${p.providerID}:m`,
          category: "Providers",
        })
        for (const m of p.models) {
          ov.push({
            title: `  └ ${truncateToColumns(m.shortLabel, 30)}`,
            value: `__mod:${p.providerID}:${m.modelID}`,
            category: "Providers",
          })
          ov.push({
            title: `     ${fmtCompact(m.context)} tokens · ${fmtCost(m.cost)} · ${m.count} ${m.count === 1 ? "message" : "messages"}`,
            value: `__mod:${p.providerID}:${m.modelID}:m`,
            category: "Providers",
          })
        }
      }
    }
    o = [
      ...ov,
      { title: "← Back to project", value: "__back", category: NAV },
      { title: "× Close", value: "__close", category: NAV },
    ]
  }
  return { title: t, options: o }
}

export function showSessionDetail(
  api: BrowserDialogApi,
  sid: string,
  pidHint?: string,
): void {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    api.ui.dialog.clear()
  }
  const render = (
    loading: boolean,
    error: string | null,
    detail: SessionDetail | null,
  ) => {
    const { title, options } = buildSessionOptions(detail, error, loading)
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
            const p = detail?.projectID || pidHint
            if (p) showProjectDetail(api, p)
            else showBrowserDialog(api)
            return
          }
          if (x.value.startsWith("__")) return
        }}
      />
    )
  }
  api.ui.dialog.replace(() => render(true, null, null), close)
  void (async () => {
    let detail: SessionDetail | null = null
    let error: string | null = null
    try {
      detail = await loadSessionDetail(
        api as unknown as import("./types").BrowserApi,
        sid,
      )
    } catch {
      error = "Unable to load session"
      detail = null
    }
    if (closed) return
    api.ui.dialog.replace(() => render(false, error, detail), close)
  })()
}
