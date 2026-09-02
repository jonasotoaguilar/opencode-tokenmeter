/**
 * Legacy path — migration source only.
 * The file `tokenmeter.sqlite` under `api.state.path.state` is obsolete
 * (tombstone/aggregate). This module owns only its path for one-time
 * migration into durable per-session checkpoints. No active readers/writers.
 */

import { join } from "node:path"

export const PROJECT_DB_FILE = "tokenmeter.sqlite"

export function projectDbPath(stateDir: string | undefined): string | null {
  if (!stateDir) return null
  return join(stateDir, PROJECT_DB_FILE)
}
