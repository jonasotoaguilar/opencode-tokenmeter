/**
 * Pure line formatters for the TokenMeter panel.
 *
 * The corrected contract renders labeled metric lines with the two
 * disclosure chevrons `▶`/`▼` as the only per-row glyphs — the Subagents
 * `↳` tree branch and its per-agent chevron included; labels identify
 * each metric. The display label for reasoning tokens is exactly `reason`
 * in every metric row (the underlying data field stays `reasoning`).
 * Every rendered line is column-aware: nothing here emits a fixed-width
 * template string that could overflow the sidebar.
 *
 * Detail rows are mode-aware via `formatDetailLines`, shared by the
 * Project/Session sections and the per-agent rows:
 *  - `numbers=compact` renders the three width-elastic labeled rows
 *    (`<total> tokens · $<spend>`, `<input> input · <realOutput> output`,
 *    `<reasoning> reason · <cache> cache`);
 *  - `numbers=precise` renders exactly five single-metric rows
 *    (`<total> tokens · $<spend>`, `<input> input`, `<output> output`,
 *    `<reasoning> reason`, `<cache> cache`) so every metric gets its own
 *    line at the narrow floor.
 * The compact summary is the elastic L1, and the Subagents global row
 * carries the aggregate only while collapsed. Detail lines are
 * width-elastic (labels/separators drop, then values truncate with `…`)
 * so no line is ever omitted — values degrade individually, a metric is
 * never dropped, and the L1 keeps a spend marker (`$…`) even when the
 * total must truncate. The pre-correction formatters and their glyph
 * paths are gone — nothing outside this module referenced them after the
 * Phase 2–4 panel rewrites.
 */

import { GLYPH } from "./glyphs"
import { realOutput } from "./math"
import { fmtCompact, fmtCost, fmtPrecise } from "./numbers"
import type { CachePref, NumbersPref } from "./settings"
import { textColumns, truncateToColumns } from "./text"
import type { GroupSummary } from "./types"

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

/**
 * `1 agent` / `2 agents`, `1 task` / `2 tasks` — PLAIN pluralized counts
 * without any glyph, for the labeled metric lines and the agent-list header
 * of the corrected contract (labels + color identify metrics; icons do not
 * repeat). Zero pluralizes like every count beyond one (`0 agents`).
 */
export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

/**
 * `R<read>|W<write>` cache pair with zero sides omitted: `R45M|W10K`,
 * `R45M`, `W10K` or `0` when both are zero — or, in `combined` mode, the
 * single summed value `cacheRead + cacheWrite`. Values are clamped to zero
 * so a stray negative never renders a minus sign. The `numbers` mode picks
 * compact magnitudes (`fmtCompact`, UPPERCASE `K`/`M`) vs thousands-separated
 * integers (`fmtPrecise`). Consumed by `formatCacheSegment` (the corrected
 * contract's role-colored cache line); kept pure for table-driven tests.
 */
export function formatCachePair(
  cacheRead: number,
  cacheWrite: number,
  cache: CachePref = "separated",
  numbers: NumbersPref = "compact",
): string {
  const read = Math.max(0, cacheRead)
  const write = Math.max(0, cacheWrite)
  const fmt = numbers === "precise" ? fmtPrecise : fmtCompact
  if (cache === "combined") return fmt(read + write)
  if (read > 0 && write > 0) return `R${fmt(read)}|W${fmt(write)}`
  if (read > 0) return `R${fmt(read)}`
  if (write > 0) return `W${fmt(write)}`
  return "0"
}

/**
 * The cache segment of a labeled metric line: the corrected contract's
 * counterpart of `formatCachePair` — same combined/separated
 * semantics (uppercase `R45M|W10K`, zero sides omitted, both zero → `0`),
 * but wrapped as a `MetricSegment` so the panel can render it as one muted
 * segment. The `numbers` mode picks compact magnitudes
 * vs thousands-separated integers.
 */
export function formatCacheSegment(
  cacheRead: number,
  cacheWrite: number,
  cache: CachePref = "separated",
  numbers: NumbersPref = "compact",
): MetricSegment {
  return {
    text: formatCachePair(cacheRead, cacheWrite, cache, numbers),
    role: "cache",
  }
}

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

/** One rendered line of a detail section: an ordered list of role-colored segments. */
export type MetricLine = MetricSegment[]

/** The token total of a view: Session (`total`), Project (`context`) or snapshot (`totalTokens`). */
const totalOf = (view: MetricLineView): number =>
  view.totalTokens ?? view.context ?? view.total ?? 0

/** Value shaping by the `numbers` preference: compact magnitudes vs thousands-separated integers. */
const metricValue = (numbers: NumbersPref, n: number): string =>
  numbers === "precise" ? fmtPrecise(n) : fmtCompact(n)

