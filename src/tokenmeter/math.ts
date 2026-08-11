/**
 * Pure usage math for the TokenMeter sidebar: extraction of per-message
 * usage, per-session summation and per-project summation. Display formatting
 * lives in numbers.ts. No I/O and no state.
 *
 * Context semantics: each assistant message contributes ONE no-cache
 * context snapshot — `input + output + reasoning`, nothing else. The
 * provider-reported `tokens.total` is NOT used for the displayed context
 * (it may include cache); cache exists only in the separate cumulative
 * cache metric. A session's context is the MAXIMUM snapshot observed across
 * its current messages, so the headline sums one snapshot per session and
 * repeated messages with the same input context (or retries/compaction) can
 * never inflate or falsely drop it. input/output/reasoning/cache/cost stay
 * strictly cumulative and separate.
 *
 * Project context semantics: the same no-cache definition applies to the
 * hourglass in Project and Session — each session contributes ONE stored
 * context snapshot (`input + output + reasoning` for observed sessions and
 * for payload-only entries, since the list payload has no total). Context is
 * a SNAPSHOT field (one per session); cache stays the separate cumulative
 * second-row metric and is never added to context a second time. Because a
 * project contains its current Session, the Project headline is always >=
 * the Session headline by membership — never by cache.
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
  // Context is the no-cache formula ONLY: `tokens.total` is intentionally
  // unused (it may include cache), and cache never enters the context.
  const context = input + output + reasoning
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
 * once per session. The headline context is ONE no-cache snapshot per
 * session: `input + raw output + raw reasoning` (cache excluded, matching
 * the Session hourglass; the list payload carries no context total).
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
 * Each entry contributes its stored ONE no-cache context snapshot
 * (`context`); entries written before the context field existed fall back
 * to input + raw output + raw reasoning (cache excluded) so persisted
 * history is never lost. Raw output and raw reasoning stay separate; the
 * displayed output real stays raw output + raw reasoning. Idempotent by
 * construction: the same entries always produce the same total, and a
 * tombstone keeps its snapshot.
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
    const entryCache = num(entry?.cache)
    cost += num(entry?.cost)
    input += entryInput
    output += entryOutput
    reasoning += entryReasoning
    cache += entryCache
    const storedContext = num(entry?.context)
    context +=
      entry?.context !== undefined
        ? storedContext
        : entryInput + entryOutput + entryReasoning
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
