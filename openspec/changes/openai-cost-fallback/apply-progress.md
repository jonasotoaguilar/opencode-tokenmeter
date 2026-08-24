# Apply Progress: OpenAI Cost Fallback — Units 1A+1B+2 cumulative

**Change**: `openai-cost-fallback` **Slice**: Unit 2 Adapter+Reconcile (2.1–2.2) **Branch**: `fix/issue-27-openai-cost-fallback-2`
**Chain**: stacked-to-main, auto-chain **Date**: 2026-08-24
**Parent attempt**: `sha256:9f55aead1539a5db6e11378d8b8c3245ab1a9183c10895b8a601e2eb03effb35` (parent settles)
**Base**: `b67612162153cd0e09ee312b4371c108058c2b98` (Unit1B merged @ b676121)
**Correction lineage**: `92b4e9ef834ea9949608bc15b85483db8910b0731322562bb9d8142e4208d31f` → `e9564ff2` (bounded Unit1B)

## Completed
- [x] 1A.1 RED `test/cost-fallback.test.ts` — gates, reported wins, /1M reasoning/cache, trim+lower exact, suffix miss, safe-zero, source
- [x] 1A.2 GREEN `types.ts` — FinitePrice, MonetarySource, ResolvedCost, MoneyRow, MessageUsage.source, UsageMessage.providerID/modelID
- [x] 1A.3 GREEN `pricing.ts` — pricingKey, selectFiniteNonTier, estimateCost, getPricing/setPricing/clearPricing (pure, no model.list)
- [x] 1A.4 GREEN `math.ts` — resolveCost, usageOf source (reported wins, /1M, exact key, never throw)
- [x] 1B.1 RED composite per-message authority: M1.10+M2.05+M3.04 refill M2.02 M3 absent→.16 repeat→.16 mixed sums idempotency
- [x] 1B.2 GREEN `store.ts` — rememberCosts, sessionCostIdentity, observedSessionUsage Σ identity, remove/forget clean identity
- [x] 2.1 RED pricing list: success atomically replaces cached exact map; failure/offline/throw retains last-known-good; malformed tier/NaN/missing omitted; one-in-flight coalesced + poll-delay cooldown retains map
- [x] 2.2 GREEN `pricing.ts` `loadPricing` around `client.model.list({location:{directory}})` one in-flight + cooldown ≥PROJECT_POLL_DELAY (2000), atomic replace via new Map, never throw; `reconcile.ts` awaits `loadPricing` before `discoverTree`/`loadSessionUsage` (coalesced, fail-closed, lifecycle via existing poll seam, no direct HTTP/static prices)

## Pending (not in 1A/1B/2)
- [ ] 3 project+tombstones (readDeletedSessionIDs, sumProjectSessions) — 3.1/3.2
- [ ] 4 deleted resolveEntry + docs — 4.1/4.2

## Files Changed (Unit 2 slice only)
- `src/tokenmeter/pricing.ts` modified — `loadPricing` SDK adapter (`client.model.list` / `ModelV2Info.cost`), one in-flight promise, success atomically replaces via `pricingKey`+`selectFiniteNonTier`, failure/offline/throw retains last-known-good, malformed omitted, cooldown ≥2000 (PROJECT_POLL_DELAY), never throw, `clearPricing` resets cooldown/inflight, `PricingApi` permissive optional shape
- `src/tokenmeter/reconcile.ts` modified — imports `loadPricing`, extends `ReconcileApi` with optional `model.list` + `path.directory`, `reconcile()` awaits `loadPricing(api)` before `discoverTree` (coalesced, fail-contained), preserves Unit1B identity via `usageOf`
- `test/cost-fallback.test.ts` modified — Unit 2 suite: `success replaces/malformed omitted/failure retains` atomically, `one-in-flight coalesced + poll-delay retains`, `reconcile awaits pricing before publishing estimated` via `activateRoot` (covers SDK `ModelV2Info.cost`/`Model.list` verify)
- `openspec/changes/openai-cost-fallback/tasks.md` modified — mark 2.1/2.2 done
- `openspec/changes/openai-cost-fallback/apply-progress.md` modified — this file (cumulative) + TDD/work-unit evidence

## Diff Accounting (post-format, Unit 2 slice only)
- `pricing.ts` 60+0 + `reconcile.ts` 6+0 + `test` 209+0 + `tasks.md` 3+3 + `apply-progress.md` 42+44 = **367 ≤400** (exact post-format `git diff --numstat` 320+47)
- Prod 66 + test 209 + docs 92 = 367; pure adapter+orchestrator seam, no Project/tombstones/deleted/UI (Unit3/4 untouched); prior 1A 395 + 1B 305 preserved on main (stacked)
- Untracked planning docs excluded: `proposal.md`, `spec.md`, `design.md`, `exploration.md`, `specs/` (phase inputs)

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1A.1 | `test/cost-fallback.test.ts` | Unit | ✅ 269/269 | ✅ missing pricing→fail | ✅ 2 pass | ✅ gates/report/trim/suffix/safe-zero/selector | ✅ mk helpers P10/T100/RC |
| 1A.2 | `types.ts` | Unit | N/A new | ✅ Written | ✅ Pass | ➖ Single types | ✅ Clean re-export |
| 1A.3 | `pricing.ts` | Unit | N/A new | ✅ Written | ✅ Pass | ✅ key+selector negative guard | ✅ isFiniteNumber >=0 |
| 1A.4 | `math.ts` | Unit | ✅ 269/269 | ✅ Written | ✅ Pass | ✅ reasoning/cache formula | ➖ None needed |
| 1B.1 | `test/cost-fallback.test.ts` | Unit | ✅ 269/269 | ✅ `rememberCosts` not found | ✅ 4 pass composite | ✅ idempotency+mixed+repeat archival | ✅ mk helper |
| 1B.2 | `src/tokenmeter/store.ts` | Unit | ✅ 269/269 | ✅ observed cost high-water fail (0.01 vs 0.03) | ✅ 273 pass | ✅ reported>estimated, zero-guard, token high-water, remove/forget | ✅ upsertCostIdentity helper |
| 2.1 | `test/cost-fallback.test.ts` | Unit | ✅ 273/273 | ✅ `loadPricing` not found + `snapshot null` | ✅ 3 pass (success/failure/malformed, coalesced, reconcile await) | ✅ atomic replace + failure retain + malformed omitted + coalesced + cooldown | ✅ pricingApi helper, activateRoot wait helper |
| 2.2 | `src/tokenmeter/pricing.ts` + `src/tokenmeter/reconcile.ts` | Unit | ✅ 273/273 | ✅ pricing model.list throws retains / snapshot null | ✅ 276 pass (adapter + reconcile) | ✅ malformed tier/NaN/missing + poll-delay + one-in-flight + reconcile estimated | ✅ permissive PricingApi, cooldown matches PROJECT_POLL_DELAY, no throw |

