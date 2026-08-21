/**
 * Unit suite for the numeric and line formatters (src/tokenmeter/numbers.ts,
 * src/tokenmeter/format.ts) under the corrected progressive-disclosure
 * contract.
 *
 * Covers the tokenmeter-panel-ui spec:
 *  - `numbers=compact` renders UPPERCASE magnitudes (`152K`, `10M`);
 *    `numbers=precise` renders thousands-separated integers (`1,234,567`)
 *  - counts pluralize in PLAIN text (`1 agent`/`2 agents`, `1 task`/`2 tasks`)
 *    — the corrected contract labels metrics, it does not repeat glyphs
 *  - `formatCacheSegment` returns a role-tagged cache segment:
 *    combined single value, or separated `R45M|W10K` with zero sides omitted
 *    and `0` when both sides are zero
 *  - `formatDetailLines` is mode-aware: compact renders the three labeled
 *    detail rows unbulleted and width-elastic; precise renders exactly
 *    five single-metric rows — labels/` · ` drop first, then values
 *    truncate with `…` — reasoning/cache values are never omitted, and
 *    the reasoning display label is exactly `reason`
 *
 * The pre-correction glyph-based formatters (`formatSectionSummary*`,
 * `breakdownSegments`, `formatTaskCount`/`formatAgents`) were swept from
 * this suite in the Phase 5 final frame sweep: their output (coins/fire/
 * robot/up/down glyphs) is contradicted by the corrected contract ("no
 * repeated metric icons, chevrons are the only per-row glyphs"), and the
 * panels that used them were replaced in Phases 2–4. `formatCachePair`
 * stays — it is a live dependency of the corrected `formatCacheSegment`.
 *
 * All formatters are pure; no mocks needed.
 */
import { describe, expect, test } from "bun:test"
import {
  formatAgentLine,
  formatCount,
  formatMetricLines,
} from "../src/tokenmeter/format"
import {
  formatCachePair,
  formatCachePercent,
  formatCacheSegment,
} from "../src/tokenmeter/format-cache"
import {
  formatCompactSummary,
  formatDetailLines,
} from "../src/tokenmeter/format-detail"
import { fmtCompact, fmtPrecise } from "../src/tokenmeter/numbers"
import { textColumns } from "../src/tokenmeter/text"

describe("fmtPrecise — thousands-separated integers (numbers=precise)", () => {
  test("renders the spec scenario 1234567 as 1,234,567", () => {
    expect(fmtPrecise(1234567)).toBe("1,234,567")
  })

  test("groups thousands and leaves small values plain", () => {
    expect(fmtPrecise(45010000)).toBe("45,010,000")
    expect(fmtPrecise(1000)).toBe("1,000")
    expect(fmtPrecise(999)).toBe("999")
  })

  test("handles zero, larger magnitudes, signs and non-finite in", () => {
    expect(fmtPrecise(0)).toBe("0")
    expect(fmtPrecise(1234567890)).toBe("1,234,567,890")
    expect(fmtPrecise(-1234567)).toBe("-1,234,567")
    expect(fmtPrecise(NaN)).toBe("0")
    expect(fmtPrecise(Infinity)).toBe("0")
  })

  test("renders integer token counts even when the raw value is fractional", () => {
    expect(fmtPrecise(1234.6)).toBe("1,235")
  })
})

describe("fmtCompact — UPPERCASE K/M magnitudes (corrected contract)", () => {
  test("thousands render uppercase K with the whole-number drop", () => {
    expect(fmtCompact(152_000)).toBe("152K")
    expect(fmtCompact(1_000)).toBe("1K")
    expect(fmtCompact(999)).toBe("999")
    expect(fmtCompact(0)).toBe("0")
  })

  test("millions render uppercase M, whole numbers dropping the decimal", () => {
    expect(fmtCompact(1_200_000)).toBe("1.2M")
    expect(fmtCompact(2_000_000)).toBe("2M")
    expect(fmtCompact(10_000_000)).toBe("10M")
  })

  test("large thousands keep the six-column budget (1000K)", () => {
    expect(fmtCompact(999_999)).toBe("1000K")
  })
})

