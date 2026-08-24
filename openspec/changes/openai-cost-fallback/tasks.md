# Tasks: OpenAI Cost Fallback

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 560–650 (~603) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1A→1B→2→3→4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — stacked-to-main chosen. Slice 1A first.

### Suggested Work Units

| Unit | Goal | PR | Test | Rollback |
|------|------|----|------|----------|
| 1A | Pure resolver (~165) | PR 1A now | `bun test test/cost-fallback.test.ts` | `types.ts` `pricing.ts` `math.ts` `test/cost-fallback.test.ts` |
| 1B | Store identity (~130) | PR 1B | same | `store.ts` `test/cost-fallback.test.ts` |
| 2 | Adapter+reconcile (~106) | PR 2 | same | `pricing.ts` `reconcile.ts` |
| 3 | Project+tombstones (~88) | PR 3 | same | `db.ts` `project.ts` |
| 4 | Deleted+docs (~136) | PR 4 | `bun test` | `math.ts` `tokenmeter.tsx` `docs/adr/0007` |

## Phase 1A: Pure Resolver (PR 1A — apply now)

- [x] 1A.1 RED `test/cost-fallback.test.ts` gates/reported/formula/normalization/safe-zero/source — pure resolver only
- [x] 1A.2 GREEN `src/tokenmeter/types.ts` `FinitePrice` `MonetarySource` `ResolvedCost` `MoneyRow` `MessageUsage.source` `UsageMessage.providerID/modelID`
- [x] 1A.3 GREEN `src/tokenmeter/pricing.ts` `pricingKey` `selectFiniteNonTier` `estimateCost` `getPricing`/`setPricing`/`clearPricing` — pure, no `model.list`
- [x] 1A.4 GREEN `src/tokenmeter/math.ts` `resolveCost` `usageOf` source — reported wins, `/1_000_000`, trim+lower exact, never throw

## Phase 1B: Store Identity (PR 1B — next, pending)

- [ ] 1B.1 RED composite: M1.10+M2.05+M3.04 refill M2.02 M3 absent→.16 repeat→.16 converted replaces self missing archives once
- [ ] 1B.2 GREEN `src/tokenmeter/store.ts` `rememberCosts` `sessionCostIdentity` `observedSessionUsage` Σ identity `forgetSession`

## Phase 2: Adapter + Reconcile (pending)

- [ ] 2.1 RED list throw/offline keeps map, success replaces
- [ ] 2.2 GREEN `loadPricing` `model.list` one in-flight `PROJECT_POLL_DELAY` `reconcile.ts` awaits

## Phase 3: Live Project (pending)

- [ ] 3.1 RED tombstone scope `(sessionX,projectA)` exclude before sum
- [ ] 3.2 GREEN `readDeletedSessionIDs` `sumProjectSessions` exclude `refreshProject`

## Phase 4: Deleted + Docs (pending)

- [ ] 4.1 RED `resolveEntry` money
- [ ] 4.2 GREEN `resolveEntry`+`tokenmeter.tsx`+ADR docs
