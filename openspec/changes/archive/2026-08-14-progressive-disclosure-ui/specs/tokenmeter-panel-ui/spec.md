# tokenmeter-panel-ui Specification

## Purpose

Master disclosure, semantic-yellow headings with main-text chevrons, a theme-relative tone hierarchy (main-text primary rows with a light-red `$amount`, derived background-relative detail tone for secondary rows), nested indentation instead of colored bullets, an `↳`-indented real-scroll Subagents list that hides when empty, and precise-mode elastic degradation that never hides reasoning/cache values. Presentation-only: data model and correctness invariants are untouched.

## Requirements

### Requirement: Master TokenMeter disclosure

Collapsed MUST render `▶ TokenMeter` plus EXACTLY ONE compact summary — the elastic L1 of the persisted `collapsedSummary` source (Session|Project) — and no other rows. Expanded MUST render `▼ TokenMeter` plus the normal sections. Master state MUST be transient (starts EXPANDED, resets to expanded on mount/session change, never kv). Chevron OR title-text click MUST toggle.

- **Scenario: Collapsed output** — GIVEN `collapsedSummary: "session"` with totals; WHEN master collapsed; THEN frame shows `▶ TokenMeter` + exactly the Session summary; AND no Project/Session/Subagents rows.
- **Scenario: Source switch** — GIVEN `collapsedSummary: "project"`; WHEN collapsed; THEN the single summary shows Project totals.
- **Scenario: Full-row toggle** — GIVEN master collapsed; WHEN the `TokenMeter` title text is clicked; THEN master expands; AND chevron click also toggles.
- **Scenario: Empty source** — GIVEN selected source has zero usage; WHEN collapsed; THEN the source's empty copy shows (`No usage yet`/`No sessions`).

### Requirement: Semantic-yellow headings

`TokenMeter` MUST render in `theme().text`. `Project`, `Session` and `Subagents` heading titles MUST render in the semantic yellow `theme().warning` and MUST NOT carry any marker glyph (no circle, dot or bullet). Leading disclosure chevrons MUST stay in the main-text tone `theme().text`, never `warning`.
(Previously: White headings — all four headings rendered in `theme().text`; before that, Project/Session/Subagents used `accent`.)

- **Scenario: Heading tones** — GIVEN any host theme; WHEN the panel renders; THEN TokenMeter uses `theme().text`; AND Project/Session/Subagents titles use `theme().warning` with no glyph; AND every leading chevron uses `theme().text`.

### Requirement: Larger chevrons, leading and trailing

Disclosure chevrons MUST be `▶` collapsed / `▼` expanded — never `▸`/`▾`. The master row, the section rows and the Subagents global row MUST render their chevron LEFTMOST; each `↳`-indented compact agent entry MUST render its chevron TRAILING the header.
(Previously: `▸`/`▾`.)

- **Scenario: Exact glyphs** — GIVEN collapsed rows; WHEN rendered; THEN each master/section/Subagents chevron is `▶`, first glyph of its row; WHEN expanded; THEN `▼`; AND agent entries read `↳ <name> (N tasks) ▶` closed / `▼` open.

### Requirement: Theme-relative tone hierarchy

The primary token+cost line MUST render in `theme().text` with ONLY the `$amount` in the light-red `theme().error`. Secondary rows (input/output/reason/cache) and the `(N tasks)` metadata MUST render in the derived detail tone — `theme().textMuted` blended 50% toward `theme().background`. Agent names MUST render in `theme().info`. No fixed hex color and no gold/cool/warm palette MAY appear in metric rows.
(Previously: gold/cool/warm 3-color map with fixed SPEND_GOLD `#D4AF37`.)

- **Scenario: Primary line tones** — GIVEN expanded detail; WHEN rendered; THEN line 1 segments are `theme().text` except the `$amount`, which is `theme().error`; AND lines 2/3 are the derived detail tone.
- **Scenario: Agent tones** — GIVEN Subagents expanded; WHEN an agent header renders; THEN the name is `theme().info`; AND `(N tasks)` is the derived detail tone.

### Requirement: Nested indentation

Project/Session compact summaries and detail rows MUST indent TWO columns beneath their heading. Subagents agent headers MUST indent two columns and their metric rows FOUR columns (aligned under the agent name after `↳ `). Rows MUST NOT carry bullets or dot markers — indentation and labels identify structure.
(Previously: MCP-style colored bullets — every metric row started with a family-colored bullet.)

