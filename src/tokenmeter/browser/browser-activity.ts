/**
 * Browser route activity lifecycle.
 * Single generation guard so a late background probe cannot
 * replace a navigated project/session detail or reopen a closed
 * browser. Back creates a fresh generation.
 */

import type { BrowserDialogApi } from "./types"

let browserGen = 0
let activeBrowserGen = 0

export type BrowserActivity = {
  /** True while this browser route is still the active one. */
  isActive: () => boolean
  /** Deactivate without clearing the dialog stack (navigate). */
  deactivate: () => void
  /** Idempotent close: deactivate and clear once. */
  close: () => void
  /** Host onClose: suppressed during content-update replaces. */
  onClose: () => void
  /** Run fn with onClose suppressed so replace-driven onClose is a no-op. */
  withSuppress: (fn: () => void) => void
}

export function createBrowserActivity(api: BrowserDialogApi): BrowserActivity {
  const myGen = ++browserGen
  activeBrowserGen = myGen
  let closed = false
  let suppress = false
  const isActive = (): boolean => !closed && activeBrowserGen === myGen
  const deactivate = (): void => {
    if (closed) return
    closed = true
    activeBrowserGen = 0
  }
  const close = (): void => {
    if (closed) return
    closed = true
    activeBrowserGen = 0
    api.ui.dialog.clear()
  }
  const onClose = (): void => {
    if (suppress) return
    close()
  }
  const withSuppress = (fn: () => void): void => {
    suppress = true
    try {
      fn()
    } finally {
      suppress = false
    }
  }
  return { isActive, deactivate, close, onClose, withSuppress }
}

/** Test-only: resets generation counters to isolate lifecycles. */
export function __resetBrowserActivityForTest(): void {
  browserGen = 0
  activeBrowserGen = 0
}
