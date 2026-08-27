# openai-cost-fallback Specification

## Purpose

Estimate OpenAI rows with `cost === 0` and billable tokens. Non-zero OpenCode cost stays authoritative.

## Requirements

### Requirement: Fallback Trigger Gates

Fallback estimation MUST occur iff provider is exactly OpenAI after trim and case-fold, reported cost is exactly `0`, billable usage (`input + output + reasoning + cacheRead + cacheWrite`) is positive, and exact-model public pricing exists. A non-zero reported cost MUST be published unchanged. When reported cost is exactly `0` and one or more other estimation conditions fail, published monetary cost MUST remain `0`.

#### Scenario: Gates pass

- GIVEN OpenAI, `cost === 0`, positive billable tokens, exact public pricing
- WHEN the row is resolved
- THEN published cost MUST be the formula estimate

#### Scenario: Non-zero reported cost

- GIVEN a row whose reported cost is non-zero
- WHEN the row is resolved
- THEN published cost MUST equal that reported cost
- AND fallback estimation MUST NOT run

#### Scenario: Zero cost with other gate miss

- GIVEN reported cost is exactly `0` and at least one other estimation condition is false
- WHEN the row is resolved
- THEN published monetary cost MUST remain `0`

### Requirement: Reported Cost Authority

Non-zero reported cost MUST be the sole monetary authority. A later non-zero report MUST replace an earlier estimate for that message even if lower.

#### Scenario: Reported wins and replaces

- GIVEN a higher prior estimate later reconciled with lower non-zero `cost`
- WHEN cost is resolved
- THEN published cost MUST equal the reported value and token totals MUST be unchanged

### Requirement: Pricing Source And Formula

Unit prices MUST be resolved through the durable chain: reported non-zero cost remains authoritative; existing positive, usable exact OpenAI pricing from SDK v2 `client.model.list()` public `ModelV2Info.cost` is first priority; the remote catalog `https://models.dev/api.json` MUST be hydrated via native `fetch` with `redirect: "error"` once per 24h TTL whenever `loadPricing` runs, regardless of whether some host OpenAI price is positive, parse only provider `openai` exact model pricing, and use it as fallback. The fallback MUST be bounded: in-process cache with successful TTL 24h, failed retry cooldown 15m, one in-flight request coalesced, bounded network timeout, never writing the 4.3MB catalog to disk and never persisting user/session data. Host exact values MUST still win per-model via `hostPricingMap.get(key) ?? remotePricingMap.get(key)` (e.g. host `gpt-4o` at 10 vs remote 2.5, `sol` missing on host uses remote 4/20) — this closes missing/partial host catalogs without making `resolveCost` asynchronous. Static hard-coded price tables and `config.providers` MUST NOT be used; the `models.dev` network source is the sole permitted fallback. Fresh list or catalog data MUST atomically replace prior in-memory pricing for its source; failure/offline MUST preserve last-known-good or safe-zero without throwing. Estimate MUST be `(input * price.input + cacheRead * price.cache.read + cacheWrite * price.cache.write + (output + reasoning) * price.output) / 1_000_000`, with a long-context tier applied only when the remote payload supplies a deterministic threshold and tier rates (e.g. `tiers: [{ tier: { type: "context", size: 272000 } }]` for `openai/gpt-5.6-sol` verified 2026-08-26 against `https://developers.openai.com/api/docs/pricing` and `https://models.dev/api.json`). Cache token accounting MUST remain non-overlapping with input tokens. No new dependency.

#### Scenario: Public list formula

- GIVEN finite non-tier `ModelCost` for the exact OpenAI model from `client.model.list()` or the `models.dev` fallback
- WHEN those tokens are estimated
- THEN published cost MUST equal the formula (tier rates applied when input meets the payload threshold, otherwise standard rates)

#### Scenario: Forbidden sources

- GIVEN only a static hard-coded table or `config.providers`
- WHEN pricing is resolved
- THEN pricing MUST be unavailable and cost MUST be `0`

