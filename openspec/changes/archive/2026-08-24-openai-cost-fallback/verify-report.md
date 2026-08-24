```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3ec6495210a7a2d41f331e1f5a252a35667f15592165bb67bacabfe5b6cf87d0
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 10/10
test_command: bun run coverage
test_exit_code: 0
test_output_hash: sha256:59c0ce01cac2d0ffcee9cba7095eeb1164f4a9af08ff7515fa0bdf62974d948e
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:5c70b20e82c1b02b5957e744f9850f8c82dd26faa68d485d4f089511abf152f7
```

## Verification Report

**Change**: openai-cost-fallback
**Version**: N/A
**Mode**: Strict TDD
**Bound after remediation**: failed evidence `sha256:89a4df5d5ce213686be30fc04bad83808a5c809d534b712763c044bf577856cf` preserved; correction evidence `sha256:d092a8ae70756bda6e02f031cf4ab328f9796a164a8926ae30597a2b99d940c8`; parent attempt `sha256:331c0780ec67833b5206737b6cc7b9d93930d81f87a122461014b8776303d595` (parent settles; no attempt commands).
**Unit4 candidate**: 398/400 authored add+del excluding untracked planning artifacts and this verify-report.

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 12 |
| Tasks complete | 12 |
| Tasks incomplete | 0 |

All 12 tasks are checked in `tasks.md`. Apply-progress reports Units 1A+1B+2+3+4 plus the identity-recovery remediation complete. Full artifacts exist (proposal, spec, design, tasks, apply-progress). This report replaces the prior FAIL envelope; the historical failed revision is not erased.

### Build & Tests Execution
**Build**: ✅ Passed
```text
bun run typecheck → exit 0
  output_hash sha256:ae3c6e20716587b7a7ec69244d8865889d22195f013af8ad4798c1fc21608040
  $ tsc -p tsconfig.json && tsc -p tsconfig.test.json

bun run build → exit 0
  output_hash sha256:5c70b20e82c1b02b5957e744f9850f8c82dd26faa68d485d4f089511abf152f7
  TokenMeter artifact + declaration; reactive bindings: effect + insert + insertNode, no eager JSX
```

**Tests**: ✅ 280 passed / ❌ 0 failed / ⚠️ 0 skipped (full `bun test`)
```text
Focused: bun test ./test/cost-fallback.test.ts → 11 pass, 0 fail, 99 expects [289ms]
  output_hash sha256:c5f3ca7ee33b6159e4c1052c48a8ef3c7b6da47dbe39a7830f0e8a216f261ef8

Harness+cost order: bun test test/harness.test.ts test/cost-fallback.test.ts → 80 pass, 0 fail, 789 expects [982ms]

CI coverage: bun run coverage → 265 pass, 0 fail, 8251 expects [19.18s] across 9 files
  (excludes test/artifact.test.ts; this is the exact CI "Unit tests with coverage" command)
  output_hash sha256:59c0ce01cac2d0ffcee9cba7095eeb1164f4a9af08ff7515fa0bdf62974d948e

Full: bun test → 280 pass, 0 fail, 8320 expects [19.18s] across 10 files
```

**Coverage**: 99.02% lines / 99.17% funcs (all files) / no project threshold configured → ✅ Above
Changed-file detail is in Strict TDD sections below.

**Biome (narrow check-only)**: ⚠️ 9 files, 0 errors, 4 warnings, exit 0
```text
biome check src/tokenmeter/math.ts src/tokenmeter/db.ts src/tokenmeter.tsx
  src/tokenmeter/pricing.ts src/tokenmeter/store.ts src/tokenmeter/reconcile.ts
  src/tokenmeter/project.ts src/tokenmeter/types.ts test/cost-fallback.test.ts
→ Checked 9 files in 17ms. No fixes applied. exit 0
  4× lint/style/noNonNullAssertion in test/cost-fallback.test.ts:617,623,630,633
```

