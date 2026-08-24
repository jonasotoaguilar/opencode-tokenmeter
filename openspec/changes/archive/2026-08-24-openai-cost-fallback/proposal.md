# Proposal: OpenAI Cost Fallback

## Intent

OpenAI subscription traffic reports `cost: 0` despite billable tokens, so Session, groups, and Project understate spend (issue #27, approved). Estimate those rows from host-cached public pricing; keep any non-zero OpenCode cost authoritative (PRD R6/R8). No outbound network.

## Scope

### In Scope
- Estimate only when provider is exactly OpenAI, reported cost is exactly 0, billable usage is non-zero, and exact-model public pricing resolves
- Apply through Session, delegated groups, live Project (`GlobalSession.model`), and deleted Project via observed usage
- Later non-zero reported cost replaces a prior estimate, even if lower
- Pricing from SDK v2 `client.model.list()` / `ModelV2Info.cost`
- Strict TDD via `bun test`; one PR under 400 authored lines (~362); `type:fix`

### Out of Scope
- UI badge; static table; outbound/`config.providers` fetch
- Non-OpenAI, variant keys, tier-only pricing, alias/date-suffix guessing
- Message-ID upsert or token-channel changes; alerts; persisted estimate flag

## Capabilities

> Contract for sdd-spec. Existing specs are display/settings.

### New Capabilities
- `openai-cost-fallback`: OpenAI-only zero-cost estimate, SDK pricing, reported-over-estimated authority, Session/group/Project propagation

### Modified Capabilities
- None

## Approach

`pricing.ts` loads `api.client.model.list({location:{directory}})`, caches first non-tier `ModelCost` at `${providerID}:${modelID}` after trim+lowercase. Exact key only. Variant ignored. No TTL. Load failure keeps zero and never throws.

Formula: `(input*price.input + cacheRead*price.cache.read + cacheWrite*price.cache.write + (output+reasoning)*price.output) / 1_000_000`

`math.ts`: `cost !== 0` wins; else estimate if all four gates pass; else 0. Used by `usageOf`, `sumProjectSessions`, `entryOfSession`. Session keeps token high-water; cost uses dual authority. Project live path re-sums fresh `session.list` rows with the same per-row rule. Await `loadPricing` before usage and Project sum.

## Affected Areas

- New: `pricing.ts`; `docs/adr/`; `test/*.ts` RED-GREEN seams
- Modified: `math.ts`, `types.ts`, `store.ts`, `reconcile.ts`, `project.ts`, `tokenmeter.tsx`, `db.ts`
- Unchanged: `panel/*` `fmtCost`; no badge

## Risks

- High: cold/offline `model.list` stays zero — retry next refresh; never throw
- High: `maxComponents` blocks lower reported — dual authority + test
- Medium: exact-model miss or missing `model` — preserve zero
- Low: over 400 authored lines — forecast ~362; one PR; keep Project

## Rollback Plan

Revert the PR. Cost returns to OpenCode-reported values only. No schema migration; SQLite stores numeric cost only.

## Dependencies

- Issue #27 `status:approved`
- `@opencode-ai/plugin` ^1.18.14 / SDK v2 `ModelV2Info.cost`, `GlobalSession.model`

## Success Criteria

- [ ] Fallback only on exact-OpenAI + `cost===0` + billable usage + exact-model public pricing
- [ ] Non-zero reported cost wins; later reported replaces a prior estimate even if lower
- [ ] Pricing only from `client.model.list()` using the pinned `/ 1_000_000` formula
- [ ] Unresolved cases preserve zero without throwing
- [ ] Session, groups, live + deleted Project include the estimate; upserts/tokens unchanged; no badge; `bun test` green; one PR under 400 lines
