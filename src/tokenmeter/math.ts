/**
 * Pure usage math for the TokenMeter sidebar: extraction of per-message
 * usage, per-session aggregation and per-project summation. Display
 * formatting lives in numbers.ts. No I/O and no state.
 *
 * Spend semantics (final, corrected): a session's total is the CUMULATIVE
 * TOKEN SPEND computed from its observed assistant messages in client order
 * (Map insertion order; replacing a message never reorders it):
 *
 *   total = Σ input + Σ output + Σ reasoning + Σ cache.read + Σ cache.write
 *
 * summed across ALL assistant messages of the session. OpenCode bills
 * input, output, reasoning (as output) and the two cache channels
 * separately, and this sum exactly reconstructs the provider `tokens.total`
 * per message; the `tokens.total` field itself is intentionally never read.
 * Because every cache token is billed, cache read/write are CUMULATIVE —
 * there is no "latest qualifying message" concept anymore.
 *
 * High-water: a session's stored/displayed spend is the per-field maximum
 * (cost/input/output/reasoning/cacheRead/cacheWrite) ever observed — never
 * a single snapshot — so compaction or a smaller later message set cannot
 * lower it (see store.ts observedSessionUsage).
 *
 * Project spend: the ledger stores each tree/session's complete-session
 * spend EXPLICITLY (see types.ProjectLedgerEntry) — it is never derived
 * from cumulative raw fields, and never built as a per-field maximum of
 * different moments. A payload-only session (never observed via messages)
 * contributes `input + output + reasoning + cache.read + cache.write` — the
 * full spend formula from the payload's own fields, so Project spend is
 * always at least Project input + output + reasoning.
 *
 * Output real semantics: OpenCode normalizes `tokens.output` as the VISIBLE
 * output (reasoning subtracted out) while `tokens.reasoning` carries the raw
 * thinking tokens. Raw output and raw reasoning stay separate everywhere in
 * the aggregation so nothing is double-counted; the DISPLAYED output real is
 * `output + reasoning`, computed once per message/session by realOutput().
 */
import { estimateCost, getPricing, pricingKey } from "./pricing"
import type {
  FinitePrice,
  MessageUsage,
  MonetarySource,
  ProjectAggregateEntry,
  ProjectSessionLike,
  ProjectUsage,
  ResolvedCost,
  SessionComponents,
  SessionUsage,
  UsageMessage,
} from "./types"

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

function isOpenAI(providerID: unknown): boolean {
  if (typeof providerID !== "string") return false
  return providerID.trim().toLowerCase() === "openai"
}

/**
 * Resolves monetary cost for a message/row.
 * Non-zero reported cost wins unchanged. Else OpenAI + billable usage + exact pricing => estimated; else reported 0.
 * Never throws.
 */
export function resolveCost(opts: {
  cost: number
  providerID: unknown
  modelID: unknown
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}): ResolvedCost {
  try {
    const cost = num(opts.cost)
    if (cost !== 0) return { cost, source: "reported" as MonetarySource }
    if (!isOpenAI(opts.providerID)) return { cost: 0, source: "reported" }
    const { input, output, reasoning, cacheRead, cacheWrite } = opts.tokens
    const billable =
      num(input) +
        num(output) +
        num(reasoning) +
        num(cacheRead) +
        num(cacheWrite) >
      0
    if (!billable) return { cost: 0, source: "reported" }
    const key = pricingKey(opts.providerID, opts.modelID)
    if (!key) return { cost: 0, source: "reported" }
    const price = getPricing(key)
    if (!price) return { cost: 0, source: "reported" }
    const est = estimateCost(
      {
        input: num(input),
        output: num(output),
        reasoning: num(reasoning),
        cacheRead: num(cacheRead),
        cacheWrite: num(cacheWrite),
      },
      price as FinitePrice,
    )
    if (!Number.isFinite(est) || est <= 0)
      return { cost: 0, source: "reported" }
    return { cost: est, source: "estimated" }
  } catch {
    return { cost: 0, source: "reported" }
  }
}

const hasUsage = (entry: ProjectAggregateEntry): boolean =>
  entry.cost +
    entry.input +
    entry.output +
    entry.reasoning +
    entry.cacheRead +
    entry.cacheWrite +
    entry.context >
  0

