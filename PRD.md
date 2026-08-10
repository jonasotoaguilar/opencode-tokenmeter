# PRD — opencode-tokenmeter

## Executive summary

`opencode-tokenmeter` is an OpenCode TUI plugin that renders a live usage sidebar in the OpenCode terminal UI: per-session token counts, cost, and the delegation tree of a session's subagents, updated in real time as events stream in. It adds a collapsible `sidebar_content` panel (order 95) that shows two metric sections — **Session** (the active session plus every delegated descendant, grouped by agent) and **Project** (all-time usage of the current project, persisted across restarts) — and never needs a remount to repaint: it rehydrates from the authoritative client data on a debounced reconcile.

## Problem statement

OpenCode shows the current chat session, but a user running heavy delegated work has no quick visibility into:

1. **Cost and token burn**: how many tokens a session and its subagents have consumed so far, including reasoning tokens and cache, and what it costs.
2. **Delegation shape**: which agents were delegated to, how many runs each produced, and which are still running.
3. **Project-wide history**: what a whole project (all directories/worktrees, including deleted sessions) has consumed over time.

The TUI host gives plugins no session-select event and no persisted "usage" primitive; the plugin must reconstruct usage from `session`/`message`/`part` events, keep the panel correct when the in-memory mirror is stale, and survive session deletion and restarts.

## Users

| User | Need |
| --- | --- |
| OpenCode users running long/delegated sessions | Live, at-a-glance token usage, cost, and delegation-tree visibility next to the chat |
| Users managing cost across a project | An all-time project total that survives session deletion and plugin restarts |
| Maintainers of this plugin | A small, testable, publishable TUI plugin that never breaks the host turn |

## Goals

- Show live Session and Project token usage (context, input, output real, reasoning, cache) and cost in the TUI sidebar.
- Show the active session's delegation tree: distinct agents, run counts per agent, running state, and per-agent usage, ordered by context weight.
- Stay live: repaint on new events without remounting the panel, and rehydrate from the authoritative client when the in-memory mirror may be stale.
- Persist across restarts: panel collapsed/expanded state and the all-time Project history ledger (with tombstones for deleted sessions) in the host `kv` store.
- Never break an OpenCode turn: every failure path is contained; a failed Project refresh shows a stable error line, never a crash.

## Requirements

### Functional

- R1: Register a `sidebar_content` slot with `order: 95` that renders the TokenMeter panel only when a `session_id` is available from slot props/context.
- R2: Track the active session by reading `api.route.current` inside a Solid effect (the TUI exposes no session-select event); activate on first mount, on sessionID prop changes, and on route changes.
- R3: Maintain per-session usage keyed by message ID, upserted (replace, never append) from `message.updated` / `message.part.updated` so repeated events and retries can never double-count.
- R4: On any relevant event, invalidate the affected session and schedule a debounced reconcile (300 ms; 100 ms on idle) that re-reads the client's authoritative messages (replace, not merge) — a stale in-memory mirror can never win over fresh client data.
- R5: Discover the delegation tree recursively via `client.session.children()`, caching per-parent child lists, with the whole tree cache purged on `session.created` (parentID can be absent) and a 2 s maintenance timer on the active root as a missed-event safety net.
- R6: Render the Session section with the headline context (one context snapshot per session, max observed; cache excluded), thinking and cost on row 1, and the input · output real · cache breakdown on row 2; `delegations` counts all descendant sessions, `agents` counts distinct agent types.
- R7: Group all descendant sessions by resolved agent type (agent field → subagent_type → `(@agent subagent)` title suffix → "subagent"), ordered by context descending with cost/runs/name as stable tiebreakers.
- R8: Render the Project section from `client.session.list({ scope: "project" })` filtered by `projectID`, persisted as an all-time ledger in `api.kv` (`tokenmeter.project.history.v1`): live sessions upsert by ID, disappeared sessions become tombstones that keep contributing, and the total is the idempotent sum of the full ledger.
- R9: On `session.deleted`, persist the delete payload's usage (or the last known snapshot) into the ledger BEFORE the refresh and pass the deleted session's projectID as a refresh hint so the Project section recovers from the ledger even when `project.current()` is momentarily unresolved.
- R10: Never let an empty/malformed/not-yet-persisted ledger zero out a project the live list visibly carries tokens for: fall back to the live total and rebuild the ledger.
- R11: Persist the panel expanded/collapsed state in `api.kv` (`tokenmeter.sidebar.expanded`); the panel is collapsed by default and toggled by the Subagents chevron.
- R12: Resolve the sidebar width from the slot context/props chain (width → columns → cols → size → viewport → bounds), fallback 38, clamped to 24–52.
- R13: Render every line column-aware (wide/combining codepoints count as real columns) and truncate to the content width so the terminal can never wrap mid-word.
- R14: All signal/timer ownership lives inside a Solid `createRoot`, disposed with the plugin; hooks never throw.

