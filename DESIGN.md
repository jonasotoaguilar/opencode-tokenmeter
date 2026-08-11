---
version: alpha
name: TokenMeter Sidebar
description: Theme-driven OpenCode TUI sidebar for token usage, cost, and delegation tree. All color values are semantic roles resolved from the host theme at runtime.
# Reference mapping only: at runtime every role is resolved from ctx.theme.current
# (the host OpenCode theme), which overrides these values. The hues below match
# the semantics documented in code (primary = agent blue, info = context cyan).
colors:
  text: "#E2E8F0"
  textMuted: "#64748B"
  primary: "#38BDF8"
  accent: "#FACC15"
  info: "#22D3EE"
  error: "#F87171"
  success: "#4ADE80"
typography:
  terminal:
    fontFamily: Terminal mono (Nerd Fonts)
    fontFeature: PUA glyphs (Octicons, Material Design, Codicons)
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
    textColor: "{colors.info}"
  metric-row-2:
    textColor: "{colors.textMuted}"
  subagents-toggle:
    textColor: "{colors.accent}"
  agents-row:
    textColor: "{colors.primary}"
  group-row:
    textColor: "{colors.primary}"
  group-meta-row:
    textColor: "{colors.info}"
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

TokenMeter is a read-only sidebar panel for the OpenCode TUI: two metric sections (Project and Session) plus a collapsible per-agent delegation list. The design is **theme-driven and column-aware**: the panel commits no literal palette, typography, or sizing of its own — every color is a semantic role resolved from the host theme (`ctx.theme.current`) at runtime, and every rendered line is measured in terminal columns and truncated to the content width so the terminal can never wrap mid-word. Glyphs are stable monochrome Nerd Font PUA characters (plus the Unicode `↳` tree marker), never emoji.

## Colors

All values are host-theme roles resolved at runtime (`theme()` from the slot context); the frontmatter references are the semantic mapping, not a literal palette. Roles are used by meaning, not by mood:

| Role (host theme) | Used for | Meaning |
| --- | --- | --- |
| `primary` | Agents count row, robot icon, agent names | Delegation identity |
| `info` | Context clock values (headline, group meta) | Token context |
| `accent` | Project/Session labels, thinking values, Subagents label | Section structure and thinking |
| `error` | Cost values, the Project error line | Cost and failures |
| `success` | Task counts (`· task N task`) | Completed work |
| `text` | Title, chevron, group tree marker | Base content |
| `textMuted` | Version, placeholder `…`, group indent, breakdown segments | Secondary content |

The thinking value rides row 1 right after the context clock in `accent` (it is not part of the breakdown); the breakdown row is fully `textMuted` — glyphs carry the meaning, so no textual token labels are rendered next to numbers.

## Typography

The panel uses the terminal's own mono font — no sizes, weights, or families are set by the plugin. Two rules govern characters:

- **Glyphs**: Nerd Font PUA codepoints (Octicons hourglass U+F4E3 / database U+F472, Material Design fire U+F0238 / robot U+F06A9, Codicons tasks U+E20F / reasoning U+EE9C) render as fixed-width monochrome characters when a Nerd Font is active; the delegation tree marker is the plain Unicode curved arrow `↳` (U+21B3) and the up/down arrows are `↑`/`↓`. Without Nerd Fonts the panel degrades (missing glyphs) but never crashes.
- **Width discipline**: every value goes through `textColumns`/`truncateToColumns` — wide and combining codepoints count as real terminal columns, and text is truncated with `…` rather than wrapping.

## Layout

Panel structure, top to bottom, with the content width = sidebar slot width − 2 (one host column each side):

1. **Title row** — `TokenMeter` (`text`) + ` 1.0.0` (`textMuted`), flush left.
2. **Project section** — `Project` accent label + two metric rows (see below); `…` placeholder while no snapshot exists; a single `error` line replaces/joins it on failure.
3. **Session section** — `Session` accent label + the same two metric rows.
4. **Subagents row** — accent label + chevron (`▶` collapsed / `▼` expanded), the ONLY toggle; collapsed shows nothing below it.
5. **Expanded list** — agents metric row (`robot  N agents` in `primary`, ` · task N task` in `success`), then one group block per agent.

**Metric rows (shared by Session and Project):** row 1 is context (`info`) · thinking (`accent`) · cost (`error`), separated by ` · `; row 2 is the muted three-value breakdown `↑ input · ↓ output real · cache`, where output real = raw output + raw reasoning computed exactly once. Both rows render only when they fit the content width (the design budget for the breakdown row is `MIN_BREAKDOWN_WIDTH` = 36 columns, the default sidebar content width).

**Group block (exactly three rows):** row 1 = `  ↳ ` marker (`text`) + robot icon + two spaces + agent name (`primary`, the elastic segment that truncates first) + ` · task N task` (`success`); rows 2 and 3 are indented four columns (`GROUP_ROW_INDENT`) and render only when they fit: row 2 is context · thinking · cost, row 3 the muted breakdown. With 3+ groups the blocks are wrapped in a `scrollbox` capped at 2 groups (6 rows) so 3 groups scroll; fewer groups render plain.

Spacing is fixed-width: two spaces after the title, after glyphs (`⌛  N`, `🖿  N`), and after the robot icon; ` · ` separators between metrics; a four-column indent for group rows 2/3.

## Elevation & Depth

None. The panel is flat terminal text: no shadows, borders, or backgrounds beyond what the host theme applies. Depth is expressed only through the collapse hierarchy (collapsed → expanded list) and the indentation of group rows relative to their marker.

## Shapes

None. No radii, strokes, or frames — everything is a text row in a terminal cell grid. The only geometric element is the `↳` tree marker and the `▶`/`▼` chevrons.

## Components

| Component | Role mapping | Notes |
| --- | --- | --- |
| `title-row` | `text` + `textMuted` | Truncates `TokenMeter` to leave room for the version |
| `section-label` | `accent` | `Project` and `Session` headers |
| `metric-row-1` | `info` + `accent` + `error` | Context · thinking · cost; rendered only if it fits |
| `metric-row-2` | `textMuted` segments | Input · output real · cache; rendered only if it fits |
| `subagents-toggle` | label `accent`, chevron `text` | Click-to-toggle (`onMouseDown`), `selectable={false}`; states: `collapsed` (default, `▶`) / `expanded` (`▼`) |
| `agents-row` | `primary` + `success` | `robot  N agents · task N task`, expanded only |
| `group-row` | marker `text`, robot + name `primary`, tasks `success` | Name truncates before marker/robot yield |
| `group-meta-row` | indent + `info`/`accent`/`error` | Indented 4 columns, fits-only |
| `group-breakdown-row` | `textMuted` | Indented 4 columns, fits-only |
| `placeholder` | `textMuted` | Static `…` — no spinner, no animation |
| `project-error` | `error` | Stable "Unable to load project data", truncated to the content width |
| `scrollbox` | — | 6 rows high, scrollY, `viewportCulling={false}`; only for 3+ groups |

## Do's and Don'ts

- Do: resolve every color from the host theme roles — never hardcode a literal color.
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
