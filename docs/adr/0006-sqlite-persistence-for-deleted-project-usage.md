# ADR-0006: SQLite persistence for the deleted-session project aggregate

> **Superseded by [ADR-0009](0009-durable-per-session-checkpoints.md)** — state-directory `tokenmeter.sqlite` is cache-ephemeral; the durable per-session checkpoint store outside `api.state.path.state` is the current architecture. This ADR is retained for historical rationale only.

## Status

Superseded by ADR-0009

## Date

2026-08-11

## Deciders

jonasotoaguilar

## Context

The Project section must show **all-time** usage: deleting a session must not
remove the tokens it spent, and repeated delete events plus multiple
concurrent TUIs must never duplicate totals. ADR-0003 persisted a v4 kv
ledger (`tokenmeter.project.history.v4`) holding live root-tree snapshots and
one deleted aggregate. Two defects made that design wrong:

1. **Cross-process clobbering.** `TuiKV` reads the shared `kv.json` once;
   every `set` writes the process's whole stale snapshot. Two OpenCode TUIs
   open in different repos of the same project lose each other's Project
   history writes.
2. **Default list truncation.** OpenCode's `Session.list` uses
   `input.limit ?? 100`; the tested config project alone has 309 live session
   rows. Without an explicit limit the live list is silently truncated.
3. **Persisted live roots need re-admission logic.** The v4 design had to
   block stale re-addition of folded trees (`deletedIDs`) and re-seed Session
   high-waters from persisted snapshots. The authoritative `session.list`
   makes live totals a read-on-every-refresh operation; nothing live needs
   persisting.

The TUI host exposes `api.state.path.state` (the plugin state directory), the
production host runs Bun 1.3.11 (which ships `bun:sqlite` as a builtin, no
`node:sqlite`), and the build target is Bun.

## Decision

Replace the v4 kv ledger with a plugin-owned SQLite database at
`api.state.path.state/tokenmeter.sqlite`:

- **`projects`** — ONE aggregate row per `project_id`: the sum of every
  deleted session's final usage (cost/input/output/reasoning/cacheRead/
  cacheWrite/cache/context).
- **`tombstones`** — a minimal `(session_id, project_id)` admission set,
  used **solely** for cross-process exactly-once accounting.

OpenCode's deletion walks the tree children-first and publishes one
`session.deleted` event per session, so each event atomically adds exactly
that session's final usage. The delete path runs ONE transaction:

```text
BEGIN IMMEDIATE
INSERT OR IGNORE INTO tombstones (session_id, project_id) VALUES (?, ?)
if changes == 1:  upsert projects.aggregate += resolved entry
COMMIT
```

Only the transaction that inserted the tombstone increments the aggregate;
duplicate deliveries and concurrent TUIs see `changes == 0` and skip. A
delete whose payload AND observed usage carry nothing is skipped WITHOUT a
tombstone, so a later useful event for the same session is still admitted.
Payload and observed usage resolve per-component (per-field maximum), as in
the store.

The Project total is computed on every refresh as

```text
sumProjectSessions(session.list({ directory, scope: "project",
                                  limit: PROJECT_SESSION_LIMIT }))
+ SQLite deleted aggregate for projectID
```

Live sessions are NEVER persisted or re-added. The list call passes an
explicit bounded limit (`PROJECT_SESSION_LIMIT = 10000`); a result length at
the cap is a truncated list and fails closed — the prior snapshot is
preserved and the stable error surfaces. Refreshes never write history.
Different projects stay isolated by `project_id` in the same file.

Concurrency: every operation opens its own short-lived connection (WAL
journal mode, busy timeout, `synchronous = NORMAL`), runs one transaction,
and closes — every process reads the latest committed state and writers
queue instead of clobbering.

A single bounded polling timer (~30 s) per plugin refreshes Project on top of
the local event-driven fast path, so another OpenCode process working in the
same project appears in the sibling sidebar promptly. The poll never
overlaps an in-flight refresh, starts at most once, and is disposed through
the existing lifecycle.

The obsolete v4 kv ledger is never read, converted, migrated or written.
`tokenmeter.sidebar.expanded` stays in `api.kv` (ADR-0003's first half).
Without persisted live roots, Project storage no longer seeds Session
high-waters; the in-run per-component high-water in the store is unchanged.

## Consequences

### Positive

- Concurrent TUIs cannot lose or duplicate each other's deleted history:
  tombstone admission is atomic in a shared WAL database.
- The live total is always the authoritative list; no snapshot can go stale,
  and no stale re-addition logic exists.
- Explicit list limit fixes the silent 100-row truncation; cap saturation
  fails closed instead of showing a partial total.
- One aggregate per project keeps deleted history bounded (no per-session
  token snapshots).
- A sibling TUI's deletions appear within ~30 s via the polling timer.

### Negative

- A project with more than 10_000 live sessions cannot be shown fully until
  the host adds paging/cursors — it fails closed with the stable error.
- The plugin now owns a real database file in the host state directory;
  concurrent processes must tolerate SQLite busy-waiting (bounded by the
  busy timeout).
- A no-usage delete is skipped entirely; a session deleted before it was
  ever observed with usage still contributes nothing.

### Neutral

- The store is schema-trivial (two tables), opened with short
  open/transaction/close boundaries, and keyed by projectID in one file.
- ADR-0003's kv key for collapse state remains authoritative and unchanged.

## Options Considered

### Option A: Plugin-owned SQLite store with tombstones (chosen)

Atomic exactly-once admission across processes, bounded history, no live
snapshots. `bun:sqlite` is a Bun builtin — no new dependency, and the Bun
build target bundles it as an external builtin.

### Option B: Keep the kv ledger (ADR-0003 v4)

Rejected: concurrent TUIs overwrite each other's whole-file writes, and
persisted live roots require re-admission logic the authoritative list makes
unnecessary.

### Option C: Per-session tombstone rows with full token snapshots

Idempotent but unbounded growth. Rejected: one aggregate per project is the
minimal correct shape.

### Option D: In-memory totals only

Simplest, but restarts and sibling processes lose deleted usage. Rejected.

## Action Items

1. [x] SQLite store module (`db.ts`) with `projects` + `tombstones`, WAL/busy
   timeout, short open/transaction/close boundaries.
2. [x] Atomic `session.deleted` admission (BEGIN IMMEDIATE + INSERT OR
   IGNORE; no-usage deletes never consume a tombstone).
3. [x] Project refresh: explicit 10_000 list limit, cap-saturation fail-closed,
   live sum + deleted aggregate, no history writes.
4. [x] Single ~30 s polling timer with in-flight/duplicate/dispose guards.
5. [x] Regression coverage: explicit limit + cap saturation; two independent
   connections (isolation, exactly-once, immediate visibility, refresh over
   shared aggregate); recursive child+parent deletion; no-usage tombstone
   behavior; polling lifecycle.

## References

- `src/tokenmeter/db.ts` — SQLite store, tombstone admission
- `src/tokenmeter/project.ts` — refresh, limit, cap fail-closed, polling
- `src/tokenmeter/math.ts` — live sum, combine, per-component resolution
- [ADR-0003: KV persistence for collapse state and the project history ledger](0003-kv-persistence-for-collapse-state-and-project-ledger.md)
