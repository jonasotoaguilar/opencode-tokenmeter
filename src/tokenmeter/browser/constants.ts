/**
 * Shared browser constants.
 * Centralizes pagination and timeout values so aggregator,
 * session-source and dialog layers share a single authority.
 */

export const BROWSER_SESSION_LIMIT = 10_000
export const PAGE_SIZE = 200
export const FETCH_TIMEOUT_MS = 4000
export const BROWSER_CONCURRENCY = 4
export const BROWSER_COMMAND_NAME = "tokenmeter.browser"
export const BROWSER_COMMAND_TITLE = "TokenMeter: Browse Usage"
export const BROWSER_COMMAND_DESC = "Browse usage across known projects"
export const NAV = "────────"
