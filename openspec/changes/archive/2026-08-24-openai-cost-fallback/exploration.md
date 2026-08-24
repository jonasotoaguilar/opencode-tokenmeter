# Exploration: openai-cost-fallback

Change: `openai-cost-fallback` — OpenAI-specific fallback cost estimation when `cost: 0` despite non-zero tokens. Reuse OpenCode/models.dev pricing metadata via SDK; preserve reported-cost authority; estimated cost must flow through the normal aggregation path so both Session (via messages) and Project (via live `session.list`) include it.

## Current State

**Plugin type & entry:** Read-only TUI plugin `src/tokenmeter.tsx` (TUI-only, `exports["./tui"]` → `dist/tui.js`). Event-driven flow `host events → entry → store invalidation/upsert → debounced reconcile → publish snapshot → panel repaint`. Verified against `@opencode-ai/plugin 1.18.14`, `@opencode-ai/sdk 1.18.14`, `@opentui/solid 0.4.5`, Bun 1.3.11.

**Message ingestion (two paths):**

1. **Fast path (event):** `api.event.on("message.updated", e => upsertMessageUsage(e.properties.info))` in `src/tokenmeter.tsx:118`. `upsertMessageUsage()` (`src/tokenmeter/store.ts:87`) calls `usageOf()` and upserts into `msgUsage: Map<sessionID, Map<messageID, MessageUsage>>` by message ID (replace, never append → idempotent). Also `message.part.updated` (non-text/reasoning parts) only invalidates + debounces; actual usage still comes from the authoritative client load.
2. **Authoritative path (rehydrate):** `src/tokenmeter/reconcile.ts:143` `reconcile()` → `discoverTree()` + `loadSessionUsage()` → `api.client.session.messages({sessionID})` → `usageOf(m)` per `m.info` → `usageMap(sessionID).clear()` + `map.set(m.id, usage)` (replace, never merge). By design the in-memory TUI mirror is never trusted (capped, drops oldest messages). `needsRehydrate/isLoaded/re-hydrating` flags control stale vs fresh.

**Current `UsageMessage` (`src/tokenmeter/types.ts:184`):**
```ts
type UsageMessage = { id?, sessionID?, role?, cost?, tokens?: { input?, output?, reasoning?, cache?: {read?, write?}, total? } }
```
No `providerID`/`modelID`/`variant` fields today — the SDK's `AssistantMessage` (`types.gen.d.ts:213 AssistantMessage { id, sessionID, role:"assistant", providerID: string, modelID: string, cost, tokens{input,output,reasoning,cache,total} }`) carries them, but the plugin's narrow type discards them. `grep -rn providerID src/` returns zero hits — confirmed gap.

**`usageOf()` (`src/tokenmeter/math.ts:90`):**
- Guards `role !== "assistant" → null`.
- `num()` coercion on each token channel; `cost = num(message.cost)`.
- `context = input+output+reasoning+cacheRead+cacheWrite` (total unused, reconstructs `tokens.total`; verified 3167+249+64+66816+0=70296).
- `if (any===0) return null` where `any = cost+input+output+reasoning+cacheRead+cacheWrite` → zero-token + zero-cost messages are dropped (preserves placeholder).

**High-water (`src/tokenmeter/store.ts:63` `observedSessionUsage`):**
- `sumMessages(map)` aggregates per-session sums, then `maxComponents(prev, usage)` per-field `Math.max` on `cost/input/output/reasoning/cacheRead/cacheWrite`. Stored in `sessionHighWaters: Map<sessionID, SessionComponents>`. Compaction (smaller later message set) never lowers displayed spend. `publish()` (`reconcile.ts:178`) sums `observedSessionUsage(sid)` across `ids` (root + recursive descendants via `tree.ts`).
- **Implication for fallback:** `cost` high-water will freeze an earlier estimate and block a later lower reported cost — contradicts issue invariant "later real non-zero cost must outrank earlier estimate even if lower." Requires estimated-vs-reported authority.

**Deleted-session / Project aggregation:**
- `src/tokenmeter.tsx:173` `session.deleted` → `observedSessionUsage(info.id)` + `recordDeletedSession(dbPath, info, observed)` → `src/tokenmeter/db.ts:125` `recordDeletedSession` resolves `entryOfSession(info)` vs `entryOfSessionUsage(observed)` via `resolveEntry()` (`math.ts:296` per-field max, `context` recomputed), then SQLite `BEGIN IMMEDIATE` tombstone insert (`tombstones(session_id,project_id)` PK) + `projects` aggregate upsert. Exactly-once across processes; no-usage deletes skip tombstone.
- `src/tokenmeter/project.ts:108` `refreshProject()` → `api.client.project.current({directory})` (with `projectIDHint` post-delete) → `api.client.session.list({directory, scope:"project", limit:10_000})` filtered by `projectID` (dedup by sessionID, fail-closed at cap, missing payload → error) → `sumProjectSessions()` (live sum) + `readDeletedAggregate()` → `combineProjectUsage()` → `projectSnapshot` signal. Live rows never persisted; Project total = live sum + deleted SQLite aggregate.
- Today `entryOfSession`/`sumProjectSessions` only read `cost`/`tokens` from `ProjectSessionLike` (narrow type without provider/model). Project `cost` is payload-reported only; fallback on that path needs model resolution per `GlobalSession.model` entry (verified present: SDK `GlobalSession.model?: { id, providerID, variant? }` at `types.gen.d.ts:1790` / `ModelRef` at `:2387`). `ProjectSessionLike` gap blocks live estimation until extended.
- Verified SDK v2 shape: `GlobalSession` (`types.gen.d.ts:1790`) includes `model?: { id: string; providerID: string; variant?: string }`, `cost?: number`, `tokens?: { input, output, reasoning, cache:{read,write} }`. This is the `session.list` row payload used by Project aggregation.

