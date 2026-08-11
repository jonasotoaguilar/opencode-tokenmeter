# How OpenCode Loads Plugins

> The full load cycle from config entry to running plugin — verified against opencode source

<overview>

An OpenCode plugin starts as an entry in a config file (`tui.json` for TUI plugins, `opencode.json` for server/runtime plugins). At load time OpenCode resolves the spec, installs the package into a versioned cache directory (cache-first, never re-checking npm), detects the entrypoint from the package manifest, and patches the config. Understanding this cycle explains why plugins go stale, what the package must export, and why `opencode plugin <name>@<version> --force` is the only reliable update path.

</overview>

<config_entries>

## Config entries

Config files live at `~/.config/opencode/{tui,opencode}.json[c]` (global) or `<project>/.opencode/{tui,opencode}.json[c]` (local — the patch target is `.opencode/` inside the worktree/directory, see `patchDir` in `packages/opencode/src/plugin/install.ts`). Only `.json` and `.jsonc` are scanned (`fileInDirectory`, `packages/opencode/src/config/paths.ts`).

The `plugin` array accepts plain spec strings or `[spec, opts]` pairs:

```jsonc
{
  "plugin": [
    "my-plugin",              // bare name → normalized to @latest
    "my-plugin@1.2.0",        // pinned version
    ["my-plugin", { "config": "..." }]  // spec + options
  ]
}
```

Local `file://` and absolute-path specs are also valid (used for local development; those bypass the npm machinery entirely).

</config_entries>

<resolution>

## Spec resolution

`resolvePluginTarget` (`packages/opencode/src/plugin/shared.ts`) normalizes a bare spec before anything else:

```ts
const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
```

- `my-plugin` → `my-plugin@latest`
- `my-plugin@1.2.0` → unchanged (the pin survives)
- `file:///path/to/dist/tui.js` → resolved as a path plugin, no npm involved

The normalized spec then becomes the cache directory name — see below.

</resolution>

<install>

## Cache-first install

`Npm.add` (`packages/core/src/npm.ts`) installs into `global.cache/packages/<sanitized-spec>`:

```ts
const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
```

The key behavior — reuse without ever consulting npm when the directory already exists:

```ts
if (yield* afs.existsSafe(path.join(dir, "node_modules", name))) {
  return resolveEntryPoint(name, path.join(dir, "node_modules", name)) // ← reuse, never checks npm
}
const tree = yield* reify({ dir, add: [pkg] }) // ← only installs when the cache dir is absent
```

Consequences:

- `my-plugin@latest` and `my-plugin@1.2.0` are **different cache directories**. Installing the pin later is a fresh install because that directory does not exist yet.
- `@latest` is a directory label, not a live pointer: once `my-plugin@latest/` exists, publishing a new version changes nothing for existing users.
- There is no TTL, no version comparison, no auto-update anywhere in the load path.
- `Npm.reify` runs arborist with `ignoreScripts: true` — lifecycle scripts in a published plugin (e.g. `postinstall`) NEVER run when opencode installs it. Supply-chain protection is on by default.

</install>

<manifest>

## Entrypoint detection

After install, `readPluginManifest` → `packageTargets` (`packages/opencode/src/plugin/install.ts`) decides what kind of plugin the package exposes by reading its `package.json`:

| Package exports | Kind | Config patched | Entrypoint |
| --- | --- | --- | --- |
| `exports["./tui"]` (or `oc-themes`) | TUI | `tui.json` | `tui.js`/`tui.d.ts` |
| `exports["./server"]` (or `main` fallback) | server/runtime | `opencode.json` | `index.js`/`index.d.ts` |
| both | dual | both configs | both pairs |

The entrypoint contract (see `publishing.md`): ship only the artifact pair(s) your kind needs — never `index.*` in a TUI-only package and never `tui.*` in a server-only package, or the manifest will advertise a target that does not exist.

</manifest>

<config_patch>

## Config patch

`patchPluginConfig` writes the spec back into the matching config (`packages/opencode/src/plugin/install.ts`):

- `--global` → `~/.config/opencode/`; otherwise the local `.opencode/` dir (or project root).
- An entry with the same package name already present → **no-op without `--force`**; `--force` replaces it.
- Duplicate entries for the same package are collapsed to one.

This is why the CLI command is the update flow: `opencode plugin <name>@<version> --force` installs the pin into a fresh cache directory AND replaces the config entry in one step.

</config_patch>

<load>

## Load at runtime

At startup the host reads the config's `plugin` entries, resolves each spec (the resolution + install cycle above), and loads the entrypoint file from the resolved cache directory (`resolveEntryPoint`). Local development replaces the npm spec with a direct file path, skipping the cache entirely.

</load>

<update>

## Updating installed plugins

The same cycle explains the update path — see `updating-plugins.md`:

- Bare/`@latest` entries never refresh: the cache directory already exists.
- `opencode plugin <name>@<version> --force` is the official update: new pin → new cache directory → guaranteed fresh install, `--force` replaces the config entry.
- There is no auto-update; the CLI command is the mechanism.

</update>

<best_practices>

## Best Practices

| Practice | Reason |
| --- | --- |
| **Publish the exact artifact pair for your kind** | Manifest detection keys off `exports["./tui"]` / `exports["./server"]` / `main`; a mismatch makes the plugin unloadable |
| **Never rely on `postinstall`** | `Npm.reify` installs with `ignoreScripts: true` — install-time scripts never run |
| **Document the pinned update command** | Users must run `opencode plugin <name>@<version> --force`; `@latest` entries never refresh |
| **Treat `@latest` as a snapshot, not a pointer** | The cache dir is named after the spec at first install and reused forever |

</best_practices>
