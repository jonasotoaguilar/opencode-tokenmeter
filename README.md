<div align="center">

<p>
<img src="docs/assets/brand/tokenmeter-banner.png" alt="TokenMeter banner" width="100%">
</p>

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

TokenMeter registers a `sidebar_content` slot (`order: 95`) that renders a collapsible panel for the active session and its delegated descendants, plus a `session_prompt_right` slot that renders a compact metrics line inline at the right end of the host's single native prompt row (the prompt is NOT replaced and no second status row is appended — the host prompt keeps its own native usage/status row) for the visible session only. Both repaint from the same cumulative high-water accounting when events arrive: each refresh event invalidates the affected session and schedules a debounced reconcile that rehydrates from the authoritative client messages (replace, never merge) — a stale in-memory mirror can never win over fresh data.

- **Session** — the active session and every delegated descendant: a primary token+cost line (each session's complete CUMULATIVE spend — `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write` across ALL assistant messages, exactly reconstructing the provider's billed `tokens.total`, with every component kept as a per-field high-water so compaction never lowers it) plus labeled secondary rows for input, output, reason, and cache, and a per-agent group list (`↳ agent (N tasks)`) ordered by spend weight. The panel starts with the master row expanded; the `Subagents` section appears automatically with the first delegated group and toggles from its heading.
- **Project** — all-time usage across directories/worktrees: the authoritative live `session.list` total (fetched with an explicit 10_000-session limit — the SDK default of 100 would silently undercount) plus one deleted-session aggregate per project, persisted in a plugin-owned SQLite store (`tokenmeter.sqlite` under the host state directory — never `api.kv`, whose whole-file read-modify-write would be clobbered by concurrent TUIs). Deleting a session records its final usage into that aggregate atomically and exactly once (tombstone admission), so duplicates, cascades and concurrent TUIs never inflate totals; a truncated list (at the cap) fails closed with the stable error line instead of showing a partial total; a ~30 s polling timer keeps the sidebar fresh when another OpenCode process works in the same project.

**Before**: you approximate spend from provider dashboards, and delegation spread is invisible.

**After**: cost, token spend, and the delegation tree of every session are one glance away, live in the terminal.

### Aggregation scopes

Each section answers a different question. **Project already includes the active Session, so never add Project + Session together.**

| Section | What it represents | How it is calculated |
| --- | --- | --- |
| **Project** | All-time usage for the current OpenCode project across directories and worktrees, including deleted sessions | Sum of every live principal-session tree plus the persisted deleted-tree aggregate. Each session ID contributes exactly once; totals survive deletion and restart. |
| **Session** | The active principal session and its complete recursive delegation tree | Active root session spend + every child, grandchild, and deeper delegated session exactly once. Switching the active route switches this scope. |
| **Footer** | The currently visible session only; every delegated child and descendant is excluded | That session's cumulative per-field high-water values. Input and output are enabled by default; each metric and the footer itself can be toggled in `TokenMeter: Settings`. |
| **Subagents** | Delegated descendants of the active Session; the principal/root session is excluded | `agents` counts distinct resolved agent types; `task` counts descendant sessions. Expanded rows group descendants by agent type and sum every run in that group. |
| **Agent group** | All delegated runs resolved to one agent type, such as `general` or `sdd-apply` | Sum of the cumulative spend, reasoning, cost, input, output, and cache for that group's descendant sessions. Groups are ordered by token spend. |

For every scope, cumulative token spend uses the same formula: `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write`.

### Displayed metrics

The sidebar renders plain Unicode disclosure glyphs (`▶`/`▼`/`↳`) — no Nerd Font is required. Colors are semantic roles resolved from the host theme at runtime: section headings (`Project`, `Session`, `Subagents`) render in the semantic yellow `theme().warning`; agent names in `theme().info` (cyan); only the `$amount` on the primary line is light red (`theme().error`); secondary metric rows and task counts use a dimmer background-relative detail tone.

