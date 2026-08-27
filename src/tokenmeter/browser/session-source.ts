import type { ProjectSessionLike } from "../types"
import type { BrowserApi } from "./types"

export async function fetchSessionsForBrowse(
  _api: BrowserApi,
  _projectID: string,
): Promise<ProjectSessionLike[]> {
  return []
}

export async function fetchSessionsForProject(
  _api: BrowserApi,
  _projectID: string,
  _directory: string,
  _currentID: string | null,
): Promise<ProjectSessionLike[]> {
  return []
}