/**
 * Real (visible + thinking) output. OpenCode normalizes `tokens.output` as
 * visible output minus reasoning, so the displayed/aggregated output real is
 * raw output + raw reasoning. Each message's reasoning is counted exactly
 * once: once inside its own output real.
 */
export function realOutput(output: number, reasoning: number): number {
  return output + reasoning
}

/**
 * Per-field maximum merge of two session component sets. Used by the store
 * (in-run high-water) and the ledger (per-member high-waters) so a smaller
 * later observation can never lower a stored component.
 */
export function maxComponents(
  a: SessionComponents,
  b: SessionComponents,
): SessionComponents {
  return {
    cost: Math.max(a.cost, b.cost),
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    reasoning: Math.max(a.reasoning, b.reasoning),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  }
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
  // Per-message spend contribution: all five billed channels. `tokens.total`
  // is intentionally unused — this sum reconstructs it exactly.
  const context = input + output + reasoning + cacheRead + cacheWrite
  const resolved = resolveCost({
    cost: num(message.cost),
    providerID: (message as UsageMessage).providerID,
    modelID: (message as UsageMessage).modelID,
    tokens: { input, output, reasoning, cacheRead, cacheWrite },
  })
  const usage: MessageUsage = {
    cost: resolved.cost,
    source: resolved.source,
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
  if (any === 0) return null
  return usage
}

/**
 * Per-session aggregation: cost/input/output/reasoning/cacheRead/cacheWrite
 * stay CUMULATIVE across the session's messages; `total` is the session's
 * complete TOKEN SPEND — the sum of ALL five billed channels across ALL
 * assistant messages, exactly reconstructing the provider `tokens.total`.
 * Always >= input + output + reasoning, so the coins total can never fall
 * below the session's cumulative input + real output. The store keeps the
 * per-field high-water of these components across observations.
 */
export function sumMessages(map: Map<string, MessageUsage>): SessionUsage {
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const u of map.values()) {
    cost += u.cost
    input += u.input
    output += u.output
    reasoning += u.reasoning
    cacheRead += u.cacheRead
    cacheWrite += u.cacheWrite
  }
  return {
    cost,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cache: cacheRead + cacheWrite,
  }
}

/**
 * Sums ALL live sessions of a project as returned by the client session.list
 * endpoint with `scope: "project"` (already filtered by projectID). Sessions
 * are counted once by sessionID — a duplicated payload can never inflate the
 * total. Raw output and raw reasoning stay separate and are each counted
 * exactly once per session. Context is the payload-only spend: `input +
 * output + reasoning + cache.read + cache.write` per session (the full
 * formula from the payload's own fields), so the live total always satisfies
 * context >= input + output + reasoning.
 * Tombstoned sessions (`exclude` contains `session.id` scoped by
 * `(sessionID, projectID)`) are skipped BEFORE any token/cost summation so
 * they never contribute live, while the same ID in another project remains
 * eligible. Per-row cost is resolved through `resolveCost` (reported wins,
 * else OpenAI estimated via `model` when pricing is present).
 */
