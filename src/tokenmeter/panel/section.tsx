// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * Parameterized Project/Session section.
 *
 * Compact by default: the header row (left chevron + warning-yellow title
 * text) is followed by ONE width-elastic summary line —
 * `<total> tokens · $<spend>` — nested two columns under the heading; it
 * degrades (elide `$…` → drop ` tokens` → truncate keeping ` · $…`)
 * instead of wrapping at the narrowest content width (22).
 *
 * Replace-on-expand: the compact summary IS detail line 1. Opening REPLACES
 * it with the mode-aware detail rows (`formatDetailLines`), each with the
 * same two-column nested indent beneath the heading; the width ladder
 * degrades elastically (labels/sep drop → `$…` → values `…`-truncate) —
 * no fits-gate omission, values never hidden, no duplicates. Compact
 * number mode renders the three labeled rows; precise number mode renders
 * exactly five single-metric rows. Semantics preserved: real output = raw
 * output + raw reasoning; the cache segment honors the `cache` preference
 * (combined single value vs `R|W` with zero sides omitted) and the
 * `numbers` preference, all from the same raw fields.
 *
 * Tone hierarchy (tone.ts): the primary token+cost line renders in the
 * main-text tone with the `$amount` in the light-red error tone; the
 * input/output and reason/cache lines render in the derived detail tone.
 * The section TITLE text renders in the semantic yellow
 * `theme().warning` — the heading carries no marker glyph of any kind.
 *
 * Loading vs empty is never conflated: no snapshot yet renders the static
 * `…` placeholder; a snapshot with zero usage renders the section's empty
 * copy (`No sessions` for Project, `No usage yet` for Session) whether the
 * section is open or closed. The Project variant keeps the stable error
 * line from project-section.tsx in the fallback and below the data.
 */
import { For, Show } from "solid-js"
import { formatCompactSummary, formatDetailLines } from "../format"
import { GLYPH } from "../glyphs"
import { projectError } from "../project"
import { settings } from "../settings"
import { ProjectError } from "./project-section"
import { segmentTone } from "./tone"

/** The spend total of a section view: Session (`totalTokens`) or Project (`context`). */
const spendOf = (view) =>
  view.totalTokens !== undefined ? view.totalTokens : view.context

/** The nested-list leading indent of every section summary/detail row (2 columns). */
const SUMMARY_INDENT = 2

/**
 * The width-elastic compact summary row of a section view — the L1 rendered
 * by both the section (replace-on-expand detail line 1) and the master
 * disclosure's collapsed branch (the persisted `collapsedSummary` source's
 * summary). Loading `…` and the empty copy are never conflated; the summary
 * segments render in the primary text tone (the `$amount` in the light-red
 * error tone), nested two columns under the heading.
 */
export function SectionSummary(props) {
  const theme = () => props.theme()
  const inner = () => Math.max(0, props.inner() - SUMMARY_INDENT)
  return (
    <Show when={props.view()} fallback={<text fg={theme().textMuted}>…</text>}>
      {(view) => (
        <Show
          when={spendOf(view()) === 0}
          fallback={
            <box paddingLeft={SUMMARY_INDENT} flexDirection="row">
              <For
                each={formatCompactSummary(view(), settings().numbers, inner())}
              >
                {(segment) => (
                  <text fg={segmentTone(theme, 0, segment.role)}>
                    {segment.text}
                  </text>
                )}
              </For>
            </box>
          }
        >
          <text fg={theme().textMuted}>{props.emptyCopy}</text>
        </Show>
      )}
    </Show>
  )
}

export function Section(props) {
  const theme = () => props.theme()
  const numbers = () => settings().numbers
  const cache = () => settings().cache
  const chevron = () => (props.open() ? GLYPH.collapse : GLYPH.expand)
  // The expanded detail rows carry the same two-column nested indent as the
  // compact summary — the data sits two columns beneath the heading in both
  // presentations. The elastic formatter keeps the maximal width budget
  // (inner minus the indent), so the full labeled lines survive at the
  // default panel width and never overflow the content column.
  const DETAIL_INDENT = SUMMARY_INDENT
  const detailLines = (view) =>
    formatDetailLines(
      view,
      { cache: cache(), numbers: numbers() },
      Math.max(0, props.inner() - DETAIL_INDENT),
    )
  return (
    <>
      <box flexDirection="row">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
        <text fg={theme().text} selectable={false} onMouseDown={props.onToggle}>
          {`${chevron()} `}
        </text>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; the section title-text click toggles disclosure (spec: chevron OR title-text). The complete title renders in the semantic yellow theme().warning. */}
        <text
          fg={theme().warning}
          selectable={false}
          onMouseDown={props.onToggle}
        >
          {props.title}
        </text>
      </box>
      <Show
        when={props.view()}
        fallback={
          <Show
            when={props.variant === "project" && projectError()}
            fallback={<text fg={theme().textMuted}>…</text>}
          >
            <ProjectError theme={props.theme} inner={props.inner} />
          </Show>
        }
      >
        {(view) => (
          <>
            <Show
              when={props.open()}
              fallback={
                <SectionSummary
                  view={view}
                  emptyCopy={props.emptyCopy}
                  theme={props.theme}
                  inner={props.inner}
                />
              }
            >
              <Show
                when={spendOf(view()) === 0}
                fallback={
                  /* Replace-on-expand: the mode-aware detail rows (L1 once
                     plus the labeled metric rows) replace the compact
                     summary — no duplicates, no fits-gate omission, values
                     never hidden. Tone hierarchy (tone.ts): the primary
                     token+cost line (index 0) renders in the main-text tone
                     with the $amount in light red; the input/output and
                     reason/cache lines render in the derived detail tone. */
                  <For each={detailLines(view())}>
                    {(line, index) => (
                      <box paddingLeft={DETAIL_INDENT} flexDirection="row">
                        <For each={line}>
                          {(segment) => (
                            <text
                              fg={segmentTone(theme, index(), segment.role)}
                            >
                              {segment.text}
                            </text>
                          )}
                        </For>
                      </box>
                    )}
                  </For>
                }
              >
                <text fg={theme().textMuted}>{props.emptyCopy}</text>
              </Show>
            </Show>
            <Show when={props.variant === "project"}>
              <ProjectError theme={props.theme} inner={props.inner} />
            </Show>
          </>
        )}
      </Show>
    </>
  )
}
