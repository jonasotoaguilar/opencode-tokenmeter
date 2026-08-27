# ADR-0007: OpenAI cost fallback via SDK pricing

## Status

**Superseded by [ADR-0008](0008-openai-cost-fallback-with-models-dev.md).**

Host-only pricing via `client.model.list()` left `openai/gpt-5.6-sol` at zero because the v2 catalog exposes zero prices for all 13 openai models (verified 2026-08-26). The durable fix preserves this ADR's authority/identity/project rules and adds the bounded `models.dev` fallback chain documented in ADR-0008; this ADR is retained for rationale.


## Date

2026-08-24

## Deciders

jonasotoaguilar

## Context

OpenAI subscription rows report `cost: 0` despite billable tokens, so Session, groups and Project understate spend. Pricing is host-cached in `model.list`, not `config.providers`. Reported cost must stay authoritative; estimates must not freeze or double-count.

## Decision

Gate then reuse existing aggregation:
- **Authority:** `cost!==0` wins unchanged; later reported replaces estimate even if lower; `0` never overwrites non-zero; per-message ID `MoneyRow` identity Σ.
- **Pricing:** `client.model.list({location:{directory}})` only; `ModelV2Info.cost` first non-tier finite quartet via exact `pricingKey(trim+lower)`; formula `(input*input + cacheRead*read + cacheWrite*write + (output+reasoning)*output)/1_000_000`; success atomically replaces map, failure/offline keeps last-known-good with cooldown, one in-flight coalesced, never throws.
- **Identity:** `sessionCostIdentity: Map<sessionID, Map<messageID,MoneyRow>>` via `upsertCostIdentity`; `rememberCosts` Σ; `observedSessionUsage` sums identity while tokens keep per-field high-water; repeat refill no-ops; `remove/forget` clean; `reconcile` awaits `loadPricing`.
- **Project:** Live `session.list` re-sums via `resolveCost` per row; tombstones `(session_id,project_id)` via `readDeletedSessionIDs` exclude before tokens/cost; deleted `resolveEntry(payload,observed,model)` tokens `max`, cost `raw!==0?raw:obs!==0?obs:resolveCost(model,mergedTokens)`.
- **Safe-zero:** Non-OpenAI, zero usage, missing provider/model, unknown model, tier-only/malformed/non-finite, or list failure/offline preserve `0` without throwing; exact key only.

## Consequences

- Reported never regresses; no stale table; repeats/duplicates never double-count; unresolved fail-closed to `0`.
- Cold/offline shows `0` until refresh; payload-only deletes need `model` to estimate.
- SQLite stores numeric cost only; restart re-estimates deterministically; reused helpers across Session/live/deleted.

## References

- `pricing.ts` `pricingKey`/`selectFiniteNonTier`/`estimateCost`/`loadPricing`; `math.ts` `resolveCost`/`resolveEntry`/`sumProjectSessions`; `store.ts` identity; `db.ts` tombstones; `project.ts`/`reconcile.ts` await `loadPricing`
