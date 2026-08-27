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
}

export function createBrowserActivity(api: BrowserDialogApi): BrowserActivity {
  const myGen = ++browserGen
  activeBrowserGen = myGen
  let closed = false
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
  return { isActive, deactivate, close }
}

/** Test-only: resets generation counters to isolate lifecycles. */
export function __resetBrowserActivityForTest(): void {
  browserGen = 0
  activeBrowserGen = 0
}