**Panel rendering:** `src/tokenmeter/panel/index.tsx` + `format.ts`/`numbers.ts`. Cost rendered `fmtCost()` two decimals; group/section aggregates sum `cost` like any other channel. No cost-specific UI branch today.

**Build/test:** `bun run build` via `scripts/build.ts` (Solid transform guard), `bun test` (90 tests / 3 files; coverage gate 80/80/80 via `bun test --coverage`). `// @ts-nocheck` on UI files → typecheck does not cover panel.

---

## Affected Areas

- `src/tokenmeter/types.ts` — extend `UsageMessage` **and** `ProjectSessionLike` with pricing identity. `UsageMessage` needs `providerID?: string; modelID?: string;` (+ optional `variant?`). `ProjectSessionLike` needs `model?: { id: string; providerID: string; variant?: string }` mirroring SDK `GlobalSession.model` (`types.gen.d.ts:1790`, `ModelRef:2387`), plus optional fallback `providerID?/modelID?` for compatibility. No bundle SDK import; keep narrow local types, document mapping to `AssistantMessage` and `GlobalSession`. Touches only type definitions.
- `src/tokenmeter/math.ts` — **core change site for Session + Project**: new `estimateCost(tokens, pricing)` pure function implementing ` (input*price.input + cacheRead*price.cache_read + cacheWrite*price.cache_write + (output+reasoning)*price.output)/1e6`; new `resolveMessageCost(message, pricing)` and `resolveProjectSessionCost(session, pricing)` that return reported cost when `cost !== 0` (authoritative), return estimated cost when `cost===0 && hasBillableTokens && providerIsOpenAI && pricingFound`, otherwise `0` + preserve estimated flag for authority. Also `hasBillableTokens` check (`input+output+reasoning+cacheRead+cacheWrite >0`). Must export for unit tests. Existing `usageOf()` becomes thin wrapper calling the resolver. `sumProjectSessions` must accept a pricing resolver per row (`getPricing(providerID, modelID) → ModelCost|null`) and apply the same authority formula per session row before summing; `entryOfSession` similarly for delete payload. `maxComponents`/`sumMessages` untouched except cost-authority bypass.
- `src/tokenmeter/pricing.ts` **(new, ~90–130 lines)** — **pricing resolution seam shared by Session and Project**: `fetchPricing(api)` → `api.client.model.list({location:{directory}})` returning `ModelV2Info[]` (type `ModelV2Info { id, providerID, cost: ModelCost[], ... }` where `ModelCost { input, output, cache{read,write}, tier? }` at `types.gen.d.ts:4012`/`4024`, response `V2ModelListResponses {location, data: ModelV2Info[]}` at `:10276`). Build `Map<string, ModelCost>` keyed by normalized `providerID:modelID`. Normalization: `providerID` case-insensitive equals `"openai"`, `modelID` trim + lowercase for lookup, preserve original for price key fallback. Handle tier: if `cost` array has `tier` entries, select first non-tier entry; if all tiered, treat as unresolved (preserve zero). Cache in module with `Map` + `loaded` flag; expose `getPricing(providerID, modelID): ModelCost|null`, `loadPricing(api): Promise<void>`, `clearPricing()` for tests. Never static table, never outbound fetch, never models.dev direct. Used by both `math.ts` Session path and `project.ts` live-Project path.
- `src/tokenmeter/store.ts` — **authority fix for Session aggregation**: extend `SessionComponents` or parallel `costAuthority: Map<sessionID, {cost, isEstimated}>` to preserve estimated-vs-reported semantics so later reported `cost>0` replaces earlier estimate even if lower. Minimal option: keep high-water for tokens, but cost high-water becomes conditional: `if (reported>0) nextCost = max(prevReportedCost, reported)` vs estimate branch. Simpler: store `costReportedHighWater` + `costEstimated` separately; `observedSessionUsage` returns `reportedCost ?? estimatedCost`. Must still satisfy `any===0` null guard and `sumMessages` cost recomputation. Also ensure message-ID upsert replaces estimate map entry when reconciled message later carries `cost>0`. Project live path does **not** use this high-water; it sums fresh `session.list` rows each refresh, but must still respect reported-over-estimated per row on that fresh sum.
- `src/tokenmeter/reconcile.ts` — **async pricing orchestration for Session**: `loadSessionUsage` after `fetchMessages` must have pricing available before `usageOf` calls estimate. Options: lazy load on first `usageOf` miss (call `loadPricing`), or eager load in `reconcile()` before `Promise.all(loadSessionUsage)`. Must not block placeholder indefinitely; if pricing not yet loaded, messages with `cost===0` keep cost 0 until next pricing load triggers re-publish. Add `schedulePricingRefresh` + generation counter similar to reconcile.
- `src/tokenmeter/project.ts` — **live Project estimation (required v1)**: inject pricing into `sumProjectSessions` path: `ProjectSessionLike` now carries `model` (sdk `GlobalSession.model: ModelRef {id, providerID}` — verified at `types.gen.d.ts:1790`/`2387`). `refreshProject()` must `await loadPricing(api)` (cached → instant after first) before `sumProjectSessions`; pass resolver so each live row with `cost===0 && hasBillableTokens && isOpenAIProvider(model.providerID) && pricingFound` contributes estimated cost, otherwise `0` with zero preserved only for genuinely unresolved rows (unknown model, tiered pricing, non-OpenAI provider, missing `model`, or offline). Fail-closed at cap and missing payload unchanged. No extra `session.get` fan-out; rely on `model` already present in list payload.
- `src/tokenmeter.tsx` — wire pricing lifecycle: `loadPricing(api)` on plugin start (inside `createRoot` before `activateRoot`), on `project.updated`/`config` change if observable, and after every reconcile/project refresh that produced estimates with unresolved pricing (staleness). Add failure containment: pricing load failure → keep zero (never throw). Deleted-session path automatically benefits because `observedSessionUsage` now carries estimated cost into `recordDeletedSession`'s `resolveEntry`; live Project path benefits via `sumProjectSessions`.
- `src/tokenmeter.tsx` + `src/tokenmeter/store.ts` — deleted-session path: `recordDeletedSession` already uses `resolveEntry` with `Math.max(cost)`. With fallback, the `observed` entry must carry estimated cost, and `payload.cost` (usually 0 for deleted subagent) must not win via max if estimate exists. Same authority fix applies to `resolveEntry` cost arg: prefer reported>0 over estimate (or delegate to per-entry resolver before max).
- `test/harness.test.ts` + new `test/pricing.test.ts` or `test/cost-fallback.test.ts` — strict-TDD seams (see Testing Strategy). Must cover both Session and Project live rows.
- `docs/adr/` — new ADR for pricing resolution (why `model.list` not static table, why `ModelCost` tier handling, why authority flag, why live Project estimation is not optional).
- No changes to `panel/*`, `format.ts`, `numbers.ts` (estimated cost renders through same `fmtCost` path; no UI distinction required per issue "preserve enough internal ..." — internal flag, not visual).

