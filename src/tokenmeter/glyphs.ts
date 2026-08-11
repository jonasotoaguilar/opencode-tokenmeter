/**
 * Stable monochrome Nerd Font glyphs for the TokenMeter sidebar.
 *
 * All codepoints live in the PUA ranges shipped by the installed Nerd Fonts
 * (Octicons + Material Design + Codicons) — no icon library is loaded and nothing here is
 * emoji, so every glyph renders as a fixed-width monochrome character. The
 * expanded-group tree marker is the plain Unicode curved arrow "↳" (U+21B3),
 * matching the reference plugin's line style.
 */
export const GLYPH = {
  /** oct-hourglass — context used (headline and group totals). */
  hourglass: "\uF4E3",
  /** oct-database — cumulative cache tokens. */
  cache: "\uF472",
  /** md-fire (U+F0238, plane-15 PUA) — native cost, root and group summary lines. */
  fire: "\u{F0238}",
  /** md-robot (U+F06A9, plane-15 PUA) — subagent count. */
  robot: "\u{F06A9}",
  /** U+E20F (PUA, narrow) — task counts, root delegations and group rows. */
  tasks: "\u{E20F}",
  /** U+EE9C (PUA, narrow) — reasoning tokens, accent-colored. */
  reasoning: "\u{EE9C}",
  /** Direction arrows for the cumulative in/out breakdown. */
  up: "↑",
  down: "↓",
  /** Expand/collapse chevrons for the kv-persisted group list. */
  expand: "▶",
  collapse: "▼",
  /** Curved tree arrow for expanded group lines. */
  tree: "↳",
} as const
