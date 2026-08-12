---
name: opencode-plugin
description: "Trigger: create OpenCode plugins, TUI plugins, sidebar UI, Solid reactivity, plugin SDK, custom tools, hooks, auth, or tool interception. Build and package plugins with @opencode-ai/plugin."
license: Apache-2.0
metadata:
  author: jonosotoaguilar
  version: "1.4"
---

## Activation Contract

Load when creating or modifying OpenCode plugins: TUI plugins, sidebar UI, Solid reactivity, plugin SDK, custom tools, hooks, auth, or tool interception. Re-read this file during plugin development.

## Hard Rules

- **Verify SDK reference (REQUIRED pre-step)**: regenerate the API reference before creating any plugin: `bun run scripts/extract-plugin-api.ts` (relative to this skill's base directory); pass `--workspace /path/to/opencode` outside an opencode checkout. Writes `references/hooks.md`, `events.md`, `tool-helper.md`.
- **Validate feasibility (REQUIRED)**: check the concept against `references/feasibility.md`; if not feasible, inform the user and suggest the alternative — never build a workaround silently.
- **Modularity**: one purpose per function, DRY; extract proactively near 150 lines, SHOULD NOT exceed 200, MUST split over 300; never all code in one `index.ts` — `references/coding-ts.md`.
- **TUI production boundary**: precompile `.tsx` with the OpenTUI Solid transform, load the compiled ESM artifact from `tui.json`, keep host runtimes external, inspect for reactive bindings and no eager JSX output — `references/tui-reactivity.md`.
- **Installed-type verification**: verify exact SDK method signatures against INSTALLED `@opencode-ai/plugin/dist/tui.d.ts` and `@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`; no `api.client.experimental.*` client path (`experimental.*` are hook names only); pass `directory` from `api.state.path.directory` to `project.current`/`session.list` — `references/tui-api.md`.
- **Testing**: `references/testing.md`; TUI plugins also run the production artifact check — preload-backed render tests don't prove the `tui.json` loading boundary.
- **Pre-publish gates**: `typecheck`, `test`, `audit --prod`, `pack --dry-run`, direct-dist testing — `references/build-and-release.md`.
- **Runtime dependency packaging**: every module the compiled artifact imports at runtime MUST be declared in `dependencies` of the published package — consumers install only `dependencies`, never `devDependencies` (a TUI bundle importing `@opentui/solid`/`solid-js` that ships them only as devDeps fails to load after install). Check the bundle's bare imports before publishing — `references/publishing.md`.
- **Entrypoint contract**: ship only the artifact pair(s) your kind needs — `tui.*` (implements `TuiPlugin`, `exports["./tui"]`, registers in `tui.json`); `index.*` (implements `Plugin`, `exports["."]`/`"./runtime"`, registers in `opencode.json`); dual = both pairs, two configs. Never ship `index.*` in a TUI-only package — `references/publishing.md`.

## Decision Gates

| Situation | Action |
| --- | --- |
| Toasts vs inline status | `references/toast-notifications.md` / `references/ui-feedback.md` |
| TUI plugin | `references/tui-reactivity.md` + `references/tui-api.md` |
| npm publish | `references/build-and-release.md` + `publishing.md` + `update-notifications.md` |
| Users updating an installed plugin | `references/updating-plugins.md` — official flow: `npm view <name> version` + `opencode plugin <name>@<version> --force` (cache-first install, no auto-update; never `postinstall` — opencode installs with `ignoreScripts: true`) |
| How the plugin host loads/installs plugins | `references/plugin-loading.md` — config entries, spec resolution, cache-first install, manifest targets, config patch, runtime load |
| Not feasible as plugin | Inform user: OC core → `packages/opencode`; MCP tools → MCP config; automation → shell scripts |

## Execution Steps

1. Verify SDK reference: run the extract script.
2. Validate feasibility; if not feasible, inform the user and stop.
3. Design: `references/hooks.md`, `hook-patterns.md`, `coding-ts.md`.
4. Implement modularly: `hook-patterns.md`, `tool-helper.md`, `events.md`, `examples.md`.
5. Add UI feedback if needed (toasts vs inline).
6. Test: test folder with the entry's config (`opencode.json` for server/runtime plugins → `opencode run hi`; `tui.json` for TUI plugins) → interactive `opencode`; recommend tests by hook type.
7. Build and package (npm only): single-file tsup bundling, packaging-boundary decision, tarball inspection via `pack --dry-run` — `build-and-release.md`.
8. Release and share (npm only): versioning/release — semantic-release optional; default is tag-driven `scripts/release-*` (preflight → publish → verify, `vX.Y.Z` tag as authorization): `build-and-release.md`, `publishing.md`, `update-notifications.md`. Update path for users: `opencode plugin <name>@<version> --force` (cache-first install, no auto-update — `updating-plugins.md`).

## Output Contract

Return: plugin files created (exact paths), hooks and tools used, feasibility verdict, tests run with results, build/release gates and artifacts, deviations from this procedure.

## References

- `references/hooks.md` — hook signatures (auto-generated)
- `references/events.md` — event types (auto-generated)
- `references/tool-helper.md` — Zod tool schemas (auto-generated)
- `references/feasibility.md` — feasibility + alternatives
- `references/hook-patterns.md` — hook patterns + common mistakes
- `references/coding-ts.md` — code architecture principles
- `references/examples.md` — examples, locations, structure (npm-dist keeps source in `src/`)
- `references/toast-notifications.md`, `references/ui-feedback.md` — user feedback
- `references/tui-reactivity.md`, `references/tui-api.md` — TUI boundary, SDK API
- `references/testing.md` — testing procedure
- `references/build-and-release.md` — packaging, gates, release
- `references/publishing.md` — npm publishing checklist
- `references/update-notifications.md` — version toast pattern
- `references/updating-plugins.md` — why plugins go stale (cache-first install), official two-command update flow
- `references/plugin-loading.md` — how the host loads plugins: config entries, resolution, cache-first install, manifest targets