### Non-functional

- N1: The shipped `dist/tokenmeter.js` artifact must contain real Solid reactive bindings (`effect`/`insert`/`insertNode`) and zero eager `jsxDEV` usage — asserted post-build so a broken build cannot silently ship (a panel that never repaints is a hard failure).
- N2: Refreshes are debounced (300 ms reconcile, 100 ms idle, 2 s maintenance tree tick) so an event burst yields one repaint.
- N3: The suite runs with `bun test`: 80 tests across `test/harness.test.ts` (module behavior), `test/render.test.tsx` (real-panel repaint without remount), and `test/artifact.test.ts` (compiled-artifact regression guard).
- N4: CI gates: frozen install, typecheck, unit tests with coverage, build, dist smoke test, audit, pack dry-run, Biome check.
- N5: Runtime packages (`@opencode-ai/plugin`, `@opencode-ai/plugin/tui`, `@opentui/core`, `@opentui/solid`, `solid-js`) stay external — the TUI host provides them at load time; the published package ships only `dist/`.
- N6: Nerd Fonts must be installed for the PUA glyphs (Octicons/Material/Codicons) to render; the plain tree marker `↳` is Unicode.

## Scope

- The TUI plugin (entry + 12 modules), its tests, build script, docs, CI/release workflows, and the versioned `skills/opencode-plugin/` development skill.
- A column-aware, theme-driven (host `theme()`) panel with Nerd Font glyphs.

## Non-goals

- Modifying sessions, messages, or the delegation tree — TokenMeter is read-only.
- Per-message drilldown, raw JSON views, or charts in the sidebar.
- Cost alerts, budgets, or rate limiting.
- Telemetry, analytics, or any outbound network traffic.
- A non-TUI (web/CLI) surface; the plugin registers only the `sidebar_content` slot.
- Server-side components or persistence outside the host `kv` store.

## Behavior and success criteria

| Criterion | Measure |
| --- | --- |
| Live repaint | The mounted panel repaints on usage updates without being remounted (render harness asserts the character frame changes in place) |
| No double counting | Repeated events, retries, and compaction never inflate totals; message usage is keyed by ID and replaced |
| Freshness wins | An invalidated session re-reads the client messages on the next reconcile; a stale non-empty mirror never wins |
| Delegation visibility | Descendant sessions appear as agent groups with run counts and usage; 3+ groups scroll inside a 6-row scrollbox |
| Project survives deletion | Deleting a session never drops its contribution; tombstones keep the all-time total idempotent across refreshes |
| Restart persistence | Expanded state and the project ledger survive plugin restarts via `api.kv` |
| No overflow | Lines truncate to the content width at every sidebar width from 24 to 52; the fallback width is 38 |
| Reactive artifact | `bun run build` fails loudly unless the artifact carries effect/insert/insertNode bindings and no `jsxDEV` |
| Fail-contained | A failed Project refresh shows the stable "Unable to load project data" line and never touches the Session panel or the turn |
| CI | All CI gates pass on a clean PR |

## Risks and open questions

- **TUI API drift**: slot context shape, `api.route`, and the `@opentui/*` rendering APIs are host-owned; the width chain resolver and the artifact assertion contain the drift, but a host upgrade may still require a plugin patch.
- **kv readiness at startup**: the host kv store becomes ready asynchronously, so a ledger write during startup may be dropped; the live-list fallback (R10) prevents a flashed zero.
- **Event ordering**: message/part events may arrive out of order; the generation counter drops stale async reconcile results, and upsert-by-ID makes totals order-independent.
- **Font dependency**: without Nerd Fonts the PUA glyphs render as missing characters; the panel degrades but does not crash.
- **Open question — panel version**: the title row currently shows a hardcoded `1.0.0`; whether it should track the package version is left to a later release.
