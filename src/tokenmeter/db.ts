/**
 * Compatibility shim: legacy aggregate DB file retains the pre-durable
 * implementation for the migration bridge. All new persistence uses the
 * durable checkpoint store; this shim will be removed once the bridge
 * at `src/tokenmeter/project.ts` is finalized.
 */
export {
  PROJECT_DB_FILE,
  projectDbPath,
  readDeletedAggregate,
  readDeletedSessionIDs,
  recordDeletedSession,
} from "./legacy-db"
