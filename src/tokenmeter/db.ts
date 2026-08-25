/**
 * Plugin-owned SQLite persistence for Project totals.
 *
 * Project total is the SUM of session totals per project,
 * including retained deleted rows. File is tokenmeter.sqlite
 * inside the host state directory.
 */
import { join } from "node:path"

export const PROJECT_DB_FILE = "tokenmeter.sqlite"

export function projectDbPath(stateDir: string | undefined): string | null {
  if (!stateDir) return null
  return join(stateDir, PROJECT_DB_FILE)
}