describe("formatCount — plain pluralized counts, no glyph (corrected contract)", () => {
  test("singularizes one and pluralizes many with the plain word", () => {
    expect(formatCount(1, "agent")).toBe("1 agent")
    expect(formatCount(2, "agent")).toBe("2 agents")
    expect(formatCount(1, "task")).toBe("1 task")
    expect(formatCount(2, "task")).toBe("2 tasks")
  })

  test("zero pluralizes like every count beyond one", () => {
    expect(formatCount(0, "agent")).toBe("0 agents")
    expect(formatCount(11, "task")).toBe("11 tasks")
  })
})

describe("formatCachePair — combined vs separated (uppercase, corrected contract)", () => {
  // Spec scenario: cacheRead 45M, cacheWrite 10K.
  const READ = 45_000_000
  const WRITE = 10_000

  test("combined renders ONE value: cacheRead + cacheWrite", () => {
    expect(formatCachePair(READ, WRITE, "combined")).toBe("45M")
    expect(formatCachePair(READ, 0, "combined")).toBe("45M")
    expect(formatCachePair(0, 0, "combined")).toBe("0")
  })

  test("combined with precise numbers renders the summed thousands-separated integer", () => {
    expect(formatCachePair(READ, WRITE, "combined", "precise")).toBe(
      "45,010,000",
    )
  })

  test("separated renders R|W from the same raw values, zero sides omitted", () => {
    expect(formatCachePair(READ, WRITE, "separated")).toBe("R45M|W10K")
    expect(formatCachePair(READ, 0, "separated")).toBe("R45M")
    expect(formatCachePair(0, WRITE, "separated")).toBe("W10K")
    expect(formatCachePair(0, 0, "separated")).toBe("0")
  })

  test("separated with precise numbers separates the thousands-separated sides", () => {
    expect(formatCachePair(READ, WRITE, "separated", "precise")).toBe(
      "R45,000,000|W10,000",
    )
  })

  test("negative sides clamp to zero in every mode", () => {
    expect(formatCachePair(-5, 3000, "separated")).toBe("W3K")
    expect(formatCachePair(-5, -3000, "combined")).toBe("0")
  })
})

describe("formatCacheSegment — role-colored cache MetricSegment (corrected contract)", () => {
  const READ = 45_000_000
  const WRITE = 10_000

  test("separated renders the uppercase R|W pair with the cache role", () => {
    expect(formatCacheSegment(READ, WRITE)).toEqual({
      text: "R45M|W10K",
      role: "cache",
    })
  })

  test("zero sides are omitted; both zero renders 0", () => {
    expect(formatCacheSegment(READ, 0)).toEqual({ text: "R45M", role: "cache" })
    expect(formatCacheSegment(0, WRITE)).toEqual({
      text: "W10K",
      role: "cache",
    })
    expect(formatCacheSegment(0, 0)).toEqual({ text: "0", role: "cache" })
  })

  test("combined renders ONE summed value from the same raw pair", () => {
    expect(formatCacheSegment(READ, WRITE, "combined")).toEqual({
      text: "45M",
      role: "cache",
    })
  })

  test("precise numbers separate the thousands-separated sides", () => {
    expect(formatCacheSegment(READ, WRITE, "separated", "precise")).toEqual({
      text: "R45,000,000|W10,000",
      role: "cache",
    })
  })

  test("negative sides clamp to zero", () => {
    expect(formatCacheSegment(-5, 3000)).toEqual({ text: "W3K", role: "cache" })
  })
})

describe("metricColor is gone — metric tone lives in the panel tone module, never a per-role color map", () => {
  // The semantic color map (panel/colors.ts) was removed with the bulleted
  // detail rows: metric tone now comes from the panel tone module
  // (tone.ts) — the primary token+cost row renders main-text with the
  // `$amount` in the light-red error tone, secondary rows render the
  // derived detail tone. The render suite pins the actual rendering.
  test("the colors module no longer exists", () => {
    const fs = require("node:fs")
    expect(
      fs.existsSync(
        new URL("../src/tokenmeter/panel/colors.ts", import.meta.url),
      ),
    ).toBe(false)
  })
})

/** Spec scenario: 10M total tokens, $92.24 spend, 152K in, 215M real output, 414K reasoning, 212M combined cache. */
const SPEC_VIEW = {
  totalTokens: 10_000_000,
  cost: 92.24,
  input: 152_000,
  output: 214_586_000,
  reasoning: 414_000,
  cacheRead: 212_000_000,
  cacheWrite: 0,
}

