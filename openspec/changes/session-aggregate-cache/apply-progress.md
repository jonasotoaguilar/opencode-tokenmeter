# Apply Progress: PR1 pricing v2 first-fill

## Scope
PR1 base=feat/session-aggregate-cache `01-pricing` — v2 contract + first-fill; no tree invalidate

## Completed
- [x] 1.1 pricing-v2-guard: v2 shape, legacy rejected, gpt-5.6-sol formula, method_missing visible, source guard — import @opencode-ai/sdk/v2/types
- [x] 1.2 pricing.ts: structural v2.model.list via Parameters<OpencodeClient["v2"]["model"]["list"]> minimal Pick, method_missing, first-fill, cooldown, inflight — remediated
- [x] 1.3 pricing-first-fill + cost-fallback v2, tokenmeter subscribe→load, scheduleForcedReconcile only, store drop invalidateAllUsage, ADR revert, typecheck/build/dist

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | Triangulate | Refactor |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | pricing-v2-guard | unit | N/A new | ✅ 5 fail | ✅ 6 pass | ✅ 2 cases | ✅ clean |
| 1.2 | pricing.ts | unit | ✅ cost-fallback 11 pass | ✅ legacy fail | ✅ v2 pass | ✅ formula | ✅ clean |
| 1.3 | pricing-first-fill | integration | ✅ 3 fail | ✅ 3 pass | ✅ once/no-op/dispose | ✅ clean |

## Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused test | `bun test --cwd . ./test/pricing-v2-guard.test.ts ./test/pricing-first-fill.test.ts ./test/cost-fallback.test.ts` → 19 pass, 126 expects |
| Typecheck | `tsc -p tsconfig.json && tsc -p tsconfig.test.json` → exit 0 |
| Build | `bun run scripts/build.ts` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Runtime harness | `bun test` + `test:dist` real bundle proof; no probe |
| Rollback | `src/tokenmeter/pricing.ts`, `src/tokenmeter.tsx`, `src/tokenmeter/reconcile.ts`, `src/tokenmeter/project.ts`, `test/*` + tasks.md |

## Budget
Tracked 168 + new 190 + tasks 6 + this 32 = 398 <400 — remediation +2 minimal structural fix

## Next
PR2 schema
