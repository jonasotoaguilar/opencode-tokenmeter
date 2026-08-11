# Publishing Plugins

> How to publish plugins to npm

<instructions>

## Before Publishing - Ask the User

Before creating a publishable package, MUST ask the user:

1. **Package name**: What should the npm package be called?
   - Unscoped: `opencode-my-plugin`
   - Scoped: `@username/opencode-my-plugin`

2. **npm scope/username**: If scoped, what's their npm username or org?

3. **Version**: Starting version? (default: `0.1.0`)

4. **License**: MIT, Apache-2.0, etc.? (default: MIT)

5. **Description**: One-line description of what the plugin does

<example>

**Example prompt:**

> "Before I create the npm package, I need a few details:
>
> 1. What should the package name be? (e.g., `opencode-background-process` or `@yourusername/opencode-background-process`)
> 2. What's your npm username/scope if using a scoped package?
> 3. Starting version? (default: 0.1.0)
> 4. License? (default: MIT)"

</example>

## How OpenCode Manages Plugins

**Users do NOT need to run `npm install`** - OpenCode automatically installs plugin dependencies at runtime.

Users simply add the plugin name to their config:

```jsonc
{
  "plugin": [
    "my-plugin@1.0.0", // Pinned version - won't auto-update
    "another-plugin", // No version = "latest" - updates on launch
  ],
}
```

**On launch, OpenCode:**

1. Runs `bun add --force` for each plugin (auto-installs)
2. Caches pinned versions until user changes config
3. For unpinned plugins, resolves `latest` and caches actual version

This means the README SHOULD NOT include `npm install` instructions - just tell users to add the plugin to their config.

**Users MUST restart OpenCode** after adding or changing a plugin in their config for it to take effect.

For local development (no npm), point config at the built output or source directly instead of a package name:

```jsonc
{
  "plugin": [
    "/abs/path/to/my-plugin/dist/index.js", // built output
    "file:///abs/path/to/my-plugin/index.ts" // source
  ]
}
```

</instructions>

<checklist>

## Entrypoint Contract — ship exactly the artifacts your plugin kind needs

The public surface of a published plugin is its `dist/` artifact pair(s) plus the `exports` map that resolves them. Ship exactly the pair your plugin kind needs, never extra names. The file names are the convention: `tui.js`/`tui.d.ts` for TUI plugins, `index.js`/`index.d.ts` for server/runtime plugins — generate only the pairs that apply.

| Plugin kind | Artifacts in `dist/` | Implements | Resolved by | Registered in |
| --- | --- | --- | --- | --- |
| TUI-only (sidebar, tabs, toasts, statusline) | `tui.js` + `tui.d.ts` | `TuiPlugin` | `exports["./tui"]` (plus `"."` → the same pair for legacy resolvers) | `tui.json` |
| Server/runtime-only (hooks, tools, auth, event processing) | `index.js` + `index.d.ts` | `Plugin` | `exports["."]` or an explicit subpath such as `exports["./runtime"]` | `opencode.json` |
| Dual (server + TUI in one package) | `index.*` + `tui.*` | `Plugin` + `TuiPlugin` | `"."` → `index.*`, `"./tui"` → `tui.*` (one bundle per entry; see `references/build-and-release.md` §7) | both: `opencode.json` + `tui.json` |

Rules:

