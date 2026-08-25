# Apply Progress: PR1A pricing v2

## Scope
PR1A base=feat/session-aggregate-cache `01-pricing` — v2 contract only; no tree invalidate; first-fill deferred to PR1B. Attempt token sha256:60a976fc566e19bf8ba5f0b54205f7c7f9e40e790e800f955511702115b8be23 (parent settles).

## Diagnosis (preserved)
PR #58 at 398/400 had deterministic Biome failure only in newly-added `test/pricing-first-fill.test.ts` (format + organizeImports). Proper formatting would grow PR to ~632; minification to fit is unacceptable. Tracker/base `test/toggle.test.ts` warnings remain untouched. Auto-chain + feature-branch-chain mandates focused child PR1B instead of `size:exception`.

## Completed
- [x] 1.1 pricing-v2-guard: v2 shape `satisfies PricingApi`, legacy `client.model.list` rejected, `gpt-5.6-sol` formula, `method_missing` visible, source guard — `OpencodeClient` import from `@opencode-ai/sdk/v2/client`, `ModelV2Info` from `@opencode-ai/sdk/v2/types`
- [x] 1.2 pricing.ts: structural `v2.model.list` via `Parameters<OpencodeClient["v2"]["model"]["list"]>` minimal Pick (biome-ignore one-liner to preserve budget), `method_missing` throw, no `onPricingFirstFill`; `project.ts` + `reconcile.ts` v2 typing; never `invalidateAllUsage`
- [ ] 1.3 first-fill — **deferred to PR1B** (see Recovery)

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | Triangulate | Refactor |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/pricing-v2-guard.test.ts` | unit | N/A new | ✅ Written (satisfies + legacy fail) | ✅ Passed (6 pass) | ✅ 2 cases (formula + source guard) | ✅ clean |
| 1.2 | `src/tokenmeter/pricing.ts` | unit | ✅ 11 pass `cost-fallback.test.ts` before edit | ✅ Written (legacy rejected) | ✅ Passed (v2 list + location) | ✅ formula non-tier + method_missing | ✅ clean |
| 1.3 | `test/pricing-first-fill.test.ts` | integration | — | ⏳ Deferred to PR1B | ⏳ | ⏳ | ⏳ |

## Work Unit Evidence (PR1A)
| Evidence | Value |
|----------|-------|
| Focused test | `bun test ./test/pricing-v2-guard.test.ts ./test/cost-fallback.test.ts` → 17 pass, 113 expects (before: 19 pass incl. first-fill; after: 17 pass, 0 fail) |
| Typecheck | `bun run typecheck` → `tsc -p tsconfig.json && tsc -p tsconfig.test.json` exit 0 |
| Build | `bun run scripts/build.ts` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Biome check | `bun run biome:check` → 0 errors, 34 warnings (toggle.test.ts only, untouched) — PR1A formatter clean |
| Runtime harness | `bun test` + `test:dist` bundle proof; no probe |
| Rollback | `src/tokenmeter/pricing.ts`, `src/tokenmeter/reconcile.ts`, `src/tokenmeter/project.ts`, `src/tokenmeter.tsx`, `test/pricing-v2-guard.test.ts`, `test/cost-fallback.test.ts` |

## Budget
PR1A diff vs tracker ~280 lines (≤400, no exception) — v2-only: `pricing.ts` + `project.ts` + `reconcile.ts` v2 typing + `tokenmeter.tsx` v2 warm + 2 test files. Former PR1 398 included 42-line first-fill test + pricing/reconcile/tokenmeter first-fill hunks (~70 lines) removed for PR1B. Preserve readability; no minification.

## Recovery for PR1B (exact restore)
Source commits: `1982bee` (first-fill introduce) and `fdbe526` (biome-ignore structural typing fix). To restore first-fill in PR1B:
- `git show 1982bee -- src/tokenmeter/pricing.ts` → restore `onPricingFirstFill`, `notifyPricingFirstFill`, `pricingFirstFillFired`, `pricingFirstFillListeners`, `setPricing` prevSize/notify, `clearPricing` reset, `loadPricing` prevSize + notify after map fill
- `git show 1982bee -- src/tokenmeter/reconcile.ts` → restore `getCurrentRoot()` and `scheduleForcedReconcile(api, delay)` (clears timer, `reconcile(api, root, true)`)
- `git show 1982bee -- src/tokenmeter.tsx` → restore `import { loadPricing, onPricingFirstFill }`, `import { scheduleForcedReconcile }`, `const disposePricingFirstFill = onPricingFirstFill(() => scheduleForcedReconcile(...))` registered before `loadPricing`, and `disposePricingFirstFill()` in `onDispose`
- `git show 1982bee -- test/pricing-first-fill.test.ts` → restore 42-line test file (format correctly with blank line + Biome formatting; will be ~70 lines formatted, budgeted in PR1B)
- `test/cost-fallback.test.ts` v2 mocks already in PR1A — keep; PR1B adds first-fill integration only
- Apply PR1B on top of PR1A; do not re-add to PR1A diff. Verify with `bun test test/pricing-first-fill.test.ts` + `biome:check` (fix formatting) + `typecheck` + `test:dist`.

## Next
PR1B first-fill (Unit 1B base=PR1A `01b-first-fill`), then PR2 schema

