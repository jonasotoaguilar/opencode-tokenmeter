/**
 * Theme-relative tone derivation for the TokenMeter panel.
 *
 * The tone hierarchy of the final visual contract, using ONLY supported
 * OpenTUI theme roles plus one relative blend through the installed RGBA
 * API (`toInts`/`fromInts` — no arbitrary hex colors anywhere):
 *   1. Section heading TITLES (Project/Session/Subagents) render in the
 *      semantic yellow `theme().warning`; their leading disclosure
 *      chevrons stay in the brightest `theme().text`.
 *   2. Primary token+cost rows render values/labels/separators in
 *      `theme().text` with ONLY the `$amount` in the light-red
 *      `theme().error` tone.
 *   3. Secondary metric rows (input/output/reason/cache) and task
 *      metadata render in a detail tone DERIVED theme-relatively: the
 *      existing `textMuted` role blended 50% toward the active
 *      `background` — substantially dimmer than textMuted,
 *      almost transparent-looking, but still readable.
 */
import { RGBA } from "@opentui/core"

/** The subset of the host theme roles the tone hierarchy reads. */
export type ToneTheme = {
  text: RGBA
  textMuted: RGBA
  background: RGBA
  error: RGBA
}

/**
 * The dimmest readable detail tone: `theme().textMuted` blended 50% toward
 * `theme().background`. Channel-wise 0–255 arithmetic via the installed
 * RGBA API, so the result stays theme-relative in every host theme.
 */
export function detailTone(theme: () => ToneTheme): RGBA {
  const [r, g, b] = theme().textMuted.toInts()
  const [br, bg, bb] = theme().background.toInts()
  return RGBA.fromInts(
    Math.round(r + (br - r) / 2),
    Math.round(g + (bg - g) / 2),
    Math.round(b + (bb - b) / 2),
  )
}

/**
 * The tone of one metric segment: primary token+cost rows (lineIndex 0)
 * render in the main-text tone except the `spend` segment, which renders
 * in the light-red error tone; every other row renders the derived detail
 * tone — separator and token text remain main white on the primary row.
 */
export function segmentTone(
  theme: () => ToneTheme,
  lineIndex: number,
  role: string,
): RGBA {
  if (lineIndex !== 0) return detailTone(theme)
  return role === "spend" ? theme().error : theme().text
}
