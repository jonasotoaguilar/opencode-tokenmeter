/**
 * Browser data aggregation for cross-project browser.
 * - First paint from project.list + current pin only (fast path in dialog).
 * - Async aggregation with concurrency 3-4, per-request timeouts, and
 *   pagination guards (unchanged cursor / empty / 10k). One project failure
 *   never freezes the dialog.
 * - Safe directory only: rejects "/", homedir, path.parse(x).root, and never
 *   falls back to host cwd for another project. If no safe directory, the
 *   project is listed without calling session.list (live zero, deleted only).
 * - Prefers v2.session.list({project}) without directory when available
 *   (avoids host plugin load for "/"). Browse list uses V2 ONLY; project
 *   detail falls back to safe directory with pagination.
 */

export { withConcurrency } from "./concurrency"
export {
  BROWSER_CONCURRENCY,
  BROWSER_SESSION_LIMIT,
  FETCH_TIMEOUT_MS,
  PAGE_SIZE,
} from "./constants"
export {
  resolveBrowseDirectory,
  resolveDirectory,
  resolveSafeDirectory,
  resolveSafeWorktree,
} from "./directories"
export { isSafeDirectory } from "./is-safe-directory"
export { loadBrowserProjects } from "./projects"
export {
  fetchSessionsForBrowse,
  fetchSessionsForProject,
} from "./session-source"
export { withTimeout } from "./timeout"
export type { BrowserApi, BrowserProject, RawProject } from "./types"
