---
version: alpha
name: TokenMeter Sidebar
description: Theme-driven OpenCode TUI sidebar for token usage, cost, and delegation tree. All colors are semantic roles resolved from the host theme at runtime, plus one theme-relative derived detail tone; no fixed product color.
# Reference mapping only: at runtime every role is resolved from ctx.theme.current
# (the host OpenCode theme), which overrides these values. The hues below match
# the semantics documented in code (warning = semantic yellow section headings,
# info = cyan agent names, error = light-red spend amounts; the secondary-row
# detail tone is derived theme-relatively from textMuted toward background).
colors:
  text: "#E2E8F0"
  textMuted: "#64748B"
  background: "#1E1E2E"
  warning: "#FACC15"
  info: "#22D3EE"
  error: "#F87171"
typography:
  terminal:
    fontFamily: Terminal mono
    fontFeature: Unicode disclosure glyphs (▶ ▼ ↳)
spacing:
  s1: 1col
  s2: 2col
  s4: 4col
components:
  panel:
    padding: 0
    width: 38
  master-row:
    textColor: "{colors.text}"
  section-heading:
    textColor: "{colors.warning}"
  primary-row:
    textColor: "{colors.text}"
    spend: "{colors.error}"
  secondary-row:
    textColor: "{colors.textMuted}"
  subagents-heading:
    textColor: "{colors.warning}"
  subagents-count:
    textColor: "{colors.textMuted}"
  agents-row:
    name: "{colors.info}"
    tasks: "{colors.textMuted}"
  project-error:
    textColor: "{colors.error}"
  placeholder:
    textColor: "{colors.textMuted}"
  scrollbox:
    height: 4rows
---

## Overview

TokenMeter is a read-only sidebar panel for the OpenCode TUI: three sections (Project, Session, and the Subagents delegation list) under a master disclosure row. The design is **theme-driven and column-aware**: the panel commits no literal palette, typography, or sizing of its own — every color is a semantic role resolved from the host theme (`ctx.theme.current`) at runtime, and the one derived tone (for secondary rows) is computed theme-relatively from the active `textMuted` and `background` roles, never a fixed hex. Every rendered line is measured in terminal columns and truncated to the content width so the terminal can never wrap mid-word. Glyphs are plain Unicode disclosure characters (`▶`/`▼`/`↳`), never emoji and never Nerd Font PUA codepoints.

## Colors

The runtime palette has one source: host theme roles from `ctx.theme.current`, plus one derived tone computed theme-relatively at render time. The hex values in frontmatter are reference swatches for theme roles; no color is guaranteed at runtime except through the host theme.

| Token | Runtime source | Reference color | Used for |
| --- | --- | --- | --- |
| `warning` | `theme().warning` | `#FACC15` | Section heading titles — `Project`, `Session`, `Subagents` (semantic yellow) |
| `text` | `theme().text` | `#E2E8F0` | Master chevron + `TokenMeter` title, leading section chevrons, primary-row values/labels/separators, agent `↳` branch and trailing chevron |
| `error` | `theme().error` | `#F87171` | The `$amount` on primary token+cost rows (light red) and the Project error line |
| `info` | `theme().info` | `#22D3EE` | Agent names on the `↳` header rows (cyan) |
| `textMuted` | `theme().textMuted` | `#64748B` | Placeholder `…`, empty copy, collapsed Subagents aggregate counts |
| `detail` | Derived: `theme().textMuted` blended 50% toward `theme().background` | — | Secondary metric rows (input/output/reason/cache) and the `(N tasks)` metadata |

The primary token+cost line renders `<total> tokens · $<spend>` in the main text tone with ONLY the `$amount` in the light-red `error` tone; the word `spent` is never rendered. Secondary rows render the derived `detail` tone — substantially dimmer than `textMuted`, almost transparent-looking, but still readable in every host theme. Section heading titles render in the semantic yellow `theme().warning` with no marker glyph of any kind; their leading disclosure chevrons stay in the main-text tone.

## Typography

The panel uses the terminal's own mono font — no sizes, weights, or families are set by the plugin. Two rules govern characters:

