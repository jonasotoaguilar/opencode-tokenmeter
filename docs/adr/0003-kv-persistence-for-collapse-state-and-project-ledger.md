# ADR-0003: KV persistence for collapse state and aggregate project usage

## Status

**Superseded by [ADR-0006](0006-sqlite-persistence-for-deleted-project-usage.md).**

The v4 kv ledger (`tokenmeter.project.history.v4`) is obsolete: the host kv
store is a whole-file read-modify-write shared by every plugin process, so
concurrent TUIs overwrite each other's Project history, and persisting live
root snapshots adds re-admission complexity the authoritative `session.list`
does not need. Project history now lives in a plugin-owned SQLite store
(`tokenmeter.sqlite` under `api.state.path.state`) holding ONE deleted-session
aggregate per project plus (sessionID, projectID) tombstones; the live total
is never persisted. The kv key `tokenmeter.sidebar.expanded` described here
remains in use unchanged. The obsolete v4 data is ignored — never read,
converted, migrated or written.

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

Two pieces of state must survive plugin restarts, and the host's `api.kv`
store is the only plugin persistence offered by the TUI. First, the panel's
collapsed/expanded state follows the user across sessions. Second, Project
shows **all-time** usage: deleting a principal session must not remove the
tokens spent by that session or any recursive delegation, and repeated
refreshes must never duplicate totals.

OpenCode exposes every principal session and delegation as a separate row in
`session.list({ scope: "project" })`. Persisting one ledger entry per row made
five user-visible sessions appear as 23 entries (five roots plus 18
delegations) and retained one full token snapshot per deleted row. The server
may also keep returning deleted sessions from memory after their database row
is gone, so an already-counted deletion can reappear in the list. The ledger
needs the all-time result, not per-session history.

## Decision

Persist in `api.kv` with two versioned keys:

1. **`tokenmeter.sidebar.expanded`** — a boolean; read at mount with a `false`
   default and written on every toggle.
2. **`tokenmeter.project.history.v4`** — a versioned ledger:

   ```text
   { v: 4, projects: {
       [projectID]: {
         roots: { [rootSessionID]: { total, members, highWaters } },
         deleted: ProjectLedgerEntry,
         deletedIDs: string[]
       }
   } }
   ```

   Each refresh resolves the top-most parent of every listed session and
   stores ONE live root-tree total (`principal + every recursive delegation`).
   `members` contains IDs only; delegations do not persist independent token
   snapshots. `highWaters` keeps each member session's per-component spend
   high-water (cost/input/output/reasoning/cacheRead/cacheWrite as per-field
   maxima — spend = Σ input + Σ output + Σ reasoning + Σ cache.read +
   Σ cache.write across all assistant messages), so the tree total's spend is
   monotonic and compaction can never lower it. When
   a root tree disappears or any member emits `session.deleted`, its total is
   folded into the project's ONE `deleted` aggregate, the live root record is
   removed, and every member ID is added to `deletedIDs`. Those IDs are the
   minimal anti-double-count set: if the server's stale list reports a
   deleted member again, the ledger ignores it instead of counting live +
   aggregate.

   Context is stored EXPLICITLY on every entry (the complete per-session
   context of the entry's scope), never derived from the cumulative raw
   fields and never built as a per-field maximum across moments. A session
   never observed via its messages contributes the payload fallback `input +
   output + reasoning` (the latest-cache term is unknowable from cumulative
   fields), so an entry's context is always >= its cumulative input + output
   + reasoning. The observed usage (client messages) wins
   over the list/delete payload when both exist.

   Cumulative raw metrics (cost/input/output/reasoning/cache) are kept
   monotonically as safe per-field maxima across the payload, the observed
   usage and the previously persisted total, so compaction or a partial
   refresh can never lower the project's numbers; context is kept
   SEPARATELY as the maximum COMPLETE per-session formula — never composed
   from the per-field-maxed cumulative fields, and clamped so it can never
   fall below the entry's merged cumulative input + output + reasoning.

   Project total is the idempotent sum of live root totals plus `deleted`.
   `projectIDHint` still recovers that total when the lookup immediately after
   deletion fails. Missing/malformed v4 data falls back to the live list and
   rebuilds live roots. No legacy format is ever read, converted, migrated or
   written — legacy kv keys (v3/v2/v1) are ignored, and writeLedger performs
   exactly ONE `kv.set` per mutation (the repository forbids
   backward-compatibility layers).

   Durability: the host kv store becomes ready asynchronously (`TuiKV.ready`),
   so every refresh is gated on readiness — a pre-ready refresh preserves the
   prior snapshot/placeholder and retries on the project timer, never reading,
   rebuilding or writing the ledger, so a dropped startup write can never
   queue an incomplete snapshot over persisted deleted history. A
   `session.deleted` event arriving before readiness is queued (deduped by
   session ID) and replays exactly once on the first ready refresh; delete
   → restart preserves the project total (the deleted aggregate is
   serialized with the ledger).

## Consequences

### Positive

- Five user-visible principal sessions persist as five live roots, regardless
  of delegation count.
- Every deleted root tree contributes to one project aggregate; no deleted
  session/delegation token history is retained.
- Repeated delete events and stale list rows cannot double-count because every
  folded member ID is remembered.
- Collapse state and all-time totals survive restarts.
- Malformed values degrade to an empty v4 ledger, never NaN.

### Negative

- `deletedIDs` grows with deletions. It stores opaque IDs only (no token
  snapshots) and is required for correctness while the server can re-report
  deleted sessions.
- Deleting an individual delegation folds its known root tree; this matches
  OpenCode's user-facing deletion unit, which is the principal session.
- Legacy kv keys (v3/v2/v1) are ignored — never read, converted, written or deleted; the v4 ledger is the only key TokenMeter ever writes for project history, exactly once per mutation.

### Neutral

- The ledger remains entirely inside the host kv store; no external file or
  database dependency is introduced.

## Options Considered

### Option A: Root-tree totals + one deleted aggregate (chosen)

Matches the user-visible session model, preserves all-time usage, bounds token
history to one aggregate, and prevents stale-list double counting.

### Option B: Per-session/delegation tombstones

Idempotent but stores implementation rows rather than user-visible sessions
and grows one full token snapshot per deletion. Replaced.

### Option C: Deleted aggregate without member IDs

Smaller, but incorrect: a stale `session.list` row would be re-added as live
after its usage had already entered the aggregate.

### Option D: In-memory totals only

Simplest, but restart loses deleted usage. Rejected.

## Action Items

1. [x] Root/delegation grouping and recursive aggregation in `ledger.ts`.
2. [x] One deleted aggregate plus member-ID deduplication per project.
3. [x] Full-ledger summation, live fallback, and `projectIDHint` recovery.
4. [x] Regression coverage for recursive trees, delete cascades, and stale
   list reappearance.

## References

- `src/tokenmeter/ledger.ts` — root grouping, folding, persistence
- `src/tokenmeter/project.ts` — refresh, fallback, recovery
- `src/tokenmeter/math.ts` — live roots + deleted aggregate sum
- [ADR-0002: Reconcile by invalidation and client rehydration](0002-reconcile-by-invalidation-and-client-rehydration.md)