const joined = (line: { text: string }[]): string =>
  line.map((segment) => segment.text).join("")

describe("formatMetricLines — exact three labeled lines (corrected contract)", () => {
  test("renders exactly the three spec lines with combined cache", () => {
    const lines = formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    })
    expect(lines).toHaveLength(3)
    expect(joined(lines[0])).toBe("10M tokens · $92.24")
    expect(joined(lines[1])).toBe("152K in · 215M out")
    expect(joined(lines[2])).toBe("414K reason · 212M cache")
  })

  test("real output is output + reasoning, computed from the raw fields", () => {
    const lines = formatMetricLines(
      { ...SPEC_VIEW, output: 10, reasoning: 5 },
      { cache: "combined", numbers: "compact" },
    )
    expect(joined(lines[1])).toBe("152K in · 15 out")
  })

  test("separated cache renders R|W from the same raw pair", () => {
    const lines = formatMetricLines(
      { ...SPEC_VIEW, cacheRead: 45_000_000, cacheWrite: 10_000 },
      { cache: "separated", numbers: "compact" },
    )
    expect(joined(lines[2])).toBe("414K reason · R45M|W10K cache")
  })

  test("precise numbers render thousands-separated values", () => {
    const lines = formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "precise",
    })
    expect(joined(lines[0])).toBe("10,000,000 tokens · $92.24")
    expect(joined(lines[1])).toBe("152,000 in · 215,000,000 out")
    expect(joined(lines[2])).toBe("414,000 reason · 212,000,000 cache")
  })

  test("the spend value is $-prefixed with exactly two decimals, never a bare number or the word", () => {
    const [line1] = formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    })
    expect(joined(line1)).not.toContain("spent")
    expect(joined(line1)).not.toContain("cost")
    expect(joined(line1)).toContain("$92.24")
    const [halfCent] = formatMetricLines(
      { ...SPEC_VIEW, cost: 0.005 },
      { cache: "combined", numbers: "compact" },
    )
    expect(joined(halfCent)).toContain("$0.01")
  })

  test("each line is a sequence of role-colored segments (value, label, sep, value, label)", () => {
    const [line1, line2, line3] = formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    })
    expect(line1.map((s) => s.role)).toEqual([
      "tokens",
      "label",
      "sep",
      "spend",
    ])
    expect(line2.map((s) => s.role)).toEqual([
      "input",
      "label",
      "sep",
      "output",
      "label",
    ])
    expect(line3.map((s) => s.role)).toEqual([
      "reasoning",
      "label",
      "sep",
      "cache",
      "label",
    ])
  })

  test("the token total resolves from totalTokens, context or total", () => {
    const { totalTokens: _total, ...projectView } = SPEC_VIEW
    const project = formatMetricLines(
      { ...projectView, context: 10_000_000 },
      { cache: "combined", numbers: "compact" },
    )
    expect(joined(project[0])).toBe("10M tokens · $92.24")
    const session = formatMetricLines(
      { ...projectView, total: 10_000_000 },
      { cache: "combined", numbers: "compact" },
    )
    expect(joined(session[0])).toBe("10M tokens · $92.24")
  })
})

describe("formatCompactSummary — elastic L1 (corrected contract)", () => {
  test("renders the full line at the default content width", () => {
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 36))).toBe(
      "10M tokens · $92.24",
    )
  })

  test("the full line also fits the narrowest content width (22)", () => {
    // The full line is 19 columns, so it fits the 22-column floor — no
    // label drop needed.
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 22))).toBe(
      "10M tokens · $92.24",
    )
  })

  test("elides the spend value to $… when the full line does not fit", () => {
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 18))).toBe(
      "10M tokens · $…",
    )
    // 15 is still the full labeled form; the ` tokens` label drops at 14.
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 15))).toBe(
      "10M tokens · $…",
    )
  })

  test("drops the tokens label, then truncates the value", () => {
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 14))).toBe(
      "10M · $…",
    )
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 10))).toBe(
      "10M · $…",
    )
    expect(joined(formatCompactSummary(SPEC_VIEW, "compact", 2))).toBe("1…")
  })

  test("every returned candidate fits the requested width", () => {
    for (let width = 2; width <= 36; width += 1) {
      const line = formatCompactSummary(SPEC_VIEW, "compact", width)
      expect(textColumns(joined(line))).toBeLessThanOrEqual(width)
    }
  })

  test("precise numbers and zero cost degrade identically", () => {
    expect(joined(formatCompactSummary(SPEC_VIEW, "precise", 36))).toBe(
      "10,000,000 tokens · $92.24",
    )
    expect(
      joined(formatCompactSummary({ ...SPEC_VIEW, cost: 0 }, "compact", 36)),
    ).toBe("10M tokens · $0.00")
  })

  test("segments keep their semantic roles at every degradation step", () => {
    expect(
      formatCompactSummary(SPEC_VIEW, "compact", 22).map((s) => s.role),
    ).toEqual(["tokens", "label", "sep", "spend"])
    expect(
      formatCompactSummary(SPEC_VIEW, "compact", 10).map((s) => s.role),
    ).toEqual(["tokens", "sep", "spend"])
    expect(
      formatCompactSummary(SPEC_VIEW, "compact", 2).map((s) => s.role),
    ).toEqual(["tokens"])
  })
})

