# ADR-0009: Durable per-session checkpoints outside the host state directory

## Status
Accepted

## Date
2026-08-29

## Deciders
jonasotoaguilar

## Context
The Project section must show **all-time** usage that survives deletion of the OpenCode cache/state directory (`api.state.path.state`). ADR-0006 stored ONE aggregate per project plus tombstones in `tokenmeter.sqlite` *inside* that same state directory. Deleting the cache therefore deleted the backup — the very history it was meant to protect. The contract is Project = all-time usage (live + historical), and the host state directory is explicitly ephemeral.

Additional forces:
- The sidebar already polls `project.current + session.list({ directory, scope:"project", limit:10_000 })` every 30 s; any checkpoint must piggyback that successful list, not add SDK calls or sweep `session.messages`.
- History must be per-session, keyed by stable identity + session ID, with monotonic high-water so a smaller later snapshot never regresses, and cost provenance (reported vs estimated) must be preserved, not blindly maxed.
- Reconciliation is a **union by session identity**, never `backup total + live total`.
- Only the *currently open* project is checkpointed; an independent all-project scanner would be unbounded.
- Multiple TUIs may write concurrently; WAL + busy_timeout + one transaction and monotonic merge are required. A crash during write must preserve the prior commit.
- Existing users' all-time deleted aggregate is a product contract; a one-time idempotent migration from the legacy DB must be performed, then only the new reader/writer remains.
- OpenCode may regenerate `projectID` after cache deletion; a canonical, safe worktree alias must allow recovery without merging unrelated clones.

The TUI host runs Bun 1.3.11 (`bun:sqlite` builtin) and the build target is Bun.

## Decision
Replace the state-directory aggregate with a **durable per-session checkpoint store outside `api.state.path.state`**:

- **Durable root** — standard OS/XDG data location, pure injectable resolution:
  - Linux: `$XDG_DATA_HOME/opencode-tokenmeter` or `~/.local/share/opencode-tokenmeter`
  - macOS: `~/Library/Application Support/opencode-tokenmeter`
  - Windows: `%APPDATA%/opencode-tokenmeter` or `%LOCALAPPDATA%/opencode-tokenmeter`
  - Test override: `TOKENMETER_DURABLE_DIR` (injectable, never browser storage or repo)
  - Directories created `0700`, files `0600` where feasible; only numeric aggregates + minimal identity/version metadata are persisted — never messages, prompts, secrets, or raw payloads. Paths are validated/normalized via `isSafeDirectory` + `normalizeAlias`.

- **Schema** — `checkpoints.sqlite` with one row per `(session_id, project_id)`:
  `project_alias` (canonical worktree), `cost` + `cost_source` (reported/estimated), `input/output/reasoning/cache_read/cache_write/cache/context`, `updated_at` (cheap `session.time.updated`), `checkpoint_at`, `version`. No per-message history.

- **Checkpointing** — on every *successful* `session.list` (the existing 30 s poll plus event/idle/deletion refresh), batch UPSERT only changed sessions in **one SQLite WAL transaction** with `busy_timeout=5000` and `PRAGMA journal_mode=WAL`. Fingerprint comparison ensures an idle unchanged refresh performs **zero row updates**. No `session.messages` sweep.

- **Reconciliation** — `reconcileProjectUsage(projectID, liveSessions, checkpoints, alias)` is a union by `session.id`:
  - live + checkpoint → merge monotonically (per-field max, cost via reported-wins) and count once
  - checkpoint-only → counts as historical
  - duplicate live rows → count once
  - reappearing/updated session → same row, monotonic

- **Deletion** — `session.deleted` performs a final `INSERT ... ON CONFLICT DO UPDATE` into the *same* checkpoint row (payload + observed high-water merged) before `forgetSession`; no tombstone/aggregate ledger remains.

- **Concurrency** — every operation is `open → WAL → busy_timeout → one transaction → close`. Monotonic `MAX()` + cost `CASE` in SQL preserves high-water even with stale pre-reads. Crash preserves prior commit.

- **Migration** — if `api.state.path.state/tokenmeter.sqlite` still exists, a one-time idempotent import copies each legacy `projects` aggregate row into a reserved checkpoint `__migrated_aggregate__` per project. After that, only the durable reader/writer is used; no dual-write. If the legacy DB was already deleted, there is nothing to recover — this is documented honestly.

- **Identity** — `projectID` primary, plus `project_alias` for recovery. Same canonical alias with regenerated ID recovers; different alias (different clone/root) stays isolated.

ADR-0006 is superseded. The obsolete `tombstones`/`projects` aggregate and the `api.kv` ledger remain never read/written.

## Consequences

### Positive
- Deleting `~/.cache/opencode` or `api.state.path.state` no longer deletes history; the durable root survives.
- Live and historical usage never double-count; per-session high-water is monotonic and cost-provenance-aware.
- Only the active project writes, bounded and without extra SDK load.
- Concurrent TUIs and crashes are safe via WAL + monotonic merge.

### Negative
- Durable location is host-specific; moving the project to another machine without copying `~/.local/share/opencode-tokenmeter` starts fresh (honest, not silent loss).
- A project with >10_000 live sessions still fails closed with the stable error.

### Neutral
- Legacy `tokenmeter.sqlite` under the state directory is read once for migration, then ignored.
- `TokenMeter` backs up **numeric usage** only, not OpenCode conversation content.

## Options Considered
- **Keep state-directory aggregate (ADR-0006)**: rejected — cache deletion deletes the backup.
- **Per-session JSON files under state dir**: rejected — same durability failure, no atomic transaction.
- **All-project periodic scanner**: rejected — unbounded, violates active-project-only invariant.

## Action Items
1. [x] `src/tokenmeter/durable/paths.ts` — pure OS/XDG resolver + alias normalization
2. [x] `src/tokenmeter/durable/{checkpoints,merge,reconcile,deleted,migrate,types}.ts` — per-session WAL store, union, deletion, migration
3. [x] `src/tokenmeter/project.ts` + `browser/{projects,project-detail}.ts` + `tokenmeter.tsx` — cut over to durable union, piggyback checkpoint, deletion UPSERT
4. [x] `test/durable-checkpoints.test.ts` — real `bun:sqlite` filesystem coverage for all invariants
5. [x] Docs + ADR-0009, supersede ADR-0006, rebuild artifact

## References
- `src/tokenmeter/durable/` — durable implementation
- `src/tokenmeter/project.ts` — piggyback checkpoint + union
- `docs/adr/0006-sqlite-persistence-for-deleted-project-usage.md` — superseded
