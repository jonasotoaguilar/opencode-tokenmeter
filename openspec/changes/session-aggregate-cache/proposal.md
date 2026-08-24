# Proposal: Session Aggregate Cache

## Intent

Blocker: OpenAI fallback never ran. Runtime calls `api.client.model.list`; installed SDK exposes only `api.client.v2.model.list`. Class: bug + architecture/performance; `fix` slices. Persist one absolute aggregate per `(project_id, session_id)` in `tokenmeter.sqlite`. Stop 10k `session.list` polls. Native messages stay source of truth.

## Scope

### In Scope
- Pricing: `api.client.v2.model.list`; SDK-typed mocks
- One `session_totals` row: absolute reported/estimated cost, tokens, CAS revision, fingerprint/cursor, content-hash `pricing_version`, deleted marker/timestamps
- Replace absolute row with expected revision; CAS miss or unknown/edited/removed/compacted → one-session repair; no additive persistent delta
- Startup publishes cached SQL totals, then repairs missing/stale active sessions
- Session/agent = tree IDs + cached rows; Project = `SUM` including retained deleted rows; retarget 2s poll to SQLite `SUM`
- `session.deleted` marks deleted, retains totals, idempotent; pricing content hash versions estimates; hash change repairs affected sessions boundedly
- Clean break: drop `projects`, `tombstones`, old kv ledger; no dual-write, fallback, compatibility layer, or deleted-history migration
- bun:sqlite/WAL/`BEGIN IMMEDIATE`/busy_timeout only; strict TDD; stacked-to-main `fix` ≤400 lines

### Out of Scope
- UI/badge; durable per-message rows; dual-write; migrate pre-upgrade deleted totals; `api.kv` Project history; monotonic host IDs/times

## Capabilities

### New Capabilities
- `session-aggregate-cache`: absolute SQLite totals, CAS replace + one-session repair, startup `SUM`, deleted retention, pricing-version repair, Project `SUM`

### Modified Capabilities
- `openai-cost-fallback`: Pricing Source → `api.client.v2.model.list`; Idempotency/Propagation and Restart stop using live `session.list`/`model.list` as Project/restart authority

## Approach

Native messages remain authority. `BEGIN IMMEDIATE` + expected-revision replace; mismatch repairs that session via `session.messages`. `PRAGMA user_version` bump drops old tables.

Slices: (1) pricing v2 ~120; (2) schema/CAS/drop ~300; (3) event upsert ~300; (4) read paths + SQLite poll ~320; (5) delete/repair/hash ~280; (6) docs/ADR 0008 + perf ~200. 1 isolated; 3–5 need 2; 6 last.

## Affected Areas

`pricing.ts`, `db.ts`, store/reconcile/project/math/types/tree/groups, `tokenmeter.tsx`, ADR 0008, ARCHITECTURE, PRD, CODEBASE-GUIDE.

## Risks

- High CAS miss / non-monotonic IDs: one-session repair; no additive deltas
- Med parallel TUI double-count: `BEGIN IMMEDIATE` + revision replace
- Med pricing-hash repair storm: bump only on hash change; bound repairs
- High upgrade loses deleted history: documented reset
- High 400-line overrun: six stacked `fix` PRs

## Rollback Plan

Revert newest-first. After Slice 2, `session_totals` drops and pre-upgrade `projects` totals cannot be restored. No dual-write fallback.

## Dependencies

Installed SDK `v2.model.list`; existing bun:sqlite primitives; first-fill prototype is evidence, not baseline; remove probe.

## Success Criteria

- [ ] `api.client.v2.model.list` used; SDK-typed mocks; one absolute row; CAS replace + one-session repair; no additive persistent delta
- [ ] Startup `SUM` ≤5ms median (p95 ≤10ms); write ≤3ms; poll 0 host RPC unless repair
- [ ] Deleted rows retained in Project `SUM`; `session.deleted` idempotent; pricing-hash repair bounded; `bun test` green; each `fix` PR ≤400 lines
