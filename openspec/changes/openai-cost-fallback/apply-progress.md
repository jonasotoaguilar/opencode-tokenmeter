# Apply Progress: OpenAI Cost Fallback — Units 1A+1B+2+3 cumulative

**Change**: `openai-cost-fallback` **Slice**: Unit 3 Live Project + Tombstones (3.1–3.2) **Branch**: `fix/issue-27-openai-cost-fallback-3`
**Chain**: stacked-to-main, auto-chain **Date**: 2026-08-24
**Parent attempt**: `sha256:ac51b4dcb3f74f69d01ba0d59b824fdb2dbab1cc749a19c06827a1a77ffa8165` (parent settles)
**Base**: `efd52be5474e886a384db58fcbd2814fdc045135` (Unit2 merged origin/main)
**Correction lineage**: `92b4e9ef834ea9949608bc15b85483db8910b0731322562bb9d8142e4208d31f` → `e9564ff2` → `remed-0.03`

## Completed
- [x] 1A.1 RED `test/cost-fallback.test.ts` — gates, reported wins, /1M reasoning/cache, trim+lower exact, suffix miss, safe-zero, source
- [x] 1A.2 GREEN `types.ts` — FinitePrice, MonetarySource, ResolvedCost, MoneyRow, MessageUsage.source, UsageMessage.providerID/modelID
- [x] 1A.3 GREEN `pricing.ts` — pricingKey, selectFiniteNonTier, estimateCost, getPricing/setPricing/clearPricing (pure, no model.list)
- [x] 1A.4 GREEN `math.ts` — resolveCost, usageOf source (reported wins, /1M, exact key, never throw)
- [x] 1B.1 RED composite per-message authority: M1.10+M2.05+M3.04 refill M2.02 M3 absent→.16 repeat→.16 mixed sums idempotency
- [x] 1B.2 GREEN `store.ts` — rememberCosts, sessionCostIdentity, observedSessionUsage Σ identity, remove/forget clean identity
- [x] 2.1 RED pricing list: success atomically replaces cached exact map; failure/offline/throw retains last-known-good; malformed tier/NaN/missing omitted; one-in-flight coalesced + poll-delay cooldown retains map
- [x] 2.2 GREEN `pricing.ts` `loadPricing` around `client.model.list({location:{directory}})` one in-flight + cooldown ≥2000, atomic replace via new Map, never throw; `reconcile.ts` awaits `loadPricing` before discoverTree (coalesced, fail-closed)
- [x] 3.1 RED tombstone scope `(sessionX,projectA)` exclude before sum; B remains eligible; reported+estimated via session authority
- [x] 3.2 GREEN `db.ts` `readDeletedSessionIDs` scoped `(session_id,project_id)` + `math.ts` `sumProjectSessions` exclude+resolveCost + `project.ts` `refreshProject` awaits `loadPricing` then `readDeletedSessionIDs` before sum

## Pending (not in 1A/1B/2/3)
- [ ] 4.1 RED `resolveEntry` money
- [ ] 4.2 GREEN `resolveEntry`+`tokenmeter.tsx`+ADR docs

## CI Remediation — Unit 2 deterministic coverage failure (2026-08-24)
- **CI**: run 32758190541 job 97530496958 `Unit tests with coverage` 260 pass/1 fail `test/cost-fallback.test.ts:414` expected 0.0125 received 0.03
- **Repro**: `bun test test/harness.test.ts test/cost-fallback.test.ts` → 75 pass/1 fail (same 0.03); `bun test test/cost-fallback.test.ts` alone → 7 pass; `bun run coverage` (9 files) passed due to alphabetical order masking
- **Root cause**: global `snapshot` leaked across files; `reconcile awaits pricing` polled `snapshot()?.cost` not `rootID`; harness left `snapshot.cost=0.03`, wait resolved stale before new `loadPricing` published `0.0125`.
- **Correction**: test-only — clear `snapshot`/`tree`/`reconcile` before/after and before `activateRoot`, wait for `snapshot()?.rootID===rootID`. No prod change.
- **Evidence**: harness+cost 76 pass; `bun test ./test/cost-fallback.test.ts` 7 pass; `bun run coverage` 261 pass; `bun test` 276 pass; typecheck/build pass

