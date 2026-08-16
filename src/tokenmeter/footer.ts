/**
 * Pure single-line formatter for the TokenMeter footer segment (host
 * `app_bottom` slot).
 *
 * The footer shows the ACTIVE route session's OWN cumulative spend only —
 * never delegated descendants — so every value is read from the canonical
 * per-session high-water (`store.observedSessionUsage`), which already
 * carries `total` and `cache` in the exact shapes this line needs:
 *
 *   total = input + output + reasoning + cache.read + cache.write
 *   cache = cache.read + cache.write
 *
 * Metric order is fixed (total first, then input, output, reasoning, cache)
 * so the line is stable across preference toggles; enabled metrics are
 * joined with the same ` · ` separator the sidebar uses, labeled
 * `total`/`in`/`out`/`reason`/`cache`. Values follow the `numbers`
 * preference (compact magnitudes vs thousands-separated integers) through
 * the existing number seams. The line is column-aware: when it does not fit
 * `width` it truncates predictably with `…` (never wraps), so the host
 * footer box can never overflow. An empty metric subset yields `""`.
 */
import { fmtCompact, fmtPrecise } from "./numbers"
import type { FooterMetric, FooterSettings, NumbersPref } from "./settings"
import { textColumns, truncateToColumns } from "./text"
import type { SessionUsage } from "./types"

export const FOOTER_SEPARATOR = " · "

/** Stable metric order: total first, then input, output, reasoning, cache. */
export const FOOTER_METRIC_ORDER: readonly FooterMetric[] = [
  "total",
  "input",
  "output",
  "reasoning",
  "cache",
]

/** Compact single-word labels; the data fields stay `reasoning`/`total`. */
export const FOOTER_LABELS: Record<FooterMetric, string> = {
  total: "total",
  input: "in",
  output: "out",
  reasoning: "reason",
  cache: "cache",
}

/** The footer value of one metric: `total`/`cache` are precomputed seams. */
const footerValue = (usage: SessionUsage, metric: FooterMetric): number =>
  usage[metric]

/**
 * Builds the compact footer line from the enabled metrics: labeled values
 * joined by ` · ` in fixed order, truncated to `width` when the full line
 * does not fit (labels are never dropped — the single-line surface keeps
 * every enabled metric identifiable). Empty metric subset → `""`.
 */
export function formatFooterLine(
  usage: SessionUsage,
  footer: FooterSettings,
  numbers: NumbersPref,
  width: number,
): string {
  const fmt = numbers === "precise" ? fmtPrecise : fmtCompact
  const parts = FOOTER_METRIC_ORDER.filter((metric) => footer[metric]).map(
    (metric) => `${FOOTER_LABELS[metric]} ${fmt(footerValue(usage, metric))}`,
  )
  if (parts.length === 0) return ""
  const line = parts.join(FOOTER_SEPARATOR)
  return textColumns(line) <= width ? line : truncateToColumns(line, width)
}