### Test Summary
- **Total tests written**: 7 (4×1A/1B +3×Unit2) — 56 expects in cost-fallback (40×1A/1B +16×Unit2)
- **Total tests passing**: 276 across 10 files (273 pre +3 Unit2) — 8277 expects
- **Layers used**: Unit (7), Integration (0 wrapped via activateRoot harness for reconcile), E2E (0)
- **Approval tests**: None — new seam, no refactoring
- **Pure functions created**: rememberCosts, syncIdentityFromMap, upsertCostIdentity, loadPricing (adapter, minimal impurity via SDK)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `bun test ./test/cost-fallback.test.ts` → 7 pass, 0 fail, 56 expects [~250ms] |
| Runtime harness command/scenario and exact result | Full `bun test` → 276 pass, 0 fail, 8277 expects [~18s]; pricing uses SDK `client.model.list({location:{directory}})` / `ModelV2Info.cost` verified via `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:4012 ModelCost, 4024 ModelV2Info, 10276 V2ModelList` + `sdk.gen.d.ts:1786 Model.list` (no static table/direct fetch) |
| Rollback boundary | `src/tokenmeter/pricing.ts` `src/tokenmeter/reconcile.ts` `test/cost-fallback.test.ts` — delete reverts pricing to 0-estimate (reported-only); tokens/identity/high-water untouched; SDK wiring removed; Unit1B identity map preserved |

- Normalization: `biome format --write` on pricing/reconcile/test (no diff after), `biome check` 0 errors on slice
- Strict TDD RED→GREEN verified: 2.1 fail `loadPricing not found` + `snapshot null`, 2.2 green after adapter+reconcile (coalesced calls=1, poll-delay retains, atomic replace)
- SDK verify: `ModelV2Info.cost` is `Array<ModelCost>` where `ModelCost { input, output, cache:{read,write}, tier? }` (types.gen.d.ts:4012), `ModelV2Info { providerID, id, cost }` (4024), `V2ModelListResponses {data: ModelV2Info[]}` (10302), `Model.list({location:{directory,workspace}})` (sdk.gen.d.ts:1786) — pricingKey `providerID:id` trim+lower + selectFiniteNonTier first non-tier finite quartet only

## Deviations
None for 2. Reuses Unit1A canonical types/pure resolver (`pricingKey`/`selectFiniteNonTier` exact, no alias) and Unit1B identity (`rememberCosts` Σ) as-is. No `sumProjectSessions`/`readDeletedSessionIDs`/`resolveEntry`/`tokenmeter.tsx`/`docs` (Units3-4). No new deps, no direct HTTP/fetch, no static prices, no backwards-compat layer, no `config.providers`.

## Issues Found
- One-in-flight reference equality: async function return wraps promise, so `p1===p2` false though coalesced (calls=1). Fixed test to assert `calls` count + map state, not reference equality — behavior is coalesced refresh, not promise identity.
- Reconcile publish guard `currentRoot !== rootID` caused `snapshot null` when calling `reconcile` directly without `activateRoot`. Fixed test to use `activateRoot` + wait loop (matches harness pattern); production `reconcile` still awaits pricing before `discoverTree`.

## Workload / PR Boundary
- Mode: stacked PR slice `sha256:9f55aead1539…` — Unit 2 Adapter+Reconcile, autonomous slice
- Boundary: starts after Unit1B identity (#48 b676121), ends before Project/tombstones/deleted; only SDK pricing adapter + reconcile orchestration, no Project/live sum
- Budget: 367 ≤400 (hard cap), untracked planning docs excluded — exact post-format recount 320+47 (prod 66 + test 209 + docs 92)
- Next: Unit 3 Project+tombstones (dependent), Unit 4 Deleted+docs

## Status
8/11 tasks complete (1A.1–1A.4, 1B.1–1B.2, 2.1–2.2), 3 pending (3.1–3.2, 4.1–4.2). Adapter proven: success atomically replaces, failure retains, malformed omitted, one-in-flight coalesced, poll-delay cooldown, never throw, reconcile awaits via existing poll seam.

## Next
Unit 3 — Live Project (dependent PR, same chain). `sdd-verify` not yet (Units3-4 pending).

## Skill Resolution
- Loaded: sdd-apply, opencode-plugin, work-unit-commits, chained-pr (stacked-to-main), code-simplification, debugging-and-error-recovery, source-driven-development, api-and-interface-design
- skill_resolution=paths-injected
