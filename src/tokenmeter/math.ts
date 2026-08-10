/**
 * Pure usage math for the TokenMeter sidebar: extraction of per-message
 * usage, per-session summation and per-project summation. Display formatting
 * lives in numbers.ts. No I/O and no state.
 *
 * Context semantics: each assistant message contributes one context snapshot
 * — provider-reported tokens.total when present, otherwise the fallback
 * input + output + reasoning + cacheRead + cacheWrite. A session's context
 * is the MAXIMUM snapshot observed across its current messages, so the
 * headline sums one snapshot per session and repeated messages with the same
 * input context (or retries/compaction) can never inflate or falsely drop
 * it. input/output/reasoning/cache/cost stay strictly cumulative and separate; the
 * snapshot's cache is never added a second time to the aggregate.
 *
 * Project context semantics: the session-level list payload carries no total,
 * so each session contributes input + raw output + raw reasoning — CACHE IS
 * EXCLUDED. Cache lives only in the second-row cache metric, so a huge cache
 * can never inflate the clock context to near the full token count.
 *
 * Output real semantics: OpenCode normalizes `tokens.output` as the VISIBLE
 * output (reasoning subtracted out) while `tokens.reasoning` carries the raw
 * thinking tokens. Raw output and raw reasoning stay separate everywhere in
 * the aggregation so nothing is double-counted; the DISPLAYED output real is
 * `output + reasoning`, computed once per message/session by realOutput().
 */
import type {
  MessageUsage,
  ProjectLedger,
  ProjectSessionLike,
  ProjectUsage,
  SessionUsage,
  UsageMessage,
} from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

/**
 * Real (visible + thinking) output. OpenCode normalizes `tokens.output` as
 * visible output minus reasoning, so the displayed/aggregated output real is
 * raw output + raw reasoning. Each message's reasoning is counted exactly
 * once: once inside its own output real.
 */
export function realOutput(output: number, reasoning: number): number {
  return output + reasoning
}

export function usageOf(
  message: UsageMessage | null | undefined,
): MessageUsage | null {
  if (message?.role !== "assistant") return null
  const tokens = message.tokens ?? {}
  const input = num(tokens.input)
  const output = num(tokens.output)
  const reasoning = num(tokens.reasoning)
  const cacheRead = num(tokens.cache?.read)
  const cacheWrite = num(tokens.cache?.write)
  const contextTotal = num(tokens.total)
  const context =
    contextTotal > 0
      ? contextTotal
      : input + output + reasoning + cacheRead + cacheWrite
  const usage: MessageUsage = {
    cost: num(message.cost),
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    context,
  }
  const any =
    usage.cost +
    usage.input +
    usage.output +
    usage.reasoning +
    usage.cacheRead +
    usage.cacheWrite
  if (any === 0 && context === 0) return null
  return usage
}

export function sumMessages(map: Map<string, MessageUsage>): SessionUsage {
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let context = 0
  for (const u of map.values()) {
    cost += u.cost
    input += u.input
    output += u.output
    reasoning += u.reasoning
    cacheRead += u.cacheRead
    cacheWrite += u.cacheWrite
    if (u.context > context) context = u.context
  }
  return {
    cost,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: context,
    cache: cacheRead + cacheWrite,
  }
}

/**
 * Sums ALL sessions of a project as returned by the client session.list
 * endpoint with `scope: "project"` (already filtered by projectID).
 * Raw output and raw reasoning stay separate and are each counted exactly
 * once per session; the headline context is input + raw output + raw
 * reasoning per session (cache excluded — it lives only in the separate
 * cache metric) because the session-level list payload carries no total.
 */
export function sumProjectSessions(
  projectID: string,
  sessions: ProjectSessionLike[],
): ProjectUsage {
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cache = 0
  let context = 0
  let counted = 0
  for (const session of sessions) {
    if (!session || session.projectID !== projectID) continue
    const tokens = session.tokens
    if (!tokens) continue
    const inputN = num(tokens.input)
    const outputN = num(tokens.output)
    const reasoningN = num(tokens.reasoning)
    const cacheRead = num(tokens.cache?.read)
    const cacheWrite = num(tokens.cache?.write)
    cost += num(session.cost)
    input += inputN
    output += outputN
    reasoning += reasoningN
    cache += cacheRead + cacheWrite
    context += inputN + outputN + reasoningN
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
    cache,
  }
}

/**
 * Sums the FULL all-time ledger of a project (live snapshots + tombstones).
 * Same per-session semantics as sumProjectSessions: each entry contributes
 * input + raw output + raw reasoning to the context (cache excluded — it
 * lives only in the separate cache metric), and the displayed output real
 * stays raw output + raw reasoning. Idempotent by construction: the same
 * entries always produce the same total, and a tombstone keeps its snapshot.
 */
export function sumLedgerProject(
  projectID: string,
  ledger: ProjectLedger,
): ProjectUsage {
  const project = ledger.projects[projectID] ?? {}
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cache = 0
  let context = 0
  let counted = 0
  for (const entry of Object.values(project)) {
    // num() coercion: a malformed entry (string/non-numeric fields from an
    // old or foreign writer) must never leak NaN into the snapshot.
    const entryInput = num(entry?.input)
    const entryOutput = num(entry?.output)
    const entryReasoning = num(entry?.reasoning)
    cost += num(entry?.cost)
    input += entryInput
    output += entryOutput
    reasoning += entryReasoning
    cache += num(entry?.cache)
    context += entryInput + entryOutput + entryReasoning
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
    cache,
  }
}
