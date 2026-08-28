# Mental Model — opencode-tokenmeter

This is the foundational page of the codebase guide: how the system fits together, its entry points, and the primary flow, in reading order. Back to [docs/CODEBASE-GUIDE.md](../CODEBASE-GUIDE.md).

## One-sentence model

Host events invalidate sessions; a debounced reconcile rehydrates usage from the authoritative client SDK; a Solid snapshot signal repaints the sidebar panel in place; and a plugin-owned SQLite store keeps the Project deleted-session aggregate alive across deletions, restarts, and concurrent TUIs.

## The system in one flow

```text
host events ──► entry (tokenmeter.tsx) ──► store invalidation / upsert
      │                                        │
      ▼                                        ▼
 debounced reconcile (300ms / 100ms idle) ◄──  (schedule)
      │  re-reads client session.messages() ONLY for
      │  loading / rehydrating sessions (replace, never merge)
      ▼
 publish UsageSnapshot (root + descendants, agent groups)
      │
      ▼
 panel/index.tsx repaints in place (no remount) — column-aware lines

Project section (parallel path):
  project.ts ──► client.project.current()
               + session.list({scope:"project", limit:10000})
      └──────► live per-session sum (authoritative, never persisted)
      └──────► db.ts ──► tokenmeter.sqlite (state dir)
                (one deleted-session aggregate per project + tombstones)
      └──────► ~30s polling timer keeps sibling TUIs fresh

Browser (presentation-only, same aggregates):
  projects-dialog.tsx ──► project.list + current pin
        │   + isEligibleProjectPath (exists + .git, not / / HOME / ~/foo)
        │   → provisional eligible rows ≤100 ms (Current Project / Projects)
        └─► probeHasSessionsV2 via v2.session.list({project,limit:1})
            with withConcurrency 4 + withTimeout 4s + browser-activity guard and host `DialogStack` lifecycle (`replace`/`clear` → previous `onClose`; host `onClose` suppressed only during content-update replaces via `withSuppress`, user `× Close`/`Escape` still clear exactly once)
            → final eligible rows ≤900 ms (invalid/deleted/root never shown)
  project-dialog.tsx / session-dialog.tsx via ONE dialog.replace
```

Two independent data paths feed one panel: the **Session** path (active session + delegation tree, rehydrated from client messages) and the **Project** path (authoritative live list sum + the SQLite deleted aggregate). A Project failure never touches the Session section. Monetary cost reuses the same gates everywhere (`pricing.ts` host `v2.model.list` → `pricing-remote.ts` bounded `models.dev` fallback → `math.resolveCost` per row, reported wins, OpenAI `cost===0` + billable + exact pricing → estimate, else safe-zero); Session keeps per-message identity Σ, Project scopes tombstones by `(session_id, project_id)` and deleted aggregates via `resolveEntry`; visibility gating is presentation-only and the cross-project browser reuses the same aggregation; see [ADR-0008](../adr/0008-openai-cost-fallback-with-models-dev.md) (supersedes 0007) and [ARCHITECTURE.md](../../ARCHITECTURE.md). The browser adds eligible-only provisional paint (`eligibility.ts` → `isEligibleProjectPath`) then V2 `session.list({project, limit:1})` presence probes with bounded concurrency/timeouts, generation guard, and host `DialogStack` `onClose`/`withSuppress` lifecycle (58→30 calls at N=28, see ADR-0009), categories `Current Project`/`Projects` and `Current Session`/`Sessions`, title count-only, and `× Close`/`Escape` close at any stage.

## Entry points

- `src/tokenmeter.tsx` — the plugin entry: subscribes to every event, loads `settings`/`pricing`/`toggle-shortcut` at startup, registers the palette layers (`tokenmeter.settings` + `tokenmeter.browser` `Browse Usage`, plus toggle layer, disposers released in `api.lifecycle.onDispose`), subscribes to `subscribeProjectSnapshot` for milestone toasts (not a Solid `createEffect` on the server build), tracks the active session reactively through `api.route.current`, and registers the `sidebar_content` slot (order 95) that returns `null` when `visibility.sidebar` is `false` otherwise renders `UsagePanel`.
- `src/tokenmeter/panel/index.tsx` — the stable panel entry: `UsagePanel` activates the root on mount and on sessionID changes, then renders from the `snapshot` and `projectSnapshot` signals (with `panel/section.tsx`, `panel/group-rows.tsx`, `panel/tone.ts`, `panel/settings-dialog.tsx`, and `panel/project-section.tsx`).
- `src/tokenmeter/settings.ts` + `sections.ts` + `shortcut.ts` — the preference model (`settings.v1` with `visibility: { sidebar, project, session, subagents }` plus `footer`/`milestones` and Subagents durable key, presentation-only visibility gating), the transient Project/Session disclosure shared with the toggle command, and the toggle command/shortcut keymap layer (kv-persisted, re-registered live on change) — plus `src/tokenmeter/browser/` (`eligibility.ts`, `projects-dialog.tsx` provisional + V2 probes, `browser-activity.ts`, `concurrency.ts`/`timeout.ts` bounds) and `src/tokenmeter/pricing-remote.ts` (bounded `models.dev` fallback).
- `scripts/build.ts` — production build with the reactive-binding guard.
- `test/render.test.tsx` — the behavioral contract that matters most: the mounted panel repaints without a remount.

