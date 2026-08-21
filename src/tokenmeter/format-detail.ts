import {
  formatMetricLines,
  labelSegment,
  metricValue,
  sepSegment,
  totalOf,
} from "./format"
import type { MetricLine, MetricLineView, MetricRole } from "./format-cache"
import { formatCacheSegment } from "./format-cache"
import { realOutput } from "./math"
import { fmtCost } from "./numbers"
import type { CachePref, NumbersPref } from "./settings"
import { textColumns, truncateToColumns } from "./text"

/**
 * The compact L1 summary row, width-elastic: the full
 * `<total> tokens · $<spend>` line degrades as the width shrinks —
 * elide the spend value to `$…`, drop the ` tokens` label, then truncate
 * the total while KEEPING the ` · $…` spend marker (the spend is never
 * dropped while the total still fits) — so the compact row never wraps at
 * the narrowest content width (22) and both metrics stay visible. Segments
 * keep their semantic roles at every degradation step; the first candidate
 * that fits wins. Below six columns no two-value line can fit and the
 * total alone is truncated (documented degenerate — the contract floor is
 * 22).
 */
export function formatCompactSummary(
  view: MetricLineView,
  numbers: NumbersPref,
  width: number,
): MetricLine {
  const total = metricValue(numbers, totalOf(view))
  const cost = fmtCost(view.cost)
  const candidates: MetricLine[] = [
    [
      { text: total, role: "tokens" },
      labelSegment("tokens"),
      sepSegment,
      { text: cost, role: "spend" },
    ],
    [
      { text: total, role: "tokens" },
      labelSegment("tokens"),
      sepSegment,
      { text: "$…", role: "spend" },
    ],
    [
      { text: total, role: "tokens" },
      sepSegment,
      { text: "$…", role: "spend" },
    ],
  ]
  for (const candidate of candidates) {
    if (textColumns(candidate.map((segment) => segment.text).join("")) <= width)
      return candidate
  }
  const truncatedWithSpend: MetricLine = [
    {
      text: truncateToColumns(total, Math.max(1, width - 5)),
      role: "tokens",
    },
    sepSegment,
    { text: "$…", role: "spend" },
  ]
  if (
    textColumns(truncatedWithSpend.map((segment) => segment.text).join("")) <=
    width
  )
    return truncatedWithSpend
  return [
    { text: truncateToColumns(total, Math.max(1, width)), role: "tokens" },
  ]
}

/**
 * The mode-aware detail rows shared by the Project/Session sections and
 * every agent entry (no per-row glyph). In `compact` number mode exactly
 * three width-elastic labeled rows render: L1 walks the compact-summary
 * ladder (elide `$…` → drop ` tokens` → truncate keeping ` · $…`); L2/L3
 * walk their own ladder (full labeled pair → trailing label dropped →
 * labels and separator dropped → values `…`-truncated around ` · `). In
 * `precise` number mode exactly five single-metric rows render —
 * `<total> tokens · $<spend>`, `<input> input`, `<output> output`,
 * `<reasoning> reason`, `<cache> cache` — each degrading individually
 * (label drops, then the value truncates), so every metric stays on its
 * own visible line at the contract width floor (22) after indentation.
 * Rows are never omitted; every line fits `width` from 1 column up.
 */
export function formatDetailLines(
  view: MetricLineView,
  opts: { cache: CachePref; numbers: NumbersPref },
  width: number,
): MetricLine[] {
  if (opts.numbers === "precise") {
    const value = (n: number): string => metricValue("precise", n)
    const total = totalOf(view)
    const cacheSegment = formatCacheSegment(
      view.cacheRead,
      view.cacheWrite,
      opts.cache,
      "precise",
      total,
    )
    return [
      formatCompactSummary(view, "precise", width),
      formatSingleMetric(value(view.input), "in", "input", width),
      formatSingleMetric(
        value(realOutput(view.output, view.reasoning)),
        "out",
        "output",
        width,
      ),
      formatSingleMetric(value(view.reasoning), "reason", "reasoning", width),
      formatSingleMetric(cacheSegment.text, "cache", "cache", width),
    ]
  }
  const [, full2, full3] = formatMetricLines(view, opts)
  return [
    formatCompactSummary(view, "compact", width),
    degradePair(full2, width),
    degradePair(full3, width),
  ]
}

/**
 * One single-metric row of the precise five-row ladder: the full
 * `<value> <label>` form, then the label dropped, then the value
 * `…`-truncated — the metric itself is never omitted, only individually
 * degraded when physically unavoidable. `label` carries no leading space
 * (the `label` segment adds it, matching the paired lines).
 */
function formatSingleMetric(
  value: string,
  label: string,
  role: MetricRole,
  width: number,
): MetricLine {
  const full: MetricLine = [{ text: value, role }, labelSegment(label)]
  if (textColumns(full.map((segment) => segment.text).join("")) <= width)
    return full
  if (textColumns(value) <= width) return [{ text: value, role }]
  return [{ text: truncateToColumns(value, Math.max(1, width)), role }]
}

/**
 * The L2/L3 elastic ladder for one labeled value pair: the full labeled
 * line, then the trailing label dropped, then both labels AND the separator
 * dropped — labels yield before any value changes. If the values-only pair
 * still overflows, both values truncate with `…` around the ` · ` separator
 * (second value first, then the first), so BOTH values always render. Below
 * 5 content columns a two-value line cannot fit; the first value alone is
 * truncated there (documented degenerate — the contract floor is 22).
 */
function degradePair(full: MetricLine, width: number): MetricLine {
  const [v1, label1, sep, v2] = full as [
    MetricLine[number],
    MetricLine[number],
    MetricLine[number],
    MetricLine[number],
  ]
  const fit = (candidate: MetricLine): boolean =>
    textColumns(candidate.map((segment) => segment.text).join("")) <= width
  if (fit(full)) return full
  const withoutTrailingLabel = [v1, label1, sep, v2]
  if (fit(withoutTrailingLabel)) return withoutTrailingLabel
  const valuesOnly = [v1, sep, v2]
  if (fit(valuesOnly)) return valuesOnly
  if (width < 5)
    return [
      { text: truncateToColumns(v1.text, Math.max(1, width)), role: v1.role },
    ]
  const sepCols = textColumns(sep.text)
  let first = truncateToColumns(v1.text, width - sepCols)
  const second = truncateToColumns(
    v2.text,
    Math.max(1, width - sepCols - textColumns(first)),
  )
  if (textColumns(first) + sepCols + textColumns(second) > width)
    first = truncateToColumns(
      v1.text,
      Math.max(1, width - sepCols - textColumns(second)),
    )
  return [{ text: first, role: v1.role }, sep, { text: second, role: v2.role }]
}