- **Glyphs**: disclosure chevrons `▶` (U+25B6) / `▼` (U+25BC) and the agent-entry branch `↳` (U+21B3) — plain Unicode characters that render in any terminal font; no Nerd Font is required. The master row, the two section rows and the Subagents heading render their chevron LEFTMOST; each `↳`-indented agent entry renders its per-agent chevron TRAILING the header (`↳ name (N tasks) ▶` closed / `↳ name (N tasks) ▼` open). The footer prompt row (session_prompt_right) uses compact metric icons `↑`/`↓`/`󰆼`/`󰧑`/`Σ` with ` · ` separators in the muted prompt tone — `↑` input, `↓` output, `󰆼` cache (or cache percent), `󰧑` reasoning, `Σ` total — rendered as single codepoints and measured via `textColumns`. Nothing here is emoji.
- **Width discipline**: every value goes through `textColumns`/`truncateToColumns` — wide and combining codepoints count as real terminal columns, and text is truncated with `…` rather than wrapping.

## Layout

Panel structure, top to bottom, with the content width = sidebar slot width − 2 (one host column each side):

1. **Master disclosure row** — `▶/▼ TokenMeter` (`text`), chevron leftmost; chevron OR title click toggles. Transient: starts expanded, resets on session change, never persisted. Collapsed renders `▶ TokenMeter` plus EXACTLY ONE compact summary (the elastic L1 of the persisted `collapsedSummary` source — session or project) and no other rows.
2. **Project section** — `Project` heading title in `warning` with a leading `▶/▼` chevron in `text`; one compact summary row (`<total> tokens · $<spend>`) nested two columns under the heading; `…` placeholder while no snapshot exists; a single `error` line replaces/joins it on failure.
3. **Session section** — `Session` heading, same contract; empty copy `No usage yet`.
4. **Subagents section** — rendered ONLY while the snapshot has at least one group (zero groups → no heading, no scrollbox, no 0-count caption; it appears automatically with the first group). Collapsed: `▶ Subagents (N agents · M tasks)` — heading in `warning`, aggregate counts in `textMuted`. Expanded: `▼ Subagents` (no aggregate — the list is the detail) followed by a real scrollbox (viewport 4 rows) holding ALL groups.
5. **Agent entries** — per-agent accordion rows: `↳ name (N tasks) ▶` (closed) / `↳ name (N tasks) ▼` (open) — the `↳` branch and the trailing chevron in `text`, agent name in `info`, `(N tasks)` in the detail tone; two-column leading indent under the Subagents heading, the width-elastic compact L1 below; opening REPLACES the compact L1 with the mode-aware detail rows (compact: three, precise: five — L1 once). Exactly one agent is open at a time (index-keyed, transient, never persisted).

**Metric rows (shared by Session, Project, and every agent entry):** the primary token+cost line is `<total> tokens · $<spend>` (`text` with the `$amount` in `error`; the word `spent` is never rendered); the secondary rows are `<input> in · <output> out` and `<reason> reason · <cache> cache` in the derived detail tone, where real output = raw output + raw reasoning computed exactly once and the reasoning label is exactly `reason`. In `compact` number mode exactly three labeled rows render (primary + paired in/out + paired reason/cache); in `precise` mode exactly five single-metric rows (tokens+cost, in, out, reason, cache). Cache renders, by default, a percentage `cache / total * 100` as integer percent (`0%` when total is 0); `combined` shows a single summed value and `separated` shows `R<read>|W<write>` with zero sides omitted and `0` when both are zero. `percentage` is the default; existing valid `combined`/`separated` values are preserved.

**Footer prompt row (session_prompt_right):** the inline prompt metric renders only the current session's own high-water usage at the right end of the native prompt's agent/model row. Enabled metrics render in fixed order `Σ total · ↑in · ↓out · 󰧑 reason · 󰆼 cache` (example values: `↑71k`, `↓4.4k`, `󰆼 99k` or `󰆼 42%` under `percentage` mode, `󰧑 1.2k`, `Σ 80k`) — icon-first, ` · ` separated, muted prompt tone, truncated with `…` to the terminal width. Cache in `percentage` mode shows the same `cache / total * 100` integer percent semantics as the sidebar, sourced from the single `cache` setting. The total icon `Σ` is the project's chosen total glyph: plain Unicode summation sign, semantically “total sum”, requiring no icon library.

