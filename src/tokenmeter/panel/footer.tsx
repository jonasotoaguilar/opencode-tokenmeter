// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * TokenMeter session-prompt segment — the host `session_prompt` slot render.
 *
 * The host renders `session_prompt` with `replace`: this component IS the
 * native prompt row. It re-renders the host `api.ui.Prompt` faithfully
 * (forwarding every slot prop) and appends a compact single-line readout of
 * the CURRENT session's OWN token spend directly below it inside a zero-gap
 * vertical box, following the reference plugin pattern
 * (`slkiser/opencode-quota` `SessionPromptWithCompactStatus`).
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
 * without observed usage, renders the native prompt alone (the metric line
 * disappears). Home has no session_prompt render, so no Home metric is
 * invented: issue #24 measures the active session only.
 *
 * Width: the prompt row spans the whole terminal, so the terminal width
 * (reactive `useTerminalDimensions`) is the line budget; the pure formatter
 * truncates with `…` so the line never wraps or overflows the host row.
 */

import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { formatFooterLine } from "../footer"
import { settings } from "../settings"
import { observedSessionUsage, snapshot } from "../store"

export function SessionPromptFooter(props) {
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

  // Line budget: the session_prompt row spans the terminal width.
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
    <box gap={0}>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={props.ref}
      />
      <Show when={line()}>
        {(text) => (
          <box flexDirection="row" justifyContent="flex-end">
            <text fg={theme().textMuted} wrapMode="none">
              {text()}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}