---

## Approaches

### Pricing resolution

#### 1A. SDK `model.list` → `ModelV2Info.cost` (Recommended, retained)
- Call `api.client.model.list({location:{directory}})` (SDK `Model.list`, `V2ModelListResponses: {location, data: ModelV2Info[]}` at `types.gen.d.ts:10276`/`10302`). Each `ModelV2Info` (`types.gen.d.ts:4024`) has `providerID`, `id` (model ID), `cost: ModelCost[]` where `ModelCost { input, output, cache{read,write}, tier? }` (`types.gen.d.ts:4012`). This IS the models.dev cache the issue references ("models.dev metadata cached by OpenCode"); `api.client.config.providers` would return zeroed subscription prices, so model list is the correct source.
- Build normalized map: key `${providerID.toLowerCase()}:${modelID.toLowerCase().trim()}` → `ModelCost` (first non-tier). Lookup per message and per `GlobalSession.model` row via `providerID`/`modelID`.
- Pros: No static table, cross-platform (uses host state dir API), survives pricing updates without plugin release, uses public metadata even for subscription models, single SDK call, no outbound network from plugin, no secrets, shared by Session and Project paths.
- Cons: Requires host to have warmed the models.dev cache (cold start → zero, per spec allowed); `model.list` exists only on newer hosts (needs fail-contained fallback to "preserve zero").
- Effort: Low (new module ~100 lines + 20 lines wiring).

#### 1B. Static price table in repo
- Ship `src/tokenmeter/pricing-table.ts` with per-model `{input,output,cache}` per-million.
- Pros: Deterministic offline.
- Cons: Violates requirement ("reuse OpenCode/model metadata when available instead of maintaining an unrelated second source of truth"), goes stale, requires releases for price changes, duplicates models.dev, cross-platform drift, rejected by issue.
- Effort: Low but wrong durability.

