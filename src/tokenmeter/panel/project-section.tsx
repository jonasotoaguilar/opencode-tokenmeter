// @ts-nocheck
/** @jsxImportSource @opentui/solid */
/**
 * Project section error line: the stable PROJECT_ERROR_MESSAGE in
 * theme().error, truncated to the content width so it never overflows —
 * no prefix, no raw runtime message.
 *
 * Project states: while the section has no snapshot yet and no error — the
 * placeholder is a plain static `…` (no animation, no spinner). A failed
 * refresh with no snapshot replaces the placeholder with a single visible
 * line in theme().error showing the stable PROJECT_ERROR_MESSAGE, truncated
 * to the content width so it never overflows; a failed refresh after a
 * snapshot keeps the metrics and adds the same compact error line below
 * them. The error clears itself on the next refresh. Session keeps its own
 * `…` fallback.
 */
import { Show } from "solid-js"
import { projectError } from "../project"
import { truncateToColumns } from "../text"

export function ProjectError(props) {
  return (
    <Show when={projectError()}>
      {(message) => (
        <text fg={props.theme().error}>
          {truncateToColumns(message(), props.inner())}
        </text>
      )}
    </Show>
  )
}
