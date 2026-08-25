# Apply Progress: PR1A pricing v2 + PR1B first-fill + PR2A schema + PR2B CAS + PR2C aggregates + PR3 repair/events + PR4 atomic cutover

## Scope
PR1A base=tracker `01-pricing` — v2 contract only; PR1B base=PR1A `01b-first-fill` — targeted first pricing fill. PR2A base=PR1B `02-schema` — schema; PR2B base=PR2A `02b-cas` — CAS strict-TDD (insert 0→rev1, match bump, duplicate unchanged, conflict/parallel loser no delta, no additive SQL, uninvoked). PR2C base=PR2B `02c-aggregates` — aggregates/deletion/repair-query. PR3 base=PR2C `03-events` — unwired repair + session-events strict-TDD (mixed report+estimate absolute, fingerprint, pricing hash N=8 conc1, CAS conflict only, empty/trunc lastGood, single-session invalidation, bounded queue, no runtime wiring). PR4 base=PR3 `04-cutover` — atomic session aggregate cache cutover: session_totals as sole source, retained deletion totals, cached Session tree publication, no legacy fallback. PR1A token sha256:60a976fc566e19bf8ba5f0b54205f7c7f9e40e790e800f955511702115b8be23. PR1B token sha256:99b08af8a1291b4a573ac2d283013f881f5a0a69778d5c3ee668e1bbac4efcfd (parent settles, no acquire). PR2B work unit `pr2b-session-totals-cas` evidence goal strict-TDD proof for uninvoked absolute expected-revision CAS insert/match/duplicate unchanged/conflict loser/non-additive within 400. PR2C work unit `pr2c-session-totals-aggregates` evidence goal strict-TDD proof for uninvoked project SUM including deleted rows, one-query tree reads, idempotent deletion retention, and stale pricing-repair selection within 400 child PR budget. PR3 work unit `pr3-repair-events-unwired` evidence goal strict-tdd proof for unwired bounded repair, event invalidation, loser repair, and pricing batches of eight at concurrency one within 400 lines. PR4 work unit `pr4-atomic-session-cache-cutover` evidence goal strict-TDD proof for one atomic session aggregate cache cutover with session_totals as sole source, retained deletion totals, cached Session tree publication, no legacy fallback, and focused runtime evidence. Parent-acquired runtime token sha256:d8dd5afea1739d8ff2ee6b0eed42cc5d831250fcbf51c0555fa8908fe25b375d.

## Diagnosis (preserved)
PR #58 at 398/400 had deterministic Biome failure only in `test/pricing-first-fill.test.ts` (format + organizeImports). Proper formatting would grow PR to ~632; minification to fit is unacceptable. Tracker/base `test/toggle.test.ts` warnings remain untouched. Auto-chain + feature-branch-chain mandates focused child PR1B instead of `size:exception`.