#### 1C. `config.providers` pricing
- Call `api.client.config.providers({directory})` → `Provider { models: {[key]: Model {cost?}} }`.
- Pros: Simple.
- Cons: For subscription models OpenCode intentionally projects zero prices there; estimate would still be zero (self-defeating). Not the models.dev cache.
- Effort: Low but fails the exact bug.

### Estimated-vs-reported authority

#### 2A. Dual cost authority (Recommended, retained)
- Keep `sessionHighWaters` for token high-water; add `sessionCostAuthority: Map<sessionID, {reportedCost:number, estimatedCost:number}>` or extend `SessionComponents` with `costIsEstimated: boolean`. In `observedSessionUsage`, merge as: `finalCost = reportedCost >0 ? max(prevReported, curReported) : max(prevEstimated, curEstimated)` but **reported always outranks estimate**: if message now has `cost>0`, it replaces estimated contribution even if lower. Implementation: store both; publish `reportedCost || estimatedCost`. Message-ID upsert naturally replaces map entry when reconciled payload later carries `cost>0`. Project live path does not need high-water (fresh sum each refresh) but must still apply same per-row reported-over-estimated rule before summing.
- Handles generation counter correctly: stale reconcile result with old estimate dropped via `seq !== reconcileSeq`.
- Pros: Matches "later real non-zero cost must outrank earlier estimate even if lower" exactly; preserves idempotency (same message ID overwrite); keeps token high-water intact.
- Cons: One extra map; small complexity.

#### 2B. Pure `maxComponents` for cost
- Reuse existing `Math.max` for `cost`.
- Pros: Zero extra code.
- Cons: If estimate $0.05 then reported $0.02 later, max keeps $0.05 — violates authority invariant. Fails issue.
- Effort: None but wrong.

### Async initialization / reconciliation

#### 3A. Eager pricing load + re-reconcile on arrival (Recommended, retained)
- On plugin start, `void loadPricing(api).then(()=> { if (hasPendingZeroCostSessions) scheduleReconcile(api, IDLE_DELAY) })`. Also in `reconcile()` and `refreshProject()`, if any `usageOf`/`sumProjectSessions` produced estimate `0` due to unresolved pricing, mark `pricingStale=true` and trigger `loadPricing` → single re-reconcile/re-refresh.
- Publish only when `loadSessionUsage`/`refreshProject` after pricing attempt (messages/rows still cost 0 if pricing still unresolved → preserve zero per spec).
- Pros: Minimal extra latency; debounced, never overlaps (generation counter / `projectLoading` guard), handles offline → zero gracefully, serves both Session and Project.
- Cons: One extra async step per root activation / project refresh (cached after first load).

#### 3B. Block reconcile until pricing loads
- `await loadPricing` inside every `loadSessionUsage`/`refreshProject` without caching optimization.
- Pros: Single path.
- Cons: Blocks placeholder longer on cold/offline; every load pays pricing fetch latency.

### Scope of fallback

#### 4A. Session (+ groups) only, v1 (Rejected — violates explicit requirement)
- Estimate only in `usageOf` path. Project live sum stays zero for `cost===0` rows.
- Cons: Drops explicit issue #27 requirement that estimated subagent cost must flow through the normal aggregation path so both Session and Project include it. The exploration confirms SDK v2 exposes `GlobalSession.model: ModelRef` (`types.gen.d.ts:1790`/`2387`) on `session.list` rows, so live Project calculation is feasible without fan-out. Preserving zero only for genuinely unresolved rows is required; deferring the whole Project path is not a smallest valid scope.

#### 4B. Session + live Project list (Required v1 — corrects gate failure)
- Patch `ProjectSessionLike` to carry `model?: { id, providerID, variant? }` and patch `sumProjectSessions` to estimate per `ProjectSessionLike` with pricing whenever `session.list` provides `model/providerID` and tokens. `refreshProject()` loads pricing once then sums; rows without resolvable pricing preserve zero (fail-closed). Deleted-aggregate path already stores observed estimate via `recordDeletedSession`, so both live and deleted contributions carry the estimate through `combineProjectUsage`.
- Pros: Satisfies explicit issue requirement; no extra `session.get` fan-out (list payload already carries `model`); estimated cost flows through normal `sumProjectSessions` → `combineProjectUsage` → `projectSnapshot`; Session and Project stay consistent.
- Cons: Needs `ProjectSessionLike` extension and ~30–40 extra lines for per-row resolver; still fail-closed when `model` absent (preserves zero, which is the specified fallback, not a scope cut).
- Effort: Low (types +6, `math.ts` resolver +20, `project.ts` wiring +15).

---

## Recommendation

**Smallest durable implementation that satisfies issue #27 within 400 lines — now explicitly including live Project estimation:**

