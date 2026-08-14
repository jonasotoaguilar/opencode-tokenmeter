/**
 * The contract's glyphs: the disclosure chevrons `▶`/`▼` (U+25B6/U+25BC)
 * and the Subagents agent-entry branch `↳` (U+21B3). Every disclosure row
 * renders its chevron LEFTMOST — the master row, the two section rows and
 * the Subagents global row — while each `↳`-indented compact agent entry
 * renders its per-agent chevron TRAILING the header (`↳ <name> (<N>
 * tasks) ▶` closed / `▼` open). Nothing here is emoji, so every glyph
 * renders as a fixed-width monochrome character.
 */
export const GLYPH = {
  /** Expand/collapse disclosure chevrons — leading for master/sections/Subagents, trailing for agent entries. */
  expand: "▶",
  collapse: "▼",
  /** The Subagents agent-entry branch, leading every compact agent line. */
  indent: "↳",
} as const
