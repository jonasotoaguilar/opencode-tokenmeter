import { fmtCompact, fmtPrecise } from "./numbers"
import type { CachePref, NumbersPref } from "./settings"

/**
 * Metric role of a rendered segment — segment metadata that identifies the
 * metric; the panel renders the token+cost segments of the primary line in
 * the main-text tone and every other segment muted, so roles never pick
 * arbitrary colors.
 */
export type MetricRole =
  | "tokens"
  | "spend"
  | "input"
  | "output"
  | "reasoning"
  | "cache"
  | "label"
  | "sep"

/** One role-colored segment of a metric line: concatenating `text` yields the exact rendered line. */
export type MetricSegment = { text: string; role: MetricRole }

/** One rendered line of a detail section: an ordered list of role-colored segments. */
export type MetricLine = MetricSegment[]

/**
 * The usage fields a section view exposes to the corrected-contract
 * formatters. Session (total), Project (context) and snapshot (totalTokens)
 * views all satisfy it; the token total resolves in that order. `cost` is
 * the monetary spend the L1 renders.
 */
export type MetricLineView = {
  totalTokens?: number
  context?: number
  total?: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/**
 * `R<read>|W<write>` cache pair with zero sides omitted: `R45M|W10K`,
 * `R45M`, `W10K` or `0` when both are zero — or, in `combined` mode, the
 * single summed value `cacheRead + cacheWrite`. Values are clamped to zero
 * so a stray negative never renders a minus sign. The `numbers` mode picks
 * compact magnitudes (`fmtCompact`, UPPERCASE `K`/`M`) vs thousands-separated
 * integers (`fmtPrecise`). Consumed by `formatCacheSegment` (the corrected
 * contract's role-colored cache line); kept pure for table-driven tests.
 * In `percentage` mode this helper is not used — see `formatCachePercent`.
 */
export function formatCachePair(
  cacheRead: number,
  cacheWrite: number,
  cache: Exclude<CachePref, "percentage"> = "separated",
  numbers: NumbersPref = "compact",
): string {
  const read = Math.max(0, cacheRead)
  const write = Math.max(0, cacheWrite)
  const fmt = numbers === "precise" ? fmtPrecise : fmtCompact
  if (cache === "combined") return fmt(read + write)
  if ((cache as CachePref) === "percentage") {
    throw new Error(
      'formatCachePair does not support percentage – use formatCachePercent(cacheRead, cacheWrite, total) or formatCacheSegment(cacheRead, cacheWrite, "percentage", numbers, total)',
    )
  }
  if (read > 0 && write > 0) return `R${fmt(read)}|W${fmt(write)}`
  if (read > 0) return `R${fmt(read)}`
  if (write > 0) return `W${fmt(write)}`
  return "0"
}

/**
 * Cache share as integer percent of the canonical total: `cache / total * 100`
 * where `cache = cacheRead + cacheWrite` and `total` uses the product's
 * existing total semantics (sidebar `totalOf(view)` or footer `usage.total`).
 * Total 0 is deterministic `0%`; values are clamped and rounded to the nearest
 * integer percent with a trailing `%`.
 */
export function formatCachePercent(
  cacheRead: number,
  cacheWrite: number,
  total: number,
): string {
  const cache = Math.max(0, cacheRead) + Math.max(0, cacheWrite)
  if (!(total > 0)) return "0%"
  const pct = Math.round((cache / total) * 100)
  const clamped = Math.max(0, Math.min(100, pct))
  return `${clamped}%`
}

/**
 * The cache segment of a labeled metric line: the corrected contract's
 * counterpart of `formatCachePair` — same combined/separated
 * semantics (uppercase `R45M|W10K`, zero sides omitted, both zero → `0`),
 * but wrapped as a `MetricSegment` so the panel can render it as one muted
 * segment. The `numbers` mode picks compact magnitudes
 * vs thousands-separated integers. In `percentage` mode the segment shows
 * `cache / total * 100` as an integer percent (`0%` when total is 0).
 */
export function formatCacheSegment(
  cacheRead: number,
  cacheWrite: number,
  cache: CachePref = "separated",
  numbers: NumbersPref = "compact",
  total?: number,
): MetricSegment {
  if (cache === "percentage") {
    return {
      text: formatCachePercent(cacheRead, cacheWrite, total ?? 0),
      role: "cache",
    }
  }
  return {
    text: formatCachePair(cacheRead, cacheWrite, cache, numbers),
    role: "cache",
  }
}
