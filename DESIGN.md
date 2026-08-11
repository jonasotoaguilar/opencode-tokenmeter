---
version: alpha
name: TokenMeter Sidebar
description: Theme-driven OpenCode TUI sidebar for token usage, cost, and delegation tree. All color values are semantic roles resolved from the host theme at runtime, EXCEPT the spend coin+number which is a fixed coin-gold identity.
# Reference mapping only: at runtime every role is resolved from ctx.theme.current
# (the host OpenCode theme), which overrides these values — EXCEPT spendGold,
# the one fixed semantic color that is never theme-derived. The hues below match
# the semantics documented in code (primary = agent blue, accent = theme accent,
# spendGold = fixed coin gold).
colors:
  text: "#E2E8F0"
  textMuted: "#64748B"
  primary: "#38BDF8"
  accent: "#FACC15"
  spendGold: "#D4AF37"
  info: "#22D3EE"
  error: "#F87171"
  success: "#4ADE80"
typography:
  terminal:
    fontFamily: Terminal mono (Nerd Fonts)
    fontFeature: PUA glyphs (Font Awesome, Octicons, Material Design, Codicons)
spacing:
  s1: 1col
  s2: 2col
  s4: 4col
components:
  panel:
    padding: 0
    width: 38
  title-row:
    textColor: "{colors.text}"
  section-label:
    textColor: "{colors.accent}"
  metric-row-1:
    spend: "{colors.spendGold}"
    thinking: "{colors.accent}"
    cost: "{colors.error}"
  metric-row-2:
    textColor: "{colors.textMuted}"
  subagents-toggle:
    textColor: "{colors.accent}"
  agents-row:
    textColor: "{colors.primary}"
  group-row:
    textColor: "{colors.primary}"
  group-meta-row:
    spend: "{colors.spendGold}"
    thinking: "{colors.accent}"
    cost: "{colors.error}"
  group-breakdown-row:
    textColor: "{colors.textMuted}"
  project-error:
    textColor: "{colors.error}"
  placeholder:
    textColor: "{colors.textMuted}"
  scrollbox:
    height: 6rows
---

## Overview

TokenMeter is a read-only sidebar panel for the OpenCode TUI: two metric sections (Project and Session) plus a collapsible per-agent delegation list. The design is **theme-driven and column-aware**: the panel commits no literal palette, typography, or sizing of its own — every color is a semantic role resolved from the host theme (`ctx.theme.current`) at runtime — with exactly ONE exception: the spend coin+number semantic color is fixed at `#D4AF37` (classic coin gold, `spendGold`), a guaranteed identity that must not follow host-theme accent. Every rendered line is measured in terminal columns and truncated to the content width so the terminal can never wrap mid-word. Glyphs are stable monochrome Nerd Font PUA characters (plus the Unicode `↳` tree marker), never emoji.

## Colors

The runtime palette has two sources: host theme roles from `ctx.theme.current`, and one fixed product color for token spend. The hex values in frontmatter are reference swatches for theme roles; only `spendGold` is guaranteed at runtime.

| Token | Runtime source | Reference/fixed color | Used for |
| --- | --- | --- | --- |
| `spendGold` | Plugin constant `SPEND_GOLD` | **`#D4AF37` (fixed)** | Fa-coins glyph + cumulative token-spend number |
| `primary` | `theme().primary` | `#38BDF8` reference | Agent count, robot icon, agent names |
| `accent` | `theme().accent` | `#FACC15` reference | Project/Session labels, thinking, Subagents label |
| `error` | `theme().error` | `#F87171` reference | Cost and Project errors |
| `success` | `theme().success` | `#4ADE80` reference | Task counts |
| `text` | `theme().text` | `#E2E8F0` reference | Title, chevron, tree marker |
| `textMuted` | `theme().textMuted` | `#64748B` reference | Version, placeholder, indents, breakdowns |
| `info` | `theme().info` | `#22D3EE` reference | Reserved; currently unused |

The headline spend total rides row 1 right after the section label in the fixed `spendGold` (coin gold `#D4AF37`) — the coin/token color is a guaranteed identity, never the theme accent, so a host that maps accent to pink still renders gold spend totals — followed by the thinking value in `accent` (thinking is not part of the breakdown); the breakdown row is fully `textMuted` — glyphs carry the meaning, so no textual token labels are rendered next to numbers.

## Typography

The panel uses the terminal's own mono font — no sizes, weights, or families are set by the plugin. Two rules govern characters:

- **Glyphs**: Nerd Font PUA codepoints (Font Awesome coins U+EDE8 / Octicons database U+F472, Material Design fire U+F0238 / robot U+F06A9, Codicons tasks U+E20F / reasoning U+EE9C) render as fixed-width monochrome characters when a Nerd Font is active; the delegation tree marker is the plain Unicode curved arrow `↳` (U+21B3) and the up/down arrows are `↑`/`↓`. The coins glyph (U+EDE8, fa-coins) is the token-spend headline for Session, Project and group rows. The database glyph renders cache as `🖿  R<read>|W<write>` when both sides are non-zero, only the non-zero side otherwise, or `🖿  0` when both are zero. Without Nerd Fonts the panel degrades (missing glyphs) but never crashes.
- **Width discipline**: every value goes through `textColumns`/`truncateToColumns` — wide and combining codepoints count as real terminal columns, and text is truncated with `…` rather than wrapping.

## Layout

