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

Unit prices MUST come only from SDK v2 `client.model.list()` public `ModelV2Info.cost`. Static tables, plugin network, and `config.providers` MUST NOT be used. Fresh list data MUST outrank prior in-memory pricing. Estimate MUST be `(input * price.input + cacheRead * price.cache.read + cacheWrite * price.cache.write + (output + reasoning) * price.output) / 1_000_000`.

#### Scenario: Public list formula

- GIVEN finite non-tier `ModelCost` for the exact OpenAI model
- WHEN those tokens are estimated
- THEN published cost MUST equal the formula

#### Scenario: Forbidden sources

- GIVEN only a static table, outbound fetch, or `config.providers`
- WHEN pricing is resolved
- THEN pricing MUST be unavailable and cost MUST be `0`

### Requirement: Safe-Zero And Normalization

Published cost MUST be `0` without throwing for non-OpenAI, zero usage, missing provider or model, unknown exact model, all-tier `ModelCost`, missing/malformed/non-finite prices, or list failure/offline. Normalization MUST be trim and case-fold on exact `${providerID}:${modelID}` only; aliases, date stripping, path splits, and variant guessing MUST NOT occur.

#### Scenario: Unresolved cases stay zero

- GIVEN any safe-zero condition above
- WHEN the row is resolved
- THEN published cost MUST be `0` without throwing

#### Scenario: Trim match without alias

- GIVEN list `GPT-4o` and row ` gpt-4o `
- WHEN pricing is looked up
- THEN the exact normalized key MUST match
- AND `gpt-4o-2024-08-06` versus list `gpt-4o` MUST leave pricing unavailable

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