## Files Changed (Unit 3 slice only)
- `src/tokenmeter/db.ts` modified — `readDeletedSessionIDs(dbPath,projectID)` `SELECT session_id FROM tombstones WHERE project_id=?` PK `(session_id,project_id)` scoped; fail/null→empty Set; uses `withDb`; no schema migration
- `src/tokenmeter/types.ts` modified — `ProjectSessionLike.model?:{id,providerID,variant?}` mirrors SDK `GlobalSession.model` (`types.gen.d.ts:1790` `ModelRef:2387`); narrow local type, no SDK import
- `src/tokenmeter/math.ts` modified — `sumProjectSessions(projectID,sessions,exclude?)` now `exclude?.has(id)` BEFORE tokens/cost, dedup via `seen`, then `resolveCost({cost, providerID:model.providerID, modelID:model.id, tokens})` per row; reported wins, else OpenAI estimated via `getPricing`; preserves existing deduplication and `context` formula
- `src/tokenmeter/project.ts` modified — `ProjectApi.client.model.list?` optional; `refreshProject` now `await loadPricing(api)` (fail-contained) then `readDeletedSessionIDs(dbPath,projectID)` then `sumProjectSessions(...,exclude)` before `combineProjectUsage`; preserves fail-closed cap, hint, error, polling
- `test/cost-fallback.test.ts` modified — Unit 3 suite `tombstone scope (sessionX,projectA) exclude before sum; B remains eligible; reported+estimated` via temp DB `projectDbPath` + `recordDeletedSession` + `readDeletedSessionIDs` + `sumProjectSessions` pure + `refreshProject` live+deleted once; covers scoped exclusion, global-not, estimated cost, reported wins, non-OpenAI zero
- `openspec/changes/openai-cost-fallback/tasks.md` modified — mark 3.1/3.2 done; Unit4 pending
- `openspec/changes/openai-cost-fallback/apply-progress.md` modified — this file (cumulative) + TDD/work-unit evidence

## Diff Accounting (post-format, Unit 3 slice only)
- `db.ts` 21+0 + `math.ts` 20+1 + `project.ts` 16+6 + `types.ts` 3+1 + `test` 152+1 + `tasks.md` 3+3 + `apply-progress.md` 48+41 = **263+53=316 ≤400** (exact `git diff origin/main --numstat` 48+41, 3+3, 21+0, 20+1, 16+6, 3+1, 152+1; prod 60+test 152+docs 95=316 inc. correction; prior 1A 395+1B 305 on main stacked)
- Pure read seam + pure sum + orchestrator await + scoped SQL; no deleted `resolveEntry`/`tokenmeter.tsx`/`docs`/migration (Unit4 untouched)
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
| 3.1 | `test/cost-fallback.test.ts` | Unit | ✅ 276/276 | ✅ `readDeletedSessionIDs` not found | ✅ 8 pass cost-fallback (was 7) | ✅ scoped A vs B + before-sum tokens/cost + reported+estimated + non-OpenAI zero + refresh live+deleted once | ✅ temp DB helper, pricing P_EST, liveA/liveB fixtures |
| 3.2 | `src/tokenmeter/db.ts` + `math.ts` + `project.ts` | Unit | ✅ 276/276 | ✅ `sumProjectSessions` included tombstoned cost 0.0125 (not excluded) + B still eligible fail | ✅ 277 pass full, 262 cov | ✅ exclude before sum (sessions/input/context) + scoped SQL + `loadPricing` await + reported wins | ✅ `exclude?` optional param, `model?` narrow type, `readDeletedSessionIDs` fail-contained, `loadPricing` fail-contained |

### Test Summary
- **Total tests written**: 8 (4×1A/1B +3×Unit2 +1×Unit3) — 71 expects in cost-fallback (40×1A/1B +16×Unit2 +15×Unit3)
- **Total tests passing**: 277 across 10 files (276 pre +1 Unit3) — 8292 expects; coverage 262 pass 8223 expects
- **Layers used**: Unit (8), Integration (0 wrapped via `refreshProject` harness with temp SQLite), E2E (0)
- **Approval tests**: None — new seam, no refactoring
- **Pure functions created**: rememberCosts, syncIdentityFromMap, upsertCostIdentity, loadPricing, readDeletedSessionIDs, sumProjectSessions (enhanced pure with exclude+resolveCost)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `bun test ./test/cost-fallback.test.ts` → 8 pass, 0 fail, 71 expects [~260ms] |
| Runtime harness command/scenario and exact result | Full `bun test` → 277 pass, 8292 expects [~19s]; `bun run coverage` → 262 pass, 8223 expects [~19s]; harness+cost 76 pass retained; `refreshProject` with temp SQLite `recordDeletedSession` + `readDeletedSessionIDs` + `loadPricing` verified |
| Rollback boundary | `src/tokenmeter/db.ts` `readDeletedSessionIDs`, `src/tokenmeter/types.ts` `model?`, `src/tokenmeter/math.ts` `sumProjectSessions` exclude+resolveCost, `src/tokenmeter/project.ts` `loadPricing`+`exclude`+`sum` — revert restores raw cost sum and no tombstone filtering; `test/cost-fallback.test.ts` Unit3 suite only; tokens/identity/reconcile untouched; no `resolveEntry`/`tokenmeter.tsx`/`docs` |