- **Scenario: Section indent** — GIVEN expanded Project; WHEN rows render; THEN summary and detail rows sit two columns right of the heading.
- **Scenario: Agent tree indent** — GIVEN Subagents expanded; WHEN an agent entry renders; THEN the header sits two columns and its metric rows four columns right of the Subagents row.

### Requirement: Precise-mode elastic degradation

With `numbers=precise`, detail rows MUST degrade elastically — elide the spend value to `$…`, drop labels/separators, then truncate values with `…` — instead of being omitted. The `reasoning` and `cache` VALUES MUST always render. Compact-mode detail rows follow the same ladder per line; rows are never dropped.
(Previously: non-fitting detail rows were omitted by a fits-gate; the ladder dropped ` spent`.)

- **Scenario: Reasoning and cache never hidden** — GIVEN precise at 22 columns with large values; WHEN detail renders; THEN reasoning and cache values are both present (possibly `…`-truncated).
- **Scenario: Labels yield before values** — GIVEN precise values too wide with labels; WHEN rendered; THEN labels/separators may drop but every value remains.

### Requirement: Section disclosure with replace-on-expand

Each section MUST render one compact summary when collapsed; expanding MUST REPLACE it with the detail lines (no duplicate). Project and Session disclosure MUST be independent, seed CLOSED at mount, reset to closed on every session change, and never be written to kv. Chevron OR section title-text click MUST toggle.
(Previously: only the chevron glyph was clickable.)

- **Scenario: Replace on expand** — GIVEN master expanded, Project collapsed; WHEN Project's chevron or title text is clicked; THEN the compact summary is replaced and no value duplicates.
- **Scenario: Independent disclosure** — GIVEN Project open; WHEN Session's row is clicked; THEN only Session toggles.
- **Scenario: Transient reset** — GIVEN Project open; WHEN the session changes; THEN Project and Session both close; AND nothing is written to kv.

### Requirement: Exact labeled metric lines

Expanded detail MUST render `<total> tokens · $<spend>`, `<input> input · <realOutput> output`, `<reasoning> reason · <cache> cache` in compact mode (three rows), or five single-metric rows in precise mode: `<total> tokens · $<spend>`, `<input> input`, `<output> output`, `<reasoning> reason`, `<cache> cache`. The reasoning DISPLAY label MUST be exactly `reason` (no period); the words `spent` and `cost` MUST NOT render — the `$`-prefixed amount with exactly two decimals conveys cost. realOutput = output+reasoning; combined cache = cacheRead+cacheWrite; `separated` renders `R<n>|W<n>` (zero sides omitted). Values MUST never be dropped.
(Previously: lines read `… <reasoning> reasoning · <cache> cache` with a ` spent` word.)

- **Scenario: Exact conceptual rows** — GIVEN 10M total, $92.24, 152K input, 215M real output, 414K reasoning, 212M cache; WHEN expanded; THEN lines read exactly `10M tokens · $92.24`, `152K input · 215M output`, `414K reason · 212M cache`.
- **Scenario: No spent word** — GIVEN any detail; THEN no `spent` or `cost` literal renders; AND the amount is `$`-prefixed with exactly two decimals.
- **Scenario: Precise five rows** — GIVEN `numbers: "precise"`; WHEN expanded; THEN exactly five single-metric rows render — tokens+cost, input, output, reason, cache — each degrading individually.
- **Scenario: Separated cache** — GIVEN `cache: "separated"`, cacheRead 45M, cacheWrite 10K; THEN the segment reads `R45M|W10K`.

### Requirement: Subagents global row, `↳` list, per-agent accordion

The section MUST render ONLY while the snapshot has at least one group: with zero groups there MUST be NO heading, scrollbox or `0 agents · 0 tasks` caption, and the section MUST appear automatically with the first group. Collapsed global row MUST read `▶ Subagents (N agents · M tasks)` (caption in `theme().textMuted`); expanded, `▼ Subagents` with NO aggregate. Compact agent entries MUST be `↳ <name> (<N> tasks) ▶` closed / `↳ <name> (<N> tasks) ▼` open — the per-agent chevron TRAILS the header; the `↳` branch and chevron render in the main-text tone, the name in `theme().info`, `(N tasks)` in the derived detail tone. Opening an agent MUST replace its compact L1 with the mode-aware detail rows (no duplicates); opening one agent MUST close any other, and clicking the open agent MUST close it. The open group MUST be transient (null at mount, reset on session change, never kv). The Subagents preference itself stays durable (`tokenmeter.sidebar.expanded`).
(Previously: `▸ <name>`-prefixed entries with a `·` separator; the section rendered a 0-count caption when empty.)

