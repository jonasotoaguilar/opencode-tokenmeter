/**
 * Union reconciliation of live sessions and durable checkpoints.
 *
 * For each session ID, merge live/checkpoint monotonically and count exactly
 * once. Checkpoint-only sessions remain historical; duplicate live rows count
 * once; reappearing sessions update the same row.
 * Cost provenance is preserved (reported/observed wins over estimated) rather
 * than blind max; observed is the complete message-derived aggregate.
 */

import { resolveCost } from "../math"
import type { ProjectSessionLike, ProjectUsage } from "../types"
import type { CheckpointRow } from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

function hasUsageRow(r: CheckpointRow): boolean {
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

function liveToRow(
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
  if (
    resolved.cost +
      input +
      output +
      reasoning +
      cacheRead +
      cacheWrite +
      context ===
    0
  )
    return null
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
    checkpointAt: 0,
    version: 1,
  }
}

function mergeCost(
  a: Pick<CheckpointRow, "cost" | "costSource">,
  b: Pick<CheckpointRow, "cost" | "costSource">,
): Pick<CheckpointRow, "cost" | "costSource"> {
  const isStrong = (x: Pick<CheckpointRow, "cost" | "costSource">) =>
    (x.costSource === "reported" || x.costSource === "observed") && x.cost !== 0
  const aStrong = isStrong(a)
  const bStrong = isStrong(b)
  if (aStrong && bStrong) return a.cost >= b.cost ? a : b
  if (aStrong) return a
  if (bStrong) return b
  return a.cost >= b.cost ? a : b
}

function mergeRows(a: CheckpointRow, b: CheckpointRow): CheckpointRow {
  const costMerged = mergeCost(a, b)
  const cacheRead = Math.max(a.cacheRead, b.cacheRead)
  const cacheWrite = Math.max(a.cacheWrite, b.cacheWrite)
  const cache = cacheRead + cacheWrite
  const input = Math.max(a.input, b.input)
  const output = Math.max(a.output, b.output)
  const reasoning = Math.max(a.reasoning, b.reasoning)
  const context = input + output + reasoning + cacheRead + cacheWrite
  if (cache !== cacheRead + cacheWrite)
    throw new Error("cache invariant violated")
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

/**
 * Union of live sessions and checkpoints by session identity.
 * - checkpoint-only counts once
 * - live + checkpoint merge monotonically and count once
 * - duplicate live rows count once
 */
export function reconcileProjectUsage(
  projectID: string,
  liveSessions: ProjectSessionLike[],
  checkpoints: Map<string, CheckpointRow>,
  alias?: string,
): ProjectUsage {
  const liveMap = new Map<string, CheckpointRow>()
  const seen = new Set<string>()
  const normAlias = alias ?? ""
  for (const s of liveSessions) {
    if (!s || typeof s.id !== "string" || !s.id) continue
    const pid = (s as unknown as { projectID?: unknown })?.projectID
    if (pid != null && pid !== "" && pid !== projectID) continue
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const row = liveToRow(s, normAlias)
    if (!row) continue
    row.projectID = projectID
    liveMap.set(s.id, row)
  }

  const allIds = new Set<string>([...liveMap.keys(), ...checkpoints.keys()])
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let context = 0
  let counted = 0

  for (const id of allIds) {
    const live = liveMap.get(id)
    const cp = checkpoints.get(id)
    let entry: CheckpointRow | null = null
    if (live && cp) entry = mergeRows(cp, live)
    else if (live) entry = live
    else if (cp) entry = cp
    if (!entry || !hasUsageRow(entry)) continue
    cost += entry.cost
    input += entry.input
    output += entry.output
    reasoning += entry.reasoning
    cacheRead += entry.cacheRead
    cacheWrite += entry.cacheWrite
    context += entry.context
    counted += 1
  }

  return {
    id: projectID,
    sessions: counted,
    cost,
    context,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache: cacheRead + cacheWrite,
  }
}
