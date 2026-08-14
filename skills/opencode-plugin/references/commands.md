# Keymap & Commands — modern `api.keymap` surface

Authoritative reference for palette commands, keybindings, and selection dialogs. Every shape below is verified against the INSTALLED types — re-verify against them before relying on newer fields:

- `~/.config/opencode/node_modules/@opentui/keymap/src/keymap.d.ts` — `Keymap` class (`registerLayer`, `dispatchCommand`, `runCommand`, `getCommands`, `getCommandEntries`, `getCommandBindings`)
- `~/.config/opencode/node_modules/@opentui/keymap/src/types.d.ts` — `Layer`, `Binding`, `Command`, `CommandEntry`, `RunCommandOptions`, `RunCommandResult`, `KeymapEvent`
- `~/.config/opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts` — `TuiPluginApi.keymap: TuiKeymap` (`Keymap<Renderable, KeyEvent>`), `TuiDialogStack`, `TuiDialogSelectProps`, `TuiLifecycle`

## Status: `api.command` is deprecated

`api.command` (`TuiCommandApi`: `register`/`trigger`/`show`) is marked `@deprecated` in the installed `tui.d.ts` ("Remove in v2"). Never use it in new code:

- `api.command.register(...)` → `api.keymap.registerLayer({ commands, bindings })`
- `api.command.trigger(name)` → `api.keymap.dispatchCommand(name)`
- `api.command.show()` → `api.keymap.dispatchCommand("command.palette.show")`

## Registering: `registerLayer`

```ts
api.keymap.registerLayer(layer: Layer): () => void // returns a disposer
```

`Layer` fields (all optional except what you need): `target?`, `priority?`, `bindings?: readonly Binding[]`, `commands?: readonly Command[]`, `targetMode?`, plus extra fields.

### Command shape

`name` and `run(ctx)` are required; every other field is a top-level custom property the host palette reads (types.d.ts: "Custom command fields are top-level properties so registration stays as simple as `{ name, run, desc }`"). The host palette queries `namespace: "palette"`, groups by `category`, displays `title`, and dispatches `name` (verified in `src/tokenmeter.tsx`):

```ts
commands: [
  {
    name: "tokenmeter.toggle-sections",
    namespace: "palette", // host palette surface
    category: "TokenMeter",
    title: "TokenMeter: Expand/Collapse Sections",
    desc: "Expand or collapse all TokenMeter panel sections",
    run: () => toggleSections(api),
  },
]
```

`run(ctx: CommandContext)` — `ctx` exposes `keymap`, `event` (`KeymapEvent`: `name`, `ctrl`, `shift`, `meta`, `preventDefault()`), `focused`, `target`, `data`, `input`, `payload`. May return `boolean | void | RunCommandResult | Promise<...>`.

### Binding shape

```ts
{ key: "ctrl+e", cmd: "tokenmeter.toggle-sections", event: "press", preventDefault: true }
```

- `key: KeyLike` — `"ctrl+e"`, `"ctrl+shift+e"`, `"ctrl+m"`, ...
- `cmd?` — command name string (or an inline `CommandHandler`).
- `event?: "press" | "release"`.
- `preventDefault?: boolean` — default `true`: calls `event.preventDefault()` + `event.stopPropagation()` so the matched key does not reach the focused target or later host listeners. Independent of `fallthrough`.
- `fallthrough?: boolean` — default `false`: continues to later matching bindings in the same dispatch chain after this command runs. Independent of `preventDefault`.

### Live re-registration

The host keymap is a live singleton: dispose the previous layer, then `registerLayer` again — the new bindings apply WITHOUT a restart. `bindings: []` keeps the command palette-queryable with no key.

Verified pattern (`src/tokenmeter/shortcut.ts` — `registerToggleLayer`):

```ts
let disposeLayer: (() => void) | null = null
export function registerToggleLayer(api: ToggleShortcutApi): () => void {
  disposeToggleLayer() // idempotent: drop the previous layer first
  const bindings =
    key === "off"
      ? [] // palette-only: no keybinding
      : [{ key, cmd: TOGGLE_COMMAND_NAME, event: "press", preventDefault: true }]
  disposeLayer = api.keymap.registerLayer({ bindings, commands: [/* palette command */] })
  return disposeLayer
}
export function disposeToggleLayer(): void {
  if (disposeLayer) {
    disposeLayer()
    disposeLayer = null
  }
}
```