### Spec Compliance Matrix
Counted from `openspec/changes/openai-cost-fallback/specs/openai-cost-fallback/spec.md`: **6 requirements**, **10 scenarios**.

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Fallback Trigger Gates | Gates pass | `test/cost-fallback.test.ts` > Unit 1A gates + Unit 2 reconcile 0.0125 | ✅ COMPLIANT |
| Fallback Trigger Gates | Non-zero reported cost | `test/cost-fallback.test.ts` > RC(0.123) + usageOf reported | ✅ COMPLIANT |
| Fallback Trigger Gates | Zero cost with other gate miss | `test/cost-fallback.test.ts` > anthropic / T0 / unknown / no pricing | ✅ COMPLIANT |
| Reported Cost Authority | Reported wins and replaces | `test/cost-fallback.test.ts` > 1B refill M2.02 + 4.1 payload 0.02 vs observed 0.05 + remed 0.01 | ✅ COMPLIANT |
| Pricing Source And Formula | Public list formula | `test/cost-fallback.test.ts` > estimateCost 0.01005 + reconcile 0.0125 | ✅ COMPLIANT |
| Pricing Source And Formula | Forbidden sources | source: no static table / outbound / `config.providers`; cache miss → 0 | ✅ COMPLIANT |
| Safe-Zero And Normalization | Unresolved cases stay zero | `test/cost-fallback.test.ts` > 1A safe-zero + 4.1 null/unknown/non-openai | ✅ COMPLIANT |
| Safe-Zero And Normalization | Trim match without alias | `test/cost-fallback.test.ts` > ` openai `/` gpt-4o ` match; suffix miss | ✅ COMPLIANT |
| Idempotency And Propagation | Repeat replace and propagate | `test/cost-fallback.test.ts` > 1B .16 repeat + 3 tombstone exclude + 4.2 once | ✅ COMPLIANT |
| Tokens Provenance Restart And Containment | Tokens restart and recover | `test/cost-fallback.test.ts` > remediation pre-pricing 0→0.0125 + Unit 2 Session publish + Unit 4 deleted numeric | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant

Independent post-remediation probe (production modules, not a checked-in extra test):

```text
1_before: usage.cost=0 source=reported
2_stored_zero: observed=0 tokens input=1000 output=500
3_pricing_without_remap: observed=0 (map not republished)
4_usageOf_after: cost=0.0125 source=estimated
5_after_remap: observed=0.0125 tokens unchanged
6_repeat: 0.0125
7_reported_wins: reported 0.01 replaces estimate
8_zero_or_est_cannot_overwrite: observed stays 0.01
9_unrelated_archive: 0.09
```

The prior CRITICAL is gone: `upsertCostIdentity` now blocks only non-zero reported from an estimated replacement (`existing.source === "reported" && existing.cost !== 0 && incoming.source === "estimated"`), and zero never overwrites non-zero. After `setPricing` plus a Session republish (`usageOf` + map write), the same message/session identity adopts 0.0125. Repeat is idempotent. Later nonzero reported wins even if lower. Unrelated archived estimates survive.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Fallback Trigger Gates | ✅ Implemented | `isOpenAI` trim+fold; `cost !== 0` short-circuit; billable sum; exact `pricingKey` |
| Reported Cost Authority | ✅ Implemented | `resolveCost` reported-first; identity blocks only non-zero reported vs estimated; `resolveEntry` raw then observed |
| Pricing Source And Formula | ✅ Implemented | `loadPricing` → `client.model.list({location:{directory}})` only; `/ 1_000_000`; first non-tier finite quartet |
| Safe-Zero And Normalization | ✅ Implemented | try/catch never throw; exact key; suffix/alias not stripped |
| Idempotency And Propagation | ✅ Implemented | identity Σ; tombstone exclude-before-sum; `INSERT OR IGNORE`; groups use `observedSessionUsage` |
| Tokens Provenance Restart And Containment | ✅ Implemented | tokens stay max; no estimate flag/badge; deleted stores numeric only; live Session re-estimates after republish |

