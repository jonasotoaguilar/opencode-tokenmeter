# Archive Report: openai-cost-fallback

**Change**: `openai-cost-fallback`
**Archived**: 2026-08-24
**Artifact store**: openspec
**Archive path**: `openspec/changes/archive/2026-08-24-openai-cost-fallback/`
**Base**: `origin/main ca8397c32e460b754003b90c7510fa4e29daaab9`
**Branch**: `chore/archive-openai-cost-fallback` (archive-only, worktree `issue-27-openai-cost-fallback`)
**Final status**: SUCCESS — cycle complete, shipped via stacked-to-main, post-remediation verify PASS WITH WARNINGS

## Gates

| Gate | Result | Evidence |
|------|--------|----------|
| Native Review Receipt Gate | N/A — `reviewGate` structurally absent | RDD off/unmanaged; ordinary repository policy applies. No review artifacts exist; nothing was read, nothing blocked. `nextRecommended=archive; dependencies.archive: ready`. |
| Task Completion Gate | PASS | Persisted `tasks.md` (now archived): 12/12 implementation tasks checked (`[x]`), 0 unchecked. No stale-checkbox reconciliation needed; `sdd-apply` marked all tasks. Structured status: `12/12 tasks; verify all_done; blockedReasons empty`. |
| CRITICAL verification gate | PASS | Fresh post-remediation `verify-report.md` verdict `pass_with_warnings`, `critical_findings: 0`, `blockers: 0`. Initial final verify had CRITICAL zero-identity freeze; maintainer-authorized reset + bound remediation resolved it; re-verify attest is the final evidence (see Final State). |
| Action Context Guard | PASS | No `workspace-planning` mode, no `allowedEditRoots` restrictions; archive confined to `openspec/`. |

## Final State (at close)

Per Final-State Authority hierarchy (1 native review authority → 2 persisted tasks artifact → 3 explicit final-state handoff in launch prompt → 4 intermediate snapshots `verify-report`/`apply-progress`). The handoff facts below outrank stale intermediate snapshots; snapshot claims are attributed with source and time.

### Delivery and closure

- **Stacked-to-main PRs merged to `origin/main`** (per handoff, outranks `apply-progress` parent pointers):
  - #47 Unit1A `2f25084e271a0b7d78d6e6ab4947e20aea23bf4b`
  - #48 Unit1B `b67612162153cd0e09ee312b4371c108058c2b98`
  - #50 Unit2 `efd52be5474e886a384db58fcbd2814fdc045135` (included CI snapshot-isolation remediation)
  - #51 Unit3 `a2d262ec48a158d13ea8bf9515d024d574c64098`
  - #52 Unit4 + zero-recovery remediation `ca8397c32e460b754003b90c7510fa4e29daaab9` (current `origin/main` HEAD)
- **Issue #27 CLOSED**; labels `bug` + `status:approved` remain (handoff).
- **ADR-0007** `docs/adr/0007-openai-cost-fallback.md` accepted and already merged/linked from `ARCHITECTURE.md` / `docs/CODEBASE-GUIDE.md` / `docs/codebase/mental-model.md` (handoff).

### Requirements and verification (final)

- **Requirements**: 6/6 compliant, **Scenarios**: 10/10 COMPLIANT (per fresh `verify-report.md` Spec Compliance Matrix, counted from `spec.md`: 6 requirements / 10 scenarios).
- **Evidence revision**: `sha256:3ec6495210a7a2d41f331e1f5a252a35667f15592165bb67bacabfe5b6cf87d0`.
- **Build**: `bun run typecheck` exit 0, `bun run build` exit 0 (`sha256:5c70b20e` artifact), Biome check pass on 9 files with 4 style warnings (`noNonNullAssertion` in test).
- **Tests (final, per handoff + verify-report — handoff is highest-ranked for counts after remediation)**:
  - Focused `test/cost-fallback.test.ts`: 11 pass / 99 expects
  - Harness+cost `test/harness.test.ts + test/cost-fallback.test.ts`: 80 pass
  - Coverage suite `bun run coverage`: 265 pass / 8251 expects
  - Full `bun test`: 280 pass / 8320 expects / 0 failed / 0 skipped
  - Typecheck / build / Biome: pass
