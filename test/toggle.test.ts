/**
 * Unit suite for the transient section disclosure (sections.ts) and the
 * configurable toggle shortcut (shortcut.ts).
 *
 * Covers the quick-direct toggle feature:
 *  - the toggle layer registers with the default `ctrl+e` binding and the
 *    `tokenmeter.toggle-sections` palette command
 *  - running the command expands all three sections when every one is
 *    collapsed and collapses all three when ANY is expanded; the Subagents
 *    change goes through `cycleSubagents` (durable key) and is skipped when
 *    the target already matches
 *  - cycling the shortcut preference persists it to
 *    `tokenmeter.toggle.shortcut` and re-registers the layer with the new
 *    binding — no restart needed
 *  - `Off` drops the binding while the command stays registered
 *  - lifecycle dispose unregisters the toggle layer (the plugin dispose
 *    wiring for BOTH layers is covered at render level in render.test.tsx)
 *  - the persisted preference loads at startup; malformed values default
 *
 * The kv store is faked (map-backed, like settings.test.ts) and the keymap
 * is a real register/dispose pair over an array, so every registration is
 * observable.
 */
import { describe, expect, test } from "bun:test"
import {
  anySectionExpanded,
  projectOpen,
  resetSectionDisclosure,
  sessionOpen,
  setSectionOpen,
  toggleSections,
} from "../src/tokenmeter/sections"
import {
  cycleSubagents,
  loadSettings,
  type SettingsApi,
  SUBAGENTS_KV_KEY,
  subagentsPref,
} from "../src/tokenmeter/settings"
import {
  cycleToggleShortcut,
  DEFAULT_TOGGLE_SHORTCUT,
  disposeToggleLayer,
  loadToggleShortcut,
  registerToggleLayer,
  TOGGLE_COMMAND_NAME,
  TOGGLE_SHORTCUT_KV_KEY,
  type ToggleShortcutApi,
  toggleShortcut,
  toggleShortcutLabel,
} from "../src/tokenmeter/shortcut"

type SetCall = { key: string; value: unknown }

type FakeKv = { kv: SettingsApi["kv"]; sets: SetCall[] }

function makeKv(initial: Record<string, unknown> = {}, ready = true): FakeKv {
  const store = new Map<string, unknown>(Object.entries(initial))
  const sets: SetCall[] = []
  return {
    kv: {
      ready,
      get<Value = unknown>(key: string, fallback?: Value): Value {
        return (store.has(key) ? store.get(key) : fallback) as Value
      },
      set(key: string, value: unknown) {
        sets.push({ key, value })
        store.set(key, value)
      },
    },
    sets,
  }
}

type RegisteredLayer = {
  commands: Array<Record<string, unknown>>
  bindings: Array<Record<string, unknown>>
}

type FakeKeymap = {
  keymap: ToggleShortcutApi["keymap"]
  layers: Array<RegisteredLayer & { disposed: boolean }>
  activeLayers: () => RegisteredLayer[]
}

function makeKeymap(): FakeKeymap {
  const layers: Array<RegisteredLayer & { disposed: boolean }> = []
  return {
    keymap: {
      registerLayer(layer: RegisteredLayer) {
        const record = { ...layer, disposed: false }
        layers.push(record)
        return () => {
          record.disposed = true
        }
      },
    },
    layers,
    activeLayers: () => layers.filter((layer) => !layer.disposed),
  }
}

/** Fresh module state: settings, shortcut and disclosure all reseeded. */
function freshApi(initial: Record<string, unknown> = {}, ready = true) {
  const kv = makeKv(initial, ready)
  const km = makeKeymap()
  const api: ToggleShortcutApi = { kv: kv.kv, keymap: km.keymap }
  loadSettings(api)
  loadToggleShortcut(api)
  resetSectionDisclosure()
  return { api, kv, km }
}

