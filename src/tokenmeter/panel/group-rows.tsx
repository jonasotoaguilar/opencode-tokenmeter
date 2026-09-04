// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * Per-agent accordion entries inside the expanded Subagents scrollbox.
 *
 * Each compact entry renders exactly two lines: the `↳`-indented header
 * `↳ <name> (<N> tasks) ▶` (the `↳` branch and the TRAILING per-agent
 * chevron in the main-text tone, agent name in the light-blue/cyan
 * `theme().info` tone, task count and parentheses in the derived detail
 * tone — every part click-to-toggle; the chevron flips `▶` → `▼` while
 * open) and the width-elastic compact L1 `<total> tokens · $<spend>` in
 * the primary text tone (the `$amount` in light red). The header carries a
 * two-column leading indent beneath the Subagents row, and the metric
 * lines a four-column indent aligned under the agent name, after the full
 * `  ↳ ` prefix, so the list reads as a nested tree.
 *
 * Replace-on-expand: opening REPLACES the compact L1 with the mode-aware
 * detail rows (`formatDetailLines` — compact: the three labeled rows,
 * precise: five single-metric rows; the L1 renders the same spend line
 * exactly once, no duplicates, no fits-gate: detail rows degrade
 * elastically, never omitted). The `↳` header stays put and its trailing
 * per-agent chevron flips `▼`. Tone hierarchy (tone.ts): the primary
 * token+cost line (compact summary and expanded L1) renders in the
 * main-text tone with the `$amount` in light red; the input/output and
 * reason/cache lines render in the derived detail tone — the same tone as
 * the `(N tasks)` metadata. Exclusivity belongs to the panel
 * (`openGroupIndex` holds the open group's INDEX): this component is
 * presentational — `open` decides whether the detail lines render,
 * `onToggle` flips it.
 */
import { For, Show } from "solid-js"
import { formatAgentLine } from "../format"
import { formatCompactSummary, formatDetailLines } from "../format-detail"
import { settings } from "../settings"
import { detailTone, segmentTone } from "./tone"

// The nested-list leading indent of every agent header row (2 columns),
// subtracted from the width budget so a padded row never overflows the
// content column.
const GROUP_INDENT = 2

// The nested-list indent of every agent metric row (4 columns — aligned
// under the header's agent name, after the `↳` branch: `  ↳ `), with its
// own width budget.
const AGENT_METRIC_INDENT = 4

// The scrollbox renders a one-column scrollbar whenever its content
// overflows the six-row viewport, so every
// row budget inside the scrollbox reserves that column — a full-budget row
// must never clip into the scrollbar.
const SCROLLBAR_COL = 1

export function GroupRows(props) {
  const theme = () => props.theme()
  const numbers = () => settings().numbers
  const cache = () => settings().cache
  const inner = () => Math.max(0, props.inner() - GROUP_INDENT - SCROLLBAR_COL)
  const metricInner = () =>
    Math.max(0, props.inner() - AGENT_METRIC_INDENT - SCROLLBAR_COL)
  const agent = () => formatAgentLine(props.group, inner(), props.open())
  const summary = () =>
    formatCompactSummary(props.group, numbers(), metricInner())
  const detailLines = () =>
    formatDetailLines(
      props.group,
      { cache: cache(), numbers: numbers() },
      metricInner(),
    )
  return (
    <>
      <box paddingLeft={GROUP_INDENT} flexDirection="row">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
        <text fg={theme().text} selectable={false} onMouseDown={props.onToggle}>
          {agent().indent}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
        <text fg={theme().info} selectable={false} onMouseDown={props.onToggle}>
          {agent().name}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
        <text
          fg={detailTone(theme)}
          selectable={false}
          onMouseDown={props.onToggle}
        >
          {agent().tasks}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; the trailing per-agent chevron click toggles the entry (the whole header is the click target). */}
        <text fg={theme().text} selectable={false} onMouseDown={props.onToggle}>
          {agent().chevron}
        </text>
      </box>
      <Show
        when={props.open()}
        fallback={
          <box paddingLeft={AGENT_METRIC_INDENT} flexDirection="row">
            <For each={summary()}>
              {(segment) => (
                <text fg={segmentTone(theme, 0, segment.role)}>
                  {segment.text}
                </text>
              )}
            </For>
          </box>
        }
      >
        {/* The mode-aware detail rows replace the compact L1 when open —
            the L1 is the same spend line exactly once; the fits-gate that
            omitted non-fitting detail rows is gone. Tone hierarchy
            (tone.ts): the primary token+cost line (index 0) renders in the
            main-text tone with the $amount in light red; the input/output
            and reason/cache lines render in the derived detail tone. */}
        <For each={detailLines()}>
          {(line, index) => (
            <box paddingLeft={AGENT_METRIC_INDENT} flexDirection="row">
              <For each={line}>
                {(segment) => (
                  <text fg={segmentTone(theme, index(), segment.role)}>
                    {segment.text}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </Show>
    </>
  )
}