- **Scenario: Hidden when empty** — GIVEN a snapshot with zero groups; WHEN the panel renders; THEN no Subagents heading, scrollbox or count caption appears; AND the section appears once the first group exists.
- **Scenario: Collapsed aggregates** — GIVEN 6 agents, 7 tasks; WHEN collapsed; THEN `▶ Subagents (6 agents · 7 tasks)`.
- **Scenario: `↳`-indented entries** — GIVEN expanded, agent `General` (5 tasks, 3.7M, $0.11); THEN `↳ General (5 tasks) ▶` + `3.7M tokens · $0.11`, indented, chevron trailing; WHEN clicked; THEN the chevron flips `▼` and the compact L1 is replaced by detail, no duplicates.
- **Scenario: Exclusivity and non-persistence** — GIVEN agent A open; WHEN agent B opened; THEN A closes; WHEN remount/session change; THEN none open, nothing written to kv.

### Requirement: Agent list real scrollbox

The expanded list MUST render in a real scroll container (sized for ~two compact entries, one scrollbar column reserved so rows never clip into it), containing ALL agents; MUST NOT slice data, hide counts, or render a `(N more — scroll)` cue.

- **Scenario: All agents reachable** — GIVEN 8 agents; WHEN expanded; THEN all 8 render in the scroll container, reachable by scrolling; AND no hidden agents or cue.
- **Scenario: Fewer than viewport** — GIVEN 1 agent; WHEN expanded; THEN it renders fully without scroll interaction.

### Requirement: Compact width safety and elastic detail

Compact and master-summary rows MUST fit 22 columns without wrapping. Detail rows MUST never wrap; they MUST degrade elastically (see precise-mode degradation) rather than being omitted.

- **Scenario: Narrow width** — GIVEN 22 columns; WHEN rendered; THEN compact rows fit without wrapping and detail rows never wrap.

Formatting: `numbers=compact` uses `fmtCompact` magnitudes; `precise` thousands-separated integers (`1234567` → `1,234,567`); counts pluralize (`1 agent`/`2 agents`, `1 task`/`2 tasks`).

### Requirement: Loading vs empty distinction

No snapshot → static `…` (no animation). Zero usage → distinct empty copy (`No usage yet`/`No sessions`), never conflated.

- **Scenario: Loading** — GIVEN no snapshot; WHEN rendered; THEN static `…`.
- **Scenario: Empty** — GIVEN zero usage; WHEN rendered; THEN the empty copy, not `…`.

### Requirement: Resolve version hardcoding

The version string MUST NOT be hardcoded in source; build-time injected or removed.

- **Scenario: No hardcoded version** — GIVEN the source; WHEN inspected; THEN no literal like `1.0.1` appears in the title render path.

### Requirement: Theme role contracts

Spend MUST render in the light-red `theme().error`, never a fixed hex. Metric rows MUST use only the tone hierarchy; headings `theme().warning`; agent names `theme().info`; chevrons and the `↳` branch `theme().text`; primary-line labels/separators `theme().text`; empty copy, placeholders and the Subagents count caption `theme().textMuted`. No hardcoded color MAY appear.
(Previously: spend used fixed SPEND_GOLD `#D4AF37`; thinking `accent`, robot/name `primary`, task count `success`.)

- **Scenario: Theme contracts** — GIVEN any theme; WHEN rendered; THEN the `$amount` is `theme().error`; AND rows use only the hierarchy tones; AND headings are `theme().warning`.

## Superseded requirement resolutions

| Old requirement | Resolution |
|---|---|
| Compact summaries with `▸`/`▾` left-chevron disclosure | Replaced by master disclosure; glyphs `▶`/`▼` |
| Semantic colors per metric role (5 theme roles + gold) | Replaced by the theme-relative tone hierarchy (main-text rows, error `$amount`, derived detail tone) |
| MCP-style colored bullets on metric rows | Replaced by nested indentation (2/4 columns); no bullets |
| Chevron-only disclosure clicks | Full-row/text and chevron clicks both toggle |
| Fits-gate omits non-fitting detail rows | Elastic degradation; reasoning/cache never hidden |
| `▸`-prefixed compact agent entries | `↳`-indented entries with trailing chevron |
| White headings for Project/Session/Subagents | Semantic-yellow `theme().warning` headings, main-text chevrons |