export function sumProjectSessions(
  projectID: string,
  sessions: ProjectSessionLike[],
  exclude?: ReadonlySet<string>,
): ProjectUsage {
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let context = 0
  let counted = 0
  const seen = new Set<string>()
  for (const session of sessions) {
    if (!session || session.projectID !== projectID) continue
    if (exclude?.has(session.id)) continue
    // A session must never be counted twice: the list is keyed by sessionID
    // (the ledger is too), so a duplicated payload contributes exactly once.
    if (seen.has(session.id)) continue
    seen.add(session.id)
    const tokens = session.tokens
    if (!tokens) continue
    const inputN = num(tokens.input)
    const outputN = num(tokens.output)
    const reasoningN = num(tokens.reasoning)
    const readN = num(tokens.cache?.read)
    const writeN = num(tokens.cache?.write)
    const resolved = resolveCost({
      cost: num(session.cost),
      providerID: (session as ProjectSessionLike).model?.providerID,
      modelID: (session as ProjectSessionLike).model?.id,
      tokens: {
        input: inputN,
        output: outputN,
        reasoning: reasoningN,
        cacheRead: readN,
        cacheWrite: writeN,
      },
    })
    cost += resolved.cost
    input += inputN
    output += outputN
    reasoning += reasoningN
    cacheRead += readN
    cacheWrite += writeN
    context += inputN + outputN + reasoningN + readN + writeN
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

/**
 * Combines the authoritative LIVE project total (sumProjectSessions over the
 * current session.list rows) with the persisted deleted aggregate. The
 * deleted aggregate counts as ONE additional session when it carries usage.
 * Context is read from the explicitly stored complete-session spend
 * (`entry.context`, which by construction equals input + output + reasoning
 * + cacheRead + cacheWrite and is never below input + output + reasoning) —
 * never derived from the raw cumulative fields. Idempotent by construction:
 * the same live rows and the same aggregate always produce the same total.
 */
export function combineProjectUsage(
  live: ProjectUsage,
  deleted: ProjectAggregateEntry | null | undefined,
): ProjectUsage {
  if (!deleted || !hasUsage(deleted)) return live
  return {
    id: live.id,
    sessions: live.sessions + 1,
    cost: live.cost + deleted.cost,
    context: live.context + deleted.context,
    input: live.input + deleted.input,
    output: live.output + deleted.output,
    reasoning: live.reasoning + deleted.reasoning,
    cacheRead: live.cacheRead + deleted.cacheRead,
    cacheWrite: live.cacheWrite + deleted.cacheWrite,
    cache: live.cache + deleted.cache,
  }
}

/**
 * Payload-only snapshot extracted from a list/delete payload. The payload
 * carries only CUMULATIVE fields; context is the payload spend `input +
 * output + reasoning + cache.read + cache.write` — cache tokens are billed
 * and therefore count into the spend like every other channel. This
 * guarantees a payload-only session never reports context below its
 * cumulative input + output + reasoning; a later observed message map may
 * raise the per-component high-water. Null when the payload carries no
 * usage.
 */
export function entryOfSession(
  session: ProjectSessionLike | undefined | null,
): ProjectAggregateEntry | null {
  const tokens = session?.tokens
  const input = num(tokens?.input)
  const output = num(tokens?.output)
  const reasoning = num(tokens?.reasoning)
  const cacheRead = num(tokens?.cache?.read)
  const cacheWrite = num(tokens?.cache?.write)
  const entry: ProjectAggregateEntry = {
    cost: num(session?.cost),
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache: cacheRead + cacheWrite,
    context: input + output + reasoning + cacheRead + cacheWrite,
  }
  return hasUsage(entry) ? entry : null
}

export function entryOfSessionUsage(
  usage: SessionUsage | null | undefined,
): ProjectAggregateEntry | null {
  if (!usage) return null
  return {
    cost: usage.cost,
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cache: usage.cache,
    context: usage.total,
  }
}

/**
 * Merges a session's two real snapshots (delete payload + plugin-observed
 * usage). Each CUMULATIVE raw metric is kept as a safe per-field maximum
 * across the observations — cumulative totals can only grow, so a partial or
 * compacted observation must never lower them. Context is the complete spend
 * of the merged entry — the sum of the merged components, which by
 * construction is >= each observation's own spend and never below input +
 * output + reasoning.
 */
export function resolveEntry(
  payload: ProjectAggregateEntry | null,
  observed: ProjectAggregateEntry | null,
  model?: { providerID?: unknown; id?: unknown } | null,
): ProjectAggregateEntry | null {
  try {
    if (!payload && !observed) return null
    const input = Math.max(num(payload?.input), num(observed?.input))
    const output = Math.max(num(payload?.output), num(observed?.output))
    const reasoning = Math.max(
      num(payload?.reasoning),
      num(observed?.reasoning),
    )
    const cacheRead = Math.max(
      num(payload?.cacheRead),
      num(observed?.cacheRead),
    )
    const cacheWrite = Math.max(
      num(payload?.cacheWrite),
      num(observed?.cacheWrite),
    )
    const raw = payload ? num(payload.cost) : 0
    const obs = observed ? num(observed.cost) : 0
    let cost: number
    if (raw !== 0) cost = raw
    else if (obs !== 0) cost = obs
    else {
      const resolved = resolveCost({
        cost: 0,
        providerID: (model as { providerID?: unknown })?.providerID,
        modelID: (model as { id?: unknown })?.id,
        tokens: { input, output, reasoning, cacheRead, cacheWrite },
      })
      cost = resolved.cost
    }
    const entry: ProjectAggregateEntry = {
      cost,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      cache: cacheRead + cacheWrite,
      context: input + output + reasoning + cacheRead + cacheWrite,
    }
    return hasUsage(entry) ? entry : null
  } catch {
    return null
  }
}
