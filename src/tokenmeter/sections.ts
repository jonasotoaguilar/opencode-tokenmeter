/**
 * Transient section disclosure for the TokenMeter sidebar.
 *
 * The Project/Session open state is shared between the panel and the
 * `tokenmeter.toggle-sections` command (shortcut.ts), so it lives in a small
 * store-like module (mirroring settings.ts) instead of UsagePanel-local
 * signals. Both signals stay TRANSIENT: reset on panel mount (the closed
 * seed) and on every session change, never written to kv. The Subagents
 * section state stays in the durable `tokenmeter.sidebar.expanded` key
 * (settings.ts) and is read here, never duplicated.
 */
import { createSignal } from "solid-js"
import { cycleSubagents, type SettingsApi, subagentsPref } from "./settings"

const [projectOpen, setProjectOpen] = createSignal(false)
const [sessionOpen, setSessionOpen] = createSignal(false)

/** Read accessors only; writes go through the functions below. */
export { projectOpen, sessionOpen }

/**
 * Opens or closes one transient section. Called by the panel's per-section
 * chevron/title click; the toggle command uses `toggleSections` instead.
 */
export function setSectionOpen(
  section: "project" | "session",
  open: boolean,
): void {
  if (section === "project") setProjectOpen(open)
  else setSessionOpen(open)
}

/**
 * Resets both transient section signals to their closed seed. Called on
 * panel mount (the seed) and on session change (as today); never persisted.
 */
export function resetSectionDisclosure(): void {
  setProjectOpen(false)
  setSessionOpen(false)
}

/** True when ANY of the three sections is expanded (Subagents reads the durable pref). */
export function anySectionExpanded(): boolean {
  return projectOpen() || sessionOpen() || subagentsPref() === "expanded"
}

/**
 * Expands all three sections when every one is collapsed; collapses all
 * three otherwise. Project/Session changes are transient; the Subagents
 * change goes through `cycleSubagents` so it persists to
 * `tokenmeter.sidebar.expanded` (skipped when the durable pref already
 * matches the target).
 */
export function toggleSections(api: SettingsApi): void {
  const expanded = !anySectionExpanded()
  setProjectOpen(expanded)
  setSessionOpen(expanded)
  const subagentsTarget = expanded ? "expanded" : "collapsed"
  if (subagentsPref() !== subagentsTarget) cycleSubagents(api)
}
