# Build, Release, and Share Plugins

> How to package, verify, version, publish, and share an OpenCode plugin

<package_metadata>

## 1. Publishable package metadata

A plugin published to npm MUST be an ESM package that OpenCode resolves by name at runtime. OpenCode hosts the SDK, so `@opencode-ai/plugin` is a `peerDependencies` entry, never a regular dependency.

```json
{
  "name": "opencode-my-plugin",
  "version": "0.1.0",
  "description": "One-line description of what the plugin does",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "assets", "README.md", "LICENSE"],
  "keywords": ["opencode", "opencode-plugin", "plugin"],
  "license": "MIT",
  "packageManager": "pnpm@11.2.2",
  "engines": {
    "node": ">=22.13"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.14.50 <2"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.15.11",
    "@types/bun": "^1.2.0",
    "@types/node": "^22.0.0",
    "tsup": "^8.5.1",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "tsup",
    "prepack": "pnpm run build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "audit:prod": "pnpm audit --prod --audit-level moderate",
    "pack:dry-run": "pnpm pack --dry-run"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

Rules:

- `type: "module"` — OpenCode plugins run as ESM.
- `main`/`types` MUST point at built `dist/` output, never at `src/` TypeScript.
- `exports` — optional. A single-entry plugin may expose `.` only or omit the map; multiple entrypoints add subpaths (see §7).
- `files` — whitelist of what enters the tarball. Source, tests, and local config MUST NOT be listed.
- `peerDependencies` — every API the host provides (SDK, TUI runtime, shared libs). Duplicate them in `devDependencies` for local typechecking.
- `prepack` — runs on both `pnpm pack` and `pnpm publish`; build here so a packed/published artifact is never stale.
- `publishConfig.access: "public"` — required for scoped packages.

</package_metadata>

<single_file_bundle>

## 2. Single-file distribution with tsup

Bundle each entrypoint into one ESM file: `bundle: true`, `splitting: false`, one output per entry.

```ts
// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  bundle: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  dts: true,
});
```

- One entry key = one output file (`index` → `dist/index.js` + `dist/index.d.ts`).
- `dts: true` generates the `.d.ts` that `main`/`types` reference.

**A single JS file is NOT automatically self-contained.** `bundle: true` only inlines statically importable JS. The package still needs extra files shipped in `files` when the plugin uses:

- local dynamic imports (`import()` with computed paths),
- runtime assets (reads/`fetch`es files shipped in the package, e.g. an `assets/` folder),
- external runtime files (binaries, data files),
- `external: [...]` entries (host-provided modules kept out of the bundle).

Every such file MUST be listed in `package.json` `files` and verified with `pnpm pack --dry-run` (§3).

</single_file_bundle>

<packaging_boundary>

## 3. Packaging-boundary decision

For every non-SDK dependency, decide explicitly between two strategies:

| Strategy | When | How |
| --- | --- | --- |
| Bundle/vendor | Small, stable, private to the plugin | Let tsup inline it; nothing extra to ship |
| External prerequisite | Host-provided or heavy/shared | Declare as `peerDependencies`, document the requirement in the README, validate the version range |

- If you choose external: the README MUST document the prerequisite and the peer range MUST be validated in CI (`pnpm install` fails on range mismatch).
- NEVER mix: a dependency that is sometimes bundled and sometimes external breaks at runtime.

**Inspect the tarball before any publication:**

```bash
pnpm pack --dry-run
```

The listing shows exactly what npm will publish. Check: `dist/` output, declared `files`, `README.md`, `LICENSE` present; `src/`, tests, configs, `.env`-style files, and secrets absent. Add `"pack:dry-run": "pnpm pack --dry-run"` and run it in CI as a gate.

</packaging_boundary>

<gates>

## 4. Pre-publish gates

Run ALL of these before publishing (locally and in CI):

```bash
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level moderate
pnpm pack --dry-run
```

- `pnpm audit --prod` — fails on known vulnerabilities in shipped (production) dependencies. Resolve by updating dependencies, never by ignoring.
- `pnpm pack --dry-run` — verifies tarball contents (see §3).

**Local direct-dist testing** — test the actual artifact, not just the source:

```bash
pnpm build
```

Then load the built output directly in a throwaway config folder:

```jsonc
// /tmp/plugin-smoke/opencode.json
{
  "plugin": ["/abs/path/to/my-plugin/dist/index.js"]
}
```

```bash
cd /tmp/plugin-smoke
opencode run hi
```

**OpenCode config testing** — verify the real user path with the package name:

```jsonc
{
  "plugin": ["opencode-my-plugin"]
}
```

Restart OpenCode after every config change and check the logs for load errors before testing interactively.

</gates>

<versioning_release>

## 5. Versioning and release

- Use **conventional commits** (`feat:`, `fix:`, breaking changes via `feat!:` or a `BREAKING CHANGE` footer): they keep the git history readable; release notes are curated per release, never dumped from history.
- **Default: tag-driven release.** The release authorization is pushing a stable `vX.Y.Z` tag (`v*`, pre-release tags excluded); the version comes from the tag, never from hand-edited files. Three executable hooks implement the contract, each failing closed (`set -euo pipefail`):
  - `scripts/release-preflight` (read-only) — the tag must match `vX.Y.Z` and the `package.json` version; validates the **curated release notes** contract: `docs/releases/` holds exactly one document named `docs/releases/<tag>.md` (missing/multiple/misnamed fails), non-empty, no placeholders, H1 titles the tag version, narrative `## What changed` plus `## Upgrade`/`## Install` sections; runs the project's own CI gates; fails if the npm version or the GitHub Release already exists; never publishes.
  - `scripts/release-publish` (write-capable, single step) — derives the version from the tag, installs frozen, builds, sets the package version, `npm publish --provenance --access public`, and creates the GitHub Release from the curated notes file `docs/releases/<tag>.md` (never a raw `git log` dump, never `--generate-notes`). New releases rename the previous release document (`git mv docs/releases/<old-tag>.md docs/releases/<new-tag>.md`) and replace its content.
  - `scripts/release-verify` (read-only) — confirms the npm entry (version + tarball) and the GitHub Release exist from the outside.
  The release workflow triggers on `push: tags: ["v*", "!v*-*"]` only and runs preflight → publication → verification in a protected `release` environment; branch pushes never release.
