// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * TokenMeter sidebar panel component — stable module entry; consumers import
 * `UsagePanel` from `./tokenmeter/panel` (resolves to this file).
 *
 * Layout, top to bottom:
 *   `TokenMeter 1.0.0` — clean title row, flush left like Project/Session; no toggle here.
 *   `Project` (accent) + two metric rows — static `…` placeholder while the
 *     lookup/list runs and no snapshot exists yet; a failed refresh shows a
 *     visible error line in theme().error (see project-section.tsx) instead
 *     of a silent placeholder, and when a snapshot already exists the
 *     metrics stay with a compact error line below them. Session is
 *     unaffected.
 *   `Session` (accent) + the same two metric rows.
 *   `Subagents [chevron]` — the ONLY toggle button, right after the accent
 *     label with a visible margin; shown in both states. Collapsed shows
 *     only this row.
 *  Expanded: `🖿 N agents · <task> N task` metrics row (agents primary,
 *     task success), then the per-agent group list, indented — rendered by
 *     GroupRows (group-rows.tsx): exactly three rows per group, the last two
 *     indented four columns. With 3+ groups the rows are wrapped in a
 *     scrollbox capped at 2 groups (6 rows) so 3 groups scroll; with fewer
 *     groups no scrollbox is used.
 *
 * Session and Project share the same two metric rows: row 1 is the spend
 * total (fixed SPEND_GOLD — the coin/token color, never theme-derived), the
 * thinking value right after it (accent), and the fire cost (error); row 2
 * is the muted
 * input · output real · cache read/write breakdown,
 * where output real = raw output + raw reasoning (computed exactly once via
 * realOutput). The metric rows only render when they fit the content
 * width, so a fixed row never overflows; long names truncate on row 1
 * instead. Every line is column-aware and truncated to the content width
 * passed in from the sidebar_content slot ctx/props. Activation runs once on
 * mount so the panel populates on first open, then again on session route
 * changes.
 */
import { createEffect, createMemo, For, on, onMount, Show } from "solid-js"
import {
  breakdownSegments,
  formatAgents,
  formatCost,
  formatHeadline,
  formatHeadlineRow,
  formatTaskCount,
  formatThinking,
} from "../format"
import { GLYPH } from "../glyphs"
import { realOutput } from "../math"
import {
  projectError,
  projectSnapshot,
  scheduleProjectRefresh,
} from "../project"
import { activateRoot } from "../reconcile"
import { snapshot } from "../store"
import { contentWidth, textColumns, truncateToColumns } from "../text"
import { SPEND_GOLD } from "./colors"
import { GroupRows } from "./group-rows"
import { ProjectError } from "./project-section"

/** Scrollbox height for 3+ groups: at most two groups × three rows each. */
const MAX_SCROLLBOX_ROWS = 6
const GROUP_SCROLL_THRESHOLD = 3