1. **Types:** Extend `UsageMessage { providerID?, modelID? }` and `ProjectSessionLike { model?: { id: string; providerID: string; variant?: string } }` (mirroring verified `GlobalSession.model` at `types.gen.d.ts:1790` / `ModelRef:2387`). Document mapping to SDK `AssistantMessage` and `GlobalSession`. Keep narrow local types.
2. **Pricing module `src/tokenmeter/pricing.ts`:** Pure + async seam shared by Session and Project:
   ```ts
   export type Pricing = ModelCost // {input, output, cache:{read,write}, tier?} at types.gen.d.ts:4012
   export function normalizeModelID(id:string):string
   export function isOpenAIProvider(pid:string):boolean // === "openai" case-insensitive
   export function estimateCost(tokens:{input,output,reasoning,cacheRead,cacheWrite}, price:Pricing):number // /1e6
   export function getPricing(providerID:string, modelID:string): Pricing|null
   export async function loadPricing(api:Pick<ProjectApi,"client"|"state">):Promise<void> // model.list with fail containment + tier filter
   ```
   Cache in module; `estimateCost` formula exactly `(input*price.input + cacheRead*price.cache_read + cacheWrite*price.cache_write + (output+reasoning)*price.output)/1e6`. Tier handling: prefer first `tier===undefined`; if none, return null → preserve zero. Model normalization: trim + lowercase; provider: lowercased `=== "openai"`; unknown model → null → zero (never throw, never invent). Single pricing cache serves both Session `usageOf` and Project `sumProjectSessions`.
3. **Math `src/tokenmeter/math.ts`:** Introduce `resolveCost` helpers and keep `usageOf`/`sumProjectSessions` as:
   ```ts
   // Session row
   if (message.role!=="assistant") return null
   tokens...
   cost = num(message.cost)
   if (cost>0) finalCost=cost // authoritative
   else if (cost===0 && (input+output+reasoning+cacheRead+cacheWrite)>0 && isOpenAIProvider(providerID) && pricing) finalCost=estimateCost(tokens,pricing)
   else finalCost=0
   // Project live row (per session in sumProjectSessions)
   const rowCost = num(session.cost)
   const rowTokens = tokensOf(session)
   let finalRowCost = rowCost
   if (rowCost===0 && hasBillableTokens(rowTokens) && isOpenAIProvider(session.model?.providerID) && getPricing(session.model.id, session.model.providerID)) {
     finalRowCost = estimateCost(rowTokens, pricing)
   } // else preserve 0 for genuinely unresolved rows
   ```
   Export `estimateCost`/`shouldEstimate` for tests. Preserve `output+reasoning` merging per formula. `sumProjectSessions` signature extended to accept pricing resolver; `entryOfSession` similarly.
4. **Store `src/tokenmeter/store.ts`:** Dual authority for Session:
   - Keep token high-water via `maxComponents` unchanged.
   - New `sessionCostReported: Map<sessionID, number>` and `sessionCostEstimated: Map<...>` or single `costAuthority` map. On `observedSessionUsage`, compute `reported = sum of Reported-cost messages`, `estimated = sum of Estimated-cost messages`, then `reported>0 ? reported : estimated` with replacement semantics on message-ID upsert (reconcile `map.clear()` + refill already handles replacement; idempotency preserved). Ensure `maxComponents` not applied to cost when authority flips — cost high-water must allow decrease when reported replaces estimate.
   - Project live path needs no high-water; it re-sums fresh list rows each `refreshProject` with per-row authority already applied.
5. **Reconcile `src/tokenmeter/reconcile.ts` + `project.ts`:** Before `Promise.all(loadSessionUsage)` and before `sumProjectSessions`, `await loadPricing(api)` (cached → instant after first). After publish/refresh, if `pricingStale` flagged (any row stayed zero due to unresolved pricing), schedule one more reconcile/refresh with `RECONCILE_DELAY`/`PROJECT_REFRESH_DELAY`. Generation counter / `projectLoading` guard drops stale.
6. **Entry `src/tokenmeter.tsx`:** `loadPricing(api)` on startup (inside `createRoot` before `activateRoot`); failure contained (preserve zero, never toast). Deleted-session path automatically benefits because `observedSessionUsage` now carries estimated cost into `recordDeletedSession`'s `resolveEntry`; live Project path benefits via `refreshProject` resolver.
7. **No UI change:** Cost flows through same `sumMessages → observedSessionUsage → publish → buildGroups` and same `sumProjectSessions → combineProjectUsage → projectSnapshot` and same `fmtCost`; groups/Session/Project aggregations include estimate automatically via normal aggregation. Internal `isEstimated` flag never leaks to persistence (SQLite `cost` column stores numeric cost only; whether estimated is not persisted — acceptable per "preserve enough internal ..." — keep in-memory flag; on restart, if still `cost===0`, re-estimate anyway).

**Why live Project estimation is mandatory in v1:** Issue #27 explicitly requires estimated subagent cost to flow through the normal aggregation path so **both** Session and Project include it. Exploration confirms `GlobalSession.model: ModelRef` is exposed on `session.list` rows (`types.gen.d.ts:1790`), so whenever the list provides `model/providerID` and tokens, live Project calculation can and must be investigated and included, preserving zero only for genuinely unresolved rows (unknown model, tiered-only pricing, non-OpenAI provider, missing `model`, offline). Labeling this optional or v2 would drop a requirement.