`cycleToggleShortcut` persists the new preference and calls `registerToggleLayer` again → immediate effect, no restart.

## Invoking: `dispatchCommand` / `runCommand`

```ts
api.keymap.dispatchCommand(cmd: string, options?: RunCommandOptions): RunCommandResult
api.keymap.runCommand(cmd: string, options?: RunCommandOptions): RunCommandResult
```

`RunCommandOptions`: `event?`, `focused?`, `target?`, `includeCommand?`, `payload?`. `RunCommandResult` — always check `ok` before acting:

```ts
{ ok: true, command? }
| { ok: false, reason: "not-found" }
| { ok: false, reason: "inactive" | "disabled" | "invalid-args" | "rejected" | "error", command? }
```

Read-only queries: `getCommands(query?)` (`CommandQuery`: `visibility?`, `namespace?`, `search?`, `searchIn?`, `filter?`, `limit?`), `getCommandEntries(query?)`, `getCommandBindings({ commands: [...] })`.

## Lifecycle

`registerLayer` returns a disposer; register it in `api.lifecycle.onDispose` so the layer dies with the plugin. When several layers live, keep each disposer tracked and release all of them in the handler. Verified in `src/tokenmeter.tsx`:

```ts
const unregisterPalette = api.keymap.registerLayer({ commands: [/* settings command */] })
registerToggleLayer(api) // disposer tracked module-level inside shortcut.ts
api.lifecycle.onDispose(() => {
  // ...other disposers...
  unregisterPalette()
  disposeToggleLayer()
})
```

When re-registering (live swap), manage disposers yourself: dispose the old registration before the new one.

## DialogSelect: selection UI without recursive replace

Open a host `DialogSelect` exactly once via the stack:

```ts
api.ui.dialog.replace(render: () => JSX.Element, onClose?: () => void): void
```

- `TuiDialogSelectProps`: `title`, `options: TuiDialogSelectOption[]` (`title`, `value`, `description?`, `footer?`, `category?`, `disabled?`, `onSelect?`), `placeholder?`, `flat?`, `onMove?`, `onFilter?`, `onSelect?`, `skipFilter?`, `current?`.
- DO NOT call `dialog.replace` again on every selection: the host `replace` resets the whole stack (`setStore("stack", [newItem])`), recreating the DialogSelect and losing its internal filter query and focus. Keep the SAME dialog instance — the host renders the stack element as a Solid function child, so reading live signals inside the render re-invokes it with fresh titles on the same instance.
- Cancel: `DialogSelect` has no `onCancel` — Escape fires the STACK-level `onClose` passed to `replace`. That hook must NOT call `clear()` bare: host `clear()` invokes each stack item's `onClose` before emptying the stack, so `onClose: () => dialog.clear()` would recurse. Use an idempotent once-guard (verified in `src/tokenmeter/panel/settings-dialog.tsx`):

```ts
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
          { title: `Cache: ${settings().cache}`, value: "cache" },
          // ...titles re-read live signals — same dialog instance re-renders...
        ]}
        onSelect={(option) => {
          cycleSettingsOption(api, option.value) // NO recursive showSettingsDialog
        }}
      />
    ),
    close,
  )
}
```

The once-guard is safe under both `replace` churn and `clear` re-entrancy.

- `TuiDialogStack` full surface: `replace(render, onClose?)`, `clear()`, `setSize("medium" | "large" | "xlarge")`, readonly `size`, `depth`, `open`.

## Verified reference implementations in this repo

- `src/tokenmeter/shortcut.ts` — palette command + keybinding via `registerLayer`, `bindings: []` for the Off preference, live re-registration on preference cycle, module-level disposer released via `lifecycle.onDispose`. Defines a structural subset type (`ToggleShortcutApi`) so the module is testable without the host.
- `src/tokenmeter/panel/settings-dialog.tsx` — DialogSelect opened once via `dialog.replace`, reactive titles, once-guarded close. Same structural-subset pattern (`DialogSurface`).
- `src/tokenmeter.tsx` — startup wiring: palette command layer (`namespace: "palette"`, `category: "TokenMeter"`), toggle layer, all disposers released in one `api.lifecycle.onDispose` handler.