## Reading order (first pass)

1. `src/tokenmeter.tsx` — see every event and how it maps to the store and the schedulers.
2. `src/tokenmeter/store.ts` — the state model: per-session message maps keyed by message ID, statuses, loaded/rehydrate flags, the `snapshot` signal.
3. `src/tokenmeter/reconcile.ts` — the freshness engine: debounce, generation counter, rehydration, the 30 s tree-maintenance timer, and `publish`.
4. `src/tokenmeter/tree.ts` + `groups.ts` — how descendants are discovered and collapsed into per-agent groups.
5. `src/tokenmeter/project.ts` + `db.ts` — the persistent Project path: live-list refresh (explicit limit, cap fail-closed), tombstone-admission deleted aggregate, polling timer.
6. `src/tokenmeter/settings.ts` + `sections.ts` + `shortcut.ts` — preferences, transient disclosure, and the toggle command/shortcut layer.
7. `src/tokenmeter/panel/` — how the signals become rows (with `format.ts`/`text.ts`/`glyphs.ts`/`tone.ts` as pure support).

## State ownership

| State | Owner | Source of truth |
| --- | --- | --- |
| Per-session message usage | `store.ts` (maps) | Replaced from `client.session.messages` on rehydration |
| Statuses | `store.ts` (map) | `session.status`/`session.idle` events + `api.state.session.status` fallback |
| Snapshot signal | `store.ts` | `reconcile.publish` (Session) |
| Project snapshot / error / loading | `project.ts` | Live `session.list` sum + SQLite deleted aggregate |
| Deleted-session aggregate + tombstones | `db.ts` (`tokenmeter.sqlite` under `api.state.path.state`) | Atomic `session.deleted` admission (BEGIN IMMEDIATE + INSERT OR IGNORE); WAL + busy timeout, short open/transaction/close |
| Settings (`cache`, `numbers`, `collapsedSummary`, `footer`, `milestones`, `visibility: { sidebar, project, session, subagents }`) | `settings.ts` | `api.kv` `tokenmeter.settings.v1` — whole-object, ready-gated writes; `visibility` defaults all `true`, presentation-only (entry returns `null` when `sidebar` off, panel `Show` gates sections) |
| Subagents preference | `settings.ts` | `api.kv` `tokenmeter.sidebar.expanded` |
| Toggle shortcut | `shortcut.ts` | `api.kv` `tokenmeter.toggle.shortcut`; the keymap layer re-registers live on change |
| Section disclosure (Project/Session) | `sections.ts` | Transient — seeded closed at mount, reset on session change, never kv |
| Open agent index | `panel/index.tsx` | Transient — null at mount, reset on session change, never kv |
| Tree cache + session metadata | `tree.ts` (maps) | Client `session.children`/`get`; purged on `session.created` and by the maintenance timer |
| Timers | `reconcile.ts` / `project.ts` | Owned by `activateRoot`/`disposeReconcile`/`disposeProjectRefresh`; disposed with the plugin's `createRoot` |

## Key invariants

- The client SDK is the source of truth; a stale non-empty mirror can never win (replace, never merge).
- Totals are sums over unique keys (message ID / session ID): repeated events and refreshes never double-count.
- Raw output and raw reasoning stay separate; the displayed output real (`output + reasoning`) is computed exactly once at the formatting boundary.
- A session's headline coins total is its COMPLETE CUMULATIVE TOKEN SPEND: `Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write` across ALL assistant messages — the exact reconstruction of OpenCode's billed `tokens.total` (verified against a real payload: 3167 + 249 + 64 + 66816 + 0 = 70296). Cache is fully accumulated, never a latest-message term. Each component (cost/input/output/reasoning/cacheRead/cacheWrite) keeps a per-field high-water so compaction can never lower the spend or its breakdown; payload-only sessions contribute their payload's own five-component sum.
- Deleted sessions keep contributing through the SQLite aggregate, admitted exactly once per session across processes and duplicate deliveries; the live list is authoritative on every refresh — never persisted, never re-added.
- Project list calls always carry the explicit 10_000 limit; a truncated (cap-saturated) result fails closed — prior snapshot preserved, stable error surfaced.
- Every line is column-aware and truncated — the terminal never wraps mid-word.
- Only preferences persist (`tokenmeter.settings.v1` including `visibility`, `tokenmeter.sidebar.expanded`, `tokenmeter.toggle.shortcut`); master/section disclosure and the open agent are transient — reset on mount and session change, never written to kv. Visibility is presentation-only: hidden surfaces keep collecting data and milestones still fire.
- Hooks never throw; a Project failure shows the stable error line and nothing else.

## Related docs

- [docs/CODEBASE-GUIDE.md](../CODEBASE-GUIDE.md) — the index this page belongs to.
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — component details, flows, ADRs.
- [PRD.md](../../PRD.md) — product intent and requirements.
- [DESIGN.md](../../DESIGN.md) — panel layout, colors, glyphs, states.
