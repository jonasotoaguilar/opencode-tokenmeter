/**
 * Checkpoint merge helpers — per-field high-water with cost provenance.
 * Reported cost wins over estimated; otherwise max.
 */

import { resolveCost } from "../math"
import type { ProjectSessionLike, SessionUsage } from "../types"
import type { CheckpointRow } from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

export function hasUsageRow(r: CheckpointRow): boolean {
  return (
    r.cost +
      r.input +
      r.output +
      r.reasoning +
      r.cacheRead +
      r.cacheWrite +
      r.context >
    0
  )
}

export function entryFromSession(
  session: ProjectSessionLike,
  alias: string,
): CheckpointRow | null {
  const tokens = session.tokens
  const input = num(tokens?.input)
  const output = num(tokens?.output)
  const reasoning = num(tokens?.reasoning)
  const cacheRead = num(tokens?.cache?.read)
  const cacheWrite = num(tokens?.cache?.write)
  const rawCost = num(session.cost)
  const resolved = resolveCost({
    cost: rawCost,
    providerID: (session as unknown as { model?: { providerID?: unknown } })
      ?.model?.providerID,
    modelID: (session as unknown as { model?: { id?: unknown } })?.model?.id,
    tokens: { input, output, reasoning, cacheRead, cacheWrite },
  })
  const context = input + output + reasoning + cacheRead + cacheWrite
  const any =
    resolved.cost +
    input +
    output +
    reasoning +
    cacheRead +
    cacheWrite +
    context
  if (any === 0) return null
  const timeRaw = (
    session as unknown as { time?: { updated?: unknown; created?: unknown } }
  )?.time
  const updatedAt = num(timeRaw?.updated) || num(timeRaw?.created)
  return {
    sessionID: session.id,
    projectID: session.projectID,
    projectAlias: alias,
    cost: resolved.cost,
    costSource: resolved.source,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache: cacheRead + cacheWrite,
    context,
    updatedAt,
    checkpointAt: Date.now(),
    version: 1,
  }
}

export function observedToEntry(
  observed: SessionUsage,
  sessionID: string,
  projectID: string,
  alias: string,
): CheckpointRow | null {
  const cost = num(observed.cost)
  const input = num(observed.input)
  const output = num(observed.output)
  const reasoning = num(observed.reasoning)
  const cacheRead = num(observed.cacheRead)
  const cacheWrite = num(observed.cacheWrite)
  const cache = num(observed.cache)
  const context = num(observed.total)
  const any =
    cost + input + output + reasoning + cacheRead + cacheWrite + context
  if (any === 0) return null
  return {
    sessionID,
    projectID,
    projectAlias: alias,
    cost,
    costSource: cost !== 0 ? "reported" : "reported",
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache,
    context,
    updatedAt: 0,
    checkpointAt: Date.now(),
    version: 1,
  }
}

export function mergeCost(
  a: Pick<CheckpointRow, "cost" | "costSource">,
  b: Pick<CheckpointRow, "cost" | "costSource">,
): Pick<CheckpointRow, "cost" | "costSource"> {
  const aRep = a.costSource === "reported" && a.cost !== 0
  const bRep = b.costSource === "reported" && b.cost !== 0
  if (aRep && bRep) return a.cost >= b.cost ? a : b
  if (aRep) return a
  if (bRep) return b
  return a.cost >= b.cost ? a : b
}

export function mergeRows(a: CheckpointRow, b: CheckpointRow): CheckpointRow {
  const costMerged = mergeCost(a, b)
  const cacheRead = Math.max(a.cacheRead, b.cacheRead)
  const cacheWrite = Math.max(a.cacheWrite, b.cacheWrite)
  const cache = cacheRead + cacheWrite
  const input = Math.max(a.input, b.input)
  const output = Math.max(a.output, b.output)
  const reasoning = Math.max(a.reasoning, b.reasoning)
  const context = input + output + reasoning + cacheRead + cacheWrite
  // Invariant: cache must equal cacheRead + cacheWrite; context must equal sum
  if (cache !== cacheRead + cacheWrite)
    throw new Error("cache invariant violated")
  if (context !== input + output + reasoning + cacheRead + cacheWrite)
    throw new Error("context invariant violated")
  return {
    sessionID: a.sessionID,
    projectID: a.projectID,
    projectAlias: b.projectAlias || a.projectAlias,
    cost: costMerged.cost,
    costSource: costMerged.costSource,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache,
    context,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    checkpointAt: Math.max(a.checkpointAt, b.checkpointAt),
    version: 1,
  }
}

export function rowsEqual(a: CheckpointRow, b: CheckpointRow): boolean {
  return (
    a.cost === b.cost &&
    a.costSource === b.costSource &&
    a.input === b.input &&
    a.output === b.output &&
    a.reasoning === b.reasoning &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.cache === b.cache &&
    a.context === b.context &&
    a.updatedAt === b.updatedAt &&
    a.projectAlias === b.projectAlias
  )
}