describe("formatDetailLines — mode-aware rows (three compact, five precise)", () => {
  const opts = { cache: "combined", numbers: "compact" } as const
  const precise = { cache: "combined", numbers: "precise" } as const

  test("compact: exactly three labeled rows render at the default width, no per-row glyph", () => {
    const lines = formatDetailLines(SPEC_VIEW, opts, 36)
    expect(lines).toHaveLength(3)
    const [line1, line2, line3] = lines
    expect(line1[0]).toEqual({ text: "10M", role: "tokens" })
    expect(line2[0]).toEqual({ text: "152K", role: "input" })
    expect(line3[0]).toEqual({ text: "414K", role: "reasoning" })
    expect(joined(line1)).toBe("10M tokens · $92.24")
    expect(joined(line2)).toBe("152K in · 215M out")
    expect(joined(line3)).toBe("414K reason · 212M cache")
    expect(joined(line1)).not.toContain("●")
  })

  test("precise: exactly five single-metric rows, the reason label last-word", () => {
    const lines = formatDetailLines(SPEC_VIEW, precise, 36)
    expect(lines).toHaveLength(5)
    expect(joined(lines[0])).toBe("10,000,000 tokens · $92.24")
    expect(joined(lines[1])).toBe("152,000 in")
    expect(joined(lines[2])).toBe("215,000,000 out")
    expect(joined(lines[3])).toBe("414,000 reason")
    expect(joined(lines[4])).toBe("212,000,000 cache")
  })

  test("precise roles keep the metric roles — only the DISPLAY label is reason", () => {
    const lines = formatDetailLines(SPEC_VIEW, precise, 36)
    expect(lines.map((line) => line.map((s) => s.role))).toEqual([
      ["tokens", "label", "sep", "spend"],
      ["input", "label"],
      ["output", "label"],
      ["reasoning", "label"],
      ["cache", "label"],
    ])
  })

  test("precise: all five values stay visible at the section floor (20) and the agent floor (17)", () => {
    // Section detail rows get contentWidth(24) - 2 = 20; agent metric rows
    // get contentWidth(24) - 4 (the `  ↳ ` prefix) - 1 (the scrollbox
    // scrollbar column) = 17. Every value must render — labels/`$…`
    // degrade, a metric is never dropped.
    for (const width of [17, 20, 36]) {
      const lines = formatDetailLines(SPEC_VIEW, precise, width)
      expect(lines).toHaveLength(5)
      expect(joined(lines[0])).toContain("10,000,000")
      expect(joined(lines[1])).toContain("152,000")
      expect(joined(lines[2])).toContain("215,000,000")
      expect(joined(lines[3])).toContain("414,000")
      expect(joined(lines[4])).toContain("212,000,000")
    }
    // The L1 ladder preserves the compact-summary degradation: the spend
    // elides to `$…` before the ` tokens` label drops (same ladder as
    // compact mode), and the total is truncated only after the ` · $…`
    // marker — the spend is never dropped while the total fits.
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 20)[0])).toBe(
      "10,000,000 · $…",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 15)[0])).toBe(
      "10,000,000 · $…",
    )
  })

  test("compact paired rows: labels and the separator drop before values truncate; values never truncate while labeled", () => {
    // The paired input/output row walks its ladder in COMPACT mode: the
    // full labeled pair is 18 columns with `in`/`out` (was 24 with
    // `input`/`output`) — at 25 it fits whole; at 14 the trailing label
    // drops (`152K in · 215M`); at 12 the labels and the separator yield
    // to the values-only pair; below 11 both values truncate with `…`
    // around ` · ` — reasoning/cache values are never omitted. Separated
    // cache degrades through the same ladder.
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 25)[1])).toBe(
      "152K in · 215M out",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 14)[1])).toBe(
      "152K in · 215M",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 12)[1])).toBe(
      "152K · 215M",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 10)[1])).toBe("152K · 21…")
    expect(
      joined(
        formatDetailLines(
          { ...SPEC_VIEW, cacheRead: 45_000_000, cacheWrite: 10_000 },
          { cache: "separated", numbers: "compact" },
          22,
        )[2],
      ),
    ).toBe("414K · R45M|W10K")
  })

  test("precise single-metric rows degrade individually: label drops, then the value truncates — never omitted", () => {
    // `152,000 in` is 10 columns (was 13 with `input`); at 9 the label
    // drops; at 7 the value truncates; below 2 even the ellipsis is the
    // whole row.
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 14)[1])).toBe(
      "152,000 in",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 9)[1])).toBe("152,000")
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 6)[1])).toBe("152,0…")
    expect(joined(formatDetailLines(SPEC_VIEW, precise, 1)[1])).toBe("…")
  })

  test("L1 keeps the compact-summary ladder", () => {
    // 19 is the full labeled line; 17: the spend value elides to `$…`;
    // 11: ` tokens` drops too.
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 26)[0])).toBe(
      "10M tokens · $92.24",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 21)[0])).toBe(
      "10M tokens · $92.24",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 17)[0])).toBe(
      "10M tokens · $…",
    )
    expect(joined(formatDetailLines(SPEC_VIEW, opts, 11)[0])).toBe("10M · $…")
  })

  test("L1 keeps a spend marker when the total must truncate — the spend is never dropped while the total fits", () => {
    // A wide total: `19,700,000 · $…` needs 15 columns; at 14 the total
    // truncates to make room for the ` · $…` marker instead of dropping it.
    const wide = { ...SPEC_VIEW, totalTokens: 19_700_000 }
    expect(joined(formatDetailLines(wide, precise, 16)[0])).toBe(
      "19,700,000 · $…",
    )
    expect(joined(formatDetailLines(wide, precise, 14)[0])).toBe(
      "19,700,0… · $…",
    )
    expect(joined(formatDetailLines(wide, precise, 14)[0])).toContain("$")
  })

  test("every line fits its width; reasoning and cache values render at every two-value width", () => {
    // The values-only minimum is 5 columns (3 for ` · ` + 2 for the `… · …`
    // floor); the contract's narrowest content width is 22. In precise mode
    // rows 3/4 are the reasoning/cache single-metric rows.
    for (let width = 1; width <= 36; width += 1) {
      for (const line of formatDetailLines(SPEC_VIEW, precise, width)) {
        expect(textColumns(joined(line))).toBeLessThanOrEqual(width)
      }
      if (width >= 5) {
        const lines = formatDetailLines(SPEC_VIEW, precise, width)
        expect(
          lines[3].some((s) => s.role === "reasoning" && s.text.length > 0),
        ).toBe(true)
        expect(
          lines[4].some((s) => s.role === "cache" && s.text.length > 0),
        ).toBe(true)
      }
    }
  })
})

