# ADR-0002: Reconcile by invalidation and client rehydration

## Status

Accepted

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

The panel must reflect the current usage of the active session and its whole delegation tree as events stream in. Two sources of usage exist: the TUI's in-memory mirror (`api.state.session.messages`) and the client SDK (`api.client.session.messages`). The mirror is cheap but can be stale or incomplete — it may lag, drop messages, or never see removals and compaction — and a naive merge of new events into a stored map can neither delete messages nor correct changed ones. Re-fetching every session synchronously on every event would churn the client and repaint the panel constantly. Events also arrive bursty and out of order (parts stream through `message.part.updated`, tools, retries, compaction).

## Decision

Treat the **client SDK as the source of truth** and the in-memory store as a projection. Every refresh event invalidates the affected session (drops its loaded flag, marks it for rehydration, keeps its existing map untouched so an interrupted publish never flashes zeroes) and schedules a **debounced reconcile** (300 ms; 100 ms on idle). The reconcile discovers the tree and, per session: uses the in-memory mirror only as a cheap fast path for unchanged, already-loaded sessions; bypasses it entirely for sessions marked for rehydration and re-reads the authoritative client messages; replaces the stored map (clear + rebuild by ID) only after a successful authoritative load; treats empty loads as provisional (the TUI sync may still be streaming, so the session stays loadable and retries re-read the client); and drops stale async results via a generation counter plus a current-root guard. Activation (first mount, sessionID prop change, route change) force-rehydrates the root and its whole descendant tree instead of trusting previously-loaded maps. A 2 s maintenance timer on the active root re-discovers the tree for missed events (e.g. `session.created` without parentID) without forcing client message fetches.

## Consequences

### Positive

- A stale non-empty mirror can never win over fresh client data; removals, changed messages, and compaction are reflected on the next reconcile.
- Totals cannot double-count: message usage is keyed by message ID and the map is replaced, not merged.
- Event bursts collapse into one repaint; out-of-order events cannot produce stale renders (generation counter).
- The tree is always recoverable: cached empty child lists cannot permanently hide a delegated session.

### Negative

- Reconcile depends on the client endpoints (`session.messages`, `session.children`, `session.get`); a client failure keeps the session loadable but delays freshness until the next event or activation.
- The loaded/rehydrate state machine adds bookkeeping per session.

### Neutral

- The in-memory fast path keeps unchanged sessions cheap; only invalidated or first-load sessions hit the client.

## Options Considered

### Option A: Invalidation + client rehydration (chosen)

Correctness against the authoritative source; bounded client round-trips (only loading/rehydrating sessions); debounced to one repaint per burst.

### Option B: In-memory mirror as source of truth

Faster, but cannot reflect removals/compaction reliably; the panel drifts from the client over long sessions. Rejected.

### Option C: Interval polling of the client

Simple, but burns client round-trips on idle seconds and repaints on a fixed cadence regardless of activity. Rejected in favor of event-driven invalidation plus the 2 s tree-only maintenance tick.

### Option D: Remount the panel on every event

Simplest render path, but the panel flashes, loses scroll state, and the render harness explicitly guards against remount-driven repaints. Rejected.

## Trade-off Analysis

Freshness wins over cheapness where it matters (invalidated sessions re-read the client), while unchanged sessions keep the mirror fast path — the cost is a small state machine instead of a single map, in exchange for never showing data the client no longer has.

## Action Items

1. [x] `store.ts` loaded/rehydrate flags and `invalidateUsage` semantics.
2. [x] `reconcile.ts` debounce, generation counter, maintenance timer, force-rehydrate on activation.
3. [x] `test/render.test.tsx` stale-mirror regression: invalidation rehydrates the same mounted panel from the authoritative client.

## References

- `src/tokenmeter/store.ts` — loaded/rehydrate state
- `src/tokenmeter/reconcile.ts` — debounced reconcile + maintenance timer
- `test/render.test.tsx` — repaint-without-remount and stale-mirror regressions
