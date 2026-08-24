# Design: OpenAI Cost Fallback

## Technical Approach

Estimate OpenAI `cost === 0` from SDK v2 `model.list` / `ModelV2Info.cost` via `pricingKey` + `resolveCost` on `AssistantMessage` and `GlobalSession.model`. Non-zero OpenCode cost wins. Session money is a per-message identity map. Tokens, token upserts, schema, `fmtCost` unchanged. No `costParts`.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Pricing | list / static / providers | table drifts; providers zero subs | `model.list({ location:{directory} })` only |
| Keying | exact trim+fold / alias-strip | spec forbids guessing | exact `${providerID}:${modelID}` trim+lower |
| Session cost | max / aggregate / identity | max blocks lower reported; aggregate drops unrelated compacted estimates | per-id `MoneyRow` map, upsert-only |
| Delete money | max / raw-or-observed / estimate in extract | max freezes estimates; extract hides reported | `resolveEntry`; tokens stay max |
| Project live | session-only / per-row list | session-only fails #27 | per-row `resolveCost`; exclude tombstones **before** sum |
| Tombstones | unscoped / `(session_id, project_id)` | cross-project false exclude | `readDeletedSessionIDs(db, projectID)` |
| Cache | TTL / every call / sticky | poll+fail storms | in-flight join; success replaces; fail cooldown |
| `costParts` | splitter / omit | seam, no consumer | **removed**; `usageOf` publishes resolved `cost` |

## Data Flow

```
model.list → adapter → Map<pricingKey, FinitePrice>
message.* → usageOf(resolveCost) → msgUsage[id]
observedSessionUsage → token max + rememberCosts(id upsert) → Session/groups
session.list → readDeletedSessionIDs(project) → exclude → resolveCost/row → live
session.deleted → raw entryOfSession + observed + model → resolveEntry → SQLite
                 └──────── combineProjectUsage ────────┘
loadPricing (one in-flight) → reconcile and refreshProject await then exclude/sum/publish
first non-empty cache → one scheduleReconcile + one scheduleProjectRefresh
```

Identity refill: upsert by id; missing ids stay; published = Σ. See composite RED.

## File Changes

Create `pricing.ts`, `test/cost-fallback.test.ts`, `docs/adr/0007-openai-cost-fallback.md`. Modify `math.ts`, `types.ts`, `store.ts` (identity map; token max only), `reconcile.ts`/`project.ts` (`loadPricing`, `model.list`), `db.ts` (`readDeletedSessionIDs`), `tokenmeter.tsx`. Unchanged: `panel/*`, token channels, token upserts, schema.

## Interfaces / Contracts

```ts
type FinitePrice = { input: number; output: number; cache: { read: number; write: number } }
type MonetarySource = "reported" | "estimated"
type ResolvedCost = { cost: number; source: MonetarySource }
type MoneyRow = ResolvedCost

pricingKey(a: unknown, b: unknown): string | null // trim+lower; empty→null; no alias/path/date/variant
selectFiniteNonTier(costs: unknown): FinitePrice | null // first non-tier finite quartet else null
estimateCost(tokens, price): number // (in*in + cr*cr + cw*cw + (out+reas)*out) / 1_000_000
resolveCost({ cost, providerID, modelID, tokens }): ResolvedCost
// cost!==0 → {reported,cost}; else openai+billable+getPricing → {estimated,estimate}; else {reported,0}

// store sessionCostIdentity: Map<sessionID, Map<messageID, MoneyRow>>
rememberCosts(sessionID, current: Map<messageID, MessageUsage>): number
// upsert each id only; missing ids stay; published=Σ; repeat refill no-op

readDeletedSessionIDs(dbPath: string | null, projectID: string): ReadonlySet<string>
// SELECT session_id FROM tombstones WHERE project_id = ?
// PK (session_id, project_id). Other projects omitted. Fail/null → empty Set.

resolveEntry(payload, observed, model?: { providerID?: unknown; id?: unknown }): ProjectAggregateEntry | null
// tokens: existing max. payload.cost is RAW (entryOfSession does not estimate):
// raw!==0 → raw; else observed.cost!==0 → observed.cost
// else resolveCost({cost:0, providerID:model.providerID, modelID:model.id, tokens}).cost
```

Adapter: `(await api.client.model.list({ location: { directory: api.state.path.directory } }))?.data`. Non-array keeps prior map; successful array **replaces** via `pricingKey(row.providerID, row.id)` + `selectFiniteNonTier(row.cost)`. Validate here only. Never throw. `usageOf` sets resolved `cost`+`source`. `sumProjectSessions(id, sessions, exclude?)` skips `exclude.has(id)` **before** tokens/cost, then `resolveCost` per row. `refreshProject` passes `readDeletedSessionIDs` into that sum before `combineProjectUsage`.

## Testing Strategy

Unit (`bun test` RED→GREEN): gates, formula, key, mix, identity, `resolveEntry`, tombstones. Integration: upsert, reconcile, list throw, first-fill, deleted observed.

Required RED:

1. **Composite identity.** Prior M1 reported `.10` + M2 est `.05` + M3 est `.04`. Refill: M2 reported `.02`, M3 absent → `.16`. Repeat → `.16`. Converted IDs replace only themselves; missing unconverted estimates archive once; still-live estimates stay live.
2. **Project tombstone scope.** Tombstone `(sessionX, projectA)`: IDs for A include `sessionX`; B does not. A list row still carrying `sessionX` for A is excluded **before** live sum; B still counts it. Project A adds the deleted aggregate once, not twice.

Also RED: gates, formula, trim-without-alias, safe-zero, mixed session, lower reported replaces that id, `resolveEntry` money.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR, executable-file, or process-integration boundary. Validate `model.list` in the adapter; parameterized SQL.

## Migration / Rollout

No schema migration. `type:fix`. Keep full Project + identity + tombstones.

Authored forecast (add+del; no goldens): pricing 100, math +75, types +16, store +42, reconcile +16, project +26, db +22, tokenmeter +16, tests 200, ADR 60, harness 30 → **~603 (560–650).**

Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High

`loadPricing`: one in-flight; success-sticky; fail keeps map, cools ≥ `PROJECT_POLL_DELAY`. Empty cache ≠ unknown model. Fail-closed. Rollback: revert PR. Live → reported-only. Deleted numerics stay.

## Open Questions

- [ ] None that block design. Apply must pick chained PRs or `size:exception`.