- **`tui.*` is a TUI plugin**: it implements `TuiPlugin`, resolves through `exports["./tui"]` — `main` is ignored for TUI loading — and registers in `tui.json`. A TUI package without that subpath (or with a missing/null `exports` map) does not load; that is the classic silent failure of a package that only sets `main`.
- **`index.*` is the normal/server plugin**: it implements `Plugin` (hooks, tools, auth, event processing), resolves through `exports["."]` (or an explicit subpath such as `exports["./runtime"]`) and registers in `opencode.json` with the corresponding spec. The TUI loader NEVER loads `index.*`.
- **An `index.js` may be the companion runtime of a TUI** (data collection/persistence/processing, e.g. the experimental `./runtime` of opencode-subagent-statusline) — but it is a separate `Plugin` entry, not a TUI artifact, and is loaded only when registered in `opencode.json`.
- **A dual package loads both runtimes**: the server/runtime entry from `opencode.json`, the TUI entry from `tui.json`. Document BOTH entries/configs in the README — never suggest one config covers both.
- **Never generate or ship `index.js`/`index.d.ts` in a TUI-only package.** Without a real server/runtime entry, an `index.*` pair is dead weight that misleads consumers (and this skill's dual-entry pattern is NOT an excuse to add it).
- Every artifact pair ships both files: the `.js` bundle and the `.d.ts` declaration (emitted from the entry with the project's own TypeScript, e.g. `tsc --emitDeclarationOnly` scoped to the entry).
- `main`/`types` mirror the single loadable entry for legacy resolvers (TUI-only: point both at `tui.*`).

TUI-only `package.json` (bun-built example):

```json
{
  "name": "opencode-my-tui-plugin",
  "type": "module",
  "main": "./dist/tui.js",
  "types": "./dist/tui.d.ts",
  "exports": {
    ".": { "types": "./dist/tui.d.ts", "import": "./dist/tui.js" },
    "./tui": { "types": "./dist/tui.d.ts", "import": "./dist/tui.js" }
  },
  "files": ["dist"]
}
```

## Publishing Checklist

1. **Package structure:**

   ```
   my-plugin/
   ├── src/
   │   └── index.ts          # Main plugin entry
   ├── dist/                  # Built output (gitignored)
   ├── package.json
   ├── tsconfig.json
   ├── README.md
   ├── LICENSE
   ├── example-opencode.json  # Example config for users
   ├── .gitignore
   └── .npmignore
   ```

2. **package.json** (replace placeholders with user's answers):

   ```json
   {
     "name": "<PACKAGE_NAME>",
     "version": "<VERSION>",
     "description": "<DESCRIPTION>",
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": {
       ".": {
         "types": "./dist/index.d.ts",
         "import": "./dist/index.js"
       }
     },
      "files": ["dist", "README.md", "LICENSE"],
      "keywords": ["opencode", "opencode-plugin", "plugin"],
      "license": "<LICENSE>",
      "dependencies": {
        "<RUNTIME_DEP_1>": "<VERSION>"
      },
      "peerDependencies": {
        "@opencode-ai/plugin": ">=1.14.50 <2"
      },
     "devDependencies": {
       "@opencode-ai/plugin": "^1.14.50",
       "@types/bun": "^1.2.0",
       "@types/node": "^22.0.0",
       "tsup": "^8.5.1",
       "typescript": "^5.7.0"
     },
     "scripts": {
       "build": "tsup",
       "prepack": "npm run build",
       "typecheck": "tsc --noEmit",
       "test": "vitest run",
       "audit:prod": "npm audit --prod --audit-level moderate",
       "pack:dry-run": "npm pack --dry-run"
     },
     "publishConfig": {
       "access": "public",
       "provenance": true
     }
   }
   ```

   Notes:
   - MUST use `peerDependencies` for `@opencode-ai/plugin` - OpenCode provides this at runtime
   - MUST declare in `dependencies` every module the compiled artifact imports at runtime — never only `devDependencies`. The consumer installs only `dependencies` (OpenCode runs `bun add --force <package>`), so a runtime import that lives only in `devDependencies` fails to resolve after install. TUI plugins are the common trap: a bundle importing `@opentui/solid` / `solid-js` (or `@opentui/core`) must ship them as `dependencies`. Verify the bundle's external imports (`rg -o 'from "[^"]+"' dist/*.js` / `require(...)`) and declare every bare import that is not provided by the host.
   - MUST add `"publishConfig": { "access": "public" }` for scoped packages
   - MUST point `main`/`types` at `dist/` output; the `prepack` script builds before both `npm pack` and `npm publish`
   - Use an `exports` map to define the public entrypoint, following the Entrypoint Contract above: a TUI plugin MUST expose `"./tui"` (OpenCode's TUI resolution path), a server-only plugin exposes `.` only, a dual plugin exposes both with separate bundles (see `references/build-and-release.md` §7). Never ship `index.*` in a TUI-only package.
   - Add `"publishConfig": { "provenance": true }` for signed npm provenance from GitHub Actions (requires public package + OIDC; see `references/build-and-release.md` §5)

3. **example-opencode.json:**

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["<PACKAGE_NAME>"]
   }
   ```

4. **README.md Installation Section:**

   ````markdown
   ## Installation

   Add to your `opencode.json`:

   ```json
   {
     "plugin": ["<PACKAGE_NAME>"]
   }
   ```

   OpenCode automatically installs plugin dependencies at runtime.

   > **TUI plugins** (e.g. `sidebar_content` slot) are NOT installed via `opencode.json` — register them in `tui.json` instead (see `references/tui-reactivity.md`):
   >
   > ```json
   > {
   >   "$schema": "https://opencode.ai/tui.json",
   >   "plugin": ["<PACKAGE_NAME>"]
   > }
   > ```

   Dual packages document BOTH configs — the server/runtime entry in `opencode.json`, the TUI entry in `tui.json`; never imply that one config loads both runtimes.
   ````

5. **Pre-publish gates (MUST all pass):**

   ```bash
   npm run typecheck
   npm test
   npm run audit:prod
   npm run pack:dry-run
   ```

   Inspect the `pack:dry-run` listing: `dist/`, `README.md`, `LICENSE` present; `src/`, tests, configs, and secrets absent. See `references/build-and-release.md` §3-4 for details.

6. **Publish:**

   For scoped packages (first time):

   ```bash
   npm publish --access public
   ```

   For unscoped or subsequent publishes:

   ```bash
   npm publish
   ```

   For repeatable releases, automate instead: conventional commits + semantic-release on `main` in GitHub Actions (npm + GitHub release/tag, npm provenance/OIDC, frozen lockfile install, no committed tokens). Full workflow in `references/build-and-release.md` §5. Keep the manual path above working as a fallback.

</checklist>

<update_notifications>

## Update Notifications for Pinned Versions

When users pin to a specific version (e.g., `my-plugin@1.0.0`), they won't see updates automatically.

SHOULD include an update checker that shows a toast when newer versions are available. See `references/update-notifications.md` for the full implementation.

</update_notifications>

<common_mistakes>

## Common Mistakes

| Mistake                         | Fix                                  |
| ------------------------------- | ------------------------------------ |
| Missing `type: "module"`        | Add to package.json                  |
| Not building before publish     | Add `prepack` script (runs for pack and publish) |
| Wrong main entry                | Point to compiled JS in `dist/`, not TS |
| Missing @opencode-ai/plugin dep | Add as peerDependency                |
| Publishing without tarball check| Run `npm run pack:dry-run` first     |
| Assets missing from package     | Bundle inlines JS only; ship assets via `files` |
| Scoped package 404              | Add `publishConfig.access: "public"` |
| Committed npm token             | Never commit `.npmrc` auth tokens; use CI secrets |
| Assumed package name            | MUST ask user for name/scope first   |

</common_mistakes>
