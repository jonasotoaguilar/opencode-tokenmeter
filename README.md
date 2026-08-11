<div align="center">

<h1>opencode-tokenmeter</h1>

<p><strong>opencode-tokenmeter — a live token-usage, cost, and delegation-tree sidebar for the OpenCode TUI.</strong></p>

<p>
<a href="https://github.com/jonasotoaguilar/opencode-tokenmeter/releases"><img src="https://img.shields.io/github/v/release/jonasotoaguilar/opencode-tokenmeter" alt="Release"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
<img src="https://img.shields.io/badge/Bun-1.3.11-black?logo=bun&logoColor=white" alt="Bun 1.3.11">
<img src="https://img.shields.io/badge/Node-%3E%3D22-green" alt="Node >= 22">
<img src="https://img.shields.io/badge/platform-OpenCode%20TUI-lightgrey" alt="Platform: OpenCode TUI">
</p>

</div>

---

> [!IMPORTANT]
> TokenMeter is a **TUI plugin**: you register it in `tui.json`, **never** in `opencode.json`'s `plugin` array — `opencode.json` configures server/runtime behavior only.

## What It Does

TokenMeter registers a `sidebar_content` slot (`order: 95`) that renders a collapsible panel for the active session and its delegated descendants, updated in real time. The panel repaints when events arrive: each refresh event invalidates the affected session and schedules a debounced reconcile that rehydrates from the authoritative client messages (replace, never merge) — a stale in-memory mirror can never win over fresh data.

- **Session** — the active session and every delegated descendant: headline token spend (each session's complete CUMULATIVE spend — `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write` across ALL assistant messages, exactly reconstructing the provider's billed `tokens.total`, with every component kept as a per-field high-water so compaction never lowers it), thinking, cost, the input · output real · cache R/W breakdown, and a per-agent group list (`↳ agent · N task`) ordered by spend weight, with a 6-row scrollbox when 3+ groups exist. The `Subagents ▶` row toggles the delegation list; the panel starts collapsed.
- **Project** — all-time usage across directories/worktrees: the authoritative live `session.list` total (fetched with an explicit 10_000-session limit — the SDK default of 100 would silently undercount) plus one deleted-session aggregate per project, persisted in a plugin-owned SQLite store (`tokenmeter.sqlite` under the host state directory — never `api.kv`, whose whole-file read-modify-write would be clobbered by concurrent TUIs). Deleting a session records its final usage into that aggregate atomically and exactly once (tombstone admission), so duplicates, cascades and concurrent TUIs never inflate totals; a truncated list (at the cap) fails closed with the stable error line instead of showing a partial total; a ~2 s polling timer keeps the sidebar fresh when another OpenCode process works in the same project.

**Before**: you approximate spend from provider dashboards, and delegation spread is invisible.

**After**: cost, token spend, and the delegation tree of every session are one glance away, live in the terminal.

### Aggregation scopes

Each section answers a different question. **Project already includes the active Session, so never add Project + Session together.**

| Section | What it represents | How it is calculated |
| --- | --- | --- |
| **Project** | All-time usage for the current OpenCode project across directories and worktrees, including deleted sessions | Sum of every live principal-session tree plus the persisted deleted-tree aggregate. Each session ID contributes exactly once; totals survive deletion and restart. |
| **Session** | The active principal session and its complete recursive delegation tree | Active root session spend + every child, grandchild, and deeper delegated session exactly once. Switching the active route switches this scope. |
| **Subagents** | Delegated descendants of the active Session; the principal/root session is excluded | `agents` counts distinct resolved agent types; `task` counts descendant sessions. Expanded rows group descendants by agent type and sum every run in that group. |
| **Agent group** | All delegated runs resolved to one agent type, such as `general` or `sdd-apply` | Sum of the cumulative spend, thinking, cost, input, output, and cache for that group's descendant sessions. Groups are ordered by token spend. |

For every scope, cumulative token spend uses the same formula: `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write`.

### Displayed metrics

The sidebar uses Nerd Font glyphs. The codepoint and name remain authoritative when a Markdown renderer cannot display a PUA glyph.

| Icon / codepoint | Metric | Displayed value |
| --- | --- | --- |
| `U+EDE8` (`fa-coins`) | Cumulative token spend | `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write`; rendered in fixed coin gold `#D4AF37` |
| `U+EE9C` (reasoning) | Thinking | Cumulative reasoning tokens; also included once in real output and total spend |
| `U+F0238` (`md-fire`) | Cost | USD cost calculated by OpenCode from the model's input/output/cache rates |
| `↑` | Input | Cumulative non-cached input tokens |
| `↓` | Real output | Cumulative visible output + reasoning tokens |
| `U+F472` (`oct-database`) | Prompt cache | `R<read>|W<write>`; zero sides are omitted and both-zero renders `0` |
| `U+F06A9` (`md-robot`) | Agents | Distinct delegated agent types and each group identity |
| `U+E20F` (tasks) | Delegations/runs | Recursive delegated session count or runs in an agent group |

Every functional glyph has exactly two visible spaces before its value. Project and Session use the same metric contract; expanded Subagent groups repeat it per agent.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event → invalidation → reconcile flow.

---

## Quick Start

### 1. Register the plugin in OpenCode

