/**
 * Browser barrel.
 * Public entry for the cross-project browser feature.
 */

export { withConcurrency } from "./concurrency"
export {
  BROWSER_COMMAND_DESC,
  BROWSER_COMMAND_NAME,
  BROWSER_COMMAND_TITLE,
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
export { withTimeout } from "./timeout"
export type {
  BrowserApi,
  BrowserProject,
  RawProject,
} from "./types"
