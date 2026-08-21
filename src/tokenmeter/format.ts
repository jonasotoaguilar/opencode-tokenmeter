/**
 * Pure line formatters for the TokenMeter panel — core metric lines and
 * agent entries. Width-elastic detail rows live in `format-detail.ts`;
 * cache-specific formatting lives in `format-cache.ts`.
 *
 * The corrected contract renders labeled metric lines with the two
 * disclosure chevrons `▶`/`▼` as the only per-row glyphs — the Subagents
 * `↳` tree branch and its per-agent chevron included; labels identify
 * each metric. The display label for reasoning tokens is exactly `reason`
 * in every metric row (the underlying data field stays `reasoning`).
 * Every rendered line is column-aware: nothing here emits a fixed-width
 * template string that could overflow the sidebar.
 */

import type { MetricLine, MetricLineView, MetricSegment } from "./format-cache"
import { formatCacheSegment } from "./format-cache"
import { GLYPH } from "./glyphs"
import { realOutput } from "./math"
import { fmtCompact, fmtCost, fmtPrecise } from "./numbers"
import type { CachePref, NumbersPref } from "./settings"
import { textColumns, truncateToColumns } from "./text"
import type { GroupSummary } from "./types"

/**
 * `1 agent` / `2 agents`, `1 task` / `2 tasks` — PLAIN pluralized counts
 * without any glyph, for the labeled metric lines and the agent-list header
 * of the corrected contract (labels + color identify metrics; icons do not
 * repeat). Zero pluralizes like every count beyond one (`0 agents`).
 */
export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

/** The token total of a view: Session (`total`), Project (`context`) or snapshot (`totalTokens`). */
export const totalOf = (view: MetricLineView): number =>
  view.totalTokens ?? view.context ?? view.total ?? 0

/** Value shaping by the `numbers` preference: compact magnitudes vs thousands-separated integers. */
export const metricValue = (numbers: NumbersPref, n: number): string =>
  numbers === "precise" ? fmtPrecise(n) : fmtCompact(n)

/** ` tokens`-style label segment — muted `label` role, one leading space. */
export const labelSegment = (text: string): MetricSegment => ({
  text: ` ${text}`,
  role: "label",
})

/** ` · ` separator segment — muted `sep` role. */
export const sepSegment: MetricSegment = { text: " · ", role: "sep" }

/**
 * The exact three labeled detail lines: `<total> tokens · $<spend>`,
 * `<input> in · <realOutput> out`, `<reasoning> reason · <cache>
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
  const total = totalOf(view)
  const cacheSegment = formatCacheSegment(
    view.cacheRead,
    view.cacheWrite,
    opts.cache,
    opts.numbers,
    total,
  )
  const line1: MetricLine = [
    { text: value(totalOf(view)), role: "tokens" },
    labelSegment("tokens"),
    sepSegment,
    { text: fmtCost(view.cost), role: "spend" },
  ]
  const line2: MetricLine = [
    { text: value(view.input), role: "input" },
    labelSegment("in"),
    sepSegment,
    { text: value(realOutput(view.output, view.reasoning)), role: "output" },
    labelSegment("out"),
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
