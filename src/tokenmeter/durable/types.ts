export type CheckpointRow = {
  sessionID: string
  projectID: string
  projectAlias: string
  cost: number
  costSource: "reported" | "estimated" | "observed"
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
  context: number
  updatedAt: number
  checkpointAt: number
  version: number
}