**Agent entries and scrollbox:** each agent entry is a `↳`-indented header plus metric rows indented four columns (`AGENT_METRIC_INDENT`) aligned under the agent name; inside the scrollbox every row budget reserves one scrollbar column. With the section expanded, ALL groups render inside the scrollbox (viewport 4 — roughly two compact entries) and scroll; nothing is sliced and no clipped cue is rendered.

Spacing is fixed-width: two columns nest summary/detail rows under section headings, four columns indent agent metric rows; ` · ` separates metrics and joins the Subagents aggregate counts.

## Elevation & Depth

None. The panel is flat terminal text: no shadows, borders, or backgrounds beyond what the host theme applies. Depth is expressed only through the collapse hierarchy (collapsed → expanded list) and the indentation of group rows relative to their marker.

## Shapes

None. No radii, strokes, or frames — everything is a text row in a terminal cell grid. The only geometric element is the `↳` tree marker and the `▶`/`▼` chevrons.

## Components

| Component | Role mapping | Notes |
| --- | --- | --- |
| `master-row` | `text` | `▶/▼ TokenMeter`, chevron leftmost; chevron OR title click toggles; transient (starts expanded, never kv) |
| `section-heading` | title `warning`, chevron `text` | `Project`/`Session`/`Subagents` heading titles; leading chevron, no marker glyph |
| `primary-row` | `text` + `error` | `<total> tokens · $<spend>`; nested 2 columns; only the `$amount` light red |
| `secondary-row` | derived detail tone | Labeled `in`/`out`/`reason`/`cache` rows; nested 2 columns; cache default `percentage` (`cache/total*100`, `0%` when total 0) |
| `footer-metric` | `textMuted` | Inline prompt row: `Σ` total · `↑` in · `↓` out · `󰧑` reason · `󰆼` cache/`󰆼 %`, ` · ` separated, truncated with `…` |
| `subagents-heading` | heading `warning`, counts `textMuted` | `▶ Subagents (N agents · M tasks)` collapsed / `▼ Subagents` expanded; durable `tokenmeter.sidebar.expanded` |
| `agents-row` | name `info`, `(N tasks)` detail, chevron `text` | `↳ name (N tasks) ▶/▼`, per-agent chevron trails the header; indented 2 columns |
| `agent-metric-row` | `text` + `error` + detail | Indented 4 columns; compact L1 or mode-aware detail rows |
| `placeholder` | `textMuted` | Static `…` — no spinner, no animation |
| `project-error` | `error` | Stable "Unable to load project data", truncated to the content width |
| `scrollbox` | — | Viewport 4 rows, scrollY; every group while Subagents is expanded |
| `settings-dialog` | host `DialogSelect` | Opened from the palette (`tokenmeter.settings`); preference rows cycle in place without recreating the dialog; Visibility category holds TokenMeter/Project/Session/Subagents toggles (presentation-only) |

## Do's and Don'ts

- Do: resolve every color from host theme roles and derive the detail tone theme-relatively; never introduce a literal (fixed-hex) color without updating this contract.
- Don't: render a line that can exceed the content width — measure first, truncate with `…`.
- Do: keep raw output and raw reasoning separate in aggregation; display output real = output + reasoning computed once at the formatting boundary.
- Don't: use emoji as functional icons — the disclosure glyphs are plain Unicode (`▶`/`▼`/`↳`); the footer prompt icons are the specified fixed codepoints (`↑`/`↓`/`󰆼`/`󰧑`/`Σ`) and no icon library is introduced.
- Do: let the agent name be the elastic segment on an agent header row; only when it cannot keep one column do the `↳` branch and chevron yield.
- Don't: add spinners or animations — the placeholder is a static `…` and loading never animates.
- Do: persist only preferences (`tokenmeter.settings.v1`, `tokenmeter.sidebar.expanded`, `tokenmeter.toggle.shortcut`); master and section disclosure stays transient and resets on session change.

