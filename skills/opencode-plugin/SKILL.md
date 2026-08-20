---
name: opencode-plugin
description: "Trigger: create OpenCode plugins, TUI plugins, sidebar UI, Solid reactivity, plugin SDK, custom tools, hooks, auth, keymaps/commands, or tool interception. Build and package plugins with @opencode-ai/plugin."
license: Apache-2.0
metadata:
  author: jonosotoaguilar
  version: "1.6"
---

## Activation Contract

Load when creating or modifying OpenCode plugins: TUI plugins, sidebar UI, Solid reactivity, plugin SDK, custom tools, hooks, auth, keymaps/commands, tool interception. Re-read this file during plugin development.

## Hard Rules

- **Verify SDK reference (REQUIRED)**: `bun run scripts/extract-plugin-api.ts` from this skill's base dir (`--workspace /path/to/opencode` outside a checkout) — writes `hooks.md`, `events.md`, `tool-helper.md`.
- **Validate feasibility (REQUIRED)**: check `feasibility.md`; if not feasible, inform the user and suggest the alternative — never a silent workaround.
- **Modularity**: one purpose per function, DRY; split near 150 lines, SHOULD NOT exceed 200, MUST split over 300; never all code in one `index.ts` — `coding-ts.md`.
- **TUI production boundary**: precompile `.tsx` (OpenTUI Solid transform), load the ESM artifact from `tui.json`, host runtimes external, no eager JSX — `tui-reactivity.md`.
- **Installed-type verification**: verify against INSTALLED `@opencode-ai/plugin/dist/tui.d.ts` + `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`; never `api.client.experimental.*` (hook names only); pass `api.state.path.directory` to `project.current`/`session.list` — `tui-api.md`.
- **TUI slot surfaces (REQUIRED)**: classify the surface BEFORE choosing the slot — `session_prompt` (replace) = row below the native input, re-render `api.ui.Prompt` forwarding host props; `home_bottom` = Home row; `session_prompt_right` = INSIDE the status row (not below-input); `app_bottom` = route flow, NOT prompt/statusline; `home_footer` = single-winner. Read the host spec + one reference plugin first — `tui-slot-surfaces.md`.
- **Keymap/commands (REQUIRED)**: `api.keymap.registerLayer({ commands, bindings })`; `api.command` deprecated (removed in v2) — never. Verify installed `@opentui/keymap` d.ts; dispose layers via `api.lifecycle.onDispose`; `api.ui.dialog.replace` ONCE + once-guarded close — `commands.md`.
- **Testing**: `testing.md`; TUI plugins also run the production artifact check.
- **Pre-publish gates**: `typecheck`, `test`, `audit --prod`, `pack --dry-run`, direct-dist — `build-and-release.md`.
- **Runtime dependency packaging**: every runtime import of the compiled artifact MUST be in `dependencies` — consumers never install `devDependencies`; check bare imports — `publishing.md`.
- **Entrypoint contract**: ship only the pair(s) your kind needs — `tui.*` (`TuiPlugin`, `exports["./tui"]`, `tui.json`); `index.*` (`Plugin`, `exports["."]`/`"./runtime"`, `opencode.json`); dual = both. Never `index.*` in a TUI-only package — `publishing.md`.

## Decision Gates

- Toasts vs inline status → `toast-notifications.md` / `ui-feedback.md`
- TUI plugin → `tui-reactivity.md` + `tui-api.md`
- TUI slot surface → `tui-slot-surfaces.md` — classify surface first
- npm publish → `build-and-release.md` + `publishing.md` + `update-notifications.md`
- Updating installed plugins → `updating-plugins.md` — never `postinstall`
- Host plugin loading → `plugin-loading.md`
- Palette command, keybinding, or both → `commands.md` — `registerLayer`; `bindings: []` = palette-only
- Selection/settings picker UI → `commands.md` — `replace` once; once-guarded close
- Not feasible as plugin → inform user: core → `packages/opencode`; MCP → MCP config; scripts

## Execution Steps

1. Verify SDK reference: run the extract script.
2. Validate feasibility; if not feasible, inform the user and stop.
3. Design + implement: `hooks.md`, `hook-patterns.md`, `coding-ts.md`, `tool-helper.md`, `events.md`, `commands.md`, `examples.md`.
4. Add UI feedback if needed (toasts vs inline).
5. Test: entry config (`opencode.json` → `opencode run hi`; `tui.json` → interactive); tests by hook type.
6. Build/package/release (npm only): tsup bundling, packaging boundary, `pack --dry-run`, tag-driven `scripts/release-*` (preflight → publish → verify, `vX.Y.Z` tag = authorization; semantic-release optional) — `build-and-release.md`, `publishing.md`, `update-notifications.md`. User update: `opencode plugin <name>@<version> --force` — `updating-plugins.md`.

## Output Contract

Return: plugin files created (exact paths), hooks and tools used, feasibility verdict, tests run with results, build/release gates and artifacts, deviations from this procedure.

## References

- Auto-generated: `references/hooks.md`, `events.md`, `tool-helper.md`
- `references/feasibility.md` — feasibility + alternatives
- `references/hook-patterns.md`, `coding-ts.md`, `examples.md` — patterns, architecture, examples
- `references/toast-notifications.md`, `ui-feedback.md` — user feedback
- `references/tui-reactivity.md`, `tui-api.md`, `tui-slot-surfaces.md` — TUI boundary, SDK API, slot surfaces
- `references/commands.md` — keymap/commands, DialogSelect
- `references/testing.md` — testing procedure
- `references/build-and-release.md`, `publishing.md`, `update-notifications.md` — packaging, gates, release
- `references/updating-plugins.md`, `plugin-loading.md` — updates, host load cycle