- **Mutation**: unavailable — no installed tool (`bunx --no-install stryker --version` not found; `verify-report.md` reports `status: unavailable`).

### Remediation lineage (why CRITICAL is now PASS)

- Initial final verify (before reset) found **CRITICAL zero identity freeze**: session identity stored unresolved `0` as `reported`, blocking later estimate replacement, so `observed` stayed `0`. Preserved as `failed evidence sha256:89a4df5d5ce213686be30fc04bad83808a5c809d534b712763c044bf577856cf` with parent attempt `sha256:331c0780...` (verify-report Bound after remediation note).
- Maintainer authorized reset; bound remediation changed `src/tokenmeter/store.ts` identity admission: **unresolved reported-zero is replaceable by a later estimate; non-zero reported still wins; zero cannot overwrite non-zero** (guard `existing.source === "reported" && existing.cost !== 0 && incoming.source === "estimated"` blocks only non-zero reported vs estimated).
- Fresh post-remediation verify re-probed: pre-pricing `0` → `0.0125` after `setPricing` + Session republish via `usageOf`, repeat idempotent, later non-zero reported `0.01` wins even if lower, unrelated archives (`0.09`) survive. Verdict upgraded to **PASS WITH WARNINGS**.

### Warnings carried (non-blocking, intentional)

Per handoff and `verify-report.md` Issues (WARNING, not CRITICAL):

1. **Payload-only delete race with startup warm**: `tokenmeter.tsx` fires `void loadPricing(api).catch(()=>{})` fire-and-forget; `session.deleted` calls `recordDeletedSession` synchronously. `resolveEntry` can estimate a payload-only OpenAI row only if `getPricing` is already populated; if delete wins the race, stored cost is `0` and tombstone `INSERT OR IGNORE` + "deleted keeps stored numeric only" makes it permanent. Spec-compliant safe-zero, but can undercount Project.

2. **First pricing fill does not proactively schedule Session/Project refresh**: `loadPricing` success only mutates the map. Session recovers on next republish (`usageOf` + map write); Project awaits `loadPricing` in `refreshProject`. Design claimed first-fill triggers one `scheduleReconcile` + one `scheduleProjectRefresh`; code does not.

Both are **WARNING** (contract-compliant, fail-closed to `0`). No CRITICAL remains. Archive proceeds under ordinary policy; no override needed for these.

### Snapshot attribution note

`apply-progress.md` cumulative sections (Unit4 + remediations) record intermediate suite counts (e.g., 276→280 passes during fixes). The fresh `verify-report.md` (evidence revision `3ec6495...`) is the final attested state and supersedes earlier counts. Launch prompt final evidence (11/99, 80, 265/8251, 280/8320) matches the verify-report and is carried as final numbers per Final-State Authority rank 3 > rank 4.

## Specs Synced (Step 2)

Main spec store had no prior `openai-cost-fallback` domain; delta was a full spec, copied mechanically (shell `cp` → temp file → `diff -r` readback → `mv`), never through model Read/Write:

| Domain | Action | Readback |
|--------|--------|----------|
| openai-cost-fallback | Created `openspec/specs/openai-cost-fallback/spec.md` | `diff -r` empty (byte-identical) |

No `ADDED`/`MODIFIED`/`REMOVED`/`RENAMED` delta headers present — the delta spec is a full spec (Purpose + 6 Requirements / 10 Scenarios). No destructive merge; `rules.archive` ("Warn before merging destructive deltas") required no warning. Verbatim `diff -r` output appears in Mechanical Copy Contract below.

## Archive Move (Step 3)

