// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * TokenMeter footer segment — the host `app_bottom` slot render.
 *
 * A compact single-line readout of the CURRENTLY VISIBLE route session's
 * OWN token spend: the canonical root/current-session-only high-water read
 * (`store.observedSessionUsage`), NEVER the snapshot aggregates (those
 * include the complete recursive delegation tree and belong to the
 * sidebar `Session` section). Values come from the per-field high-water, so
 * compaction or a smaller later snapshot can never lower the line.
 *
 * Reactivity: the route session is tracked through `api.route.current`
 * (same seam as the entry's activation effect), so a route/session switch
 * re-evaluates the memo and the footer swaps or disappears without
 * remounting. Repaints are pulsed by the `snapshot` signal: reconcile
 * publishes a fresh snapshot whenever the active root has usage, and the
 * memo re-reads `observedSessionUsage` on that pulse. Off-route (home), a
 * disabled footer, or a session without observed usage all render nothing.
 *
 * Width: the `app_bottom` box spans the whole terminal, so the terminal
 * width (reactive `useTerminalDimensions`) is the line budget; the pure
 * formatter truncates with `…` so the line never wraps or overflows the
 * host footer.
 */

import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { formatFooterLine } from "../footer"
import { settings } from "../settings"
import { observedSessionUsage, snapshot } from "../store"

export function UsageFooter(props) {
  const theme = () => props.theme()

  // The active route session, tracked reactively; null off-session.
  const sessionID = createMemo(() => {
    const route = props.api.route.current
    return route?.name === "session" ? (route.params?.sessionID ?? null) : null
  })

  // Root-session-only high-water usage of the visible route session. The
  // `snapshot()` read is the reactive pulse: reconcile publishes a fresh
  // snapshot whenever the active root has usage, so this memo re-runs and
  // re-reads the authoritative per-session accounting on every repaint.
  const usage = createMemo(() => {
    const sid = sessionID()
    if (!sid) return null
    snapshot()
    return observedSessionUsage(sid)
  })

  // Line budget: the app_bottom box spans the terminal width.
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
      {(text) => <text fg={theme().text}>{text()}</text>}
    </Show>
  )
}