#### Scenario: Host wins over fallback

- GIVEN host `client.model.list()` holds usable positive exact pricing for `openai:gpt-5.6-sol` and `models.dev` holds different pricing for the same model
- WHEN the row is resolved
- THEN the host price MUST be used and the fallback MUST NOT be consulted for that model

#### Scenario: Fallback when host unusable

- GIVEN host catalog has no usable positive exact pricing for `openai:gpt-5.6-sol` (missing, empty, tier-only, malformed, or all-zero) and `models.dev` holds exact `openai/gpt-5.6-sol` pricing
- WHEN the row is resolved
- THEN published cost MUST be the fallback estimate

### Requirement: Safe-Zero And Normalization

Published cost MUST be `0` without throwing for non-OpenAI, zero usage, missing provider or model, unknown exact model, all-tier `ModelCost`, missing/malformed/non-finite prices (NaN, infinity, negatives, or records with no positive input/output signal), or catalog fetch failure/offline/timeout. Absent `cache_write` MUST be treated as zero instead of discarding otherwise valid input/output/cache-read pricing. Normalization MUST be deterministic exact IDs with only explicit, evidence-backed steps: trim and case-fold on exact `${providerID}:${modelID}`, strip a leading `openai/` prefix from the model ID, and map exact `gpt-5.6` to `gpt-5.6-sol`; all other alias, date-stripping, family, and cross-provider guessing MUST NOT occur.

#### Scenario: Unresolved cases stay zero

- GIVEN any safe-zero condition above
- WHEN the row is resolved
- THEN published cost MUST be `0` without throwing

#### Scenario: Trim match without alias

- GIVEN list `GPT-4o` and row ` gpt-4o `
- WHEN pricing is looked up
- THEN the exact normalized key MUST match
- AND `gpt-4o-2024-08-06` versus list `gpt-4o` MUST leave pricing unavailable

#### Scenario: Explicit prefix and alias normalization

- GIVEN `models.dev` pricing for `openai/gpt-5.6-sol` and a row with `modelID` `openai/gpt-5.6-sol` or `gpt-5.6`
- WHEN pricing is looked up
- THEN the normalized exact key `openai:gpt-5.6-sol` MUST be used and yield the estimate
- AND `gpt-4o-2024-08-06`, `gpt-5` family, or unrelated suffixes MUST remain safe-zero

#### Scenario: Missing cache_write usable

- GIVEN pricing with finite positive input/output/cache-read but absent `cache_write`
- WHEN the row is resolved with cache write tokens
- THEN pricing MUST be usable with `cache_write` rate zero and cache tokens MUST be priced non-overlapping with input tokens

### Requirement: Idempotency And Propagation

Repeated same-message events MUST NOT change totals. Reconciliation MUST overwrite that message identity, not add. The same per-row rule MUST apply to Session, delegated groups, live Project via `GlobalSession.model`, and deleted Project via observed usage, at most once per aggregate. Live Project MUST re-sum fresh `session.list`; a deleted session MUST leave the live sum.

#### Scenario: Repeat replace and propagate

- GIVEN an applied estimate that later reports non-zero cost, then the session is deleted
- WHEN the event repeats, reconcile runs, then aggregates refresh
- THEN totals MUST stay unchanged on repeat, the estimate MUST be replaced once, live surfaces MUST have included it once, and after delete it MUST appear only in the deleted aggregate

### Requirement: Tokens Provenance Restart And Containment

Tokens and token high-water MUST stay unchanged except monetary cost authority. Provenance MUST stay internal: no persisted estimate flag and no required UI badge. After restart, live costs MUST re-resolve from current client messages or `session.list` plus current `model.list`; deleted Project MUST keep stored numeric cost only. Failures MUST preserve `0` without throwing.

#### Scenario: Tokens restart and recover

- GIVEN an estimated cost, then restart with list failure then success
- WHEN Session publishes and Project refreshes
- THEN tokens and token high-water MUST follow existing rules, live rows MUST re-estimate, and deleted numeric cost MUST be kept