- Pre-move recursive snapshot taken (`mktemp -d` + `cp -R openspec/changes/openai-cost-fallback → $snapshot_root/source`).
- Staged files were git-tracked (`apply-progress.md`, `tasks.md`); untracked planning artifacts (`proposal.md`, `design.md`, `exploration.md`, `specs/.../spec.md`, `verify-report.md`) moved via filesystem `mv` through `git mv` fallback.
- `git mv openspec/changes/openai-cost-fallback → openspec/changes/archive/2026-08-24-openai-cost-fallback` succeeded; source directory confirmed gone (`[ -e openspec/changes/openai-cost-fallback ]` false).
- **MANDATORY readback**: `diff -r $snapshot/source openspec/changes/archive/2026-08-24-openai-cost-fallback` → **empty output (byte-identical)**. Verbatim output in Mechanical Copy Contract below.

## Archive Contents

- `proposal.md` ✅ (67 lines, untracked → archived)
- `specs/openai-cost-fallback/spec.md` ✅ (93 lines, delta → archived + canonical copy)
- `design.md` ✅ (98 lines)
- `tasks.md` ✅ (51 lines, 12/12 tasks complete, git-tracked rename)
- `verify-report.md` ✅ (247 lines, verdict pass_with_warnings, evidence rev `3ec6495...`)
- `apply-progress.md` ✅ (121 lines, cumulative Units 1A–4 + remediations, git-tracked rename)
- `exploration.md` ✅ (252 lines)
- `archive-report.md` (this file, additive)

Persisted `tasks.md` has no unchecked implementation tasks; no stale-checkbox reconciliation was performed.

## Mechanical Copy Contract — Verbatim Readbacks

### Spec sync (Step 2)

```
cp openspec/changes/openai-cost-fallback/specs/openai-cost-fallback/spec.md → openspec/specs/openai-cost-fallback/.spec.md.XXXXXX
diff -r source vs temp: (no output)
DIFF_EMPTY_PASS: source vs temp identical
mv temp → openspec/specs/openai-cost-fallback/spec.md
diff -r source vs target: (no output)
DIFF_EMPTY_PASS: source vs target identical
```

### Archive move (Step 3)

```
cp -R openspec/changes/openai-cost-fallback → /tmp/sdd-archive.XXXXXX/source
git mv openspec/changes/openai-cost-fallback openspec/changes/archive/2026-08-24-openai-cost-fallback
diff -r /tmp/sdd-archive.XXXXXX/source openspec/changes/archive/2026-08-24-openai-cost-fallback: (no output)
DIFF_EMPTY_PASS: archive identical to snapshot
```

Empty `diff -r` is the only passing evidence; any difference would have FAILED the phase. A skipped or missing `diff -r` also FAILS — not applicable; both readbacks were executed and captured.

## Verification (Step 4)

- [x] Main spec updated correctly: `openspec/specs/openai-cost-fallback/spec.md` exists and is byte-identical to archived delta (structural readback: `diff -r` empty).
- [x] Change folder moved to archive: `openspec/changes/archive/2026-08-24-openai-cost-fallback/` contains all 7 artifacts.
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report, apply-progress, exploration).
- [x] Archived `tasks.md` has no unchecked tasks (12/12 `[x]`).
- [x] Active changes directory no longer has this change (`openspec/changes/openai-cost-fallback` absent).
- [x] Verbatim `diff -r` readbacks included and empty (see above).

## Source of Truth Updated

The following spec now reflects the new behavior:

- `openspec/specs/openai-cost-fallback/spec.md` (new domain, 93 lines, 6 requirements / 10 scenarios)

No other `openspec/specs/` files were modified; existing domains `tokenmeter-command-palette`, `tokenmeter-panel-ui`, `tokenmeter-settings` untouched.

## Intentional-With-Warnings

None. This archive is clean; the two WARNINGs above are carried from the fresh verify-report as non-blocking, documented warnings, not archive-time overrides. No user-approved partial archive, no stale-checkbox reconciliation, no destructive merge.

## Changed / Untracked Paths and Line Budget (archive-only PR)

**Worktree**: `chore/archive-openai-cost-fallback` vs `origin/main ca8397c`
**Mode**: archive-only — no production/tests changes per instruction. `Do not commit, push, create PR, merge, or modify production/tests.` This report is for PR description / line-budget review.

