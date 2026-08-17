// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * TokenMeter inline prompt metric — the host `session_prompt_right` slot
 * render.
 *
 * The host keeps its SINGLE native `api.ui.Prompt`: the `session_prompt`
 * replace slot is deliberately NOT registered, so `replace` mode falls
 * through to the host's own prompt — which already renders its own native
 * usage/status row (`context · cost` in the prompt's bottom status row), so
 * any plugin-side prompt re-render or appended status row would duplicate
 * it. The host renders `session_prompt_right` INSIDE that one prompt, at the
 * right end of its agent/model meta row (the native `right` prop), so this
 * component is only a compact single-line readout of the CURRENT session's
 * OWN token spend — never a second prompt, never a second status row.
 *
 * Accounting: the canonical root/current-session-only high-water read
 * (`store.observedSessionUsage`), NEVER the snapshot aggregates (those
 * include the complete recursive delegation tree and belong to the sidebar
 * `Session` section). Values come from the per-field high-water, so
 * compaction or a smaller later snapshot can never lower the line.
 *
 * Reactivity: the session comes from the slot props (`session_id`), which
 * the host derives from the visible route — no route guessing here.
 * Repaints are pulsed by the `snapshot` signal: reconcile publishes a fresh
 * snapshot whenever the active root has usage, and the memo re-reads
 * `observedSessionUsage` on that pulse. A disabled footer, or a session
 * without observed usage, renders nothing (the host prompt stays intact).
 * Home has no session_prompt_right render, so no Home metric is invented:
 * issue #24 measures the active session only.
 *
 * Width: the metric shares the native prompt's agent/model row, which spans
 * the terminal width, so the reactive terminal width is the truncation
 * ceiling; the pure formatter truncates with `…` so the line never wraps or
 * overflows the host row.
 */

import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { formatFooterLine } from "../footer"
import { settings } from "../settings"
import { observedSessionUsage, snapshot } from "../store"

export function SessionPromptRight(props) {
  const theme = () => props.api.theme.current

  // Root-session-only high-water usage of the slot's current session. The
  // `snapshot()` read is the reactive pulse: reconcile publishes a fresh
  // snapshot whenever the active root has usage, so this memo re-runs and
  // re-reads the authoritative per-session accounting on every repaint.
  const usage = createMemo(() => {
    const sid = props.sessionID
    if (!sid) return null
    snapshot()
    return observedSessionUsage(sid)
  })

  // Truncation ceiling: the metric sits at the right end of the native
  // prompt's agent/model row, which spans the terminal width.
  const dimensions = useTerminalDimensions()

  const line = createMemo(() => {
    if (!settings().footer.enabled) return ""
    const u = usage()
    if (!u) return ""
    return formatFooterLine(
      u,
      settings().footer,
      settings().numbers,
      dimensions().width,
    )
  })

  return (
    <Show when={line()}>
      {(text) => (
        <text fg={theme().textMuted} wrapMode="none">
          {text()}
        </text>
      )}
    </Show>
  )
}
