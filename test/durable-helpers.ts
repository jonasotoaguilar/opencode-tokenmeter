import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProjectSessionLike } from "../src/tokenmeter/types"

export const tmpDurable = () => mkdtempSync(join(tmpdir(), "dur-t-"))
export const dbPathFor = (dir: string) => join(dir, "checkpoints.sqlite")
export const sess = (
  id: string,
  projectID: string,
  tokens: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  },
  cost = 0,
  extra: Partial<ProjectSessionLike> = {},
): ProjectSessionLike => ({
  id,
  projectID,
  cost,
  tokens: {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: tokens.cache,
  },
  ...extra,
})