### Git status (porcelain, at archive time)

```
R  openspec/changes/openai-cost-fallback/apply-progress.md -> openspec/changes/archive/2026-08-24-openai-cost-fallback/apply-progress.md
R  openspec/changes/openai-cost-fallback/tasks.md -> openspec/changes/archive/2026-08-24-openai-cost-fallback/tasks.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/design.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/exploration.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/proposal.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/specs/openai-cost-fallback/spec.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/verify-report.md
?? openspec/specs/openai-cost-fallback/spec.md
?? openspec/changes/archive/2026-08-24-openai-cost-fallback/archive-report.md (this file, additive, not in snapshot diff)
```

### Diff stat vs `origin/main`

- Staged renames (0 insertions, byte-identical moves): 2 files
  - `openspec/changes/{openai-cost-fallback => archive/2026-08-24-openai-cost-fallback}/apply-progress.md | 0`
  - `openspec/changes/{openai-cost-fallback => archive/2026-08-24-openai-cost-fallback}/tasks.md | 0`

- Untracked additions (will appear as `A` once staged; excluded from `git diff origin/main --numstat` until added):
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/design.md` — 98 lines
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/exploration.md` — 252 lines
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/proposal.md` — 67 lines
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/specs/openai-cost-fallback/spec.md` — 93 lines
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/verify-report.md` — 247 lines
  - `openspec/specs/openai-cost-fallback/spec.md` — 93 lines (canonical sync, byte-identical to archived spec)
  - `openspec/changes/archive/2026-08-24-openai-cost-fallback/archive-report.md` — this file (~240 lines)

**Line budget**: staged diff is `0` lines (renames only); untracked archive + canonical total is **~850 lines** before this report (93×2 + 98 + 252 + 67 + 247 = 850). With this report, total archive-only addition is ~1090 lines. All are docs/specs audit trail — no production code, no tests, no build. Well within archive PR expectations; no 400-line production review budget applies (archive is mechanical, not code review).

**Structural readbacks**:
- Canonical spec readback: `diff -r archived-spec canonical-spec` → empty (verified).
- Archive report readback: additive-only, excluded from snapshot `diff -r` per Mechanical Copy Contract.
- Source path verification: `openspec/changes/openai-cost-fallback` no longer exists (required by archive convention) ✅.

## Audit Trail Notes

- Active `openspec/changes/` no longer contains `openai-cost-fallback` (moved to `archive/2026-08-24-openai-cost-fallback`).
- No `openspec/` files outside the change folder were modified except the new canonical spec `openspec/specs/openai-cost-fallback/spec.md` (mechanical copy).
- No production code (`src/`, `test/`, `docs/adr/`, etc.) modified in this archive branch; implementation is already on `origin/main` via PRs #47, #48, #50, #51, #52.
- `openspec/specs/openai-cost-fallback/spec.md` and `openspec/changes/archive/2026-08-24-openai-cost-fallback/` remain unstaged/untracked (working tree only) for the orchestrator/user to stage and push as an archive-only PR. Do not commit/push automatically per instruction.
- Archive is an AUDIT TRAIL — never delete or modify archived changes.

## SDD Cycle Complete

The change has been fully planned, implemented, verified (post-remediation PASS WITH WARNINGS), and archived. Ready for the next change.

## References

- Issue: #27 (closed, `bug` + `status:approved`)
- PRs: #47 (Unit1A), #48 (Unit1B), #50 (Unit2), #51 (Unit3), #52 (Unit4 + zero-recovery)
- Evidence revision: `sha256:3ec6495210a7a2d41f331e1f5a252a35667f15592165bb67bacabfe5b6cf87d0`
- Verify report: `openspec/changes/archive/2026-08-24-openai-cost-fallback/verify-report.md`
- Canonical spec: `openspec/specs/openai-cost-fallback/spec.md`
- ADR: `docs/adr/0007-openai-cost-fallback.md` (already on main, linked from ARCHITECTURE)
