# ADR-0009: Eligible projects with V2 presence probes and provisional paint

## Status

Accepted

## Date

2026-08-27

## Deciders

jonasotoaguilar

## Context

The cross-project browser introduced in `v1.2.0..v1.3.0` initially listed every `project.list` entry and probed liveness with two sequential calls per project — `project.directories` to discover a safe worktree then `session.list({directory})` to check for sessions — plus a base `project.list` and `project.current`. At `N=28` that is `1 list + 1 current + 28 directories + 28 session.list(directory) = 58` backend calls, each gated by host directory resolution that can throw for another project's stale path ("/", deleted worktree, non-git folder). The provisional dialog also used only `isSafeDirectory` (traversal/root guard) so invalid, deleted, `~/foo`, or root-level projects flashed before the async probes removed them, and titles/categories still read legacy `Current`/`Others` while the spec required `Current Project`/`Projects` and `Current Session`/`Sessions` with count-only titles. The dialog closed and back-stack races were covered by generation guards, but the liveness probe still cost 2×N. Issue #111 authorizes a durable fix before `v1.3.0`.

## Decision

Keep the existing browser shell (`Projects` → `Project detail` → `Session detail` via ONE `api.ui.dialog.replace` with once-guarded close, provider/model breakdown sorted by spend) and add the smallest durable eligibility + probe chain:

- **Eligibility gate:** `src/tokenmeter/browser/eligibility.ts` (`isEligibleProjectPath`) sync-filters every candidate before any network call: `typeof string`, trimmed non-empty, `isSafeDirectory` (no `parse(root)` roots, no traversal), not a direct child of HOME (`dirname(normalize(p)) === normalize(homedir)`), `existsSync` + `statSync` isDirectory, `existsSync(join(p,".git"))`. Only eligible projects enter the provisional set; ineligible, invalid, deleted, non-git, or root-level (`/`, HOME, `~/foo`) entries never appear. Nested `~/projects/foo` stays eligible. Uses only sync `node:fs`/`node:os`/`node:path` — no git process per project.
- **Provisional then final:** `projects-dialog.tsx` paints provisional eligible rows immediately from `project.list` + `current` pin in ≤100 ms (observed ~40 ms poll) with categories `Current Project`/`Projects` and title count-only; async `probeHasSessionsV2` via `api.client.v2.session.list({project, limit:1})` then finalizes with `withConcurrency` (`BROWSER_CONCURRENCY` 4) + `withTimeout` (`FETCH_TIMEOUT_MS` 4s) + `browser-activity.ts` generation guard. Late probes cannot replace a navigated Project/Session detail or reopen a closed browser; `__back`/`__close` are idempotent and Back returns to that `projectID` without leaking stack entries.
- **V2 presence probes:** replace legacy `project.directories` + `session.list({directory})` with `api.client.v2.session.list({project, limit:1})` for browse liveness. At `N=28` this is `1 list + 1 current + 28 v2.session.list(project) = 30` calls — a measured 58→30 reduction, provisional ≤100 ms / final ≤900 ms / ≤3 replaces / no unhandled rejections, asserted in `test/perf-browser-first-paint.test.ts`. Browse uses V2-only; project detail may still fall back to safe directory with pagination guards where needed.
- **Headings:** `projects-dialog.tsx` → `Current Project` / `Projects`; `project-dialog.tsx` → `Current Session` / `Sessions`; titles remain count-only (`TokenMeter: Browse Usage (N)` where `N` is project count, `TokenMeter: {projectName} (N)` where `N` is root sessions, `TokenMeter: {sessionTitle}` with `★` pin) with no Overview tokens/cost duplication. `truncateToColumns`/`textColumns` still bound titles to one line and avoid `esc` collision.

## Consequences

- Invalid/deleted/non-git and root-level projects never flash; provisional and final sets share the same `isEligibleProjectPath` authority.
- First paint is non-blocking and usable in ≤100 ms before any probe completes; finalization is bounded, concurrent, and generation-guarded.
- Backend load drops 58→30 at `N=28`; per-request timeout and concurrency prevent one slow project from freezing the dialog.
- Heading contract matches spec and tests; `Current Project`/`Projects`/`Current Session`/`Sessions` are enforced by `perf-browser-first-paint` and `browser-dialogs-*` suites.
- No git subprocess, no new dependency, no second aggregation truth — browser remains presentation-only over `session.list` + deleted aggregate.

## Rejected

- **Legacy directory probes:** `project.directories` → `session.list({directory})` per project (2×N + 2 base) with `isSafeDirectory` provisional — rejected for double cost, stale-directory failures, and flashing ineligible rows. Superseded by V2 `session.list({project, limit:1})` + `eligibility.ts`.
- **Async eligibility per project:** `node:fs/promises` or `git rev-parse --is-inside-work-tree` per project — rejected for throughput and provisional latency; sync checks keep first paint ≤100 ms.

## References

- `src/tokenmeter/browser/eligibility.ts` `isEligibleProjectPath` (sync `existsSync`/`statSync`, `.git`, HOME-child, `isSafeDirectory`, `parse(root)`)
- `src/tokenmeter/browser/projects-dialog.tsx` `isEligibleProjectPath` provisional + `probeHasSessionsV2` via `api.client.v2.session.list({project, limit:1})` + categories `Current Project`/`Projects`, `withConcurrency`/`withTimeout`/`browser-activity.ts`
- `src/tokenmeter/browser/project-dialog.tsx` `Current Session`/`Sessions`
- `src/tokenmeter/browser/constants.ts` `BROWSER_CONCURRENCY` 4 / `FETCH_TIMEOUT_MS` 4000 / `BROWSER_SESSION_LIMIT` 10000
- `src/tokenmeter/browser/concurrency.ts` `withConcurrency`, `timeout.ts` `withTimeout`, `browser-activity.ts` generation guard
- `test/perf-browser-first-paint.test.ts` (30 V2 calls, ≤100 ms provisional / ≤900 ms final, eligibility filtering, no late-probe replacement)
- `test/browser-dialogs-navigation.test.ts` (Close idempotence, late async, heading categories)

## Supersedes

- None — new durable decision for the browser probe/eligibility path; does not supersede ADR-0008 (pricing) or ADR-0006 (SQLite).