**Line forecast:** `pricing.ts` ~110, `math.ts` +55 (Session + Project resolvers), `types.ts` +12, `store.ts` +45, `reconcile.ts` +15, `project.ts` +20, `tokenmeter.tsx` +15, tests +90 = **~362 lines** → **single PR fits 400** under `auto-chain` (no slice needed). Evidence supports budget; no scope cut required. If a later audit shows `session.list` payload missing `model` on some hosts (contradicted by current SDK types), that would be a Host capability gap, not a scope deferral — the plugin still preserves zero for those rows (fail-closed) and the budget remains.

**Accepted tradeoffs:** Tiered pricing → preserve zero; unknown model → zero (never hallucinate); subscription zero-price config ignored (use models.dev); offline → zero; `variant` ignored for lookup (base `modelID` only); `model` absent on a Project row → preserve zero for that row.

---

## Risks

- **Cold models.dev cache / offline (`High`):** `model.list` may return empty or fail; estimate stays zero per spec — safe but user sees no improvement until host warms cache. Mitigate: retry on next reconcile/project refresh; document offline behavior; test offline path for both Session and Project rows; never throw.
- **Cost authority regression (`High`):** If `maxComponents` still maxes cost, later reported $0.02 will not replace earlier $0.05 estimate. Mitigate: dual authority map + regression test "estimate then reported lower wins" for Session; Project live path re-sums fresh rows so authority is per-row, but still needs reported-over-estimated check before summing.
- **Tiered pricing mis-estimate (`Medium`):** `ModelCost.tier` entries (context-based tiers) selected naively could apply wrong tier. Mitigate: use only non-tier entry; tiered → preserve zero and log nothing (both Session and Project).
- **Model ID normalization (`Medium`):** SDK reports `modelID` like `gpt-4o`, `gpt-4o-2024-08-06`, `openai/gpt-4o` in some configs. Lookup miss → false zero. Mitigate: normalize trim+lowercase, try exact then base split on `/` and `-20` date suffix fallback; still fail to zero if ambiguous — never guess. Applies to both Session `modelID` and Project `model.id`.
- **Project live-list `model` absent on a row (`Medium`, now in-scope):** If a host returns a `GlobalSession` without `model` (older host or edge case), that row cannot be estimated — must preserve zero for that row (genuinely unresolved). This is fail-closed per spec, not a v1 gap. Mitigate: guard `if (!session.model?.providerID || !session.model?.id) preserveZero`; test missing-model Project row stays zero; verify against live payload in proposal phase.
- **Generation counter / projectLoading staleness (`Low`):** Pricing load finishing after a newer reconcile/refresh could overwrite with stale estimate. Mitigate: reuse `reconcileSeq` guard and `projectLoading` gate; pricing load triggers new reconcile/refresh rather than direct publish.
- **Type `// @ts-nocheck` hides regressions (`Low`):** UI files not typechecked. Mitigate: manual installed-type verification per `skills/opencode-plugin/SKILL.md` + `bun run build` artifact guard.
- **SQLite cost persistence (`Low`):** Persisted `projects.cost` is numeric only; restart loses "estimated" provenance. Acceptable because re-estimate recomputes deterministically on next Session load and next Project `session.list` refresh; reported cost still authoritative on reload.
- **Security/privacy (`Low`):** No outbound fetch, no secrets, no model content change, no new permissions. Pricing comes from host SDK `model.list` only (same trust boundary as `session.list`). No injection surface (cost is numeric, no string interpolation). DoD: no new network, no kv write.

---

## Ready for Proposal

**Yes** — with live Project estimation explicitly in v1 scope.

1. **Confirm pricing source contract:** Use `api.client.model.list` (`ModelV2Info.cost` at `types.gen.d.ts:4024`/`4012`, response `V2ModelListResponses` at `types.gen.d.ts:10276`) not `api.client.config.providers`. Proposal should cite SDK lines `types.gen.d.ts:4012 ModelCost`, `4024 ModelV2Info`, `10276 V2ModelListResponses`, `1790 GlobalSession`, `2387 ModelRef`, and `sdk.gen.d.ts: Model.list` and note tier handling + fail containment for both Session and Project.
2. **Lock scope:** Session (messages) + groups + deleted-aggregate Project via `observedSessionUsage` **and** live Project via `sumProjectSessions` with per-row `GlobalSession.model` estimation is v1. Proposal must state live Project estimation is required whenever `session.list` provides `model/providerID` and tokens, preserving zero only for genuinely unresolved rows — not optional or v2.
3. **Formula pin:** Proposal must pin exact estimation formula and divisor `1e6` with the 3,416-message <2% validation note and the `output+reasoning` merging for both paths.

---

## Strict-TDD Test Seams & Minimum Scenarios

**Seams (require pure exports, no SDK mock in unit layer):**

