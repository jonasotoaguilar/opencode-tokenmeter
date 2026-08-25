# Apply Progress: PR1A pricing v2 + PR1B first-fill

## Scope
PR1A base=tracker `01-pricing` — v2 contract only; PR1B base=PR1A `01b-first-fill` — targeted first pricing fill. PR1A token sha256:60a976fc566e19bf8ba5f0b54205f7c7f9e40e790e800f955511702115b8be23. PR1B token sha256:99b08af8a1291b4a573ac2d283013f881f5a0a69778d5c3ee668e1bbac4efcfd (parent settles, no acquire).

## Diagnosis (preserved)
PR #58 at 398/400 had deterministic Biome failure only in `test/pricing-first-fill.test.ts` (format + organizeImports). Proper formatting would grow PR to ~632; minification to fit is unacceptable. Tracker/base `test/toggle.test.ts` warnings remain untouched. Auto-chain + feature-branch-chain mandates focused child PR1B instead of `size:exception`.

## Completed
- [x] 1.1 pricing-v2-guard: v2 shape `satisfies PricingApi`, legacy `client.model.list` rejected, `gpt-5.6-sol` formula, `method_missing` visible, source guard — `OpencodeClient` import from `@opencode-ai/sdk/v2/client`, `ModelV2Info` from `@opencode-ai/sdk/v2/types`
- [x] 1.2 pricing.ts: structural `v2.model.list` via `Parameters<OpencodeClient["v2"]["model"]["list"]>` minimal Pick (biome-ignore one-liner to preserve budget), `method_missing` throw, no `onPricingFirstFill`; `project.ts` + `reconcile.ts` v2 typing; never `invalidateAllUsage`
- [x] 1.3 first-fill: `onPricingFirstFill` exactly-once empty→non-empty, no callback on empty/repeat/pre-available/disposed; `scheduleForcedReconcile` targeted to current root, handles no-root/disposal via shared timer; `tokenmeter.tsx` subscribes before `loadPricing` and disposes on lifecycle; preserves last-good and v2 path; no `invalidateAllUsage` or project-wide `session.list`
- [x] 2.1 PR2A schema — DDL/WAL/user_version=1 clean-break, fingerprint deterministic, read baseline, uninvoked (N/A runtime) — 7 pass

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | Triangulate | Refactor |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/pricing-v2-guard.test.ts` | unit | N/A new | ✅ Written (satisfies + legacy fail) | ✅ Passed (6 pass) | ✅ 2 cases (formula + source guard) | ✅ clean |
| 1.2 | `src/tokenmeter/pricing.ts` | unit | ✅ 11 pass `cost-fallback.test.ts` before edit | ✅ Written (legacy rejected) | ✅ Passed (v2 list + location) | ✅ formula non-tier + method_missing | ✅ clean |
| 1.3 | `test/pricing-first-fill.test.ts` | integration | ✅ 17 pass PR1A before edit | ✅ Written → `scheduleForcedReconcile not found` fail | ✅ Passed (4 pass, 24 expects) | ✅ empty→non-empty, repeat/dispose/pre-available, targeted no-root, wiring | ✅ clean |
| 2.1 | `test/session-totals.test.ts` | unit | ✅ 290 pass before | ✅ Written (no module fail) | ✅ Passed 7/46 | ✅ fresh/legacy/idempotent/fingerprint | ✅ clean |

## Work Unit Evidence (PR1A)
| Evidence | Value |
|----------|-------|
| Focused test | `bun test ./test/pricing-v2-guard.test.ts ./test/cost-fallback.test.ts` → 17 pass, 113 expects |
| Typecheck | `bun run typecheck` → exit 0 |
| Build | `bun run scripts/build.ts` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Biome check | `bun run biome:check` → 0 errors, 34 warnings (toggle.test.ts only) |
| Runtime harness | `bun test` + `test:dist` bundle proof; no probe |
| Rollback | `src/tokenmeter/pricing.ts`, `src/tokenmeter/reconcile.ts`, `src/tokenmeter/project.ts`, `src/tokenmeter.tsx`, `test/pricing-v2-guard.test.ts`, `test/cost-fallback.test.ts` |

## Work Unit Evidence (PR1B)
| Evidence | Value |
|----------|-------|
| Focused test | `bun test ./test/pricing-first-fill.test.ts` → 4 pass, 24 expects — RED `scheduleForcedReconcile not found` 1 fail, GREEN 4 pass |
| Full suite | `bun test` → 290 pass, 0 fail, 8358 expects |
| Typecheck | `bun run typecheck` → exit 0 |
| Biome check | `bun run biome:check` → 0 errors, 34 warnings (toggle only, untouched) |
| Build | `bun run build` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Runtime harness | `bun test` + `test:dist`; no probe, no `invalidateAllUsage`, no `session.list(10000)` |
| Rollback | `src/tokenmeter/pricing.ts` (onPricingFirstFill + notify + clear reset + load prevSize), `src/tokenmeter/reconcile.ts` (getCurrentRoot + scheduleForcedReconcile + dispose clears root/timer), `src/tokenmeter.tsx` (subscribe before load + dispose), `test/pricing-first-fill.test.ts` |

## Budget
PR1A ~280, PR1B ~354, PR2A 393 (138+255) vs d812e2e ≤400 (+7 tasks/progress=400) — focused 7/46, full 297/0 8404e, typecheck 0, biome 0e34w, build ok, dist 15/15, runtime N/A uninvoked, rollback session-totals.ts+test; each ≤400, no exception, no minification, no legacy.

## Recovery for PR1B
Source commits: `1982bee` (first-fill hunks) and `fdbe526` (structural v2 typing fix). Restored on PR1A v2 contract via `git show 1982bee -- <path>` for `pricing.ts`/`reconcile.ts`/`tokenmeter.tsx`/`test/pricing-first-fill.test.ts` hunks, preserving `Parameters<OpencodeClient["v2"]["model"]["list"]>` line with `biome-ignore format`. Verified with `bun test test/pricing-first-fill.test.ts` + `biome:check` + `typecheck` + `test:dist`.

## Next
PR2 schema (Unit 2 base=PR1B `02-schema`), then PR3–PR5. Preserve untracked `design.md`, `exploration.md`, `specs/session-aggregate-cache/spec.md` unchanged. No dist staging.
