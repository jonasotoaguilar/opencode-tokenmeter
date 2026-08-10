// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * Per-agent group rows inside the expanded Subagents list.
 *
 * Each group renders exactly three rows: `  ↳ <robot> <name> · <task> N
 * task` (marker text, robot + name in the SAME theme().primary blue, task
 * count success), then the four-column indented context + thinking + cost
 * row (GROUP_ROW_INDENT), then the four-column indented three-value
 * input · output real · cache row. The name is the elastic segment of row 1
 * and truncates there; the indented metric rows render only when they fit
 * the content width, so a fixed row never overflows. GroupRows is
 * presentational: it renders from the group data and the theme/inner width
 * accessors passed by the panel entry.
 */
import { For, Show } from "solid-js"
import {
  breakdownSegments,
  formatGroupLine,
  formatGroupMeta,
  GROUP_ROW_INDENT,
} from "../format"
import { realOutput } from "../math"
import { textColumns } from "../text"

export function GroupRows(props) {
  const line = () => formatGroupLine(props.group, props.inner())
  const meta = () => formatGroupMeta(props.group)
  const metaText = () => meta().context + meta().thinking + meta().cost
  const breakdown = () =>
    breakdownSegments(
      props.group.input,
      realOutput(props.group.output, props.group.reasoning),
      props.group.cache,
    )
  const breakdownText = () =>
    breakdown()
      .map((segment) => segment.text)
      .join("")
  const rowIndent = () => GROUP_ROW_INDENT
  return (
    <>
      <box flexDirection="row">
        <text fg={props.theme().text}>{line().marker}</text>
        <text fg={props.theme().primary}>{line().robot}</text>
        <text fg={props.theme().primary}>{line().name}</text>
        <text fg={props.theme().success}>{line().tasks}</text>
      </box>
      <Show
        when={
          textColumns(rowIndent()) + textColumns(metaText()) <= props.inner()
        }
      >
        <box flexDirection="row">
          <text fg={props.theme().textMuted}>{rowIndent()}</text>
          <text fg={props.theme().info}>{meta().context}</text>
          <text fg={props.theme().accent}>{meta().thinking}</text>
          <text fg={props.theme().error}>{meta().cost}</text>
        </box>
      </Show>
      <Show
        when={
          textColumns(rowIndent()) + textColumns(breakdownText()) <=
          props.inner()
        }
      >
        <box flexDirection="row">
          <text fg={props.theme().textMuted}>{rowIndent()}</text>
          <For each={breakdown()}>
            {(segment) => (
              <text
                fg={
                  segment.accent
                    ? props.theme().accent
                    : props.theme().textMuted
                }
              >
                {segment.text}
              </text>
            )}
          </For>
        </box>
      </Show>
    </>
  )
}