<table>
  <thead>
    <tr><th>Row</th><th>Rendered</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Primary token+cost</td>
      <td><code>&lt;total&gt; tokens · $&lt;spend&gt;</code> — main text tone; only the <code>$amount</code> is light red (<code>theme().error</code>); the word <code>spent</code> is never rendered</td>
    </tr>
    <tr>
      <td>Secondary rows</td>
      <td><code>&lt;input&gt; input · &lt;output&gt; output</code> and <code>&lt;reason&gt; reason · &lt;cache&gt; cache</code> — the reasoning label is exactly <code>reason</code>; real output = raw output + raw reasoning</td>
    </tr>
    <tr>
      <td>Numbers modes</td>
      <td>Compact = 3 rows (primary + paired input/output + paired reason/cache); Precise = 5 independent rows (tokens+cost, input, output, reason, cache)</td>
    </tr>
    <tr>
      <td>Cache</td>
      <td>Combined single value, or separated <code>R&lt;read&gt;|W&lt;write&gt;</code> with zero sides omitted and both-zero rendering <code>0</code></td>
    </tr>
    <tr>
      <td>Cost</td>
      <td>USD cost calculated by OpenCode from the model's input/output/cache rates, always <code>$</code>-prefixed with exactly two decimals</td>
    </tr>
    <tr>
      <td>Footer</td>
      <td>Single truncated line for the visible session only; independently configurable <code>total</code>, <code>in</code>, <code>out</code>, <code>reason</code>, and combined <code>cache</code> metrics</td>
    </tr>
    <tr>
      <td>Collapsed Subagents</td>
      <td><code>Subagents (N agents · M tasks)</code> — the aggregate counts render only while the section is collapsed</td>
    </tr>
  </tbody>
</table>

Project and Session use the same metric contract; expanded agent groups repeat it per agent under `↳ name (N tasks) ▶` (closed) / `↳ name (N tasks) ▼` (open), with the per-agent chevron trailing the header.

**Sidebar states** — collapsed shows only the master summary; expanded reveals Project, Session, and per-agent delegation groups.

<p>
<img src="docs/assets/sidebar/sidebar_collapse.png" alt="TokenMeter sidebar collapsed — master row summary only" width="380">
<img src="docs/assets/sidebar/sidebar_expand.png" alt="TokenMeter sidebar expanded — Project, Session, and Subagents with per-agent groups" width="380">
</p>

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event → invalidation → reconcile flow.

---

## Quick Start

### 1. Register the plugin in OpenCode

Add the plugin to your TUI config (`~/.config/opencode/tui.json` user-level, `.opencode/tui.json` project-level, or `tui.jsonc` — all work):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-tokenmeter-tui"]
}
```

OpenCode resolves npm package names for TUI plugins and installs them automatically — there is no `npm install` step. The plugin registers the `sidebar_content` and `session_prompt_right` slots on load — no manual slot configuration is needed. **Restart OpenCode** after changing a TUI plugin or its `tui.json` entry.

### Updating

OpenCode installs plugins **cache-first**: once `opencode-tokenmeter-tui` is in the package cache, it is reused forever and newer npm releases are never picked up automatically (there is no auto-update). To update, remove the plugin's cache directory and restart OpenCode — it reinstalls the latest published version automatically:

```bash
rm -rf ~/.cache/opencode/packages/opencode-tokenmeter-tui@latest
```

The cache directory is named after the config entry (`@latest` for a bare name), and OpenCode only skips installation when that directory already exists. Removing it forces a fresh install from npm on next start — no version to remember, nothing accumulates, the config stays untouched. (If you deliberately pin a version in the config, remove that version's directory instead.)

<details>
<summary><strong>Local development instead of the npm package</strong></summary>

Point at the built artifact (run `bun run build` first):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/abs/path/to/opencode-tokenmeter/dist/tui.js"]
}
```

</details>

### 2. Verify

