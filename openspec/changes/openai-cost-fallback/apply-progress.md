# Apply Progress: OpenAI Cost Fallback — Units 1A+1B+2 cumulative

**Change**: `openai-cost-fallback` **Slice**: Unit 2 Adapter+Reconcile (2.1–2.2) **Branch**: `fix/issue-27-openai-cost-fallback-2`
**Chain**: stacked-to-main, auto-chain **Date**: 2026-08-24
**Parent attempt**: `sha256:337bb4fc54c1fe526e9ee0687d9eed3408276e196b4c746188ae978aa10e3a3e` (parent settles)
**Base**: `b67612162153cd0e09ee312b4371c108058c2b98` (Unit1B merged @ b676121)
**Correction lineage**: `92b4e9ef834ea9949608bc15b85483db8910b0731322562bb9d8142e4208d31f` → `e9564ff2` → `remed-0.03`

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

## CI Remediation — Unit 2 deterministic coverage failure (2026-08-24)
- **CI**: run 32758190541 job 97530496958 `Unit tests with coverage` 260 pass/1 fail `test/cost-fallback.test.ts:414` expected 0.0125 received 0.03
- **Repro**: `bun test test/harness.test.ts test/cost-fallback.test.ts` → 75 pass/1 fail (same 0.03); `bun test test/cost-fallback.test.ts` alone → 7 pass; `bun run coverage` (9 files) passed locally due to alphabetical order masking
- **Root cause**: test isolation — global `snapshot` leaked across files; `reconcile awaits pricing` polled `snapshot()?.cost` (any) not its `rootID`; harness left `snapshot.cost=0.03`, wait resolved on stale snapshot before new `loadPricing` published `0.0125` (1000*5+500*15/1e6). Prod `loadPricing`→`reconcile` correct; pricing globals already isolated via `clearPricing`.
- **Correction**: test-only minimal fix — import `setSnapshot`/`disposeReconcile`/`purgeTreeCache`, clear `snapshot`/`tree`/`reconcile` in `beforeEach`/`afterEach` and before `activateRoot`, wait for `snapshot()?.rootID===rootID`. No assertion weakened, no sleeps, no prod change, no Unit3/4.
- **Evidence**: after fix harness+cost → 76 pass; `bun test ./test/cost-fallback.test.ts` → 7 pass; `bun run coverage` → 261 pass; `bun test` → 276 pass; typecheck/build pass

## Files Changed (Unit 2 slice only)
- `src/tokenmeter/pricing.ts` modified — `loadPricing` SDK adapter (`client.model.list` / `ModelV2Info.cost`), one in-flight promise, success atomically replaces via `pricingKey`+`selectFiniteNonTier`, failure/offline/throw retains last-known-good, malformed omitted, cooldown ≥2000 (PROJECT_POLL_DELAY), never throw, `clearPricing` resets cooldown/inflight, `PricingApi` permissive optional shape
- `src/tokenmeter/reconcile.ts` modified — imports `loadPricing`, extends `ReconcileApi` with optional `model.list` + `path.directory`, `reconcile()` awaits `loadPricing(api)` before `discoverTree` (coalesced, fail-contained), preserves Unit1B identity via `usageOf`
- `test/cost-fallback.test.ts` modified — Unit 2 suite + isolation fix (`setSnapshot` + `rootID` guard, clear `snapshot`/`tree`/`reconcile` before/after; keeps 0.0125 assertion) — `success replaces/malformed omitted/failure retains`, `one-in-flight coalesced + poll-delay`, `reconcile awaits pricing` via `activateRoot`
- `openspec/changes/openai-cost-fallback/tasks.md` modified — mark 2.1/2.2 done
- `openspec/changes/openai-cost-fallback/apply-progress.md` modified — this file (cumulative) + TDD/work-unit evidence

