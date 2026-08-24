# Apply Progress: OpenAI Cost Fallback — Units 1A+1B cumulative

**Change**: `openai-cost-fallback` **Slice**: Unit 1B Store Identity (1B.1–1B.2) **Branch**: `fix/issue-27-openai-cost-fallback-1b`
**Chain**: stacked-to-main, auto-chain **Date**: 2026-08-24
**Parent attempt**: `sha256:e9564ff2271793b4abfe4450bc0764408a207cffd0e3e589dcac93c5f81f9e8c` (parent settles)
**Base**: `2f25084e271a0b7d78d6e6ab4947e20aea23bf4b` (Unit 1A merged)
**Correction lineage**: `92b4e9ef834ea9949608bc15b85483db8910b0731322562bb9d8142e4208d31f` → `e9564ff2` (bounded Unit1B correction)

## Completed
- [x] 1A.1 RED `test/cost-fallback.test.ts` — gates, reported wins, /1M reasoning/cache, trim+lower exact, suffix miss, safe-zero, source
- [x] 1A.2 GREEN `types.ts` — FinitePrice, MonetarySource, ResolvedCost, MoneyRow, MessageUsage.source, UsageMessage.providerID/modelID
- [x] 1A.3 GREEN `pricing.ts` — pricingKey, selectFiniteNonTier, estimateCost, getPricing/setPricing/clearPricing (pure, no model.list)
- [x] 1A.4 GREEN `math.ts` — resolveCost, usageOf source (reported wins, /1M, exact key, never throw)
- [x] 1B.1 RED composite per-message authority: M1.10+M2.05+M3.04 refill M2.02 M3 absent→.16 repeat→.16 mixed sums idempotency
- [x] 1B.2 GREEN `store.ts` — rememberCosts, sessionCostIdentity, observedSessionUsage Σ identity, remove/forget clean identity

## Pending (not in 1A/1B)
- [ ] 2 adapter+reconcile (loadPricing model.list one in-flight) — 2.1/2.2
- [ ] 3 project tombstones (readDeletedSessionIDs, sumProjectSessions) — 3.1/3.2
- [ ] 4 deleted resolveEntry + docs — 4.1/4.2

## Files Changed (1B slice only)
- `src/tokenmeter/store.ts` modified — sessionCostIdentity (now private), rememberCosts, observedSessionUsage identity sum + token high-water, remove/forget clean; header fixed (tokens high-water vs cost identity), duplication removed via upsertCostIdentity helper with centralized empty-ID guard
- `test/cost-fallback.test.ts` modified — concise 1B suite (composite, idempotency, reported>estimated, token high-water, remove/forget) — asserts via public behavior/cleanup only, no internal mutation
- `openspec/changes/openai-cost-fallback/tasks.md` modified — mark 1B.1/1B.2 done
- `openspec/changes/openai-cost-fallback/apply-progress.md` modified — this file (cumulative) + correction evidence
- Pre-slice docs excluded: proposal/spec/design/exploration (planning, not slice)

## Diff Accounting (post-format, 1B slice only)
- `store.ts` 93+17 + `test` 93+1 + `tasks.md` 3+3 + `apply-progress.md` 60+35 = **305 ≤400** (exact post-format recount)
- Prod 110 + test 94 + docs 101 = 305; pure store seam, no SDK wiring; prior 1A 395 preserved on main

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1A.1 | `test/cost-fallback.test.ts` | Unit | ✅ 269/269 | ✅ missing pricing→fail | ✅ 2 pass | ✅ gates/report/trim/suffix/safe-zero/selector | ✅ mk helpers P10/T100/RC |
| 1A.2 | `types.ts` | Unit | N/A new | ✅ Written | ✅ Pass | ➖ Single types | ✅ Clean re-export |
| 1A.3 | `pricing.ts` | Unit | N/A new | ✅ Written | ✅ Pass | ✅ key+selector negative guard | ✅ isFiniteNumber >=0 |
| 1A.4 | `math.ts` | Unit | ✅ 269/269 | ✅ Written | ✅ Pass | ✅ reasoning/cache formula | ➖ None needed |
| 1B.1 | `test/cost-fallback.test.ts` | Unit | ✅ 269/269 | ✅ `rememberCosts` not found | ✅ 4 pass composite | ✅ idempotency+mixed+repeat archival | ✅ mk helper |
| 1B.2 | `src/tokenmeter/store.ts` | Unit | ✅ 269/269 | ✅ observed cost high-water fail (0.01 vs 0.03) | ✅ 273 pass | ✅ reported>estimated, zero-guard, token high-water, remove/forget | ✅ upsertCostIdentity helper (centralized empty-ID, preserves reported>estimated + non-zero-over-zero) |