Add the plugin to your TUI config (`~/.config/opencode/tui.json` user-level, `.opencode/tui.json` project-level, or `tui.jsonc` — all work):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@jonasotoaguilar/opencode-tokenmeter"]
}
```

OpenCode resolves npm package names for TUI plugins and installs them automatically — there is no `npm install` step. The plugin registers the `sidebar_content` slot with `order: 95` on load — no manual slot configuration is needed. **Restart OpenCode** after changing a TUI plugin or its `tui.json` entry.

<details>
<summary><strong>Local development instead of the npm package</strong></summary>

Point at the built artifact (run `bun run build` first):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/abs/path/to/opencode-tokenmeter/dist/tokenmeter.js"]
}
```

</details>

### 2. Verify

Open a session and check the right sidebar: a `TokenMeter 1.0.0` panel with `Project` and `Session` metric rows appears. The `Subagents ▶` row expands the delegation list; the panel starts collapsed.

---

## Development

### Setup

```bash
bun install          # frozen lockfile preferred after first install
```

### Commands

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc -p tsconfig.json && tsc -p tsconfig.test.json` |
| `bun run test` | Unit tests (bun:test) — no build required |
| `bun run coverage` | Tests with coverage (lcov + text) — the gate keeps every source file at ≥80% statements/functions/lines; Bun has no branch metric; `dist/**` excluded as generated output |
| `bun run build` | Bundles `src/tokenmeter.tsx` into `dist/tokenmeter.js` via `scripts/build.ts` |
| `bun run test:dist` | `bun run build` first, then the artifact regression test against `dist/tokenmeter.js` |
| `bun run audit` | `bun audit` |
| `bun run biome:check` | Read-only Biome gate: formatter + linter over `src`, `test`, `scripts`, TS configs |
| `bun run biome:format` | Apply the Biome formatter to the same files |
| `bun run hooks:install` | Install the repo-local Lefthook pre-commit hook |
| `bun run pack:dry-run` | Inspect the tarball contents before publishing |

The suite runs **99 tests / 0 failures across 3 files** (899 `expect` calls) on Bun 1.3.11. `test` and `test:dist` are distinct on purpose: the unit suite never needs a build, and the dist test is never silently skipped — it fails hard if `dist/tokenmeter.js` is missing or non-reactive.

### The build guard

`bun run build` compiles the entry with `@opentui/solid`'s `createSolidTransformPlugin` (via `bun build`, external runtime packages). Loading the source `.tsx` through Bun's ordinary eager JSX transform would emit `jsxDEV` calls with eagerly evaluated props — and the mounted sidebar would **never repaint**. The build script post-checks the artifact for real `effect`/`insert`/`insertNode` bindings and forbids `jsxDEV`/`jsx-runtime`, failing loudly instead of shipping a frozen panel.

### Biome

[Biome](https://github.com/biomejs/biome) (2.5.x) is the formatter and linter — one fast tool that formats, lints, and organizes imports, configured by a single `biome.json`.

### Package and release

- Releases are **tag-driven**: push a stable `vX.Y.Z` tag — the release workflow preflights, publishes to npm with provenance, and creates the GitHub Release.
- Publishing uses npm **Trusted Publishing (OIDC)** with provenance: no npm tokens exist, and publication runs in the protected `release` environment.
- The first-ever publish is a one-time **manual authenticated bootstrap** (dist-tag `bootstrap`); the procedure, the npmjs trusted-publisher binding, and the full control list live in [docs/release-security.md](docs/release-security.md).

---

## Project structure

```text
.
├── src/
│   ├── tokenmeter.tsx         # entry: event wiring, kv state, slot registration
│   └── tokenmeter/            # modules: store, reconcile, tree, groups,
│                              #   project, db, math, numbers, format,
│                              #   text, glyphs, types + panel/ (entry,
│                              #   group-rows, project-section)
├── test/                      # 107 bun:test tests (harness, render, artifact)
├── scripts/
│   ├── build.ts               # bundled dist with the reactive-binding guard
│   └── release-*              # release pipeline hooks (preflight, publish, verify)
├── skills/
│   ├── opencode-plugin/       # versioned plugin-development skill (authoritative)
│   └── npm-secure-config/     # npm/pnpm/Bun security-configuration skill
├── docs/                      # CODEBASE-GUIDE, codebase/, adr/, skill-style-guide
├── openspec/                  # spec-driven requirements (specs/, changes/)
├── PRD.md
├── ARCHITECTURE.md
├── DESIGN.md
├── AGENTS.md
└── package.json
```

---

## Documentation

| Your task | Start here |
| --- | --- |
| Product intent and scope | [PRD.md](PRD.md) |
| Architecture: flows, module map, decisions | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Panel layout, colors, glyphs, states | [DESIGN.md](DESIGN.md) |
| Understand the data-flow mental model | [docs/codebase/mental-model.md](docs/codebase/mental-model.md) |
| Navigate the code / dev commands | [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md) |
| Architecture decision records | [docs/adr/](docs/adr/) |
| Release pipeline security (controls, bootstrap, drift checklist) | [docs/release-security.md](docs/release-security.md) |
| Authoring the bundled skill | [docs/skill-style-guide.md](docs/skill-style-guide.md) |
| Branch policy, PR gates, labels | [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| Report a vulnerability | [.github/SECURITY.md](.github/SECURITY.md) |

---

## Next Steps

- **User** — install and register the plugin in [Quick Start](#quick-start), then explore the delegation tree in the sidebar.
- **Developer** — start from [docs/codebase/mental-model.md](docs/codebase/mental-model.md), then follow [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md).
- **Maintainer** — read [docs/release-security.md](docs/release-security.md) before the first release.

---

<div align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</div>
