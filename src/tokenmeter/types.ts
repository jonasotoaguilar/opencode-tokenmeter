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
  /** One context snapshot: tokens.total when present, else input+raw output+raw reasoning+cache. */
  context: number
}

export type SessionUsage = TokenUsage & {
  cost: number
  /** Context snapshot: max observed per-message context across the session. */
  total: number
  /** cacheRead + cacheWrite (cumulative). */
  cache: number
}

export type GroupSummary = {
  name: string
  runs: number
  running: number
  cost: number
  /** Context snapshot sum across the group (one per session, max observed). */
  total: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  cache: number
}

export type UsageSnapshot = {
  rootID: string
  cost: number
  /** Headline context: sum of one context snapshot per session (root + all descendants). */
  totalTokens: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  cache: number
  /** Total delegations: recursive descendant session count (includes grandchildren). */
  delegations: number
  /** Distinct agent types used across all descendant sessions. */
  agents: number
  groups: GroupSummary[]
}

/**
 * Aggregate usage for the Project section, summed from the sessions returned
 * by the client session.list endpoint (`scope: "project"`) across
 * directories/worktrees.
 */
export type ProjectUsage = {
  /** projectID the sessions were filtered by. */
  id: string
  /** Number of project sessions that contributed token usage. */
  sessions: number
  cost: number
  /**
   * Headline context: input + raw output + raw reasoning per session (cache
   * EXCLUDED — it lives only in the separate `cache` metric), summed across
   * the project's sessions, since the session-level list payload has no total.
   */
  context: number
  /** Cumulative raw visible output (OpenCode reports output minus reasoning). */
  input: number
  output: number
  /** Cumulative raw reasoning tokens (thinking). */
  reasoning: number
  cache: number
}

/**
 * One persisted per-session snapshot in the Project history ledger (kv key
 * tokenmeter.project.history.v1). Live sessions upsert their snapshot by ID
 * on every project refresh; sessions that disappear from the live list are
 * kept as tombstones (deletedAt) and never removed, so the project total is
 * the idempotent sum of the full all-time ledger.
 */
export type ProjectLedgerEntry = {
  cost: number
  input: number
  /** Cumulative raw visible output (kept separate from reasoning). */
  output: number
  /** Cumulative raw reasoning tokens (kept separate from output). */
  reasoning: number
  /** cacheRead + cacheWrite (cumulative). */
  cache: number
  /** ISO timestamp of the last refresh that listed this session as live. */
  lastSeen?: string
  /** ISO timestamp set once the session left the live list (or was deleted). */
  deletedAt?: string
}

/** Versioned persistent Project history ledger, keyed by projectID then sessionID. */
export type ProjectLedger = {
  /** Ledger schema version. */
  v: 1
  projects: Record<string, Record<string, ProjectLedgerEntry>>
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
