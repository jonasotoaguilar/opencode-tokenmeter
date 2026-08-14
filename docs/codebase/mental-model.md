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
      └──────► ~2s polling timer keeps sibling TUIs fresh
```

Two independent data paths feed one panel: the **Session** path (active session + delegation tree, rehydrated from client messages) and the **Project** path (authoritative live list sum + the SQLite deleted aggregate). A Project failure never touches the Session section.

## Entry points

- `src/tokenmeter.tsx` — the plugin entry: subscribes to every event, loads the settings and toggle-shortcut preferences at startup, registers the palette layers (`tokenmeter.settings` command + toggle layer, disposers released in `api.lifecycle.onDispose`), tracks the active session reactively through `api.route.current`, and registers the `sidebar_content` slot (order 95) that renders `UsagePanel`.
- `src/tokenmeter/panel/index.tsx` — the stable panel entry: `UsagePanel` activates the root on mount and on sessionID changes, then renders from the `snapshot` and `projectSnapshot` signals (with `panel/section.tsx`, `panel/group-rows.tsx`, `panel/tone.ts`, `panel/settings-dialog.tsx`, and `panel/project-section.tsx`).
- `src/tokenmeter/settings.ts` + `sections.ts` + `shortcut.ts` — the preference model (three-field `settings.v1` + Subagents durable key), the transient Project/Session disclosure shared with the toggle command, and the toggle command/shortcut keymap layer (kv-persisted, re-registered live on change).
- `scripts/build.ts` — production build with the reactive-binding guard.
- `test/render.test.tsx` — the behavioral contract that matters most: the mounted panel repaints without a remount.

## Reading order (first pass)

1. `src/tokenmeter.tsx` — see every event and how it maps to the store and the schedulers.
2. `src/tokenmeter/store.ts` — the state model: per-session message maps keyed by message ID, statuses, loaded/rehydrate flags, the `snapshot` signal.
3. `src/tokenmeter/reconcile.ts` — the freshness engine: debounce, generation counter, rehydration, the 2 s tree-maintenance timer, and `publish`.
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
| Settings (`cache`, `numbers`, `collapsedSummary`) | `settings.ts` | `api.kv` `tokenmeter.settings.v1` — whole-object, ready-gated writes |
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
- Only preferences persist (`tokenmeter.settings.v1`, `tokenmeter.sidebar.expanded`, `tokenmeter.toggle.shortcut`); master/section disclosure and the open agent are transient — reset on mount and session change, never written to kv.
- Hooks never throw; a Project failure shows the stable error line and nothing else.

## Related docs

- [docs/CODEBASE-GUIDE.md](../CODEBASE-GUIDE.md) — the index this page belongs to.
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — component details, flows, ADRs.
- [PRD.md](../../PRD.md) — product intent and requirements.
- [DESIGN.md](../../DESIGN.md) — panel layout, colors, glyphs, states.
