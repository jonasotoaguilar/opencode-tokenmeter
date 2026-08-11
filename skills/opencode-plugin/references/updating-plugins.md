# Updating Installed Plugins

> Why OpenCode plugins go stale, and the official update path

<overview>

OpenCode installs npm plugins **cache-first** (see `plugin-loading.md` for the full load cycle): once a package is in the local package cache, it is reused forever — OpenCode never re-checks npm for a newer version. There is no auto-update, no TTL, and no version comparison. A bare plugin name in the config normalizes to `@latest`, but that `@latest` is only the cache directory name — a label, not a live pointer. The official update mechanism is the `opencode plugin` CLI command with an explicit version pin.

</overview>

<mechanism>

## Why plugins go stale (verified against opencode source)

`Npm.add` in `packages/core/src/npm.ts` returns the cached install without consulting npm when the directory exists:

```ts
// packages/core/src/npm.ts — Npm.add
if (yield* afs.existsSafe(path.join(dir, "node_modules", name))) {
  return resolveEntryPoint(name, path.join(dir, "node_modules", name)) // ← reuse, never checks npm
}
const tree = yield* reify({ dir, add: [pkg] }) // ← only installs when the cache dir is absent
```

The cache directory is derived from the spec: `path.join(global.cache, "packages", sanitize(pkg))` — so `name@latest` and `name@1.2.3` are **different directories**. A bare spec is normalized before install:

```ts
// packages/opencode/src/plugin/shared.ts — resolvePluginTarget
const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
```

Consequences:

- `"plugin": ["my-plugin"]` installs into `packages/my-plugin@latest/` once, forever.
- Publishing `my-plugin@1.2.0` changes nothing for existing users: their `@latest` cache dir still exists, so `Npm.add` returns it without a registry call.
- `opencode plugin my-plugin --force` (bare, no version) does NOT update either — the spec normalizes to `@latest`, the cache dir exists, and the config patch is a no-op for an identical entry.

</mechanism>

<official_update>

## The official update command

```bash
opencode plugin <name>@<version> --force
# e.g.
opencode plugin my-plugin@1.2.0 --force
opencode plugin my-plugin@1.2.0 --force --global   # global config
```

Why it works:

1. The version pin creates a **new cache directory** (`packages/name@1.2.0`), which does not exist → guaranteed fresh install.
2. OpenCode detects the entrypoint and patches only the matching config (`tui.json` for TUI plugins, `opencode.json` for server/runtime plugins).
3. `--force` replaces the existing entry in the config (without it, an already-configured plugin is a no-op).

There is no auto-update anywhere in OpenCode — the CLI command IS the update flow. Do not hand-delete the cache directory; the pin-based command is the supported path.

</official_update>

<automation>

## Automating updates (recommended pattern)

Ship an update script with your plugin and expose it as a `bin` — the context-mode pattern adapted to OpenCode. The script MUST only ever update **its own package** (read its name from the package.json that ships next to it); a plugin bin must not touch other plugins' config entries.

```jsonc
// package.json
{
  "name": "my-plugin",
  "files": ["dist", "scripts/update-plugin"],
  "bin": { "my-plugin": "./scripts/update-plugin" }
}
```

```bash
my-plugin                    # update this plugin if outdated (npx my-plugin works too)
my-plugin --check            # report only; exit 2 if outdated (CI-friendly)
my-plugin --dry-run          # show the command without running it
my-plugin --global           # only the global config
my-plugin --local            # only the local config
```

**Users without the repository** install the helper from the repo via the official one-liner (the `curl | bash` pattern — same as gentle-ai's installer), not by cloning it:

```bash
curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/scripts/install.sh | bash
my-plugin-update --check     # report if the plugin is outdated
my-plugin-update             # update via the official command
```

The `install.sh` script downloads `update-plugin` from the repository into `~/.local/share/<package>/`, writes a minimal `package.json` next to it (so the helper can identify its own package without a checkout), and installs a launcher at `~/.local/bin/<package>-update`. The helper must accept `--package <name>` as an override for exactly this case (no manifest next to the script when executed standalone).

Why the installer and not `npm install -g <package>`: a published plugin pulls runtime dependencies whose transitive install scripts are blocked by npm's `strict-allow-scripts` security default (which is on by default in newer npm). The update helper itself needs none of those dependencies — it is plain bash + node — so the curl installer is both lighter and unblockable.

How the helper works:

1. Reads its own name from the `package.json` in the directory above the script (`--package <name>` overrides when there is none, e.g. curl|bash execution).
2. Finds that plugin's entry in the opencode configs (global `~/.config/opencode/{tui,opencode}.json[c]`, local `./{tui,opencode}.json[c]` and `./.opencode/`).
3. Resolves the registry's latest version (`npm view <name> version`).
4. Reads the actually-installed version from the package cache (`~/.cache/opencode/packages/<spec>/node_modules/<name>/package.json`).
5. Compares semver; if outdated, runs the exact official command `opencode plugin <name>@<latest> --force [--global]` for its own entry only.

Exit codes: `0` up to date / updated, `1` error, `2` `--check` found updates.

**Version reference** — users can see both versions from bash:

```bash
my-plugin --check                     # "installed 1.0.0 = latest 1.0.0" or "installed 1.0.0 → latest 1.0.1"
npm view my-plugin version            # latest published version, independent of the install
my-plugin                             # update to latest (runs the official command)
```

Pairing this with the update toast (see `update-notifications.md`) gives users both a heads-up and a one-command fix.

### Why a `bin`, not a `postinstall`

OpenCode installs plugin packages with `ignoreScripts: true` (`packages/core/src/npm.ts`, `Npm.reify`). A `postinstall` script in a published plugin **never runs** when opencode installs it — and relying on third-party install scripts is exactly the supply-chain risk `ignore-scripts` exists to block. The update mechanism MUST be an explicit user action: a `bin` entry (or a documented command), never an install-time script.

</automation>

<comparison>

## How the ecosystem does it

**context-mode** (`context-mode upgrade` / `ctx_upgrade` MCP tool) ships its own upgrade command as a package `bin`: it fetches `https://registry.npmjs.org/context-mode/latest`, compares with the local version, and then pulls + rebuilds + reconfigures hooks. The transferable pattern: a registry check at startup or on demand, plus a self-update command the user can run. For OpenCode plugins the "rebuild" step is unnecessary — `opencode plugin <name>@<version> --force` does the install and config patch — so the package `bin` pattern reduces to exactly the update script described above.

</comparison>

<best_practices>

## Best Practices

| Practice | Reason |
| --- | --- |
| **Always pin versions in release docs and toasts** | `@latest` is a cache label; only a pin guarantees a fresh install |
| **Document the official command in the README** | Users must run `opencode plugin <name>@<version> --force`, not delete caches |
| **Expose a `bin` or update script** | Lets users self-serve the update (context-mode pattern) |
| **The update script only touches its own package** | A plugin bin must not modify other plugins' config entries |
| **Update toast → official command** | The notification should tell users the exact command (see `update-notifications.md`) |
| **Check at startup, never block** | Registry check is best-effort; fail silently (see `update-notifications.md`) |
| **No auto-update promise** | OpenCode has no auto-update; don't imply one |

</best_practices>
