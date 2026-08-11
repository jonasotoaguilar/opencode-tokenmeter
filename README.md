# opencode-tokenmeter

A live [OpenCode](https://opencode.ai) TUI sidebar for token usage, cost, and the delegation tree of your sessions — updated in real time, without ever remounting the panel.

## How it works

TokenMeter registers a `sidebar_content` slot (order 95) that renders a collapsible panel with two metric sections:

- **Session** — the active session and every delegated descendant: headline context (one snapshot per session, max observed), thinking, cost, the input · output real · cache breakdown, and a per-agent group list (`↳ agent · N task`) ordered by context weight, with a 6-row scrollbox when 3+ groups exist.
- **Project** — all-time usage of the current project across directories/worktrees, including deleted sessions, persisted as a history ledger in the host `kv` store.

The panel repaints when events arrive because each refresh event invalidates the affected session and schedules a debounced reconcile that **rehydrates from the authoritative client messages** (replace, never merge) — a stale in-memory mirror can never win over fresh data. The Subagents chevron toggles the delegation list; the expanded state is persisted in `api.kv` (`tokenmeter.sidebar.expanded`, collapsed by default).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event → invalidation → reconcile flow.

## Requirements

| Requirement | Value |
| --- | --- |
| OpenCode | recent version with TUI plugin support |
| Runtime | Bun/Node >= 22 (host provides the plugin SDK) |
| Nerd Fonts | installed and active in the terminal (PUA glyphs) |
| Package manager | Bun 1.3.11 (development) |
| Biome | formatter + linter (dev and CI), see below |

## Install

### 1. Register the plugin in OpenCode

Add the plugin to your OpenCode config (`opencode.json` at project or user level):

```jsonc
{
  "plugin": ["opencode-tokenmeter"]
}
```

OpenCode resolves and installs npm plugin names automatically — there is no `npm install` step. For local development, point at the built output instead:

```jsonc
{
  "plugin": ["/abs/path/to/opencode-tokenmeter/dist/tokenmeter.js"]
}
```

The plugin registers the `sidebar_content` slot with `order: 95` on load — no manual slot configuration is needed. **Restart OpenCode** after changing the plugin config.

### 2. Verify

Open a session and check the right sidebar: a `TokenMeter 1.0.0` panel with `Project` and `Session` metric rows appears. The `Subagents ▶` row expands the delegation list; the panel starts collapsed.

## Development

### Setup

```bash
bun install          # frozen lockfile preferred after first install
```

### Scripts

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc -p tsconfig.json && tsc -p tsconfig.test.json` |
| `bun run test` | Unit tests (bun:test) — no build required |
| `bun run coverage` | Tests with coverage (lcov + text) — 80/80/80 statements/functions/lines per source file; Bun has no branch metric; `dist/**` excluded as generated output |
| `bun run build` | Bundles `src/tokenmeter.tsx` into `dist/tokenmeter.js` via `scripts/build.ts` |
| `bun run test:dist` | `bun run build` first, then the artifact regression test against `dist/tokenmeter.js` |
| `bun run audit` | `bun audit` |
| `bun run biome:check` | Read-only Biome gate: formatter + linter over `src`, `test`, `scripts`, TS configs |
| `bun run biome:format` | Apply the Biome formatter to the same files |
| `bun run pack:dry-run` | Inspect the tarball contents before publishing |
| `bun run prepack` | Runs `bun run build` automatically on `pack`/`publish` |
| `bun run hooks:install` | Install the repo-local Lefthook pre-commit hook |

`test` and `test:dist` are distinct on purpose: the unit suite never needs a build, and the dist test is never silently skipped — it fails hard if `dist/tokenmeter.js` is missing or non-reactive.

### The build guard

`bun run build` compiles the entry with `@opentui/solid`'s `createSolidTransformPlugin` (via `bun build`, external runtime packages). Loading the source `.tsx` through Bun's ordinary eager JSX transform would emit `jsxDEV` calls with eagerly evaluated props — and the mounted sidebar would **never repaint**. The build script post-checks the artifact for real `effect`/`insert`/`insertNode` bindings and forbids `jsxDEV`/`jsx-runtime`, failing loudly instead of shipping a frozen panel.

### Biome

[Biome](https://github.com/biomejs/biome) is the formatter and linter for this repo — one fast tool that formats, lints, and organizes imports, configured by a single `biome.json`. Official repository: <https://github.com/biomejs/biome>.

```bash
bun run biome:check    # formatter + linter, no writes
bun run biome:format   # apply the formatter to the same files
```

### Package and release overview

- Releases are **tag-driven**: merge to `main` with the version in sync, then push a stable `vX.Y.Z` tag — the release workflow preflights, publishes to npm with provenance, and creates the GitHub Release. Conventional Commits between tags become the release notes.
- Publishing uses npm **provenance** (OIDC): `publishConfig.provenance` plus the `id-token` permission in the release workflow.
- No tokens are ever committed; secrets reach the workflow only through the `release` environment's `env:`.

## Project tree

```text
.
├── src/
│   ├── tokenmeter.tsx         # entry: event wiring, kv state, slot registration
│   └── tokenmeter/            # modules: store, reconcile, tree, groups,
│                              #   project, ledger, math, numbers, format,
│                              #   text, glyphs, types + panel/ (entry,
│                              #   group-rows, project-section)
├── test/                      # 90 bun:test tests (harness, render, artifact)
├── scripts/
│   ├── build.ts               # bundled dist with the reactive-binding guard
│   └── release-*              # release pipeline hooks (preflight, publish, verify)
├── skills/opencode-plugin/    # versioned plugin-development skill (authoritative)
├── docs/                      # CODEBASE-GUIDE, codebase/, adr/, skill-style-guide
├── PRD.md
├── ARCHITECTURE.md
├── DESIGN.md
└── package.json
```

## Documentation

| Your task | Start here |
|-----------|------------|
| Product intent and scope | [PRD.md](PRD.md) |
| Architecture: flows, module map, decisions | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Panel layout, colors, glyphs, states | [DESIGN.md](DESIGN.md) |
| Navigate the code / dev commands | [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md) |
| Branch policy, PR gates, labels | [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| Report a vulnerability | [SECURITY.md](.github/SECURITY.md) |
| Authoring the bundled skill | [docs/skill-style-guide.md](docs/skill-style-guide.md) |

## License

MIT — see [LICENSE](LICENSE).