## Content & States

- **Default**: the master row starts expanded; the Project and Session sections seed closed (each shows its compact summary row under its heading); the Subagents section is hidden entirely while zero groups exist and appears automatically with the first delegated group.
- **Section disclosure**: clicking a heading or its leading chevron toggles that section; the `tokenmeter.toggle-sections` command (default `Ctrl+E`) expands/collapses all three sections together. Master and section disclosure are transient — reset on session change, never written to kv.
- **Agent entries**: clicking an entry's header (or its trailing chevron) opens it — the compact L1 is replaced by the mode-aware detail rows — and closes the previously open entry (exactly one open at a time); clicking the open entry closes it.
- **Settings**: opened from the command palette (`TokenMeter: Settings`); a host `DialogSelect` lists the preference rows (Cache, Numbers, Summary, Subagents, Shortcut, Visibility: TokenMeter/Project/Session/Subagents, plus Project/Milestones and Footer metrics), and selecting a row cycles it in place without recreating the dialog (focus and filter preserved).
- **Visibility**: `TokenMeter: on/off` hides the entire sidebar (`sidebar_content` → `null`); `Project/Session/Subagents: on/off` hide only their section without reserving height. Hidden surfaces keep collecting data — cost, milestones, and footer remain live. Visibility is independent of Subagents expanded/collapsed (`tokenmeter.sidebar.expanded`).
- **Placeholder**: a section with no snapshot yet shows a plain `…`; Project failure with no snapshot replaces it with one `error` line; failure after a snapshot keeps the metrics and adds the compact error line below; the error clears on the next refresh. Session keeps its own `…` fallback and is never touched by a Project failure.
- **Empty first open**: a session with no usage stays on the placeholder until usage or delegations arrive — an empty load is provisional, never a frozen zero. A snapshot with zero usage renders the section's empty copy (`No sessions` for Project, `No usage yet` for Session) whether the section is open or closed.


## Browser dialogs

The browser is three native host `DialogSelect` panels navigated with ONE `api.ui.dialog.replace` at a time (once-guarded close, no recursive replace, no stack leak):

- **Projects** (`TokenMeter: Browse Usage (N)`) — N = number of projects; title is count-only and never duplicates tokens/cost. Rows `label` (truncated 24, `★` pinned current) with description ISO date; sorted current first then recent; categories `Current Project` then `Projects`, eligible projects only (existing `.git` directory, not `/`/HOME/`~/foo`; provisional ≤100 ms, final V2 probes 58→30). While loading/error the panel shows a single `Overview` placeholder; `× Close` last.
- **Project detail** (`TokenMeter: {projectName} (N)`) — N = root sessions only (pinned current + others, not delegations); name truncated with `truncateToColumns` so title stays one line and never collides with `esc`; overview is the only place for totals/in-out/reason-cache% (3 rows `__total`/`__io`/`__cache` plus period); session rows `label` (★ if current) with ISO date; categories `Current Session` then `Sessions`; `← Back to projects` + `× Close` last.
- **Session detail** (`TokenMeter: {sessionTitle}` + optional `★ ` if current) — no `— Session`, no tokens, no cost in title; name truncated to avoid `esc` collision; Overview 3 rows only place for totals; Providers breakdown sorted spend descending (`providerID · tokens · cost · count`, provider id exact) with models underneath `└ <shortLabel> · tokens · cost` (short label last path segment, description `count messages`); `← Back to project` returns to that `projectID` (fallback browser) + `× Close`. All costs `fmtCost`, tokens `fmtCompact`, labels `truncateToColumns`, loading `Loading …`, error `Unable to load …`, no Nerd Font.

## Responsive Behavior

The sidebar width comes from the slot context/props chain (width → columns → cols → size → viewport → bounds) with fallback **38**, clamped to **24–52**. The content width floors at 10 columns; every row degrades elastically (labels/separators drop, values truncate with `…`) instead of wrapping, so the panel stays readable on narrow sidebars instead of overflowing.