Panel structure, top to bottom, with the content width = sidebar slot width − 2 (one host column each side):

1. **Title row** — `TokenMeter` (`text`) + ` 1.0.0` (`textMuted`), flush left.
2. **Project section** — `Project` accent label + two metric rows (see below); `…` placeholder while no snapshot exists; a single `error` line replaces/joins it on failure.
3. **Session section** — `Session` accent label + the same two metric rows.
4. **Subagents row** — accent label + chevron (`▶` collapsed / `▼` expanded), the ONLY toggle; collapsed shows nothing below it.
5. **Expanded list** — agents metric row (`robot  N agents` in `primary`, ` · task N task` in `success`), then one group block per agent.

**Metric rows (shared by Session and Project):** row 1 is the token spend total (`spendGold`, the fa-coins glyph) · thinking (`accent`) · cost (`error`), separated by ` · `; row 2 is the muted three-value breakdown `↑ input · ↓ output real · 🖿  cache`, where output real = raw output + raw reasoning computed exactly once. Cache uses `R<read>|W<write>` when both sides are non-zero, only `R<read>` or `W<write>` when the other side is zero, and `0` when both are zero. Both rows render only when they fit the content width (the design budget for the breakdown row is `MIN_BREAKDOWN_WIDTH` = 36 columns, the default sidebar content width).

**Group block (exactly three rows):** row 1 = `  ↳ ` marker (`text`) + robot icon + two spaces + agent name (`primary`, the elastic segment that truncates first) + ` · task N task` (`success`); rows 2 and 3 are indented four columns (`GROUP_ROW_INDENT`) and render only when they fit: row 2 is spend (`spendGold`) · thinking (`accent`) · cost (`error`), row 3 the muted breakdown. With 3+ groups the blocks are wrapped in a `scrollbox` capped at 2 groups (6 rows) so 3 groups scroll; fewer groups render plain.

Spacing is fixed-width: two spaces after the title, after glyphs (`coins  N`, `🖿  R…|W…`), and after the robot icon; ` · ` separators between metrics; a four-column indent for group rows 2/3.

## Elevation & Depth

None. The panel is flat terminal text: no shadows, borders, or backgrounds beyond what the host theme applies. Depth is expressed only through the collapse hierarchy (collapsed → expanded list) and the indentation of group rows relative to their marker.

## Shapes

None. No radii, strokes, or frames — everything is a text row in a terminal cell grid. The only geometric element is the `↳` tree marker and the `▶`/`▼` chevrons.

## Components

| Component | Role mapping | Notes |
| --- | --- | --- |
| `title-row` | `text` + `textMuted` | Truncates `TokenMeter` to leave room for the version |
| `section-label` | `accent` | `Project` and `Session` headers |
| `metric-row-1` | `spendGold` + `accent` + `error` | Spend · thinking · cost; rendered only if it fits |
| `metric-row-2` | `textMuted` segments | Input · output real · conditional cache R/W; rendered only if it fits |
| `subagents-toggle` | label `accent`, chevron `text` | Click-to-toggle (`onMouseDown`), `selectable={false}`; states: `collapsed` (default, `▶`) / `expanded` (`▼`) |
| `agents-row` | `primary` + `success` | `robot  N agents · task N task`, expanded only |
| `group-row` | marker `text`, robot + name `primary`, tasks `success` | Name truncates before marker/robot yield |
| `group-meta-row` | indent + `spendGold`/`accent`/`error` | Indented 4 columns, fits-only |
| `group-breakdown-row` | `textMuted` | Indented 4 columns, fits-only |
| `placeholder` | `textMuted` | Static `…` — no spinner, no animation |
| `project-error` | `error` | Stable "Unable to load project data", truncated to the content width |
| `scrollbox` | — | 6 rows high, scrollY, `viewportCulling={false}`; only for 3+ groups |

## Do's and Don'ts

- Do: resolve colors from host theme roles except the documented `SPEND_GOLD = #D4AF37` product identity; never introduce another literal color without updating this contract.
- Don't: render a line that can exceed the content width — measure first, truncate with `…`.
- Do: keep raw output and raw reasoning separate in aggregation; display output real = output + reasoning computed once at the formatting boundary.
- Don't: use emoji as functional icons — use the stable monochrome Nerd Font glyphs.
- Do: let the agent name be the elastic segment on a group row; only when it cannot keep one column do the marker and robot yield.
- Don't: add spinners or animations — the placeholder is a static `…` and loading never animates.
- Do: keep the collapse state persistent (`tokenmeter.sidebar.expanded`), collapsed by default.

## Content & States

- **Collapsed (default)**: only the title, Project, Session, and the `Subagents ▶` row are visible.
- **Expanded**: agents metric row + per-agent group blocks (scrolled at 3+ groups).
- **Placeholder**: a section with no snapshot yet shows a plain `…`; Project failure with no snapshot replaces it with one `error` line; failure after a snapshot keeps the metrics and adds the compact error line below; the error clears on the next refresh. Session keeps its own `…` fallback and is never touched by a Project failure.
- **Empty first open**: a session with no usage stays on the placeholder until usage or delegations arrive — an empty load is provisional, never a frozen zero.

## Responsive Behavior

The sidebar width comes from the slot context/props chain (width → columns → cols → size → viewport → bounds) with fallback **38**, clamped to **24–52**. The content width floors at 10 columns; metric and group rows render only when they fit, so the panel degrades gracefully on narrow sidebars instead of overflowing.