## Diff Accounting (post-format, Unit 2 slice only)
- `pricing.ts` 60+0 + `reconcile.ts` 6+0 + `test` 223+0 + `tasks.md` 3+3 + `apply-progress.md` 52+45 = **344+48=392 ≤400** (exact `git diff origin/main --numstat` 52+45, 3+3, 60, 6, 223; prod 66 + test 223 + docs 103 =392)
- Pure adapter+orchestrator + test isolation; no Project/tombstones/deleted/UI (Unit3/4 untouched); prior 1A 395 + 1B 305 on main (stacked)
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
| 2.2-remed | `test/cost-fallback.test.ts` | Unit | ✅ 260/1 fail → | ✅ repro 75/1 harness+cost isolates | ✅ 76 pass harness+cost, 261 cov, 276 full | ✅ stale 0.03 → `rootID` guard | ✅ `setSnapshot(null)` + `rootID` |

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
| Runtime harness command/scenario and exact result | Full `bun test` → 276 pass, 8277 expects [~18s]; `bun run coverage` → 261 pass, 8208 expects [~19s]; harness+cost 76 pass (was 75/1 before fix); SDK `Model.list` verified via types.gen.d.ts:4012/4024 + sdk.gen.d.ts:1786 |
| Rollback boundary | `test/cost-fallback.test.ts` isolation only — revert `setSnapshot`/`rootID` guard restores old `snapshot()?.cost` poll; prod `pricing.ts`/`reconcile.ts` untouched; tokens/identity untouched |

- Normalization: `biome format --write` on pricing/reconcile/test (no diff after), `biome check` 0 errors on slice
- Strict TDD RED→GREEN verified: 2.1 fail `loadPricing not found` + `snapshot null`, 2.2 green after adapter+reconcile (coalesced calls=1, poll-delay retains, atomic replace)
- SDK verify: `ModelV2Info.cost` is `Array<ModelCost>` where `ModelCost { input, output, cache:{read,write}, tier? }` (types.gen.d.ts:4012), `ModelV2Info { providerID, id, cost }` (4024), `V2ModelListResponses {data: ModelV2Info[]}` (10302), `Model.list({location:{directory,workspace}})` (sdk.gen.d.ts:1786) — pricingKey `providerID:id` trim+lower + selectFiniteNonTier first non-tier finite quartet only

## Deviations
None for 2. Reuses Unit1A canonical types/pure resolver (`pricingKey`/`selectFiniteNonTier` exact, no alias) and Unit1B identity (`rememberCosts` Σ) as-is. No `sumProjectSessions`/`readDeletedSessionIDs`/`resolveEntry`/`tokenmeter.tsx`/`docs` (Units3-4). No new deps, no direct HTTP/fetch, no static prices, no backwards-compat layer, no `config.providers`.

## Issues Found
- One-in-flight `p1===p2` false (async wrap) → assert `calls` count + map state, not ref equality.
- Reconcile guard `currentRoot !== rootID` caused `snapshot null` without `activateRoot`; fixed via `activateRoot` + wait loop.
- **CI isolation (remediation)**: global `snapshot` leaked `cost=0.03` from harness; loose `snapshot()?.cost` poll resolved stale before new pricing. Fixed test-only via `setSnapshot(null)` + `rootID` guard; no prod change, harness+cost now 76 pass, coverage 261 pass.

## Workload / PR Boundary
- Mode: stacked PR slice `sha256:337bb4fc…` — Unit 2 Adapter+Reconcile + remediation, autonomous
- Boundary: after Unit1B (#48 b676121), before Project/tombstones/deleted; only SDK adapter + reconcile + test isolation (no Project/live sum)
- Budget: 344+48=392 ≤400 (hard cap), planning docs excluded — prod 66 + test 223 + docs 103 =392
- Next: Unit 3 Project+tombstones (dependent), Unit 4 Deleted+docs

## Status
8/11 tasks complete (1A.1–1A.4, 1B.1–1B.2, 2.1–2.2), 3 pending (3.1–3.2, 4.1–4.2). Adapter proven + remediation verified: harness+cost 76 pass, coverage 261 pass, full 276 pass; success atomically replaces, failure retains, coalesced, cooldown, reconcile awaits pricing.

## Next
Unit 3 — Live Project (dependent PR, same chain). `sdd-verify` not yet (Units3-4 pending).

## Skill Resolution
- Loaded: sdd-apply, opencode-plugin, work-unit-commits, chained-pr (stacked-to-main), code-simplification, debugging-and-error-recovery, source-driven-development, api-and-interface-design
- skill_resolution=paths-injected