- Normalization: `biome format --write` on db/math/project/types/test (no diff after), `biome check` 0 errors on slice
- Strict TDD RED→GREEN verified: 3.1 fail `readDeletedSessionIDs not found`, 3.2 green after `readDeletedSessionIDs` + `sumProjectSessions` exclude+pricing + `refreshProject` await+exclude (B still eligible, A excluded before sum, live+deleted once, reported+estimated)
- SDK verify: `GlobalSession.model?:{id,providerID,variant?}` (`types.gen.d.ts:1790` `ModelRef:2387`), `ModelCost` (`:4012`), `ModelV2Info` (`:4024`), `V2ModelListResponses` (`:10302`), `Model.list` (`sdk.gen.d.ts:1786`) — pricingKey `${providerID}:${modelID}` trim+lower + selectFiniteNonTier first non-tier only; `sumProjectSessions` resolves via `resolveCost` per row

## Deviations
None for 3. Reuses Unit1A canonical pure resolver (`pricingKey`/`selectFiniteNonTier` exact, no alias) and Unit1B identity (`rememberCosts` Σ) and Unit2 adapter (`loadPricing` one in-flight, cooldown, fail-contained, never throw) as-is. No `resolveEntry`/`tokenmeter.tsx`/`docs/adr` (Unit4). No new deps, no direct HTTP/fetch, no static prices, no speculative migration/compatibility layer, no global session-ID exclusion.

## Issues Found
- One-in-flight `p1===p2` false (async wrap) → assert `calls` count + map state, not ref equality (Unit2).
- Reconcile guard `currentRoot !== rootID` caused `snapshot null` without `activateRoot`; fixed via `activateRoot` + wait loop (Unit2).
- CI isolation (remediation): global `snapshot` leaked `cost=0.03` from harness; loose `snapshot()?.cost` poll resolved stale before new pricing. Fixed test-only via `setSnapshot(null)` + `rootID` guard (Unit2).
- No new issues for Unit3; `readDeletedSessionIDs` must be scoped `(session_id,project_id)` not global — verified via `tombstones` PK and `WHERE project_id=?`; `sumProjectSessions` must exclude BEFORE sum (tokens/cost) not after.

## Workload / PR Boundary
- Mode: stacked PR slice `sha256:ac51b4dc…` — Unit 3 Live Project + Tombstones, autonomous
- Boundary: after Unit2 (#50 efd52be), before Deleted+docs (Unit4); only `readDeletedSessionIDs` + `sumProjectSessions` + `refreshProject` + `ProjectSessionLike.model` (no deleted `resolveEntry`/`tokenmeter.tsx`/docs)
- Budget: 263+53=316 ≤400 (hard cap), planning docs excluded — prod 60+test 152+docs 95=316 inc. correction (+2+1); prior 1A 395+1B 305 on main stacked
- Next: Unit 4 Deleted+docs (dependent final PR, same chain). `sdd-verify` not yet (Unit4 pending).

## Status
10/12 tasks complete (1A.1–1A.4, 1B.1–1B.2, 2.1–2.2, 3.1–3.2), 2 pending (4.1, 4.2). Live Project proven: scoped tombstone exclude before sum (A excluded, B eligible, tokens/cost), reported+estimated via `resolveCost` per row, `refreshProject` awaits `loadPricing` then `readDeletedSessionIDs` then `sumProjectSessions` before `combineProjectUsage` (live+deleted once, fail-contained).

## Next
Unit 4 — Deleted `resolveEntry` + UI + ADR/docs (dependent final PR, same chain). After Unit4, `sdd-verify` then `sdd-archive`.

## Skill Resolution
- Loaded: sdd-apply, opencode-plugin, work-unit-commits, chained-pr (stacked-to-main), code-simplification, debugging-and-error-recovery, source-driven-development, api-and-interface-design
- skill_resolution=paths-injected