SDK types verified against installed `@opencode-ai/plugin` ^1.18.14 / `@opencode-ai/sdk`:
- `GlobalSession.model?: { id, providerID, variant? }` (`types.gen.d.ts:1790` / `:1819`)
- `ModelRef` (`:2387`), `ModelCost` (`:4012`), `ModelV2Info.cost: Array<ModelCost>` (`:4024` / `:4052`)
- `V2ModelListResponses` (`:10302`) `data: Array<ModelV2Info>`
- `Model.list({ location?: { directory?: string } })` (`sdk.gen.d.ts:1781`)

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| `model.list` only | ✅ Yes | No static table, no `config.providers`, no outbound fetch |
| Exact `${providerID}:${modelID}` trim+lower | ✅ Yes | `pricingKey` |
| Per-id `MoneyRow` map | ✅ Yes | `sessionCostIdentity` + `rememberCosts` / `syncIdentityFromMap` |
| Zero-reported replaceable by later estimate | ✅ Yes | remediating `upsertCostIdentity` guard |
| `resolveEntry` raw / observed / estimate | ✅ Yes | tokens max; cost authority as designed |
| Project-scoped tombstones exclude before sum | ✅ Yes | `readDeletedSessionIDs` + `sumProjectSessions` |
| One in-flight + cooldown ≥ `PROJECT_POLL_DELAY` | ✅ Yes | 2000 ms; tests assert coalesced calls + retain |
| Atomic replace on successful array | ✅ Yes | new Map then clear+copy; non-array retains LKG |
| Reconcile / `refreshProject` await `loadPricing` | ✅ Yes | both await then proceed |
| First non-empty cache → one reconcile + one project refresh | ❌ No | `loadPricing` success only mutates the map |
| Fire-and-forget startup warm | ⚠️ Partial | implemented as designed; see Issues |
| Docs/ADR | ✅ Yes | `docs/adr/0007-openai-cost-fallback.md` linked from ARCHITECTURE, CODEBASE-GUIDE, mental-model |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | apply-progress TDD Cycle Evidence table present for 1A–4.2 + remed |
| All tasks have tests | ✅ | 12/12 tasks name `test/cost-fallback.test.ts` (or types/docs with covering suite) |
| RED confirmed (tests exist) | ✅ | `test/cost-fallback.test.ts` exists; 11 tests / 99 expects |
| GREEN confirmed (tests pass) | ✅ | 11/11 focused pass; 280/280 full pass |
| Triangulation adequate | ✅ | remediating test covers pre-pricing zero → estimate, repeat, reported wins, archive survive |
| Safety Net for modified files | ✅ | apply-progress records suite counts before each GREEN; files were existing except new `pricing.ts` / ADR |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 11 | 1 (`test/cost-fallback.test.ts`) | bun test |
| Integration | 0 dedicated (temp SQLite + fake client inside unit file) | 0 | bun:sqlite in-process |
| E2E | 0 | 0 | not installed |
| **Total** | **11** (change-focused) / **280** repo | **1** change file / **10** repo | bun test |

---

### Changed File Coverage
| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `src/tokenmeter/math.ts` | 95.02% | n/a (funcs 92.31%) | L107, L137-147, L437-438 | ✅ Excellent |
| `src/tokenmeter/pricing.ts` | 97.98% | n/a (funcs 100%) | L57-58 | ✅ Excellent |
| `src/tokenmeter/store.ts` | 100% | n/a (funcs 100%) | — | ✅ Excellent |
| `src/tokenmeter/db.ts` | 100% | n/a (funcs 100%) | — | ✅ Excellent |
| `src/tokenmeter.tsx` | 100% | n/a (funcs 96.15%) | — | ✅ Excellent |
| `src/tokenmeter/reconcile.ts` | 97.79% | n/a (funcs 100%) | L141, L158 | ✅ Excellent |
| `src/tokenmeter/project.ts` | 100% | n/a (funcs 100%) | — | ✅ Excellent |
| `src/tokenmeter/types.ts` | n/a | n/a | types only | ➖ |

**Average changed file coverage**: ~98.4% lines (files with line data)

---

### Assertion Quality
**Assertion quality**: ✅ All assertions verify real behavior

Change tests assert formula values (0.01005, 0.0125, 0.16, 0.01, 0.09), sources, tombstone membership, exclude-before-sum tokens, identity recovery, and lifecycle once-only persistence. `not.toThrow()` calls are paired with value asserts. No tautologies, ghost loops, or smoke-only checks. Remediation `!` after `usageOf` is immediately followed by cost/source asserts.

---

### Quality Metrics
**Linter**: ⚠️ 4 warnings (noNonNullAssertion in remediating test) / 0 errors
**Type Checker**: ✅ No errors (`tsc` both projects)

### Mutation Testing Evidence