Open a session and check the right sidebar: a `▶ TokenMeter` panel appears with `Project`, `Session` and — once delegations exist — `Subagents` headings (semantic yellow) above their compact summary rows. The `Subagents` section appears automatically with the first delegated group. A muted line directly below the message input shows the visible session's own input and output tokens without delegated usage. Run `TokenMeter: Settings` from the command palette to toggle footer metrics, visibility (TokenMeter, Project, Session, Subagents — presentation-only, collection and milestones keep running while hidden), and other preferences, or press `Ctrl+E` (configurable in Settings) to expand/collapse all three sections together. Run `TokenMeter: Browse Usage` from the palette to open the cross-project browser — `Projects` lists only eligible projects (existing directory with `.git`, not `/`, HOME, or a direct child of HOME like `~/foo`; nested `~/projects/foo` stays) with lifetime totals, `★` pinned current, categories `Current Project` / `Projects` → `Project detail` (`Current Session` / `Sessions` plus aggregate, period, last activity) → `Session detail` (lifetime tokens/cost + provider/model breakdown sorted by spend, `★` if current) — provisional projects paint in ≤100 ms before presence probes finalize, `← Back` returns without leaking entries.

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
| `bun run build` | Bundles `src/tokenmeter.tsx` into `dist/tui.js` (with `dist/tui.d.ts`) via `scripts/build.ts` |
| `bun run test:dist` | `bun run build` first, then the artifact regression test against `dist/tui.js` |
| `bun run audit` | `bun audit` |
| `bun run biome:check` | Read-only Biome gate: formatter + linter over `src`, `test`, `scripts`, TS configs |
| `bun run biome:format` | Apply the Biome formatter to the same files |
| `bun run hooks:install` | Install the repo-local Lefthook pre-commit hook |
| `bun run pack:dry-run` | Inspect the tarball contents before publishing |

The suite runs **224 tests / 0 failures across 7 files** (7,820 `expect` calls) on Bun 1.3.11. `test` and `test:dist` are distinct on purpose: the unit suite never needs a build, and the dist test is never silently skipped — it fails hard if `dist/tui.js` is missing or non-reactive.

### The build guard

`bun run build` compiles the entry with `@opentui/solid`'s `createSolidTransformPlugin` (via `bun build`, external runtime packages). Loading the source `.tsx` through Bun's ordinary eager JSX transform would emit `jsxDEV` calls with eagerly evaluated props — and the mounted sidebar would **never repaint**. The build script post-checks the artifact for real `effect`/`insert`/`insertNode` bindings and forbids `jsxDEV`/`jsx-runtime`, failing loudly instead of shipping a frozen panel.

### Biome

[Biome](https://github.com/biomejs/biome) (2.5.x) is the formatter and linter — one fast tool that formats, lints, and organizes imports, configured by a single `biome.json`.

### Package and release

- Releases are **tag-driven**: push a stable `vX.Y.Z` tag — the release workflow preflights, publishes to npm with provenance, and creates the GitHub Release.
- Every release needs a **curated release notes body** in the single current release document `docs/releases/<tag>.md`. The lifecycle keeps exactly one document: for a new release, `git mv docs/releases/<old-tag>.md docs/releases/<new-tag>.md`, replace its content with the narrative body (meaningful sections, PR/issue links — see the template in the `ci-cd-and-automation` skill assets), bump the package version, commit, then tag. The release preflight fails the release when `docs/releases/` has zero or multiple documents, the document name does not match the tag, or the body is empty, placeholder-filled, malformed, or mismatched to the tag/version — the GitHub Release is created from that file only, never from a raw commit list.
- Publishing uses npm **Trusted Publishing (OIDC)** with provenance: no npm tokens exist, and publication runs in the protected `release` environment.
- The first-ever publish is a one-time **manual authenticated bootstrap** (dist-tag `bootstrap`); the procedure, the npmjs trusted-publisher binding, and the full control list live in [docs/release-security.md](docs/release-security.md).

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
| Curated release notes (single current release document) | [docs/releases/](docs/releases/) |
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
