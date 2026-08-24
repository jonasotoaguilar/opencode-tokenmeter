# Tasks: Session Aggregate Cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1480 (350+300+350+280+200) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | tracker draft → PR1–PR5; only tracker→main |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Apply PR1. Dirty worktree ≠ baseline. Skills: sdd-apply, chained-pr, stacked-pr (`gh stack init --base feat/session-aggregate-cache`), work-unit-commits, opencode-plugin, performance-optimization.

### Suggested Work Units

| Unit | Goal | PR | Test | Runtime | Rollback |
|------|------|----|------|---------|----------|
| 0 | Tracker from main | tracker | N/A | N/A no runtime | delete tracker |
| 1 | v2+first-fill; no tree invalidate | PR1 base=tracker `01-pricing` | `bun test test/pricing-first-fill.test.ts test/cost-fallback.test.ts` | `bun run test:dist`; no probe | `pricing/tokenmeter/reconcile/store` +tests |
| 2 | schema/CAS; migrate uncalled | PR2 base=PR1 `02-schema` | `bun test test/session-totals.test.ts` | N/A uninvoked | `session-totals.ts`+types+test |
| 3 | repair/events unwired | PR3 base=PR2 `03-events` | `bun test test/repair.test.ts test/session-events.test.ts` | N/A not wired | `repair.ts`+`session-events.ts`+tests |
| 4 | Atomic cutover | PR4 base=PR3 `04-cutover` | `bun test test/session-cutover.test.ts test/harness.test.ts` | `test:dist` + local TUI | wiring + deleted old path |
| 5 | docs/perf | PR5 base=PR4 `05-docs` | `bun test test/perf/session-totals-bench.ts` | `hyperfine --warmup 2 --runs 20 bun test/perf/session-totals-bench.ts` | ADR 0008 docs bench |

≤400 authored/PR. Polluted child = wrong base.

## Phase 0: Tracker

- [ ] 0.1 `feat/session-aggregate-cache` from `origin/main`; draft.

## Phase 1: PR1 pricing (≤350)

- [ ] 1.1 RED `test/pricing-v2-guard.test.ts`: `satisfies PricingApi`; `tsc` rejects `client.model.list` mocks; `gpt-5.6-sol` formula; `method_missing` ≠ empty.
- [ ] 1.2 GREEN `src/tokenmeter/pricing.ts`: adopt first-fill; `Pick<OpencodeClient,"v2">`; `v2.model.list`; never add `invalidateAllUsage`.
- [ ] 1.3 RED `test/pricing-first-fill.test.ts`+`cost-fallback.test.ts` → typed `v2.model.list`. GREEN `tokenmeter.tsx` subscribe then `loadPricing`; `scheduleForcedReconcile`; drop `store.ts` `invalidateAllUsage`; revert dirty `docs/adr/0007-*.md`. First-fill. `typecheck`; `test:dist`; grep no probe/`client.model.list`.

## Phase 2: PR2 schema (≤300)

- [ ] 2.1 RED `test/session-totals.test.ts`: one row; CAS match/dup; no additive SQL; two-conn migrate; same-id token edit ≠ `unchanged`; `busy`/`io` lastGood no repair/zero 3×≤50ms; delete idempotent.
- [ ] 2.2 GREEN `src/tokenmeter/session-totals.ts`+types: DDL; `migrateSessionTotals` WAL/`user_version=1` drop `projects`/`tombstones`; `casReplace`/`read`/`sumProject`/`readTree`/`markDeleted`/`listPricingRepair`; SHA-256 `id:cost:tokens`. Not called from `db.ts`.

## Phase 3: PR3 modules (≤350)

- [ ] 3.1 RED mixed report+estimate; cache restart; edit/remove/compact/unknown → that id; two-process loser repairs no deltas; hash change estimated N=8 conc.1; same hash/deleted skip.
- [ ] 3.2 GREEN `src/tokenmeter/repair.ts` + `session-events.ts` unwired; empty/trunc lastGood; never missing-delete/`busy`/`io`; no dual-write.

## Phase 4: PR4 cutover (≤280)

- [ ] 4.1 RED paint=cache before RPC; Project SUM incl deleted/peer; tree/agent=tree IDs; 2s SQLite SUM; 0 `session.list` 10000; clean-break grep `history.v4|recordDeletedSession|readDeleted|PROJECT_SESSION_LIMIT|invalidateAllUsage|client.model.list`.
- [ ] 4.2 GREEN `db.ts` `withDb` migrate; wire `tokenmeter.tsx` `project.ts` `reconcile.ts` `math.ts` `tree.ts` `groups.ts`; same candidate delete old path; `session.deleted`→`markDeleted`; no shim.

## Phase 5: PR5 docs (≤200)

- [ ] 5.1 Hyperfine SUM ≤5ms/p95≤10ms write ≤3ms; keep iff variance+green; ledger keep/revert. `docs/adr/0008-session-aggregate-cache.md`; ARCHITECTURE.md PRD.md CODEBASE-GUIDE.md `0007`; no runtime. Grep; probe absent.

## Phase 6: Verify

- [ ] 6.1 `bun run test`+coverage+typecheck+biome:check+build+audit+pack:dry-run+test:dist; local TUI; sdd-verify; then tracker→main; archive.