- `pricing.ts`: `estimateCost(tokens, price) → number`, `normalizeModelID(id) → string`, `isOpenAIProvider(pid) → boolean`, `selectPricing(costs: ModelCost[]) → ModelCost|null` (tier filter), `getPricing`/`loadPricing` (inject fake `api.client.model.list`).
- `math.ts`: `shouldEstimate(message) → boolean`, `shouldEstimateProjectRow(session) → boolean`, `resolveCost(message, pricing) → {cost, isEstimated}`, `resolveProjectCost(session, pricing) → {cost, isEstimated}`.
- `store.ts`: Authority maps (`reportedCost`, `estimatedCost`) — expose `clearAuthorityForTest()` or test via `observedSessionUsage` sequence.
- `project.ts`/`math.ts`: `sumProjectSessions(projectID, sessions, getPricing)` pricing-injected.

**Minimum scenarios (issue #27, each as RED-then-GREEN `bun:test`):**

| # | Scenario | Given / When / Then | Layer |
|---|----------|----------------------|-------|
| 1 | **Reported cost authoritative (Session)** | G: OpenAI `gpt-4o`, usage `input 1000/output 500/reasoning 200/cache 0`, pricing `{input 5, output 15}`. W: `cost 0.023` reported. T: cost MUST be `0.023` not estimate. | unit `math` |
| 2 | **Zero-cost estimate (Session)** | G: same usage, `cost 0`, provider `openai`, pricing found. W: `estimate = (1000*5 + 0 + 700*15)/1e6 = 0.0155`. T: cost MUST be `0.0155` (within 1e-9). | unit `math`+`pricing` |
| 3 | **Non-OpenAI never estimates (Session)** | G: provider `anthropic`, `cost 0`, same usage, pricing present. T: cost stays `0`. | unit |
| 4 | **Zero tokens never estimates** | G: `openai`, all tokens 0, `cost 0`. T: `usageOf` returns `null` (not an estimated message) — preserves existing `any===0`→null. | unit |
| 5 | **Unknown model → preserve zero (Session)** | G: `openai`, model `gpt-9-nonexistent`, pricing miss/null. T: cost stays `0`, no throw. | unit `pricing` |
| 6 | **Tiered pricing → preserve zero** | G: `ModelCost[]` all have `tier` field. T: `selectPricing` returns `null`, estimate not applied. | unit `pricing` |
| 7 | **Cache-aware formula** | G: `input 3167, output 249, reasoning 64, cacheRead 66816`, price `{input 5, cache_read 2.5, cache_write 0, output 15}`. T: `(3167*5+66816*2.5+(249+64)*15)/1e6` exact. | unit |
| 8 | **Reported outranks lower estimate (Session)** | G: message `m1` first observed with `cost 0` → estimate `0.05` published. W: same `m1` later via reconcile with `cost 0.02` (reported). T: session cost MUST be `0.02`, not `max(0.05,0.02)`. | integration `store`+`reconcile` |
| 9 | **No double-count on re-event** | G: same `m1` estimated, duplicate `message.updated` with same id+usage. T: `msgUsage` size stays 1, `sumMessages` cost once. | unit `store` |
| 10 | **Message-ID upsert replaces estimate** | G: map has `m1` estimated `0.05`; W: `usageOf` with same `id=m1` but `cost 0.03` reported. T: map entry cost becomes `0.03`. | unit `store` |
| 11 | **Model ID normalization** | G: `modelID " GPT-4o "` vs pricing key `gpt-4o`. T: lookup succeeds. Variant suffix `gpt-4o-2024-08-06` maps to `gpt-4o` if base present. | unit `pricing` |
| 12 | **Offline / load failure → zero** | G: `api.client.model.list` throws/returns `null`. T: estimate not applied, no throw, `loadPricing` resolves, next reconcile still zero (Session and Project). | integration `pricing` |
| 13 | **Pricing arrives after messages** | G: messages loaded with `cost 0` while pricing not yet loaded → cost 0 published. W: `loadPricing` resolves. T: scheduled reconcile re-evaluates and now shows estimate. | integration `reconcile` |
| 14 | **Deleted aggregate inherits estimate** | G: subagent session with estimated cost `0.04`, then `session.deleted` (payload cost 0, no tokens). T: `recordDeletedSession` aggregate `cost` includes `0.04` via `observedSessionUsage` (not payload zero). | integration `db`+`store` |
| 15 | **Group + Session aggregate includes estimate** | G: root + one delegated session estimated `0.02`. W: `publish` sums. T: `snapshot.cost` and `groups[0].cost` include `0.02`; `totalTokens` includes `context` channels. | integration `reconcile` |
| 16 | **Live Project estimate when model+tokens present** | G: `GlobalSession { cost 0, tokens {input 1000, output 500, reasoning 0, cache{read 0,write 0}}, model:{id:"gpt-4o", providerID:"openai"}}` in `session.list`, pricing `{input 5, output 15}`. W: `refreshProject` with pricing loaded. T: `live.cost` MUST be `0.0075` (`(1000*5+500*15)/1e6`) and flow through `combineProjectUsage` to `projectSnapshot.cost`. | integration `project`+`math` |
| 17 | **Live Project preserves zero for non-OpenAI** | G: `model:{providerID:"anthropic", id:"claude-4"}` cost 0 with tokens. T: live row cost stays `0`, `projectSnapshot` does not invent estimate. | unit `project` |
| 18 | **Live Project preserves zero for unknown model / tiered** | G: `openai` model `gpt-9-nonexistent` or tiered-only pricing, cost 0. T: live row cost stays `0` (genuinely unresolved). | unit `pricing`+`project` |
| 19 | **Live Project preserves zero when model absent** | G: `GlobalSession` row without `model` (missing provider identity), cost 0 with tokens. T: live row cost stays `0` (genuinely unresolved, fail-closed). | unit `project` |
| 20 | **Live Project reported outranks estimate** | G: Project row first seen with `cost 0` → estimate `0.05`, next `session.list` returns same `id` with `cost 0.02` reported (real billing arrived). T: `sumProjectSessions` on fresh list MUST yield `0.02`, not stale `0.05`. | integration `project` |
| 21 | **Real payload parity regression <2%** | G: 3,416 real priced messages with pricing map. T: For each where cost>0, `abs(estimate - reported)/reported < 0.02` (or at least spot-check with fixture). Keeps formula honest. | unit `pricing` (fixture) |

Integration harness reuses `test/harness.test.ts` pattern (`fakeApi` with `session.messages`, `session.children`, `session.get`, `state.session.status`) plus `api.client.model.list` mock, `usageMap` inspection, and `project.list` mock with `GlobalSession.model`.

---

## References (Evidence)

- Ingestion: `src/tokenmeter.tsx:118` `message.updated → upsertMessageUsage`, `src/tokenmeter/store.ts:87` `upsertMessageUsage`, `src/tokenmeter/math.ts:90` `usageOf`, `src/tokenmeter/reconcile.ts:104` `fetchMessages`, `:112` `loadSessionUsage`, `:143` `reconcile`, `:178` `publish`
- High-water: `src/tokenmeter/store.ts:63` `observedSessionUsage`, `:37` `sessionHighWaters`, `src/tokenmeter/math.ts:76` `maxComponents`, `src/tokenmeter/reconcile.ts:188` `publish` high-water comment
- Deleted/project: `src/tokenmeter.tsx:173` `session.deleted → recordDeletedSession`, `src/tokenmeter/db.ts:125` `recordDeletedSession`, `src/tokenmeter/math.ts:257` `entryOfSession`, `:279` `entryOfSessionUsage`, `:296` `resolveEntry`, `src/tokenmeter/project.ts:108` `refreshProject`, `:80` `PROJECT_SESSION_LIMIT`, `:159` `sumProjectSessions` call site
- Types: `src/tokenmeter/types.ts:168` `ProjectSessionLike` (narrow, now requires `model?`), `184` `UsageMessage` (no provider/model), SDK `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:1790` `GlobalSession {model?: {id, providerID, variant?}, cost, tokens}`, `:2387` `ModelRef {id, providerID, variant?}`, `:4012` `ModelCost`, `:4024` `ModelV2Info {providerID, id, cost[]}`, `:10276` `V2ModelListResponses {data: ModelV2Info[]}`, `:10302` `V2ModelListResponse`
- SDK client: `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts:1786` `Model.list → V2ModelListResponses`, `client.gen.d.ts` location, `node_modules/@opencode-ai/plugin/dist/tui.d.ts` `TuiPluginApi.client: OpencodeClient`
- Build/test: `package.json` scripts `test: bun test`, `scripts/build.ts` Solid transform guard, `openspec/config.yaml` strict_tdd + coverage 80
- Formula validation: confirmed in issue description — ` (input*price.input + cacheRead*price.cache_read + cacheWrite*price.cache_write + (output+reasoning)*price.output)/1e6` matched 3,416 messages <2%.

## Unresolved Decisions

- **Model ID variant stripping strategy:** Exact suffix/date-version stripping rules for models like `gpt-4o-2024-08-06` vs `openai/gpt-4o` — require probing real `ModelV2Info.id` values cached by OpenCode (models.dev IDs are canonical, but alias handling may be needed). Proposal should lock normalization table for both Session and Project rows.
- **Pricing cache invalidation:** TTL vs event-driven (`project.updated`/`config` change). Proposal should choose one (recommend no TTL; reload on next reconcile/project refresh when unresolved, cheap).
- **Variant field usage:** Whether `UsageMessage.variant` / `GlobalSession.model.variant` participates in pricing key (e.g. `gpt-4o:high`). Proposal should state ignore for v1.

## Decision needed before apply

**No** — live Project estimation is required and fits the 400-line budget (~362 lines, single PR, no slice). If a later probe shows `session.list` omitting `model` on a specific host version, the plugin preserves zero for those rows (fail-closed, genuinely unresolved) without exceeding budget; no scope cut is needed.