describe("toggle layer registration (shortcut.ts)", () => {
  test("registers the default ctrl+e binding and the toggle-sections command", () => {
    const { api, km } = freshApi()
    const dispose = registerToggleLayer(api)
    const active = km.activeLayers()
    expect(active).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees layer
    const layer = active[0]!
    // biome-ignore lint/style/noNonNullAssertion: test guarantees command
    const command = layer.commands[0]!
    expect(command.name).toBe(TOGGLE_COMMAND_NAME)
    expect(command.namespace).toBe("palette")
    expect(command.category).toBe("TokenMeter")
    expect(command.title).toBe("TokenMeter: Expand/Collapse Sections")
    expect(command.desc).toBeTypeOf("string")
    expect(typeof command.run).toBe("function")
    expect(layer.bindings).toEqual([
      {
        key: "ctrl+e",
        cmd: TOGGLE_COMMAND_NAME,
        event: "press",
        preventDefault: true,
      },
    ])
    expect(toggleShortcut()).toBe(DEFAULT_TOGGLE_SHORTCUT)
    expect(toggleShortcutLabel()).toBe("Ctrl+E")
    dispose()
    expect(km.activeLayers()).toHaveLength(0)
  })

  test("the registered command's run toggles the sections when invoked (palette path)", () => {
    const { api, km } = freshApi()
    const dispose = registerToggleLayer(api)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees layer and command
    const run = km.activeLayers()[0]!.commands[0]!.run as () => void
    run()
    expect(anySectionExpanded()).toBe(true)
    run()
    expect(anySectionExpanded()).toBe(false)
    dispose()
  })

  test("the persisted shortcut loads at startup and binds the layer to it; malformed values default", () => {
    const { api, km } = freshApi({ [TOGGLE_SHORTCUT_KV_KEY]: "ctrl+m" })
    expect(toggleShortcut()).toBe("ctrl+m")
    registerToggleLayer(api)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees binding
    expect(km.activeLayers()[0]!.bindings[0]!.key).toBe("ctrl+m")
    // Off persists across startup: no binding, command still present.
    const off = freshApi({ [TOGGLE_SHORTCUT_KV_KEY]: "off" })
    expect(toggleShortcut()).toBe("off")
    registerToggleLayer(off.api)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees layer
    expect(off.km.activeLayers()[0]!.bindings).toEqual([])
    // biome-ignore lint/style/noNonNullAssertion: test guarantees command
    expect(off.km.activeLayers()[0]!.commands[0]!.name).toBe(
      TOGGLE_COMMAND_NAME,
    )
    // Malformed value resolves to the default.
    freshApi({ [TOGGLE_SHORTCUT_KV_KEY]: "ctrl+z" })
    expect(toggleShortcut()).toBe("ctrl+e")
  })
})

describe("toggle semantics (sections.ts)", () => {
  test("expands all when all are collapsed; collapses all when any is expanded", () => {
    const { api, kv } = freshApi()
    expect(anySectionExpanded()).toBe(false)

    toggleSections(api)
    expect(projectOpen()).toBe(true)
    expect(sessionOpen()).toBe(true)
    expect(subagentsPref()).toBe("expanded")
    expect(anySectionExpanded()).toBe(true)
    // The Subagents change persists through cycleSubagents.
    expect(kv.sets).toEqual([{ key: SUBAGENTS_KV_KEY, value: true }])

    toggleSections(api)
    expect(projectOpen()).toBe(false)
    expect(sessionOpen()).toBe(false)
    expect(subagentsPref()).toBe("collapsed")
    expect(kv.sets).toEqual([
      { key: SUBAGENTS_KV_KEY, value: true },
      { key: SUBAGENTS_KV_KEY, value: false },
    ])
  })

  test("a single open section (project-only) collapses everything on toggle", () => {
    const { api, kv } = freshApi()
    setSectionOpen("project", true)
    expect(anySectionExpanded()).toBe(true)
    toggleSections(api)
    expect(projectOpen()).toBe(false)
    expect(sessionOpen()).toBe(false)
    expect(subagentsPref()).toBe("collapsed")
    // Subagents already matched the collapse target: no durable write.
    expect(kv.sets).toEqual([])
  })

  test("subagents-only expanded collapses all on toggle, persisting the collapse", () => {
    const { api, kv } = freshApi()
    cycleSubagents(api)
    expect(anySectionExpanded()).toBe(true)
    toggleSections(api)
    expect(projectOpen()).toBe(false)
    expect(sessionOpen()).toBe(false)
    expect(subagentsPref()).toBe("collapsed")
    expect(kv.sets).toEqual([
      { key: SUBAGENTS_KV_KEY, value: true },
      { key: SUBAGENTS_KV_KEY, value: false },
    ])
  })

  test("resetSectionDisclosure restores the closed seed without touching the durable pref", () => {
    const { api, kv } = freshApi()
    toggleSections(api)
    expect(anySectionExpanded()).toBe(true)
    resetSectionDisclosure()
    expect(projectOpen()).toBe(false)
    expect(sessionOpen()).toBe(false)
    // Subagents is durable: the reset never touches it.
    expect(subagentsPref()).toBe("expanded")
    expect(kv.sets).toEqual([{ key: SUBAGENTS_KV_KEY, value: true }])
  })
})