### Test Summary
- **Total tests written**: 4 (2×1A, 2×1B) — 40 expects in cost-fallback (25×1A +15×1B)
- **Total tests passing**: 273 across 10 files (269 pre +4 cost-fallback) — 8261 expects
- **Layers used**: Unit (4), Integration (0), E2E (0)
- **Approval tests**: None — new seam, no refactoring
- **Pure functions created**: rememberCosts, syncIdentityFromMap, upsertCostIdentity (private helper)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `bun test ./test/cost-fallback.test.ts` → 4 pass, 0 fail, 40 expects |
| Runtime harness command/scenario and exact result | N/A pure store seam (no host SDK/DB) — `bun run typecheck` pass, `bun run build` pass, full `bun test` 273 pass |
| Rollback boundary | `src/tokenmeter/store.ts` `test/cost-fallback.test.ts` — delete reverts cost to high-water max; tokens untouched; identity map removed |

- Normalization: `biome format --write` on 2 TS/test files (store + test) no diff after, `biome check` 0 errors on slice
- Strict TDD RED→GREEN verified: 1B.1 fail `rememberCosts not found`, 1B.2 fail cost 0.01 vs 0.03 high-water → both green after store identity
- Correction (bounded) 2026-08-24 `e9564ff2`: header fixed (tokens high-water vs cost identity); duplication removed via single private `upsertCostIdentity` helper (reported>estimated + zero-guard, centralized `!id` guard, no broader scope); `sessionCostIdentity` made private after CodeGraph confirms zero production callers (grep `src/` only internal; tests already use public `rememberCosts`/`observedSessionUsage`/`removeMessageUsage`/`forgetSession` cleanup, no accessor added); timing unchanged

## Deviations
None for 1B. Reuses Unit1A canonical types/pure resolver; no duplicate monetary types; no SDK model.list/loadPricing/reconcile (Unit2), no Project/tombstones (Unit3), no deleted/docs (Unit4). Zero-cost guard (`incoming.cost===0 && existing.cost!==0 → keep`) preserves compaction high-water for reported costs while allowing lower reported to replace estimate.

## Issues Found
- Harness compaction cost high-water (0.03) failed under identity sum (0.01) because same-ID zero overwrote non-zero. Fixed with zero-guard: reported non-zero never overwritten by zero, preserving historical spend while still allowing estimated→reported lower replacement. Full suite now 273 pass.

## Workload / PR Boundary
- Mode: stacked PR slice `e9564ff2` (bounded correction on `a89477...`) — Unit 1B Store Identity, autonomous slice
- Boundary: starts after 1A pure resolver (2f25084), ends before adapter/project/deleted; no SDK wiring, timing unchanged
- Budget: 305 ≤400 (hard cap), docs excluded — exact post-format recount 249+56=305
- Next: Unit 2 adapter+reconcile (dependent)

## Status
6/11 tasks complete (1A.1–1A.4, 1B.1–1B.2), 5 pending. Store monetary identity proven: per-message upsert, reported>estimated even if lower, missing estimated archives once, repeat no double, observed cost Σ identity while tokens keep maxComponents high-water, remove/forget clean identity.

## Next
Unit 2 — Adapter+Reconcile (dependent PR, same chain). sdd-verify not yet.

## Correction Evidence

- **Finding 1 — stale header**: fixed `store.ts` module header to state token components use per-field high-water (maxComponents semantics) while monetary cost uses per-message identity Σ; observedSessionUsage doc already correct, header now matches.
- **Finding 2 — duplication**: extracted single cohesive private helper `upsertCostIdentity(identity, id, incoming)` preserving `reported>estimated` and `non-zero-over-zero`; both `rememberCosts` and `syncIdentityFromMap` now delegate to it (net -6 lines duplicated logic, +11 helper, behavior identical).
- **Finding 3 — visibility**: `sessionCostIdentity` made `private` (`const` not `export`) after CodeGraph + `grep src/` confirms zero production importers (only `store.ts` internal + `test` via public API). Tests already assert via public `rememberCosts`/`observedSessionUsage`/`removeMessageUsage`/`forgetSession` cleanup; no test-only accessor added. If production had depended, would have left export and reported reason.
- **Finding 4 — empty-ID guard**: centralized `if (!id) return` inside `upsertCostIdentity`; `rememberCosts` no longer duplicates `if (!id) continue`, `syncIdentityFromMap` now gains correct guard via helper (helper-scoped, no new sessionID guard, no broadened scope).

## Skill Resolution
- Loaded: sdd-apply, opencode-plugin, work-unit-commits, chained-pr (stacked-to-main), code-simplification, debugging-and-error-recovery
- skill_resolution=paths-injected
