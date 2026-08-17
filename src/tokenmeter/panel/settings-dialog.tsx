// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * Palette-owned settings menu: a host `DialogSelect` with one option per
 * preference, opened once through `api.ui.dialog.replace`. Selecting an
 * option cycles that preference through the settings module's `cycle*`
 * writers (ready-gated, whole-object `settings.v1` writes); the option
 * titles update REACTIVELY because the render function reads the live
 * signals — the host renders the stack element as a Solid function child,
 * so a signal change re-invokes the render with fresh titles on the SAME
 * DialogSelect instance. The dialog is NEVER replaced after selection:
 * `replace` resets the whole host stack (verified in the host
 * DialogProvider: `setStore("stack", [newItem])`), which would destroy and
 * recreate the DialogSelect — losing its internal filter query and focus.
 * Cancelling closes the dialog without changing anything.
 *
 * Cancel wiring (installed `@opencode-ai/plugin` contract): the host
 * `TuiDialogSelectProps` has no `onCancel` — Escape fires the STACK-level
 * `onClose` of `dialog.replace(render, onClose)`. That hook must not call
 * `clear()` bare: the host's `clear()` invokes each stack item's `onClose`
 * before emptying the stack, so `onClose: () => dialog.clear()` would
 * recurse until the stack empties (host dialog stack verified). The
 * once-guard makes the close idempotent under both `replace`-churn and
 * `clear`-reentrancy.
 */
import {
  cycleCache,
  cycleCollapsedSummary,
  cycleFooter,
  cycleFooterMetric,
  cycleNumbers,
  cycleSubagents,
  settings,
  subagentsPref,
} from "../settings"
import { cycleToggleShortcut, toggleShortcutLabel } from "../shortcut"

/**
 * The host dialog surface the menu needs — a structural subset of
 * `TuiPluginApi` (same pattern as `SettingsApi` in settings.ts). The real
 * `TuiDialogStack`/`DialogSelect` satisfy it structurally.
 */
export type DialogSurface = {
  ui: {
    dialog: {
      replace(render: () => JSX.Element, onClose?: () => void): void
      clear(): void
    }
    DialogSelect: (props: {
      title: string
      options: Array<{ title: string; value: string; category?: string }>
      onSelect?: (option: { title: string; value: string }) => void
    }) => JSX.Element
  }
}

/**
 * Opens the settings DialogSelect exactly once. After an option selection
 * the dialog is NOT re-opened: the titles re-read the live signals inside
 * the render function, so the host's reactive render (same stack entry,
 * same DialogSelect instance) shows the new values while preserving the
 * user's filter query and focus.
 */
export function showSettingsDialog(api: DialogSurface): void {
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    api.ui.dialog.clear()
  }
  api.ui.dialog.replace(
    () => (
      <api.ui.DialogSelect
        title="TokenMeter Settings"
        options={[
          {
            title: `Cache: ${settings().cache}`,
            value: "cache",
            category: "Sidebar",
          },
          {
            title: `Numbers: ${settings().numbers}`,
            value: "numbers",
            category: "Sidebar",
          },
          {
            title: `Summary: ${settings().collapsedSummary}`,
            value: "collapsedSummary",
            category: "Sidebar",
          },
          {
            title: `Subagents: ${subagentsPref()}`,
            value: "subagents",
            category: "Sidebar",
          },
          {
            title: `Shortcut: ${toggleShortcutLabel()}`,
            value: "shortcut",
            category: "Sidebar",
          },
          {
            title: `Footer: ${settings().footer.enabled ? "on" : "off"}`,
            value: "footer",
            category: "Footer",
          },
          {
            title: `Footer input: ${settings().footer.input ? "on" : "off"}`,
            value: "footer.input",
            category: "Footer",
          },
          {
            title: `Footer output: ${settings().footer.output ? "on" : "off"}`,
            value: "footer.output",
            category: "Footer",
          },
          {
            title: `Footer reasoning: ${settings().footer.reasoning ? "on" : "off"}`,
            value: "footer.reasoning",
            category: "Footer",
          },
          {
            title: `Footer cache: ${settings().footer.cache ? "on" : "off"}`,
            value: "footer.cache",
            category: "Footer",
          },
          {
            title: `Footer total: ${settings().footer.total ? "on" : "off"}`,
            value: "footer.total",
            category: "Footer",
          },
        ]}
        onSelect={(option) => {
          if (option.value === "cache") cycleCache(api)
          else if (option.value === "numbers") cycleNumbers(api)
          else if (option.value === "collapsedSummary")
            cycleCollapsedSummary(api)
          else if (option.value === "subagents") cycleSubagents(api)
          else if (option.value === "shortcut") cycleToggleShortcut(api)
          else if (option.value === "footer") cycleFooter(api)
          else if (option.value === "footer.input")
            cycleFooterMetric(api, "input")
          else if (option.value === "footer.output")
            cycleFooterMetric(api, "output")
          else if (option.value === "footer.reasoning")
            cycleFooterMetric(api, "reasoning")
          else if (option.value === "footer.cache")
            cycleFooterMetric(api, "cache")
          else if (option.value === "footer.total")
            cycleFooterMetric(api, "total")
          // Deliberately NO recursive showSettingsDialog here: the titles
          // re-read the live signals, so the host re-renders this same
          // stack entry reactively. Re-replacing would recreate the
          // DialogSelect and reset its filter query and focus.
        }}
      />
    ),
    close,
  )
}
