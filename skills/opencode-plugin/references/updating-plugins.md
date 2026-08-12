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

## The official update flow

Update to the LATEST published version — the command resolves the current version from the registry and pins it (no version to remember):

```bash
opencode plugin "my-plugin@$(npm view my-plugin version)" --force
opencode plugin "my-plugin@$(npm view my-plugin version)" --force --global
```

Why it works:

1. The version pin creates a **new cache directory** (`packages/name@<version>`), which does not exist → guaranteed fresh install.
2. OpenCode detects the entrypoint and patches only the matching config (`tui.json` for TUI plugins, `opencode.json` for server/runtime plugins).
3. `--force` replaces the existing entry in the config (without it, an already-configured plugin is a no-op).

**Never write `@latest` in the update command.** `name@latest` is the cache-directory label of a bare config entry: that directory already exists, so `Npm.add` returns it without consulting npm and nothing is reinstalled. "Update to latest" means resolving the concrete latest version (`npm view <name> version`) and pinning it. There is no auto-update anywhere in OpenCode — the pinned CLI command IS the update flow. Do not hand-delete the cache directory; the pin-based command is the supported path. A helper script adds nothing but convenience; document the command in the README instead.

</official_update>

<update_notifications>

## Notifying users

Pair the update command with the update toast (see `update-notifications.md`): the plugin checks npm at startup (non-blocking, fail-silent) and the toast tells the user the exact command to run.

</update_notifications>

<comparison>

## How the ecosystem does it

**context-mode** ships a `context-mode upgrade` CLI bin that fetches the registry latest version and self-updates. For OpenCode plugins that extra machinery is unnecessary — `opencode plugin <name>@<version> --force` already does the install and config patch, so the user-facing flow reduces to the pinned update command above.

</comparison>

<best_practices>

## Best Practices

| Practice | Reason |
| --- | --- |
| **Always pin versions in release docs and toasts** | `@latest` is a cache label; only a pin guarantees a fresh install |
| **Document the pinned update command in the README** | `opencode plugin "<name>@$(npm view <name> version)" --force`; never tell users to delete caches or write `@latest` |
| **Update toast → exact command** | The notification should tell users the exact command (see `update-notifications.md`) |
| **Check at startup, never block** | Registry check is best-effort; fail silently (see `update-notifications.md`) |
| **No auto-update promise** | OpenCode has no auto-update; don't imply one |

</best_practices>