/** ` tokens`-style label segment — muted `label` role, one leading space. */
const labelSegment = (text: string): MetricSegment => ({
  text: ` ${text}`,
  role: "label",
})

/** ` · ` separator segment — muted `sep` role. */
const sepSegment: MetricSegment = { text: " · ", role: "sep" }

/**
 * The exact three labeled detail lines: `<total> tokens · $<spend>`,
 * `<input> input · <realOutput> output`, `<reasoning> reason · <cache>
 * cache`. Semantics preserved: real output = raw output + raw reasoning;
 * the cache segment honors the `cache` preference (combined single value vs
 * separated `R|W` with zero sides omitted) and the `numbers` preference
 * (compact magnitudes vs thousands-separated integers). The spend value is
 * ALWAYS `$`-prefixed (never a bare number) with exactly two decimals; the
 * word `spent` is never rendered — `$` already conveys cost. The reasoning
 * DISPLAY label is exactly `reason` (the data field stays `reasoning`).
 * No glyphs — the labels identify each metric. The panel renders the
 * first (token+cost) line's segments in the main-text tone (spend in the
 * light-red error tone) and the other lines in the derived detail tone;
 * concatenating a line's texts yields its exact rendered string.
 */
export function formatMetricLines(
  view: MetricLineView,
  opts: { cache: CachePref; numbers: NumbersPref },
): [MetricLine, MetricLine, MetricLine] {
  const value = (n: number): string => metricValue(opts.numbers, n)
  const cacheSegment = formatCacheSegment(
    view.cacheRead,
    view.cacheWrite,
    opts.cache,
    opts.numbers,
  )
  const line1: MetricLine = [
    { text: value(totalOf(view)), role: "tokens" },
    labelSegment("tokens"),
    sepSegment,
    { text: fmtCost(view.cost), role: "spend" },
  ]
  const line2: MetricLine = [
    { text: value(view.input), role: "input" },
    labelSegment("input"),
    sepSegment,
    { text: value(realOutput(view.output, view.reasoning)), role: "output" },
    labelSegment("output"),
  ]
  const line3: MetricLine = [
    { text: value(view.reasoning), role: "reasoning" },
    labelSegment("reason"),
    sepSegment,
    { text: cacheSegment.text, role: "cache" },
    labelSegment("cache"),
  ]
  return [line1, line2, line3]
}

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
): MetricSegment[] {
  const total = metricValue(numbers, totalOf(view))
  const cost = fmtCost(view.cost)
  const candidates: MetricSegment[][] = [
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
  // Keep both metrics: truncate the total to make room for the ` · $…`
  // spend marker instead of dropping the spend. `truncateToColumns` never
  // exceeds its budget, so this rung always fits from six columns up.
  const truncatedWithSpend: MetricSegment[] = [
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
    const cacheSegment = formatCacheSegment(
      view.cacheRead,
      view.cacheWrite,
      opts.cache,
      "precise",
    )
    return [
      formatCompactSummary(view, "precise", width),
      formatSingleMetric(value(view.input), "input", "input", width),
      formatSingleMetric(
        value(realOutput(view.output, view.reasoning)),
        "output",
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
  // The ladder always receives the exact five-segment labeled form
  // [value, label, sep, value, label] from formatMetricLines.
  const [v1, label1, sep, v2] = full as [
    MetricSegment,
    MetricSegment,
    MetricSegment,
    MetricSegment,
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

/**
 * One compact agent entry: the `↳` indent, the elastic agent name plus the
 * parenthesized task count, and the per-agent disclosure chevron (`▶`
 * closed / `▼` open) TRAILING the header. The header line reads
 * `↳ <name> (<N> tasks) ▶` (or `↳ <name> (<N> tasks) ▼` while open) — no
 * separator dot between name and count; the indent and chevron are fixed,
 * and the name is measured against the REAL rendered tasks text, the
 * indent and the chevron, truncating to the budget and keeping at least
 * one column. Rows whose tasks segment alone cannot fit are render-site
 * gated.
 */
export function formatAgentLine(
  group: Pick<GroupSummary, "name" | "runs">,
  width: number,
  open: boolean,
): { indent: string; name: string; tasks: string; chevron: string } {
  const tasks = ` (${formatCount(group.runs, "task")})`
  const indent = `${GLYPH.indent} `
  const chevron = ` ${open ? GLYPH.collapse : GLYPH.expand}`
  return {
    indent,
    name: truncateToColumns(
      group.name,
      Math.max(
        1,
        width - textColumns(tasks) - textColumns(indent) - textColumns(chevron),
      ),
    ),
    tasks,
    chevron,
  }
}
