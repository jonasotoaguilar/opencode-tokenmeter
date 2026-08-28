# ADR-0010: Eligible-only root without V2 presence probes

## Status

Accepted

## Date

2026-08-28

## Deciders

jonasotoaguilar

## Context

ADR-0009 added V2 `session.list({project, limit:1})` presence probes (30 calls at N=28) after sync eligibility. Real OpenCode 1.18.23 via `createOpencodeServer`/`createOpencodeClient` proves V2 is **instance-scoped**: `client.v2.session.list({project, limit:1})` returns `{"data":{"data":[...],"cursor":...}}` only when client's directory header equals the target project's worktree; otherwise `data:[]`. With browser client bound to current project's directory, every non-current probe returned 0 → final filtered to `Current Project` only. Canary "solo muestra el current project" confirmed. Requirement is to hide deleted/non-Git/root/direct-HOME, **not** zero-session projects. Probing adds N calls for no product value and is not authoritative cross-project.

## Decision

Remove the root presence/refinement pass entirely. Root list is deterministic:

- `project.list` (1) + `project.current({directory: host})` (1) = **2** backend calls, no per-project probes.
- Sync `isEligibleProjectPath` (exists, directory, `.git`, not `/`/HOME/`~/foo`, `isSafeDirectory`+`parse(root)` guard) is the sole filter; zero-session eligible projects remain visible.
- One usable render after eligibility, ≤100ms, ≤2 `dialog.replace` (loading→eligible), generation-guarded `BrowserActivity` with `onClose/withSuppress` preserved for Close/Escape.
- Project detail keeps **legacy** `session.list({directory: safeWorktree, scope:"project", limit: PROJECT_SESSION_LIMIT})` via `resolveSafeWorktree` — proven to return non-current sessions when supplied the project's worktree, regardless of client directory. `session-source.ts` reverted from V2 `project` param to directory path; no dual truth.

## Consequences

- Cross-project browse is no longer instance-scoped; multiple eligible projects always visible after idle; selecting non-current loads its sessions.
- Backend load 30→2 at N=28; no timeout/concurrency for root; `test/perf-browser-first-paint.test.ts` updated to assert 2 calls, ≤100ms usable, ≤2 replaces.
- V2 remains only where proven authoritative (`v2.model.list` for pricing fallback). Pricing path unchanged.
- Coverage stays presentation-only over existing aggregation; heading contract `Current Project`/`Projects` unchanged.

## Rejected

- **Tri-state retain-on-unknown** (previous commit 45c5f51): unwrapped nested `SessionsResponse` correctly and retained on `null`, but still paid N probes for non-authoritative data and still hid successful empty (now required to remain). Rejected for complexity without durable value.
- **Direct-HOME child / root flashing**: still excluded synchronously.

## References

- `src/tokenmeter/browser/projects-dialog.tsx` eligible-only, no `probeHasSessionsV2`/`withConcurrency`
- `src/tokenmeter/browser/session-source.ts` directory-scoped legacy fetch via `resolveSafeWorktree`
- `src/tokenmeter/browser/project-detail.ts` legacy `session.list({directory})` (unchanged)
- `test/browser-projects-v2-lifecycle.test.ts` root eligible + detail integration (2 calls, Close/Escape)
- `test/perf-browser-first-paint.test.ts` 2-call guard

## Supersedes

- ADR-0009 — corrects 58→30 claim; root is now 58→2, V2 probes deleted; ADR-0009 marked Superseded.