export function UsagePanel(props) {
  const theme = () => props.theme()
  const inner = () => contentWidth(props.width ?? 38)

  // Initial activation on first mount: the panel must reconcile and populate
  // as soon as it opens, without depending on a reactive prop change. The
  // deferred effect below covers later sessionID prop updates.
  onMount(() => {
    activateRoot(props.api, props.sessionID)
    scheduleProjectRefresh(props.api)
  })
  createEffect(
    on(
      () => props.sessionID,
      (sid) => activateRoot(props.api, sid),
      { defer: true },
    ),
  )

  const view = createMemo(() => {
    const snap = snapshot()
    return snap && snap.rootID === props.sessionID ? snap : null
  })
  const projectView = () => projectSnapshot()

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg={theme().text}>
          {truncateToColumns(
            "TokenMeter",
            Math.max(1, inner() - textColumns(" 1.0.0")),
          )}
        </text>
        <text fg={theme().textMuted}> 1.0.0</text>
      </box>
      <text fg={theme().accent}>Project</text>
      <Show
        when={projectView()}
        fallback={
          <Show
            when={projectError()}
            fallback={<text fg={theme().textMuted}>…</text>}
          >
            <ProjectError theme={theme} inner={inner} />
          </Show>
        }
      >
        {(project) => (
          <>
            <Show
              when={
                textColumns(
                  formatHeadlineRow(
                    project().context,
                    project().reasoning,
                    project().cost,
                  ),
                ) <= inner()
              }
            >
              <box flexDirection="row">
                <text fg={SPEND_GOLD}>
                  {formatHeadline({ totalTokens: project().context })}
                </text>
                <text fg={theme().accent}>
                  {formatThinking(project().reasoning)}
                </text>
                <text fg={theme().error}>
                  {` · ${formatCost(project().cost)}`}
                </text>
              </box>
            </Show>
            <Show
              when={
                textColumns(
                  breakdownSegments(
                    project().input,
                    realOutput(project().output, project().reasoning),
                    project().cacheRead,
                    project().cacheWrite,
                  )
                    .map((segment) => segment.text)
                    .join(""),
                ) <= inner()
              }
            >
              <box flexDirection="row">
                <For
                  each={breakdownSegments(
                    project().input,
                    realOutput(project().output, project().reasoning),
                    project().cacheRead,
                    project().cacheWrite,
                  )}
                >
                  {(segment) => (
                    <text
                      fg={segment.accent ? theme().accent : theme().textMuted}
                    >
                      {segment.text}
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <ProjectError theme={theme} inner={inner} />
          </>
        )}
      </Show>
      <Show when={view()} fallback={<text fg={theme().textMuted}>…</text>}>
        {(snap) => (
          <>
            <text fg={theme().accent}>Session</text>
            <Show
              when={
                textColumns(
                  formatHeadlineRow(
                    snap().totalTokens,
                    snap().reasoning,
                    snap().cost,
                  ),
                ) <= inner()
              }
            >
              <box flexDirection="row">
                <text fg={SPEND_GOLD}>{formatHeadline(snap())}</text>
                <text fg={theme().accent}>
                  {formatThinking(snap().reasoning)}
                </text>
                <text fg={theme().error}>
                  {` · ${formatCost(snap().cost)}`}
                </text>
              </box>
            </Show>
            <Show
              when={
                textColumns(
                  breakdownSegments(
                    snap().input,
                    realOutput(snap().output, snap().reasoning),
                    snap().cacheRead,
                    snap().cacheWrite,
                  )
                    .map((segment) => segment.text)
                    .join(""),
                ) <= inner()
              }
            >
              <box flexDirection="row">
                <For
                  each={breakdownSegments(
                    snap().input,
                    realOutput(snap().output, snap().reasoning),
                    snap().cacheRead,
                    snap().cacheWrite,
                  )}
                >
                  {(segment) => (
                    <text
                      fg={segment.accent ? theme().accent : theme().textMuted}
                    >
                      {segment.text}
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <box flexDirection="row">
              <text fg={theme().accent}>Subagents</text>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI text element, not DOM; click-to-toggle is the TUI interaction model. */}
              <text
                fg={theme().text}
                selectable={false}
                onMouseDown={() => props.onToggleExpanded()}
              >
                {` ${props.expanded() ? GLYPH.collapse : GLYPH.expand}`}
              </text>
            </box>
            <Show when={props.expanded()}>
              <box flexDirection="row">
                <text fg={theme().primary}>{formatAgents(snap().agents)}</text>
                <text fg={theme().success}>
                  {formatTaskCount(snap().delegations)}
                </text>
              </box>
              <Show
                when={snap().groups.length >= GROUP_SCROLL_THRESHOLD}
                fallback={
                  <For each={snap().groups}>
                    {(group) => (
                      <GroupRows group={group} inner={inner} theme={theme} />
                    )}
                  </For>
                }
              >
                <scrollbox
                  height={MAX_SCROLLBOX_ROWS}
                  scrollY
                  viewportCulling={false}
                >
                  <For each={snap().groups}>
                    {(group) => (
                      <GroupRows group={group} inner={inner} theme={theme} />
                    )}
                  </For>
                </scrollbox>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
