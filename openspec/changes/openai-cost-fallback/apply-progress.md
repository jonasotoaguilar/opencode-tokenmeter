# Apply Progress: OpenAI Cost Fallback — Unit 1A Pure Resolver (corrected)

**Change**: `openai-cost-fallback` **Slice**: Unit 1A (1A.1–1A.4) **Branch**: `fix/issue-27-openai-cost-fallback`
**Chain**: stacked-to-main, auto-chain **Date**: 2026-08-24
**Correction**: `sha256:92b4e9ef834ea9949608bc15b85483db8910b0731322562bb9d8142e4208d31f`
**Parent**: `sha256:dfa51ba40dffcf3d9fb139f7051debb0f5e81f1228465eaa1e150e0e17c1f87c`

## Completed
- [x] 1A.1 RED `test/cost-fallback.test.ts` — gates, reported wins, /1M reasoning/cache, trim+lower exact, suffix miss, safe-zero, source
- [x] 1A.2 GREEN `types.ts` — FinitePrice, MonetarySource, ResolvedCost, MoneyRow, MessageUsage.source, UsageMessage.providerID/modelID
- [x] 1A.3 GREEN `pricing.ts` — pricingKey, selectFiniteNonTier, estimateCost, getPricing/setPricing/clearPricing (pure, no model.list)
- [x] 1A.4 GREEN `math.ts` — resolveCost, usageOf source (reported wins, billable, exact key, /1M, never throw)

## Pending (not in 1A)
- [ ] 1B store identity (rememberCosts, sessionCostIdentity, observedSessionUsage) — 1B.1/1B.2
- [ ] 2 adapter+reconcile (loadPricing model.list one in-flight) — 2.1/2.2
- [ ] 3 project tombstones (readDeletedSessionIDs, sumProjectSessions) — 3.1/3.2
- [ ] 4 deleted resolveEntry + docs — 4.1/4.2

## Files Changed (1A slice)
- `types.ts` modified — monetary types
- `pricing.ts` created — pure seam, injectable map
- `math.ts` modified — resolveCost gates + usageOf source
- `test/cost-fallback.test.ts` created — concise 1A suite (data-driven)
- `tasks.md` modified — split 1→1A/1B
- `apply-progress.md` modified — this file
- Pre-slice docs excluded: proposal/spec/design/exploration (planning, not slice)

## Diff Accounting (post-format, slice only)
- `math.ts` 70 (69+1) + `types.ts` 15 + `pricing.ts` 75 + `test` 119 + `tasks.md` 51 + `apply-progress.md` 65 = **395 ≤400**
- Prod 160 + test 119 + docs 116 = 395; hardening +5 (negative guard + dedupe + test) keeps cap; prior failure 966 corrected

## TDD Evidence
- 1A.1: RED pricing missing→fail, GREEN 2 tests pass, triangulate gates/report/trim/suffix/safe-zero/selector, helpers P10/T100/RC
- 1A.2: types RED→GREEN single type, clean
- 1A.3: pricing RED→GREEN key trim-lower vs suffix, selector first finite vs tier + negative >=0 guard, pure no network
- 1A.4: math RED→GREEN formula reasoning+cache, reported wins, safe-zero + negative est guard (est<=0), never throw
- Summary: 2 tests, 25 expects; `bun test` 271 pass with slice (254 pre); typecheck+build pass

## Work Unit Evidence
- Focused: `bun test test/cost-fallback.test.ts` → 2 pass, 0 fail, 25 expects [data-driven safe-zero + negative-price loop]
- Runtime: N/A pure seam (no host SDK/DB) — `bun run typecheck` pass, `bun run build` pass
- Rollback: `types.ts` `pricing.ts` `math.ts` `test/cost-fallback.test.ts` — delete reverts to reported-only; store untouched
- Normalization: `biome format --write` on 4 TS/test files (no diff after), `biome check` 0 errors on slice (pricing re-exports canonical types)

## Deviations
None for 1A. Store identity, alias guessing, model.list, costParts deferred to 1B+ per correction.

## Issues Found
Gate failure corrected: 966→390 by reverting store identity (169 lines) and data-driven test compaction (no duplicated matrices).
Hardening: negative price guard (`isFiniteNumber >=0` + `est<=0` in resolveCost, deduped MonetarySource/ResolvedCost/MoneyRow re-exports) +1 negative-price assertion; candidate stays bounded.

## Workload / PR Boundary
- Mode: stacked PR slice correction `92b4e9...` — Unit 1A pure resolver, ends before store/adapter/project/deleted
- Budget: 396 ≤400 (hardened), pre-slice docs excluded
- Next: Unit 1B store identity (dependent)

## Status
4/11 tasks complete (1A.1–1A.4), 7 pending. Pure resolver proven: gates, reported authority, /1M with reasoning/cache, exact trim+lower/no suffix, safe-zero, selector, source all green; no store side effects.

## Next
Unit 1B — Store Identity (dependent PR, same chain). sdd-verify not yet.

## Skill Resolution
- Loaded: sdd-apply, opencode-plugin, work-unit-commits, chained-pr (stacked-to-main), code-simplification, debugging-and-error-recovery