describe("formatAgentLine — `↳`-indented elastic name with TRAILING chevron (corrected contract)", () => {
  test("renders the spec compact entry text with the `↳` indent and the trailing chevron", () => {
    expect(formatAgentLine({ name: "General", runs: 5 }, 36, false)).toEqual({
      indent: "↳ ",
      name: "General",
      tasks: " (5 tasks)",
      chevron: " ▶",
    })
    // Open flips the per-agent chevron; the rest of the line is identical.
    expect(formatAgentLine({ name: "General", runs: 5 }, 36, true)).toEqual({
      indent: "↳ ",
      name: "General",
      tasks: " (5 tasks)",
      chevron: " ▼",
    })
  })

  test("the agent line carries the `↳` indent and the trailing chevron; the Subagents global row does not", () => {
    expect(
      formatAgentLine({ name: "General", runs: 5 }, 36, false).indent,
    ).toBe("↳ ")
    expect(
      formatAgentLine({ name: "General", runs: 5 }, 36, false).chevron,
    ).toBe(" ▶")
    expect(
      formatAgentLine({ name: "General", runs: 5 }, 36, true).chevron,
    ).toBe(" ▼")
  })

  test("singularizes one task", () => {
    expect(formatAgentLine({ name: "General", runs: 1 }, 36, false).tasks).toBe(
      " (1 task)",
    )
  })

  test("long names truncate to the width budget INCLUDING the indent and chevron", () => {
    // indent 2 + chevron 2 + tasks 10; at width 19 the name budget is 5.
    expect(
      formatAgentLine({ name: "very-long-agent-name", runs: 5 }, 19, false),
    ).toEqual({
      indent: "↳ ",
      name: "very…",
      tasks: " (5 tasks)",
      chevron: " ▶",
    })
  })

  test("the name keeps at least one column; narrower rows are render-site gated", () => {
    expect(formatAgentLine({ name: "General", runs: 5 }, 5, false)).toEqual({
      indent: "↳ ",
      name: "…",
      tasks: " (5 tasks)",
      chevron: " ▶",
    })
  })

  test("indent + name + tasks + chevron never overflow the width budget once the tasks segment fits", () => {
    // ` (12 tasks)` is 11 columns plus the 2-column `↳ ` indent and the
    // 2-column ` ▶` chevron; below 16 columns the row is render-site gated
    // (documented contract), so the fit invariant holds from 16 up.
    for (let width = 16; width <= 40; width += 1) {
      const line = formatAgentLine(
        { name: "a-very-long-agent-name", runs: 12 },
        width,
        false,
      )
      expect(
        textColumns(line.indent + line.name + line.tasks + line.chevron),
      ).toBeLessThanOrEqual(width)
    }
  })
})

