/**
 * Browser dialog barrel.
 * Re-exports the split dialog layers so existing imports from
 * "./browser/dialog" continue to work without behavior change.
 */

export {
  BROWSER_COMMAND_DESC,
  BROWSER_COMMAND_NAME,
  BROWSER_COMMAND_TITLE,
} from "./constants"
export { showBrowserDialog } from "./projects-dialog"
export type { BrowserDialogApi } from "./types"
