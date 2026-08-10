# ADR-0003: KV persistence for collapse state and the project history ledger

## Status

Accepted

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

Two pieces of state must survive plugin restarts, and the host's `api.kv` store is the only plugin persistence offered by the TUI (no filesystem access is available or wanted). First, the panel's collapsed/expanded state should follow the user across sessions and restarts. Second, the Project section must show **all-time** project usage: sessions get deleted, and a deleted session's usage must not vanish with it; repeated refreshes must never duplicate totals. The `session.list({ scope: "project" })` endpoint only reports live sessions, and the kv store becomes ready asynchronously (a write during startup may be dropped). The delete payload (`session.deleted`) may or may not carry token data, and a session deleted before ever being observed cannot be recovered by any list call.

## Decision

Persist in `api.kv` with two versioned keys:

1. **`tokenmeter.sidebar.expanded`** — a boolean; the panel reads it at mount with a `false` default (collapsed by default) and writes it on every toggle.
2. **`tokenmeter.project.history.v1`** — a versioned ledger `{ v: 1, projects: { [projectID]: { [sessionID]: ProjectLedgerEntry } } }`. Every project refresh upserts the **live** sessions by ID (replace, never accumulate; `lastSeen` refreshed, `deletedAt` cleared when a session is live again) and tombstones entries that no longer appear in the live list (setting `deletedAt`, never removing). The project total is the idempotent **sum of the full ledger** — live entries plus tombstones — so refreshes never duplicate, updates replace their snapshot, and deleted sessions keep contributing. `session.deleted` persists the delete payload's usage (or the last known snapshot) into the ledger *before* the refresh and passes the deleted session's `projectID` as a refresh hint so a failing post-delete lookup recovers the snapshot from the ledger. The ledger is never allowed to zero out a project the live list visibly carries tokens for: an empty/malformed/not-yet-persisted ledger falls back to the live total and is rebuilt (normalized and persisted) from the live sessions. Stored values are shape-validated on read; malformed structures degrade to an empty ledger, never to NaN.

## Consequences

### Positive

- Collapse state and all-time project totals survive restarts.
- Deleting a session never drops its contribution and never flashes "Unable to load project data" (tombstone + `projectIDHint` recovery).
- Idempotent by construction: the same live list twice changes nothing; the full-sum is deterministic.
- Malformed/foreign ledger values cannot break the panel (validation + `num()` coercion).

### Negative

- The ledger grows monotonically per project (tombstones are never garbage-collected by design — unbounded across very long-lived projects).
- kv writes before the store is ready are dropped; the live-list fallback masks this but the first persisted write may be lost.

### Neutral

- The ledger lives entirely inside the host kv store — no external files, no schema migrations beyond the `v` version field.

## Options Considered

### Option A: Host `api.kv` with replace-by-ID upserts + tombstones (chosen)

No new storage dependency; survives restarts; idempotent; handles deletion without losing history.

### Option B: In-memory project totals only

Simplest, but every restart loses the project history and deleted sessions vanish from the total. Rejected.

### Option C: JSON files on disk

Persistence outside the host contract; the TUI plugin has no sanctioned filesystem boundary; path/config complexity. Rejected.

## Trade-off Analysis

KV persistence trades monotonic ledger growth for durability and idempotency — the right trade for an "all-time" metric the user reads across restarts, with the async-ready kv store covered by the live-list fallback.

## Action Items

1. [x] `ledger.ts` read/write with shape validation, `upsertLiveSessions`, `persistDeletedSession`.
2. [x] `project.ts` full-ledger summation, live fallback/rebuild, `projectIDHint` recovery.
3. [x] Entry wiring: expanded state kv key, `session.deleted` → `persistDeletedSession` before refresh.

## References

- `src/tokenmeter/ledger.ts` — ledger read/write/upsert/tombstone
- `src/tokenmeter/project.ts` — refresh, fallback, post-delete recovery
- `src/tokenmeter.tsx` — kv state wiring and delete handling
- [ADR-0002: Reconcile by invalidation and client rehydration](0002-reconcile-by-invalidation-and-client-rehydration.md)