describe("the corrected-contract formatters carry no repeated metric glyphs", () => {
  // The pre-correction metric glyph codepoints (deleted with the glyph diet):
  // fa-coins U+EDE8, oct-database U+F472, md-fire U+F0238, md-robot U+F06A9,
  // task U+E20F, reasoning U+EE9C, up/down arrows. The tree-branch glyph
  // (`↳`, U+21B3) is the Subagents agent-entry indent — the ONLY non-chevron
  // glyph left — so formatter output carries no `●` heading marker and no
  // metric-row glyph.
  const FORBIDDEN = [
    "\uEDE8",
    "\uF472",
    "\u{F0238}",
    "\u{F06A9}",
    "\u{E20F}",
    "\u{EE9C}",
    "↑",
    "↓",
  ]

  test("every formatter output emits labels and values only, never a metric glyph", () => {
    const outputs: string[] = []
    for (const line of formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    }))
      for (const segment of line) outputs.push(segment.text)
    for (let width = 2; width <= 36; width += 2)
      for (const segment of formatCompactSummary(SPEC_VIEW, "compact", width))
        outputs.push(segment.text)
    for (let width = 2; width <= 36; width += 2)
      for (const line of formatDetailLines(
        SPEC_VIEW,
        { cache: "combined", numbers: "compact" },
        width,
      ))
        for (const segment of line) outputs.push(segment.text)
    const agent = formatAgentLine({ name: "General", runs: 5 }, 20, false)
    outputs.push(agent.name, agent.chevron, agent.tasks)
    for (const glyph of FORBIDDEN)
      for (const output of outputs) expect(output).not.toContain(glyph)
  })

  test("no formatter output contains the word spent — $ already conveys cost", () => {
    const outputs: string[] = []
    for (const line of formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    }))
      for (const segment of line) outputs.push(segment.text)
    for (let width = 2; width <= 36; width += 2)
      for (const segment of formatCompactSummary(SPEC_VIEW, "compact", width))
        outputs.push(segment.text)
    for (let width = 2; width <= 36; width += 2)
      for (const line of formatDetailLines(
        SPEC_VIEW,
        { cache: "combined", numbers: "compact" },
        width,
      ))
        for (const segment of line) outputs.push(segment.text)
    const agent = formatAgentLine({ name: "General", runs: 5 }, 20, false)
    outputs.push(agent.name, agent.chevron, agent.tasks)
    for (const output of outputs) expect(output).not.toContain("spent")
  })

  test("the detail rows carry no per-row glyph — the `●` marker is gone from the contract", () => {
    // The `●` heading marker was removed entirely (the section titles now
    // carry the warning tone): formatter output for metric rows emits
    // values and labels only, and the pre-correction metric glyphs must
    // never ride along.
    const opts = { cache: "combined", numbers: "compact" } as const
    const precise = { cache: "combined", numbers: "precise" } as const
    for (let width = 1; width <= 36; width += 2) {
      for (const line of [
        ...formatDetailLines(SPEC_VIEW, opts, width),
        ...formatDetailLines(SPEC_VIEW, precise, width),
      ]) {
        for (const segment of line) {
          expect(segment.text).not.toContain("●")
          expect(segment.text).not.toContain(" ● ")
          for (const glyph of FORBIDDEN) {
            expect(segment.text).not.toContain(glyph)
          }
        }
      }
    }
  })

  test("sidebar labels use in/out (not input/output) everywhere", () => {
    const lines = formatMetricLines(SPEC_VIEW, {
      cache: "combined",
      numbers: "compact",
    })
    expect(joined(lines[1])).toBe("152K in · 215M out")
    expect(joined(lines[1])).not.toContain(" input")
    expect(joined(lines[1])).not.toContain(" output")
    const precise = { cache: "combined", numbers: "precise" } as const
    const detail = formatDetailLines(SPEC_VIEW, precise, 36)
    expect(joined(detail[1])).toBe("152,000 in")
    expect(joined(detail[2])).toBe("215,000,000 out")
  })
})

