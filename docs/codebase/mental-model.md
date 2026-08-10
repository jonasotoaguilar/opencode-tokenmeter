# Mental Model — opencode-tokenmeter

This is the foundational page of the codebase guide: how the system fits together, its entry points, and the primary flow, in reading order. Back to [docs/CODEBASE-GUIDE.md](../CODEBASE-GUIDE.md).

## One-sentence model

Host events invalidate sessions; a debounced reconcile rehydrates usage from the authoritative client SDK; a Solid snapshot signal repaints the sidebar panel in place; and a persistent kv ledger keeps Project totals alive across deletions and restarts.

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
  project.ts ──► client.project.current() + session.list({scope:"project"})
      └──────► ledger.ts ──► api.kv tokenmeter.project.history.v1
                (upsert live by ID, tombstone deleted, idempotent full-sum)
```

Two independent data paths feed one panel: the **Session** path (active session + delegation tree, rehydrated from client messages) and the **Project** path (all-time project usage, persisted in the kv ledger). A Project failure never touches the Session section.

## Entry points

- `src/tokenmeter.tsx` — the plugin entry: subscribes to every event, owns the kv-persisted expanded state, tracks the active session reactively through `api.route.current`, and registers the `sidebar_content` slot (order 95) that renders `UsagePanel`.
- `src/tokenmeter/panel/index.tsx` — the stable panel entry: `UsagePanel` activates the root on mount and on sessionID changes, then renders from the `snapshot` and `projectSnapshot` signals (with `panel/group-rows.tsx` and `panel/project-section.tsx`).
- `scripts/build.ts` — production build with the reactive-binding guard.
- `test/render.test.tsx` — the behavioral contract that matters most: the mounted panel repaints without a remount.

## Reading order (first pass)

1. `src/tokenmeter.tsx` — see every event and how it maps to the store and the schedulers.
2. `src/tokenmeter/store.ts` — the state model: per-session message maps keyed by message ID, statuses, loaded/rehydrate flags, the `snapshot` signal.
3. `src/tokenmeter/reconcile.ts` — the freshness engine: debounce, generation counter, rehydration, the 2 s tree-maintenance timer, and `publish`.
4. `src/tokenmeter/tree.ts` + `groups.ts` — how descendants are discovered and collapsed into per-agent groups.
5. `src/tokenmeter/project.ts` + `ledger.ts` — the persistent Project path with tombstones and recovery.
6. `src/tokenmeter/panel/` — how the signals become rows (with `format.ts`/`text.ts`/`glyphs.ts` as pure support).

## State ownership

| State | Owner | Source of truth |
| --- | --- | --- |
| Per-session message usage | `store.ts` (maps) | Replaced from `client.session.messages` on rehydration |
| Statuses | `store.ts` (map) | `session.status`/`session.idle` events + `api.state.session.status` fallback |
| Snapshot signal | `store.ts` | `reconcile.publish` (Session) |
| Project snapshot / error / loading | `project.ts` | Full kv-ledger sum; live-list fallback |
| Ledger | `api.kv` (`tokenmeter.project.history.v1`) | `ledger.ts` reads/writes |
| Expanded state | `api.kv` (`tokenmeter.sidebar.expanded`) | entry toggle |
| Tree cache + session metadata | `tree.ts` (maps) | Client `session.children`/`get`; purged on `session.created` and by the maintenance timer |
| Timers | `reconcile.ts` / `project.ts` | Owned by `activateRoot`/`disposeReconcile`/`disposeProjectRefresh`; disposed with the plugin's `createRoot` |

## Key invariants

- The client SDK is the source of truth; a stale non-empty mirror can never win (replace, never merge).
- Totals are sums over unique keys (message ID / session ID): repeated events and refreshes never double-count.
- Raw output and raw reasoning stay separate; the displayed output real (`output + reasoning`) is computed exactly once at the formatting boundary.
- A session's headline context is one max-observed snapshot; cache is excluded from context by design.
- Deleted sessions keep contributing (tombstones); a live list never zeroes a ledger.
- Every line is column-aware and truncated — the terminal never wraps mid-word.
- Hooks never throw; a Project failure shows the stable error line and nothing else.

## Related docs

- [docs/CODEBASE-GUIDE.md](../CODEBASE-GUIDE.md) — the index this page belongs to.
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — component details, flows, ADRs.
- [PRD.md](../../PRD.md) — product intent and requirements.
- [DESIGN.md](../../DESIGN.md) — panel layout, colors, glyphs, states.
