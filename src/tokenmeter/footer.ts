/**
 * Pure single-line formatter for the TokenMeter prompt metric (host
 * `session_prompt_right` slot, rendered inline at the right end of the
 * native prompt's agent/model row).
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
 * joined with the same ` · ` separator the sidebar uses, icon-first with
 * the compact prompt icons (`↑`/`↓`/`󰆼`/`󰧑`/`Σ`). Values follow the `numbers`
 * preference (compact magnitudes vs thousands-separated integers) through
 * the existing number seams, except the cache metric in `percentage` mode
 * which shows `cache / total * 100` as an integer percent (`0%` when total
 * is 0). The line is column-aware: when it does not fit `width` it
 * truncates predictably with `…` (never wraps), so the host footer box can
 * never overflow. An empty metric subset yields `""`.
 */
import { formatCachePercent } from "./format-cache"
import { fmtCompact, fmtPrecise } from "./numbers"
import type {
  CachePref,
  FooterMetric,
  FooterSettings,
  NumbersPref,
} from "./settings"
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

/** Compact single-word labels; the data fields stay `reasoning`/`total`. Kept for reference; footer now renders icons. */
export const FOOTER_LABELS: Record<FooterMetric, string> = {
  total: "total",
  input: "in",
  output: "out",
  reasoning: "reason",
  cache: "cache",
}

/**
 * Prompt icon vocabulary for the footer row. Input/output use the plain
 * Unicode arrows `↑`/`↓`; cache/reasoning use the user-provided Nerd Font
 * glyphs `󰆼`/`󰧑` exactly; total uses `Σ` (U+2211 N-ARY SUMMATION) — a plain
 * Unicode math glyph already renderable without a Nerd Font, chosen as the
 * most semantically appropriate single-column glyph for “total sum” among
 * the project's existing plain-Unicode icon vocabulary (▶/▼/↳/↑/↓).
 * No new icon library is introduced; all glyphs are single-codepoint
 * strings measured via `textColumns`.
 */
export const FOOTER_ICONS: Record<FooterMetric, string> = {
  total: "Σ",
  input: "↑",
  output: "↓",
  reasoning: "󰧑",
  cache: "󰆼",
}

/** The footer value of one metric: `total`/`cache` are precomputed seams. */
const footerValue = (usage: SessionUsage, metric: FooterMetric): number =>
  usage[metric]

/**
 * Builds the compact footer line from the enabled metrics: icon-first
 * metric pairs joined by ` · ` in fixed order, truncated to `width` when the
 * full line does not fit (labels are never dropped — the single-line surface
 * keeps every enabled metric identifiable). Empty metric subset → `""`.
 * When `cache` is `percentage`, the cache metric shows the cache share
 * (`cache / total * 100`, rounded integer percent, `0%` when total is 0)
 * instead of the absolute cached token count.
 */
export function formatFooterLine(
  usage: SessionUsage,
  footer: FooterSettings,
  numbers: NumbersPref,
  width: number,
  cache: CachePref = "combined",
): string {
  const fmt = numbers === "precise" ? fmtPrecise : fmtCompact
  const parts = FOOTER_METRIC_ORDER.filter((metric) => footer[metric]).map(
    (metric) => {
      let valueText: string
      if (metric === "cache" && cache === "percentage") {
        valueText = formatCachePercent(
          usage.cacheRead,
          usage.cacheWrite,
          usage.total,
        )
      } else {
        valueText = fmt(footerValue(usage, metric))
      }
      const icon = FOOTER_ICONS[metric]
      // Input/output keep the compact `↑71k` shape from the spec (no space);
      // cache/reasoning/total use `icon + space + value` to match `󰆼 99k`
      // and keep the cache/reason Nerd glyphs breathing from the digits.
      if (metric === "input" || metric === "output")
        return `${icon}${valueText}`
      return `${icon} ${valueText}`
    },
  )
  if (parts.length === 0) return ""
  const line = parts.join(FOOTER_SEPARATOR)
  return textColumns(line) <= width ? line : truncateToColumns(line, width)
}