describe("formatCachePercent — cache share percentage (cache/total*100)", () => {
  test("computes cache / total * 100 as rounded integer percent", () => {
    expect(formatCachePercent(50, 0, 100)).toBe("50%")
    expect(formatCachePercent(25, 25, 100)).toBe("50%")
    expect(formatCachePercent(2100, 0, 43900)).toBe("5%") // footer scenario
  })

  test("total 0 is deterministically 0%", () => {
    expect(formatCachePercent(0, 0, 0)).toBe("0%")
    expect(formatCachePercent(100, 50, 0)).toBe("0%")
    expect(formatCachePercent(0, 0, -10)).toBe("0%")
  })

  test("rounding and clamping", () => {
    expect(formatCachePercent(1, 0, 3)).toBe("33%") // 33.33 -> 33
    expect(formatCachePercent(2, 0, 3)).toBe("67%") // 66.66 -> 67
    expect(formatCachePercent(199, 0, 200)).toBe("100%") // 99.5 -> 100 clamped
    expect(formatCachePercent(100, 100, 100)).toBe("100%") // cache > total would be 200% but clamped to 100
  })

  test("negative cache sides clamp to zero", () => {
    expect(formatCachePercent(-50, 30, 100)).toBe("30%")
    expect(formatCachePercent(-10, -20, 100)).toBe("0%")
  })
})

describe("formatCacheSegment percentage mode — sidebar and footer share the same seam", () => {
  test("percentage mode returns the cache share percent, not R|W or combined", () => {
    const total = 10_000_000
    const seg = formatCacheSegment(
      212_000_000,
      0,
      "percentage",
      "compact",
      total,
    )
    // 212M impossible > total, clamped to 100%
    expect(seg).toEqual({ text: "100%", role: "cache" })
    const small = formatCacheSegment(100, 50, "percentage", "compact", 300)
    expect(small).toEqual({ text: "50%", role: "cache" })
  })

  test("metric lines with percentage cache show percent and in/out labels", () => {
    const view = { ...SPEC_VIEW, cacheRead: 5_000_000, cacheWrite: 0 }
    // SPEC_VIEW total 10M, cache 5M -> 50%
    const lines = formatMetricLines(view, {
      cache: "percentage",
      numbers: "compact",
    })
    expect(joined(lines[1])).toBe("152K in · 215M out")
    expect(joined(lines[2])).toBe("414K reason · 50% cache")
  })

  test("detail lines with percentage cache in precise mode show percent", () => {
    const view = { ...SPEC_VIEW, cacheRead: 5_000_000, cacheWrite: 0 }
    const lines = formatDetailLines(
      view,
      { cache: "percentage", numbers: "precise" },
      36,
    )
    expect(joined(lines[4])).toBe("50% cache")
  })
})
