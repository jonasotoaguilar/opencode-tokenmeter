# Delta for openai-cost-fallback

## MODIFIED Requirements

### Requirement: Pricing Source And Formula

Unit prices MUST come only from installed-SDK `api.client.v2.model.list` public `ModelV2Info.cost`. The system MUST NOT call `api.client.model.list`. Tests and mocks MUST type against installed `OpencodeClient.v2.model.list` and `ModelV2Info`. A missing list method MUST fail the pricing load visibly and MUST NOT treat method-missing as a successful empty map. Fresh list data MUST outrank prior in-memory pricing. The first non-empty pricing fill after empty MUST schedule bounded affected-session repair. Static tables, plugin network, and `config.providers` MUST NOT be used. Estimate MUST be `(input * price.input + cacheRead * price.cache.read + cacheWrite * price.cache.write + (output + reasoning) * price.output) / 1_000_000`.
(Previously: sourced `client.model.list()` without installed-type mocks, visible method-missing failure, or first-fill repair)

#### Scenario: Public list formula

- GIVEN finite non-tier `ModelCost` for the exact OpenAI model
- WHEN those tokens are estimated
- THEN published cost MUST equal the formula

#### Scenario: Forbidden sources

- GIVEN only a static table, outbound fetch, or `config.providers`
- WHEN pricing is resolved
- THEN pricing MUST be unavailable and cost MUST be `0`

#### Scenario: Installed v2 endpoint

- GIVEN the installed SDK exposes only `api.client.v2.model.list`
- WHEN pricing is loaded
- THEN the system MUST call that endpoint
- AND MUST NOT call `api.client.model.list`

#### Scenario: Method-missing is not silent

- GIVEN `api.client.v2.model.list` is absent
- WHEN pricing is loaded
- THEN the load MUST fail without publishing a successful empty map

#### Scenario: First-fill repair

- GIVEN pricing was empty then becomes non-empty
- WHEN the first fill commits
- THEN the system MUST schedule repair of affected sessions

### Requirement: Idempotency And Propagation

Repeated same-message events MUST NOT change totals. Reconciliation MUST overwrite that message identity, not add. The same per-row rule MUST apply to Session, delegated groups, Project, and deleted Project via cached `session_totals`, at most once per aggregate. Live Project MUST derive from the SQL SUM of `session_totals` for that project, including retained deleted rows. Live Project MUST NOT use `session.list` as totals authority.
(Previously: live Project re-summed `session.list`; a deleted session left the live sum)

#### Scenario: Repeat replace and propagate

- GIVEN an applied estimate that later reports non-zero cost, then the session is deleted
- WHEN the event repeats, reconcile runs, then aggregates refresh
- THEN totals MUST stay unchanged on repeat, the estimate MUST be replaced once, live surfaces MUST have included it once, and after delete it MUST appear only via the retained deleted row in Project SUM

#### Scenario: Project ignores session.list totals

- GIVEN a live `session.list` payload that differs from cached `session_totals`
- WHEN Project publishes
- THEN published Project totals MUST equal the SQL SUM
- AND MUST NOT equal the `session.list` aggregate

### Requirement: Tokens Provenance Restart And Containment

Tokens and token high-water MUST stay unchanged except monetary cost authority. Provenance MUST stay internal: no persisted estimate flag and no required UI badge. After restart, Session and Project MUST publish immediately from cached `session_totals`. Restart MUST NOT treat live `session.list` or `model.list` as Project or restart totals authority. Stale or missing active-session rows MUST repair from native `session.messages` plus current pricing. Deleted rows MUST keep stored numeric totals. Failures MUST preserve last-good published totals without throwing.
(Previously: restart re-resolved live costs from client messages or `session.list` plus `model.list`; failures preserved `0`)

#### Scenario: Tokens restart and recover

- GIVEN cached estimated Session and Project rows, then restart
- WHEN Session and Project first publish
- THEN tokens and token high-water MUST follow existing rules
- AND published costs MUST equal the cached rows before any host list

#### Scenario: Restart does not poll session.list for totals

- GIVEN a restart with cached rows
- WHEN first paint completes
- THEN the system MUST NOT call `session.list` with limit 10000 to compute totals
