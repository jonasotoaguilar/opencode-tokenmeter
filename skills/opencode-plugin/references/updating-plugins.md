# Updating Installed Plugins

> Why OpenCode plugins go stale, and how to update them

<overview>

OpenCode installs npm plugins **cache-first** (see `plugin-loading.md` for the full load cycle): once a package is in the local package cache, it is reused forever — OpenCode never re-checks npm for a newer version. There is no auto-update, no TTL, and no version comparison. A bare plugin name in the config normalizes to `@latest`, but that `@latest` is only the cache directory name — a label, not a live pointer.

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

The cache directory is derived from the config entry: `path.join(global.cache, "packages", sanitize(spec))`. A bare spec is normalized before install:

```ts
// packages/opencode/src/plugin/shared.ts — resolvePluginTarget
const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
```

Consequences:

- `"plugin": ["my-plugin"]` installs into `packages/my-plugin@latest/` once, forever — the load path never consults npm again for that directory.
- Publishing `my-plugin@1.2.0` changes nothing for existing users: their `@latest` cache dir still exists, so `Npm.add` returns it without a registry call.
- `opencode plugin my-plugin --force` (bare or `@latest`) does NOT update either — the spec normalizes to `@latest`, the cache dir exists, and the config patch is a no-op for an identical entry.

</mechanism>

<official_update>

## The official update: remove the cache directory

Because the cache directory is keyed by the config entry, removing it forces a fresh install from npm on next start — and nothing accumulates:

```bash
rm -rf ~/.cache/opencode/packages/my-plugin@latest
# restart OpenCode → it reinstalls the latest published version automatically
```

- No version to remember or pin.
- The config stays untouched (bare entry keeps resolving to `@latest`).
- The same directory is reused forever — no per-version accumulation in the cache.
- If the config deliberately pins a version (`my-plugin@1.2.0`), remove that version's directory instead (`packages/my-plugin@1.2.0`).

The pinned CLI flow (`opencode plugin my-plugin@1.2.0 --force`) installs into a NEW cache directory (`packages/my-plugin@1.2.0`), which works but has two costs: it rewrites the config entry to the pin, and every update leaves the previous version's directory orphaned in the cache (verified: ~150MB per plugin version). Use the pin only when you deliberately want to fix a version, not as the routine update path.

**Never write `@latest` in the update command.** `name@latest` is the cache-directory label of a bare config entry: that directory already exists, so `Npm.add` returns it without consulting npm and nothing is reinstalled. There is no auto-update anywhere in OpenCode — the cache-removal step IS the update flow. A helper script adds nothing but convenience; document the `rm -rf` + restart in the README instead.

</official_update>

<update_notifications>

## Notifying users

Pair the update step with the toast (see `update-notifications.md`): the plugin checks npm at startup (non-blocking, fail-silent) and the toast tells the user the exact cache directory to remove.

</update_notifications>

<comparison>

## How the ecosystem does it

**context-mode** ships a `context-mode upgrade` CLI bin that fetches the registry latest version and self-updates. For OpenCode plugins that extra machinery is unnecessary — the load path is cache-keyed by config entry, so removing the cache directory is the complete update flow.

</comparison>

<best_practices>

## Best Practices

| Practice | Reason |
| --- | --- |
| **Document the cache-removal update** | `rm -rf ~/.cache/opencode/packages/<entry>` + restart is the reliable update; never claim `@latest` refreshes |
| **Keep bare entries for auto-latest installs** | A bare name resolves to `@latest` and reinstalls latest after cache removal — no config churn |
| **Pin only to fix a version** | A pin changes the cache directory; it is a version lock, not an update mechanism |
| **Update toast → exact cache path** | The notification should tell users the directory to remove (see `update-notifications.md`) |
| **Check at startup, never block** | Registry check is best-effort; fail silently (see `update-notifications.md`) |
| **No auto-update promise** | OpenCode has no auto-update; don't imply one |

</best_practices>
