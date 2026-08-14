/**
 * Configurable keyboard shortcut for the toggle-sections command.
 *
 * Owns the durable `tokenmeter.toggle.shortcut` preference (a dedicated kv
 * key, mirroring the Subagents key pattern — the `settings.v1` object keeps
 * its exact three-field contract), the keymap layer that binds the shortcut
 * to `tokenmeter.toggle-sections`, and the palette-visible command itself.
 *
 * The layer is re-registered whenever the preference cycles so a change
 * takes effect WITHOUT a restart: the host keymap is a live singleton, so
 * unregister + register swaps the binding (or drops it for `Off`) while the
 * command stays queryable from the palette. The module-level disposer makes
 * registration idempotent and is released on plugin dispose.
 */
import { createSignal } from "solid-js"
import { toggleSections } from "./sections"
import type { SettingsApi } from "./settings"

export type ToggleShortcutPref = "ctrl+e" | "ctrl+shift+e" | "ctrl+m" | "off"

export const TOGGLE_COMMAND_NAME = "tokenmeter.toggle-sections"
export const TOGGLE_SHORTCUT_KV_KEY = "tokenmeter.toggle.shortcut"
export const DEFAULT_TOGGLE_SHORTCUT: ToggleShortcutPref = "ctrl+e"

/** The shortcut domain in fixed cycle order, with user-facing labels. */
export const TOGGLE_SHORTCUTS: ReadonlyArray<{
  key: ToggleShortcutPref
  label: string
}> = [
  { key: "ctrl+e", label: "Ctrl+E" },
  { key: "ctrl+shift+e", label: "Ctrl+Shift+E" },
  { key: "ctrl+m", label: "Ctrl+M" },
  { key: "off", label: "Off" },
]

const [toggleShortcut, setToggleShortcut] = createSignal<ToggleShortcutPref>(
  DEFAULT_TOGGLE_SHORTCUT,
)

export { toggleShortcut }

/** The user-facing label of the current preference (settings dialog row). */
export function toggleShortcutLabel(): string {
  return (
    TOGGLE_SHORTCUTS.find((entry) => entry.key === toggleShortcut())?.label ??
    "Off"
  )
}

/**
 * The keymap surface shortcut registration needs — a structural subset of
 * `TuiPluginApi` (same pattern as `SettingsApi` in settings.ts); the real
 * host keymap satisfies it structurally.
 */
export type ToggleShortcutApi = SettingsApi & {
  keymap: {
    registerLayer(layer: {
      bindings: Array<{
        key: string
        cmd: string
        event: "press"
        preventDefault?: boolean
      }>
      commands: Array<{
        name: string
        namespace: string
        category: string
        title: string
        desc: string
        run: () => void
      }>
    }): () => void
  }
}

let disposeLayer: (() => void) | null = null

const isToggleShortcutPref = (v: unknown): v is ToggleShortcutPref =>
  TOGGLE_SHORTCUTS.some((entry) => entry.key === v)

/**
 * Loads the durable preference once at startup; absent or malformed values
 * resolve to the default.
 */
export function loadToggleShortcut(api: SettingsApi): void {
  const raw = api.kv.get<unknown>(
    TOGGLE_SHORTCUT_KV_KEY,
    DEFAULT_TOGGLE_SHORTCUT,
  )
  setToggleShortcut(isToggleShortcutPref(raw) ? raw : DEFAULT_TOGGLE_SHORTCUT)
}

/**
 * Registers the toggle layer with the CURRENT preference: the command is
 * always present (palette-queryable) and the binding only when the shortcut
 * is not `Off`. Idempotent — any previously registered layer is disposed
 * first. Returns the disposer of the newest registration.
 */
export function registerToggleLayer(api: ToggleShortcutApi): () => void {
  disposeToggleLayer()
  const key = toggleShortcut()
  const bindings =
    key === "off"
      ? []
      : [
          {
            key,
            cmd: TOGGLE_COMMAND_NAME,
            event: "press" as const,
            preventDefault: true,
          },
        ]
  disposeLayer = api.keymap.registerLayer({
    bindings,
    commands: [
      {
        name: TOGGLE_COMMAND_NAME,
        namespace: "palette",
        category: "TokenMeter",
        title: "TokenMeter: Expand/Collapse Sections",
        desc: "Expand or collapse all TokenMeter panel sections",
        run: () => toggleSections(api),
      },
    ],
  })
  return disposeLayer
}

/** Releases the current toggle layer (plugin dispose); a no-op when none. */
export function disposeToggleLayer(): void {
  if (disposeLayer) {
    disposeLayer()
    disposeLayer = null
  }
}

/**
 * Cycles the shortcut preference Ctrl+E -> Ctrl+Shift+E -> Ctrl+M -> Off,
 * persists it (ready-gated) and re-registers the layer so the change takes
 * effect immediately, without a restart.
 */
export function cycleToggleShortcut(api: ToggleShortcutApi): void {
  const current = toggleShortcut()
  const index = TOGGLE_SHORTCUTS.findIndex((entry) => entry.key === current)
  const next = TOGGLE_SHORTCUTS[(index + 1) % TOGGLE_SHORTCUTS.length]!.key
  setToggleShortcut(next)
  if (api.kv.ready) api.kv.set(TOGGLE_SHORTCUT_KV_KEY, next)
  registerToggleLayer(api)
}
