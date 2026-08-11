/**
 * Narrow structural types for the TokenMeter sidebar plugin.
 *
 * The shapes mirror the fields the SDK exposes on AssistantMessage
 * (cost/tokens), Session (id/title/parentID/agent/projectID), Project
 * (id/worktree) and SessionStatus, kept local so the plugin bundle does not
 * depend on SDK type resolution.
 *
 * Token accounting convention: OpenCode normalizes the reported
 * `tokens.output` as the VISIBLE output — reasoning tokens are subtracted
 * out — while `tokens.reasoning` carries the raw thinking tokens. Internally
 * the plugin keeps raw `output` and raw `reasoning` separate and cumulative;
 * the DISPLAYED output real is always `output + reasoning`, computed exactly
 * once per message/session via realOutput() (see math.ts).
 *
 * Spend semantics: the headline total is CUMULATIVE TOKEN SPEND —
 * `Σ(input + output + reasoning + cache.read + cache.write)` across all
 * assistant messages of a session — which exactly reconstructs the provider
 * `tokens.total` per message. It is NOT a context-window formula: cache
 * tokens are billed separately by OpenCode, so every cache.read/cache.write
 * token counts into the spend. Each component is kept as a per-field
 * high-water (see store.ts), so compaction or a smaller later message set
 * can never lower the displayed spend.
 */

export type TokenUsage = {
  input: number
  /** Raw visible output tokens (OpenCode reports output minus reasoning). */
  output: number
  /** Raw reasoning tokens (thinking). */
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type MessageUsage = TokenUsage & {
  cost: number
  /**
   * Per-message spend contribution: `input + output + reasoning + cacheRead
   * + cacheWrite`. `tokens.total` is intentionally unused — the plugin
   * reconstructs the same value from the normalized fields.
   */
  context: number
}

export type SessionUsage = TokenUsage & {
  cost: number
  /**
   * Complete per-session spend: `Σ input + Σ output + Σ reasoning + Σ
   * cache.read + Σ cache.write` across ALL assistant messages of the
   * session — the exact reconstruction of the provider `tokens.total`.
   * Always >= input + output + reasoning, so the coins total can never fall
   * below the session's cumulative input + real output.
   */
  total: number
  /** cacheRead + cacheWrite (cumulative across messages). */
  cache: number
}

export type GroupSummary = {
  name: string
  runs: number
  running: number
  cost: number
  /** Sum of the complete per-session spend of each delegated session in the group (each session once). */
  total: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
}

export type UsageSnapshot = {
  rootID: string
  cost: number
  /**
   * Headline spend: sum of the per-session spends across the root session
   * plus every recursive descendant, each session ID exactly once. Every
   * term satisfies spend >= input + output + reasoning.
   */
  totalTokens: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
  /** Total delegations: recursive descendant session count (includes grandchildren). */
  delegations: number
  /** Distinct agent types used across all descendant sessions. */
  agents: number
  groups: GroupSummary[]
}

/**
 * Aggregate usage for the Project section: the sum of the project's LIVE
 * sessions (client session.list, `scope: "project"`, across
 * directories/worktrees) plus one persisted aggregate of the project's
 * DELETED sessions. Live rows are authoritative and fetched fresh on every
 * refresh — never persisted; only the deleted aggregate survives in the
 * plugin-owned SQLite store.
 */
export type ProjectUsage = {
  /** projectID the sessions were filtered by. */
  id: string
  /** Number of project sessions that contributed token usage. */
  sessions: number
  cost: number
  /**
   * Headline spend: the live sessions' complete per-session spend
   * (`input + output + reasoning + cache.read + cache.write` per session,
   * never below input + output + reasoning) plus the persisted deleted
   * aggregate's stored complete spend. Nothing is derived from the raw
   * cumulative fields.
   */
  context: number
  /** Cumulative raw visible output (OpenCode reports output minus reasoning). */
  input: number
  output: number
  /** Cumulative raw reasoning tokens (thinking). */
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
}

/**
 * One persisted aggregate usage snapshot of a project's DELETED sessions
 * (the `projects` row of the plugin-owned SQLite store). Raw cumulative
 * fields keep their cumulative semantics; `context` is the stored complete
 * per-session spend of the entry's scope, always exactly
 * `input + output + reasoning + cacheRead + cacheWrite` and therefore never
 * below input + output + reasoning. `cache` is the display convenience
 * cacheRead + cacheWrite.
 */
export type ProjectAggregateEntry = {
  cost: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  cacheRead: number
  cacheWrite: number
  /** cacheRead + cacheWrite (display convenience; cumulative). */
  cache: number
  /** Complete per-session spend (stored explicitly; never derived; == input + output + reasoning + cacheRead + cacheWrite). */
  context: number
}

/** Per-field component maxima kept as a session's spend high-water. */
export type SessionComponents = {
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** Minimal session shape returned by the client session.list endpoint (`scope: "project"`). */
export type ProjectSessionLike = {
  id: string
  projectID: string
  /** Directory the session was created in (sessions span all directories/worktrees). */
  directory?: string
  /** Set on child/delegated sessions; included unless the list filters roots. */
  parentID?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}

/** Minimal assistant-message shape carrying usage data. */
export type UsageMessage = {
  id?: string
  sessionID?: string
  role?: string
  cost?: number
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}

/** Minimal session shape as returned by the session endpoints. */
export type SessionInfo = {
  id: string
  title?: string
  parentID?: string
  agent?: string
  subagent_type?: string
}

export type SessionStatusType = "idle" | "busy" | "retry"
