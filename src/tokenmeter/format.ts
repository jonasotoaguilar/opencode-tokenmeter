/**
 * Pure line formatters for the TokenMeter panel.
 *
 * Every rendered line is column-aware: nothing here emits a fixed-width
 * template string that could overflow the sidebar. Session and Project share
 * the same two metric rows — row 1 is context + thinking + cost, row 2 is
 * the three-value input · output real · cache breakdown. Each subagent group
 * renders exactly three rows: row 1 keeps the indented tree marker, the
 * muted robot icon, the agent name and the `· <task> N task` run count — the
 * name is the elastic segment, measured against the REAL rendered texts
 * (separator, glyphs and number included), with the marker and the robot
 * icon + two spaces reserved before the name gets to truncate; only when the name
 * cannot keep even one column do the marker and the robot yield. Rows 2 and
 * 3 are indented four columns (GROUP_ROW_INDENT)
 * so their metrics align a bit right of the marker, and are rendered only
 * when they fit the content width, so a fixed metric row never overflows.
 * The breakdown row uses compact token formatting and returns muted
 * segments; the reasoning pair is NOT part of the breakdown anymore —
 * thinking moved to row 1, right after the context tokens, and carries the
 * accent color there. Glyphs carry the meaning, so no textual token labels
 * are rendered next to the numbers.
 */

import { GLYPH } from "./glyphs"
import { fmtCompact, fmtCost, fmtTokens } from "./numbers"
import { textColumns, truncateToColumns } from "./text"
import type { GroupSummary } from "./types"

/** Design budget for the three-value breakdown row (fits the default sidebar content width 36). */
export const MIN_BREAKDOWN_WIDTH = 36

/** Indentation for group rows 2/3: four columns, aligning metrics a bit right of the `  ↳ ` marker. */
export const GROUP_ROW_INDENT = "    "

/** ` · <task> N task` — success-colored (theme().success), on the expanded metrics row and on per-agent group rows alike. */
export function formatTaskCount(count: number): string {
  return ` · ${GLYPH.tasks}  ${count} task`
}

export function formatHeadline(snap: { totalTokens: number }): string {
  return `${GLYPH.hourglass} ${fmtTokens(snap.totalTokens)}`
}

/** ` · <thinking>  N` — accent-colored thinking value, right after the context tokens, with two visible spaces after the glyph. */
export function formatThinking(reasoning: number): string {
  return ` · ${GLYPH.reasoning}  ${fmtTokens(reasoning)}`
}

export function formatCost(cost: number): string {
  return `${GLYPH.fire} ${fmtCost(cost)}`
}

/** The full headline row (context · thinking · cost) as one string, for column measurement and tests. */
export function formatHeadlineRow(
  context: number,
  reasoning: number,
  cost: number,
): string {
  return `${formatHeadline({ totalTokens: context })}${formatThinking(reasoning)} · ${formatCost(cost)}`
}

export type BreakdownSegment = {
  text: string
  /** The breakdown row is fully muted; thinking carries the accent on row 1. */
  accent: boolean
}

/**
 * One colored segment per rendered part of the three-value breakdown row:
 * input · output real · cache, in that order. Concatenating the segment
 * texts yields exactly formatBreakdown, so measurement and rendering can
 * never drift apart. The caller passes the OUTPUT REAL (output + reasoning),
 * computed exactly once from the raw values.
 */
export function breakdownSegments(
  input: number,
  outputReal: number,
  cache: number,
): BreakdownSegment[] {
  return [
    { text: `${GLYPH.up} ${fmtCompact(input)}`, accent: false },
    { text: " · ", accent: false },
    { text: `${GLYPH.down} ${fmtCompact(outputReal)}`, accent: false },
    { text: " · ", accent: false },
    { text: `${GLYPH.cache}  ${fmtCompact(cache)}`, accent: false },
  ]
}

/** The whole three-value breakdown as one string, for column measurement and tests. */
export function formatBreakdown(
  input: number,
  outputReal: number,
  cache: number,
): string {
  return breakdownSegments(input, outputReal, cache)
    .map((segment) => segment.text)
    .join("")
}

/** `🖿 N agents` — text-colored (theme().text, shared with the robot icon and the agent names; the cyan info belongs to the clock), expanded metrics row. */
export function formatAgents(agents: number): string {
  return `${GLYPH.robot}  ${agents} agents`
}

export type GroupLine = {
  /** `  ↳ ` — indented tree marker prefix; "" once the name can no longer keep one column. */
  marker: string
  /** `<robot>  ` — text-colored (theme().text) robot icon plus two trailing spaces, left of the name; "" once the name can no longer keep one column. */
  robot: string
  /** Elastic truncated agent name — text-colored (theme().text) segment; always at least one column. */
  name: string
  /** ` · <task> N task` — right after the name; never leaves row 1. */
  tasks: string
}

/**
 * Splits a group's row 1 into an indented tree-marker prefix, the text-colored
 * robot icon + two spaces, an elastic name segment and the task-count
 * segment. The run count ALWAYS rides row 1; the name budget is measured from
 * the REAL rendered texts (separator, glyphs and number included), never from
 * fixed presets, so longer names and growing run counts compete for the same
 * width. The robot icon and BOTH its trailing spaces are reserved BEFORE the
 * name truncates; the name truncates first, and only when it cannot keep even
 * one column do the marker and the robot yield together.
 */
export function formatGroupLine(
  group: Pick<GroupSummary, "name" | "runs">,
  width: number,
): GroupLine {
  const marker = `  ${GLYPH.tree} `
  const robot = `${GLYPH.robot}  `
  const tasks = formatTaskCount(group.runs)
  const fixedColumns = textColumns(tasks)
  let usedMarker = marker
  let usedRobot = robot
  let nameBudget =
    width - textColumns(marker) - textColumns(robot) - fixedColumns
  if (nameBudget < 1) {
    usedMarker = ""
    usedRobot = ""
    nameBudget = width - fixedColumns
  }
  return {
    marker: usedMarker,
    robot: usedRobot,
    name: truncateToColumns(group.name, Math.max(1, nameBudget)),
    tasks,
  }
}

export type GroupMeta = {
  /** `⌛ context` — info-colored, row 2. */
  context: string
  /** ` · <thinking> N` — accent-colored, right after the context total. */
  thinking: string
  /** ` · <fire> cost` — error-colored, after thinking. */
  cost: string
}

/** Row 2 of a group: context total, thinking value and fire cost. */
export function formatGroupMeta(
  group: Pick<GroupSummary, "total" | "reasoning" | "cost">,
): GroupMeta {
  return {
    context: `${GLYPH.hourglass} ${fmtTokens(group.total)}`,
    thinking: formatThinking(group.reasoning),
    cost: ` · ${formatCost(group.cost)}`,
  }
}