describe("shortcut preference cycling (shortcut.ts)", () => {
  test("changing the shortcut re-registers the layer with the new binding, no restart", () => {
    const { api, kv, km } = freshApi()
    registerToggleLayer(api)
    expect(km.activeLayers()).toHaveLength(1)

    cycleToggleShortcut(api)
    expect(toggleShortcut()).toBe("ctrl+shift+e")
    expect(toggleShortcutLabel()).toBe("Ctrl+Shift+E")
    expect(kv.sets).toEqual([
      { key: TOGGLE_SHORTCUT_KV_KEY, value: "ctrl+shift+e" },
    ])
    // The old layer was disposed: exactly one layer remains, rebound.
    const active = km.activeLayers()
    expect(active).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees active
    expect(active[0]!.bindings).toEqual([
      {
        key: "ctrl+shift+e",
        cmd: TOGGLE_COMMAND_NAME,
        event: "press",
        preventDefault: true,
      },
    ])
    // biome-ignore lint/style/noNonNullAssertion: test guarantees command
    expect(active[0]!.commands[0]!.name).toBe(TOGGLE_COMMAND_NAME)

    cycleToggleShortcut(api)
    expect(toggleShortcut()).toBe("ctrl+m")
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(km.activeLayers()[0]!.bindings[0]!.key).toBe("ctrl+m")
  })

  test("Off removes the binding while keeping the command", () => {
    const { api, kv, km } = freshApi()
    registerToggleLayer(api)
    cycleToggleShortcut(api) // ctrl+shift+e
    cycleToggleShortcut(api) // ctrl+m
    cycleToggleShortcut(api) // off
    expect(toggleShortcut()).toBe("off")
    expect(toggleShortcutLabel()).toBe("Off")
    expect(kv.sets.at(-1)).toEqual({
      key: TOGGLE_SHORTCUT_KV_KEY,
      value: "off",
    })
    const active = km.activeLayers()
    expect(active).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees active
    expect(active[0]!.bindings).toEqual([])
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(active[0]!.commands[0]!.name).toBe(TOGGLE_COMMAND_NAME)
  })

  test("the full cycle wraps off back to Ctrl+E after four selections", () => {
    const { api, kv, km } = freshApi()
    registerToggleLayer(api)
    cycleToggleShortcut(api) // ctrl+shift+e
    cycleToggleShortcut(api) // ctrl+m
    cycleToggleShortcut(api) // off
    cycleToggleShortcut(api) // wrap: off -> ctrl+e
    expect(toggleShortcut()).toBe("ctrl+e")
    expect(toggleShortcutLabel()).toBe("Ctrl+E")
    expect(kv.sets.at(-1)).toEqual({
      key: TOGGLE_SHORTCUT_KV_KEY,
      value: "ctrl+e",
    })
    const active = km.activeLayers()
    expect(active).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(active[0]!.bindings).toEqual([
      {
        key: "ctrl+e",
        cmd: TOGGLE_COMMAND_NAME,
        event: "press",
        preventDefault: true,
      },
    ])
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(active[0]!.commands[0]!.name).toBe(TOGGLE_COMMAND_NAME)
  })

  test("a not-ready kv still updates the preference and re-registers, without persisting", () => {
    const { api, kv, km } = freshApi({}, false)
    registerToggleLayer(api)
    cycleToggleShortcut(api)
    expect(toggleShortcut()).toBe("ctrl+shift+e")
    expect(kv.sets).toEqual([])
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(km.activeLayers()[0]!.bindings[0]!.key).toBe("ctrl+shift+e")
  })

  test("disposeToggleLayer unregisters the layer and is idempotent", () => {
    const { api, km } = freshApi()
    registerToggleLayer(api)
    expect(km.activeLayers()).toHaveLength(1)
    disposeToggleLayer()
    expect(km.activeLayers()).toHaveLength(0)
    disposeToggleLayer()
    expect(km.activeLayers()).toHaveLength(0)
  })

  test("registerToggleLayer is idempotent: a second registration replaces the first", () => {
    const { api, km } = freshApi()
    const first = registerToggleLayer(api)
    const second = registerToggleLayer(api)
    const active = km.activeLayers()
    expect(active).toHaveLength(1)
    // biome-ignore lint/style/noNonNullAssertion: test guarantees presence
    expect(active[0]!.bindings[0]!.key).toBe("ctrl+e")
    first()
    second()
    expect(km.activeLayers()).toHaveLength(0)
  })
})