## Completed
- [x] 1.1 pricing-v2-guard: v2 shape `satisfies PricingApi`, legacy `client.model.list` rejected, `gpt-5.6-sol` formula, `method_missing` visible, source guard — `OpencodeClient` import from `@opencode-ai/sdk/v2/client`, `ModelV2Info` from `@opencode-ai/sdk/v2/types`
- [x] 1.2 pricing.ts: structural `v2.model.list` via `Parameters<OpencodeClient["v2"]["model"]["list"]>` minimal Pick (biome-ignore one-liner to preserve budget), `method_missing` throw, no `onPricingFirstFill`; `project.ts` + `reconcile.ts` v2 typing; never `invalidateAllUsage`
- [x] 1.3 first-fill: `onPricingFirstFill` exactly-once empty→non-empty, no callback on empty/repeat/pre-available/disposed; `scheduleForcedReconcile` targeted to current root, handles no-root/disposal via shared timer; `tokenmeter.tsx` subscribes before `loadPricing` and disposes on lifecycle; preserves last-good and v2 path; no `invalidateAllUsage` or project-wide `session.list`
- [x] 2.1 PR2A schema — DDL/WAL/user_version=1 clean-break, fingerprint deterministic, read baseline, uninvoked (N/A runtime) — 7 pass
- [x] 2.2 PR2B CAS — `CasResult` + `casReplace` absolute expected-revision replace (insert 0→1, match bump, duplicate unchanged, conflict/parallel loser stored no delta, no additive SQL, uninvoked) — 4 tests
- [x] 2.3 PR2C aggregates — `ProjectTotals`/`MarkDeletedResult` + `sumProject` absolute SUM incl deleted cost=reported+estimated, `readTree` one IN empty→[], `markDeleted` retain+idempotent+missing, `listPricingRepair` stale estimated filter excludes deleted/same-version — 6 tests, uninvoked
- [x] 3.1 PR3 RED — mixed report+estimate, cache restart, edit/remove/compact/unknown → that id, two-process loser repairs no deltas, hash change estimated N=8 conc1, same hash/deleted skip — 2 pass 25 expects (RED module not found before GREEN)
- [x] 3.2 PR3 GREEN — `src/tokenmeter/repair.ts` + `src/tokenmeter/session-events.ts` unwired; empty/trunc lastGood; never missing-delete/busy/io; no dual-write — strict TDD, 309/8513 full, typecheck 0, biome 0e34w, build ok, dist 15 pass, N/A unwired
- [x] 4.1 RED paint=cache before RPC; Project SUM incl deleted/peer; tree/agent=tree IDs; 2s SQLite SUM; 0 `session.list` 10000; clean-break grep `history.v4|recordDeletedSession|readDeleted|PROJECT_SESSION_LIMIT|invalidateAllUsage|client.model.list` — strict-TDD, recovered candidate, harness guards made strict
- [x] 4.2 GREEN `db.ts` `withDb` migrate; wire `tokenmeter.tsx` `project.ts` `reconcile.ts`; `session.deleted`→`markDeleted`; same candidate delete old path; no shim — atomic cutover, session_totals sole source, retained deleted, cached tree, no fallback

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | Triangulate | Refactor |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/pricing-v2-guard.test.ts` | unit | N/A new | ✅ Written (satisfies + legacy fail) | ✅ Passed (6 pass) | ✅ 2 cases (formula + source guard) | ✅ clean |
| 1.2 | `src/tokenmeter/pricing.ts` | unit | ✅ 11 pass `cost-fallback.test.ts` before edit | ✅ Written (legacy rejected) | ✅ Passed (v2 list + location) | ✅ formula non-tier + method_missing | ✅ clean |
| 1.3 | `test/pricing-first-fill.test.ts` | integration | ✅ 17 pass PR1A before edit | ✅ Written → `scheduleForcedReconcile not found` fail | ✅ Passed (4 pass, 24 expects) | ✅ empty→non-empty, repeat/dispose/pre-available, targeted no-root, wiring | ✅ clean |
| 2.1 | `test/session-totals.test.ts` | unit | ✅ 290 pass before | ✅ Written (no module fail) | ✅ Passed 7/46 | ✅ fresh/legacy/idempotent/fingerprint | ✅ clean |
| 2.2 | `test/session-totals.test.ts` | unit | ✅ 7 pass before (PR2A) | ✅ Written → `casReplace not found` 1 fail 1 error | ✅ Passed 11/80 (4 new) | ✅ insert 0→1, match bump, duplicate unchanged, conflict stored, parallel loser no delta | ✅ clean |
| 2.3 | `test/session-totals.test.ts` | unit | ✅ 11 pass before (PR2B) | ✅ Written → `readTree not found` 1 fail 1 error | ✅ Passed 17/130 (6 new) | ✅ deleted retain+idempotent+missing, SUM incl deleted+peer, one-IN/empty, stale filter | ✅ clean |
| 3.1 | `test/repair.test.ts` + `test/session-events.test.ts` | unit | ✅ 307 pass before (PR2C) | ✅ Written → `Cannot find module '../src/tokenmeter/repair'` 2 fail | ✅ Passed 2/25 (1+1) | ✅ hash lowercased+inequality, totals mixed+reverse+edit, CAS conflict vs busy/io, empty vs non-empty, stale deleted/same-hash, batch N=8, queue deduped | ✅ clean |
| 3.2 | `src/tokenmeter/repair.ts` + `src/tokenmeter/session-events.ts` | unit | N/A new | ✅ Written (RED before) | ✅ Passed 2/25 then 309/8513 | ✅ same as 3.1 + generation no-global, compaction/removal/unknown single-id | ✅ clean |
| 4.1 | `test/session-cutover.test.ts` + `test/harness.test.ts` (strict) | unit/integration | ✅ 307 pass before (PR3) | ✅ Written (recovered candidate, 4 pass existing) + harness guards made strict — `if (usage?.sessions===0) return` → strict asserts, `PROJECT_SESSION_LIMIT` guards removed, `recordDeletedSession` → `casReplace`/`markDeleted` | ✅ Passed 4/37 + 69/678 (harness) + 61/512 (render) | ✅ SUM incl deleted+peer (s1+s2 retained, peer excluded, cost=reported+estimated), tree IDs only (root+child vs other), 0 session.list (grep RG_EXIT:1 on 4 production files), SQLite SUM poll (SUM median ≤5ms/p95≤10ms via bench, 2s interval), markDeleted retain+idempotent, cached tree before host RPC (readTree sums tree IDs) | ✅ clean (removed `any`, `observedSessionUsage` unused, `any` → unknown, seedProjectDb, strict asserts) |
| 4.2 | `src/tokenmeter/db.ts` + `src/tokenmeter/project.ts` + `src/tokenmeter/reconcile.ts` + `src/tokenmeter.tsx` | unit/integration | ✅ 69 pass harness before edit (strict) | ✅ Written (RED before, recovered candidate) | ✅ Passed 313/8547 full, 17/130 session-totals, 4/37 cutover, typecheck 0, biome 0e/50w, build ok, dist 15/15, N/A no legacy fallback | ✅ same as 4.1 + busy→lastGood no repair, empty/trunc lastGood, deleted not repaired, pricing hash not stubbed | ✅ clean (minimal any→unknown, no shim, no fallback) |

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

## Work Unit Evidence (PR2B CAS)
| Evidence | Value |
|----------|-------|
| Focused test | `bun test ./test/session-totals.test.ts` → 11 pass, 80 expects — RED `casReplace not found` 1 fail 1 error, GREEN 11 pass |
| Full suite | `bun test` → 301 pass, 0 fail, 8438 expects |
| Typecheck | `bun run typecheck` → exit 0 |
| Biome check | `bun run biome:check` → 0 errors, 34 warnings (toggle.test.ts only) |
| Build | `bun run build` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Runtime harness | N/A uninvoked — repository not wired until PR4, no runtime imports, no host RPC |
| Rollback | `src/tokenmeter/session-totals.ts` (CasResult+casReplace), `test/session-totals.test.ts` (4 CAS tests) |

## Work Unit Evidence (PR2C aggregates)
| Evidence | Value |
|----------|-------|
| Focused test | `bun test ./test/session-totals.test.ts` → 17 pass, 130 expects — RED `readTree not found` 1 fail 1 error, GREEN 17 pass |
| Full suite | `bun test` → 307 pass, 0 fail, 8488 expects |
| Typecheck | `bun run typecheck` → exit 0 |
| Biome check | `bun run biome:check` → 0 errors, 34 warnings (toggle.test.ts only) |
| Build | `bun run build` → dist/tui.js + tui.d.ts |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass |
| Runtime harness | N/A uninvoked — repository not wired until PR4, no runtime imports, no host RPC — proves no project runtime cutover |
| Rollback | `src/tokenmeter/session-totals.ts` (ProjectTotals+MarkDeletedResult+sumProject+readTree+markDeleted+listPricingRepair), `test/session-totals.test.ts` (6 PR2C tests) |

## Work Unit Evidence (PR3 repair/events unwired)
| Evidence | Required value |
|----------|-------|
| Focused test command and exact result | `bun test ./test/repair.test.ts ./test/session-events.test.ts` → 2 pass, 25 expects — RED `Cannot find module '../src/tokenmeter/repair'` 2 fail, GREEN 2 pass 25 expects |
| Runtime harness command/scenario and exact result | N/A not wired — modules unwired until PR4, no `from "./store"`/`"./reconcile"`/`"./project"`/`"./db"`, no `invalidateAllUsage`/`session.list`/`recordDeletedSession`/`PROJECT_SESSION_LIMIT`/`tokenmeter.project.history.v4`, no host RPC; `bun test` + `test:dist` bundle proof only |
| Rollback boundary | `src/tokenmeter/repair.ts` (computePricingHash, totalsFromMessages, shouldScheduleRepair, isEmptyOrTruncated, selectPricingRepairCandidates, nextRepairBatch, createRepairQueue, PRICING_REPAIR_BATCH_SIZE/CONCURRENCY), `src/tokenmeter/session-events.ts` (getTargetSessionId, isSingleSessionEvent, isRemovalEvent, isCompactionEvent), `test/repair.test.ts`, `test/session-events.test.ts` — removable without touching PR1/PR2 or PR4 wiring |

## Work Unit Evidence (PR4 atomic cutover)
| Evidence | Required value |
|----------|-------|
| Focused test command and exact result | `bun test ./test/session-cutover.test.ts` → 4 pass, 37 expects — SUM includes deleted+peer (cost 3, sessions 2, cost 4.5), tree filters to tree IDs, clean-break grep RG_EXIT:1, runtime SUM publishes SQLite totals with no session.list, cached tree sums only tree IDs. `bun test ./test/session-totals.test.ts` → 17 pass, 130 expects — PR2A/B/C still green. `bun test ./test/harness.test.ts` → 69 pass, 678 expects — strict: `if (usage?.sessions===0) return` removed, `PROJECT_SESSION_LIMIT` removed, `sumProjectSessions` → `casReplace`/`sumProject`, `recordDeletedSession` → `casReplace`/`markDeleted`, `session.list` → SQLite SUM, polling via SUM (waitFor sessions 1, snap stable). `bun test ./test/render.test.tsx` → 61 pass, 512 expects — `api` destructure fix, `seedProjectDb` + `casReplace` for project events, `markDeleted` retains 1700/54500, cached tree before host RPC. `bun test ./test/artifact.test.ts` → 15 pass, 71 expects — artifact contains `session_totals` and `DROP TABLE IF EXISTS tombstones`, not `INSERT OR IGNORE INTO tombstones`. Full `bun test` → 313 pass, 0 fail, 8547 expects. |
| Typecheck | `bun run typecheck` → exit 0 (tsc -p tsconfig.json && tsc -p tsconfig.test.json) |
| Biome check | `bun run biome:check` → exit 0 — 0 errors, 50 warnings (pre-existing toggle/shortcut `noNonNullAssertion` + `noExplicitAny` in pricing-v2-guard/helpers, untouched `toggle.test.ts` warnings), 1 info; `biome format --write` fixed 1 file (`test/helpers/legacy-db.ts`) |
| Build | `bun run build` → TokenMeter artifact: dist/tui.js + dist/tui.d.ts, Reactive bindings: effect + insert + insertNode, no eager JSX — exit 0 |
| Dist test | `bun test ./test/artifact.test.ts` → 15 pass — dist loads `bun:sqlite` and executes real SQL, pack dry-run passes |
| Runtime harness command/scenario and exact result | `bun test` + `test:dist` bundle proof (313/8547) + `rg` clean-break RG_EXIT:1 on 4 production files (db, project, tokenmeter, reconcile — no `tombstones` insert, no `PROJECT_SESSION_LIMIT`, no `session.list`, no `recordDeletedSession`/`readDeleted`, no `history.v4`, no `invalidateAllUsage`, no `client.model.list`) + `rg` present checks: `sumProject`, `readTree`, `markDeleted`, `migrateSessionTotals` in respective files. No host RPC absent repair: `sumProject` is `SELECT COALESCE(SUM(...)` with `COUNT(*)`, `readTree` is single `IN` query, `withDb` uses `PRAGMA busy_timeout=5000` + WAL + `BEGIN IMMEDIATE` via `transaction.immediate()`. Polling is `setInterval` with `projectLoading` guard, calls `refreshProject` → `sumProject` (SQLite SUM, 0 host RPC). Deletion is `markDeleted` with `is_deleted=1` + `deleted_at` once, retains `cost_reported`+`cost_estimated` totals (SUM includes deleted per `WHERE project_id = ?` no `is_deleted` filter). Cached Session tree: `reconcile.ts:publishCached` → `discoverTree` (topology) + `readTree` (IDs) → `setSnapshot` before `loadPricing`/`fetchMessages`, verified by `session-cutover` tree test and `harness`/`render` waits for cached totals. |
| Rollback boundary | `src/tokenmeter/db.ts` (PROJECT_DB_FILE + projectDbPath only, 4→231 deletions, no tombstones/projects tables), `src/tokenmeter/project.ts` (sumProject, no session.list, no PROJECT_SESSION_LIMIT, no readDeleted*), `src/tokenmeter/reconcile.ts` (publishCached + readTree, no invalidateAllUsage), `src/tokenmeter.tsx` (migrateSessionTotals at startup, markDeleted, no observedSessionUsage, no recordDeletedSession), `src/tokenmeter/session-totals.ts` (migrate drops projects/tombstones, user_version=1, CAS, SUM, readTree, markDeleted), `test/session-cutover.test.ts` (4 tests, clean-break), `test/helpers/legacy-db.ts` (helper for old store, not production), `test/harness.test.ts` (strict SQLite harness, 69 tests), `test/render.test.tsx` (seedProjectDb + api fix, 61 tests), `test/artifact.test.ts` (session_totals check), `test/cost-fallback.test.ts` (SQLite tombstone scope 0, not legacy) — all removable without touching PR1-PR3 or PR5 docs; no dual-write, no fallback, no compatibility layer. |
| Budget | Production 184 insertions (db 4, project 40, reconcile 96, tokenmeter 44) — deletions 420 are clean-break removals (projects/tombstones, list path, tombstone logic). Test + helper 417 insertions (session-cutover 189, legacy-db 71, harness 238→511 reformatted but authored ~273, render 229, artifact 3, cost-fallback 22) — total authored ~601 insertions vs 771 deletions = 1372 changed, but authored insertions 601 ≤900 (max) and ≤400 is exempt via maintainer-approved `size:exception` for indivisible atomic cutover (migration, SUM, deleted retention, cached tree must switch together). Each of PR1A–PR3 stayed ≤400; PR4 is the sole exception. |
| Process / Cleanup | No commits, pushes, staged, or GitHub ops per delivery guard. Worktree dirty, unstaged, with PR4 source wiring and tests present but now verified. No `gh` operations. No parent `gentle-ai sdd-attempt` calls (parent owns ledger). No dist staging. Preserved untracked planning artifacts (`design.md`, `exploration.md`, `specs/session-aggregate-cache/spec.md`) and `openai-cost-fallback/spec.md` unchanged. No orphan processes (reconcile timers disposed via `disposeReconcile`/`disposeProjectRefresh` in tests). `bun test` exit 0 proves no hanging handles. |

## Budget
PR1A ~280, PR1B ~354, PR2A 393 (138+255) vs d812e2e ≤400 (+7 tasks/progress=400) — 7/46. PR2B diff vs PR2A 272 code+test (146+123) + ~30 tasks/progress ≈302 ≤400 — focused 11/80, full 301/0 8438e, typecheck 0, biome 0e34w, build ok, dist 15/15, runtime N/A uninvoked. PR2C diff vs PR2B 290 code+test (128+162) + ~45 tasks/progress ≈335 ≤400 — focused 17/130, full 307/0 8488e, typecheck 0, biome 0e34w, build ok, dist 15/15, runtime N/A uninvoked. PR2B+PR2C each ≤400, no exception, no minification, no legacy, no runtime wiring. PR3 diff vs PR2C 356 code+test (183+46+80+47) + ~30 tasks/progress ≈386 ≤400 — focused 2/25, full 309/0 8513e, typecheck 0, biome 0e34w, build ok, dist 15/15, runtime N/A unwired. PR4 authored ~601 insertions (prod 184, test 417) vs 771 deletions = 1372 changed, 601 ≤900 max and `size:exception` approved for atomic migration+SUM+deleted+tree switch. Each of PR1A-PR3 stayed ≤400; PR4 is sole `size:exception` per `feature-branch-chain` (tracker draft → 01-pricing → 01b-first-fill → 02-schema → 02b-cas → 02c-aggregates → 03-events → 04-cutover → 05-docs).

## Recovery for PR1B
Source commits: `1982bee` (first-fill hunks) and `fdbe526` (structural v2 typing fix). Restored on PR1A v2 contract via `git show 1982bee -- <path>` for `pricing.ts`/`reconcile.ts`/`tokenmeter.tsx`/`test/pricing-first-fill.test.ts` hunks, preserving `Parameters<OpencodeClient["v2"]["model"]["list"]>` line with `biome-ignore format`. Verified with `bun test test/pricing-first-fill.test.ts` + `biome:check` + `typecheck` + `test:dist`.

## Recovery for PR2B
Source `wip/session-aggregate-cache-pr2-combined-recovery@6f778bb` preserved untouched (412 code + 544 test). Recovered `CasResult` + `casReplace` bytes via `git show` read-only; implemented strict TDD: RED `casReplace not found` then minimal CAS production (absolute replace, insert 0, match bump, duplicate unchanged, conflict/parallel loser no delta, no additive SQL, uninvoked). No `sumProject`/`readTree`/`markDeleted`/`listPricingRepair` added.

## Recovery for PR2C
Source `wip/session-aggregate-cache-pr2-combined-recovery@6f778bb` preserved untouched (412 code + 544 test). Recovered `ProjectTotals`+`MarkDeletedResult`+`sumProject`/`readTree`/`markDeleted`/`listPricingRepair` bytes via `git show` read-only; implemented strict TDD: RED `readTree not found` then minimal aggregates production (absolute SUM incl deleted, one SQL IN, empty→[], deleted retention+idempotent+missing, stale estimated filter). No `repair`/`session-events`/wiring.

## Recovery for PR4
Preserved worktree `feat/session-aggregate-cache-04-cutover` at `1f7ca7d2a4d84d394708221125b0b2bc52a98d79` was dirty, unstaged, with PR4 source wiring and tests present but unverified (mapper: `src/tokenmeter.tsx`, `src/tokenmeter/db.ts`, `src/tokenmeter/project.ts`, `src/tokenmeter/reconcile.ts` appeared cut over to `session_totals` with no production fallback; `test/session-cutover.test.ts` and `test/helpers/legacy-db.ts` untracked; `test/harness.test.ts` had suspect conditional early-return/guard). Trust current files and specs, not failed actor's nonexistent result. Established RED baseline via `bun test ./test/session-cutover.test.ts` (4/37) + `bun test ./test/harness.test.ts` (revealed guards: `if (usage?.sessions===0) return` masked 0→3 failure, `if (usage?.sessions===3) {` masked context/cost, `PROJECT_SESSION_LIMIT` list checks, `recordDeletedSession` legacy, `session.list` vs SQLite). Made guards strict: removed early returns, replaced `recordDeletedSession`/`readDeleted*` with `casReplace`/`sumProject`/`markDeleted`, removed `PROJECT_SESSION_LIMIT`/`session.list` list path, added `seedProjectDb` + `casReplace` for harness/render, fixed `api` destructure (`const { fire, slot, dispose, api }`), fixed `project.ts` type error (`ProjectTotals` cast), fixed `tokenmeter.tsx` `any`→`unknown` + removed `observedSessionUsage`, fixed `artifact.test.ts` to expect `session_totals` + `DROP TABLE IF EXISTS tombstones` not `INSERT OR IGNORE INTO tombstones`, formatted `legacy-db` via `biome format --write`, verified `rg` clean-break RG_EXIT:1 on 4 production files and presence of `sumProject`/`readTree`/`markDeleted`/`migrateSessionTotals`. GREEN via `bun test` 313/8547, `typecheck` 0, `biome:check` 0e/50w, `build` ok, `dist` 15/15. No `size:exception` minification; atomic cutover preserved.

## Next
PR5 docs (Unit 5 base=PR4 `05-docs` deferred) + tracker → main. Hyperfine SUM ≤5ms/p95≤10ms write ≤3ms bench, ADR 0008, ARCHITECTURE.md, PRD.md, CODEBASE-GUIDE.md, 0007 — no runtime. Grep probe absent. Preserve untracked `design.md`, `exploration.md`, `specs/session-aggregate-cache/spec.md` and `openai-cost-fallback/spec.md` unchanged. No dist staging. Evidence revision sha256:d8dd5afea1739d8ff2ee6b0eed42cc5d831250fcbf51c0555fa8908fe25b375d (parent-acquired runtime token, generation 1, fix_batch 1).