```json
{
  "schema": "gentle-ai.mutation-evidence/v1",
  "change_name": "openai-cost-fallback",
  "campaign_id": "cam-20260824T193240Z-3ec64952",
  "campaign_type": "full",
  "generated_at": "2026-08-24T19:32:40Z",
  "candidate_fingerprint": "sha256:5cf59c800696b823d7c9ec1c60089863d1b481fc386acc813066cd9ae22ce2b2",
  "candidate_binding_strength": "strong",
  "scope_fingerprint": "sha256:ae9bf6d991b8942543c09b0b2276eb97bdb30e22c31d0f84601b0b11ab2e67e8",
  "baseline_suite_hash": "sha256:59c0ce01cac2d0ffcee9cba7095eeb1164f4a9af08ff7515fa0bdf62974d948e",
  "baseline_hash_kind": "opaque",
  "tool": { "name": "stryker", "version": "unavailable" },
  "config_fingerprint": "sha256:unavailable",
  "harness_disposition": "reused",
  "repro": {
    "cwd": ".",
    "command": "bunx --no-install stryker --version",
    "seed": null,
    "timeout_seconds": 30
  },
  "counts": { "total": 0, "killed": 0, "survived": 0, "timeout": 0, "error": 0 },
  "counts_source": "executed",
  "survivors": [],
  "selected_mutant_ids": [],
  "incremental_eligible": false,
  "prior_evidence_revision": "sha256:c3fd30f63663357dca6fcda313df24668936219970fce8523e57e59b97bfab02",
  "cache_manifest": [],
  "invalidation_reasons": [
    {
      "kind": "invalidated",
      "reason": "prior_unavailable",
      "prior_evidence_revision": "sha256:c3fd30f63663357dca6fcda313df24668936219970fce8523e57e59b97bfab02"
    }
  ],
  "status": "unavailable",
  "error": "error: Could not find an existing 'stryker' binary to run. Stopping because --no-install was passed."
}
```

No Stryker/mewt binary, lockfile package, or project config is present. One bounded probe only; nothing was installed. Prior mutation block was `unavailable`; this campaign is a new full attempt that remains unavailable.

### Issues Found
**CRITICAL**: None

**WARNING**:
1. **Fire-and-forget pricing warm vs payload-only deletion (explicit re-evaluation).** `tokenmeter.tsx` starts `void loadPricing(api).catch(() => {})` and `session.deleted` calls `recordDeletedSession` synchronously. `resolveEntry` can estimate a payload-only OpenAI row only if `getPricing` is already populated. If delete wins the race, stored cost is `0`; tombstone `INSERT OR IGNORE` plus “deleted keeps stored numeric only” makes that `0` permanent. Normative reading: this is **not CRITICAL**. Safe-zero requires `0` when exact-model pricing is not yet in cache; the spec’s deleted path is “via observed usage” (an already-applied estimate still persists); live reconcile/Project **await** `loadPricing` and recover. It **is WARNING** because the design/task claimed the warm “ensures” payload-only estimate, there is no delete-time await and no retry after first-fill, and a cold payload-only delete can undercount Project forever. Severity: **WARNING**. Contract-compliant; retained.
2. **Design first-fill refresh is missing.** Design: first non-empty cache → one `scheduleReconcile` + one `scheduleProjectRefresh`. `loadPricing` success only mutates the map. Independent probe step 3 shows Session observed cost stays `0` until a republish remaps via `usageOf`. Spec scenario is compliant because `WHEN Session publishes` now adopts the estimate (probe steps 4–5; remediating test). Project refresh already awaits `loadPricing`. This remains a design deviation, not a spec break.

**SUGGESTION**:
1. Replace remediating-test non-null assertions (`usageOf(...)!`) with explicit null checks to clear the four Biome warnings.
2. On first successful pricing fill, schedule one reconcile + one project refresh (closes WARNING 2).
3. If payload-only delete must estimate, join the in-flight `loadPricing` before `recordDeletedSession` (closes WARNING 1).

### Verdict
PASS WITH WARNINGS
Prior CRITICAL identity freeze is remediating and covered: pre-pricing stored zero recovers to 0.0125 on Session republish, repeat is idempotent, later nonzero reported wins, zero cannot overwrite nonzero, unrelated archives survive. Two WARNINGs remain (payload-delete race; missing first-fill schedule). Commands are green; 6/6 requirements and 10/10 scenarios pass; mutation unavailable.