- **semantic-release is one OPTIONAL engine** (branch-push model): it derives the next version, release notes, and tag from commits on `main`. Use it only when branch-push automation is wanted; the tag-driven model above keeps version control with the author. Configure `release` in `package.json`:

```json
"release": {
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

```yaml
# .github/workflows/release.yml (semantic-release option)
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 11.2.2
      - uses: actions/setup-node@v4
        with:
          node-version: 22.13
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --prod --audit-level moderate
      - run: pnpm pack --dry-run
      - run: pnpm exec semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
```

- **npm provenance/OIDC**: `"publishConfig": { "provenance": true }` + `id-token: write` permission; npm signs the release from GitHub OIDC (requires a public npm package and GitHub Actions builds). Applies to both release models.
- **Frozen installs**: `pnpm install --frozen-lockfile --ignore-scripts` in CI — never resolve fresh in CI.
- **No committed tokens**: secrets exist only in GitHub Actions secrets (`NPM_TOKEN`, `GITHUB_TOKEN`). Never commit `.npmrc` files containing auth tokens.
- **Keep a manual publish path**: local `npm publish` (authenticated) must keep working as a fallback when CI is unavailable.

</versioning_release>

<sharing_install>

## 6. Sharing and installation

OpenCode automatically resolves npm plugin names from config and installs them at runtime — users do NOT run `npm install`:

```jsonc
{
  "plugin": [
    "opencode-my-plugin@1.0.0", // pinned - no auto-update
    "opencode-my-plugin"        // unpinned - resolves latest
  ]
}
```

- Pinned versions stay cached until the user changes the config; unpinned resolves `latest` at launch.
- For local development, point config at the built output directly (`/abs/path/to/plugin/dist/index.js`) or at source with `file://` — no npm needed.
- Tell users to **restart OpenCode** after adding or changing a plugin in config.
- README installation section: show the config snippet and note auto-install; do NOT include `npm install` instructions.

</sharing_install>

<dual_entry>

## 7. Dual-entry `exports` (applicable pattern, not a requirement)

Plugins with more than one loadable module (e.g. a runtime entry and a TUI entry) can expose subpaths and build one bundle per entry:

```json
"exports": {
  ".":       { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./tui":   { "types": "./dist/tui.d.ts",   "import": "./dist/tui.js" }
}
```

```ts
// tsup.config.ts - one config object per entrypoint
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    bundle: true,
    splitting: false,
    clean: true,
    outDir: "dist",
    dts: true,
  },
  {
    entry: { tui: "src/tui.tsx" },
    format: ["esm"],
    bundle: true,
    splitting: false,
    clean: false,
    outDir: "dist",
    dts: true,
  },
]);
```

Apply this only when the plugin genuinely has multiple entrypoints. A single-entry plugin may expose `.` only or omit the map (see §1); it needs neither extra subpaths nor the split config.

</dual_entry>
