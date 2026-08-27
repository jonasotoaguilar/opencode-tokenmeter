# ADR-0008: OpenAI cost fallback via SDK pricing with models.dev remote fallback

## Status

Accepted

## Date

2026-08-26

## Deciders

jonasotoaguilar

## Context

ADR-0007 gated OpenAI cost fallback through `client.v2.model.list()` only (`ModelV2Info.cost` first non-tier finite quartet via exact `pricingKey(trim+lower)`). The PR #66 bundle correctly calls `api.client.v2.model.list`, but a production billable message (`providerID=openai`, `modelID=gpt-5.6-sol`, reported cost 0) still estimates zero: OpenCode's v2 catalog exposes zero prices for all 13 `openai` models, so mocked tests pass while production stays zero. TUI render, aggregate identity, and formatting are not the cause. CodexBar resolves the same model via `https://models.dev/api.json` (cached, merged fallback, explicit aliases); on 2026-08-26 that catalog's exact `openai/gpt-5.6-sol` pricing matches the official OpenAI pricing page `https://developers.openai.com/api/docs/pricing` (Standard per 1M tokens input 4, cached input 0.4, cache write 5, output 20; long context 8/0.8/10/30). The plugin must not hard-code those values and must not add a dependency, but must provide an automatic fallback when host pricing is unusable.

## Decision

Preserve ADR-0007's authority/identity/project/safe-zero core and add the smallest durable automatic pricing-source chain:

- **Authority:** `cost!==0` wins unchanged; later reported replaces estimate even if lower; `0` never overwrites non-zero; per-message ID `MoneyRow` identity Σ (see `store.ts`).
- **Source precedence:** 1) reported non-zero, 2) existing positive, usable exact OpenAI pricing from `api.client.v2.model.list()` (first priority), 3) remote catalog `https://models.dev/api.json` hydrated once per 24h TTL whenever `loadPricing` runs via native `fetch` with `redirect: "error"` regardless of whether some host OpenAI price is positive, parse only provider `openai` exact model pricing. No new dependency. Host exact still wins per-model via `hostPricingMap.get(key) ?? remotePricingMap.get(key)` (e.g. host `gpt-4o` at 10 vs remote 2.5, `sol` missing uses remote 4/20) — eager hydration closes missing/partial host catalogs without making `resolveCost` asynchronous.
- **Deterministic exact IDs:** `pricingKey` normalizes via trim+lower, strips a leading `openai/` prefix from model IDs, and maps exact `gpt-5.6` to `gpt-5.6-sol` (evidence-backed for current data). No generic family/date/cross-provider guessing; `gpt-4o-2024-08-06` vs `gpt-4o`, `gpt-5`, `gpt-5.6-terra`, etc. remain safe-zero.
- **Price usability:** `selectFiniteNonTier` and remote parsing treat absent `cache_write` as zero instead of discarding otherwise valid input/output/cache-read pricing; reject NaN, infinity, negatives, and records with no positive input/output signal; tier-only/empty/malformed discarded.
- **Remote caching & failure:** Preserve last-known-good atomically. Remote catalog uses bounded in-process caching modeled after CodexBar: successful catalog TTL 24h, failed retry cooldown 15m, one in-flight request coalesced, bounded network timeout (~8s), no disk write of the 4.3MB catalog and no persisted user/session data. If remote unavailable or no exact authoritative/mapped model exists, preserve safe-zero without throwing or blocking TUI startup.
- **Long-context tier:** Parse and apply only when remote payload supplies a deterministic threshold and rates (e.g. `tiers: [{ input: 8, output: 30, cache_read: 0.8, cache_write: 10, tier: { type: "context", size: 272000 } }]` for `openai/gpt-5.6-sol` from `https://models.dev/api.json` retrieved 2026-08-26); otherwise use standard rates. Never hard-code a threshold absent from data. Threshold is evaluated against `input` tokens (cache tokens remain non-overlapping per TokenMeter token semantics); tier rates apply when `input >= threshold`.
- **Cohesion:** Pricing stays in `pricing.ts` (host map + remote map, `pricingKey`/`selectFiniteNonTier`/`estimateCost`/`loadPricing`/`getPricing`) without splitting modules; reused by `math.ts` `resolveCost`/`resolveEntry`/`sumProjectSessions`, `store.ts` identity, `db.ts` tombstones, `project.ts`/`reconcile.ts` awaiting `loadPricing`.

## Consequences

- Production `openai/gpt-5.6-sol` zero-cost rows now estimate via the remote exact pricing while host zero entries are correctly treated as not usable (no false usable price).
- Host exact pricing remains first priority per-model via `hostPricingMap.get(key) ?? remotePricingMap.get(key)`; remote catalog is hydrated once per 24h TTL whenever `loadPricing` runs regardless of host state, so partial catalogs (host `gpt-4o` at 10 but `sol` missing) still resolve `sol` via remote while `gpt-4o` keeps host value.
- Alias/prefix handling is explicit and tested; other guesses stay safe-zero.
- Missing `cache_write` pricing remains usable with write rate zero; tier pricing is deterministic and not hard-coded.
- Remote failures/offline/timeouts keep last-known-good or safe-zero, never throw, never block TUI startup; watcher sync covers index freshness, no disk persistence.
- SQLite still stores numeric cost only; restart re-estimates deterministically via host then fallback.
- Verified against live stall catalog and `models.dev` fixture end-to-end through `resolveCost`.

## References

- `src/tokenmeter/types.ts` `FinitePrice.tier` (threshold + tier rates, cit. official pricing URL and catalog retrieval date)
- `src/tokenmeter/pricing.ts` `pricingKey`/`selectFiniteNonTier`/`estimateCost` (`tier` branch)/`loadPricing` (host + remote TTL 24h / cooldown 15m / in-flight / timeout / `https://models.dev/api.json`) / `getPricing` (host-first)
- `src/tokenmeter/math.ts` `resolveCost`/`resolveEntry`/`sumProjectSessions` (unchanged authority, now benefits from fallback pricing)
- `openspec/specs/openai-cost-fallback/spec.md` (Pricing Source And Formula + Safe-Zero And Normalization updated to allow the fallback chain and explicit normalization)
- Sources: `https://developers.openai.com/api/docs/pricing` (official pricing, 2026-08-26), `https://models.dev/api.json` (catalog, retrieved 2026-08-26)

## Supersedes

- ADR-0007 (host-only pricing) — retained for rationale, superseded for the fallback chain.
