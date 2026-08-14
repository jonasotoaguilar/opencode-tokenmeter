# Tasks: Progressive Disclosure UI

Corrected contract: prior tasks void (superseded specs/design) — boxes reset, unchecked where code does not yet comply. Strict TDD: RED → GREEN. Design open question resolved: master starts EXPANDED (preserves current behavior).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,300–1,700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Tracker `feat/tokenmeter-progressive-disclosure`; PR 1 base = tracker, PR N base = PR N-1 branch; only tracker merges. Each unit <400 native lines incl. SDD artifacts; heavy test frames capped per unit (no wholesale rewrites).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Settings model + DialogSelect menu | PR 1 | `bun test test/settings.test.ts` | headless dialog frames | settings.ts + settings-dialog.tsx + tests |
| 2 | Master disclosure + white headings + chevrons | PR 2 | `bun test test/render.test.tsx` | headless master frames | index/section/glyphs + frames |
| 3 | 3-color map + bullets + elastic L2/L3 | PR 3 | `bun test test/format.test.ts` | headless 22-col frames | colors/format + tests |
| 4 | `↳` subagents + integration sweep | PR 4 | `bun test test/render.test.tsx` | headless scrollbox frames | group-rows + frames |
| 5 | Palette category + delete screen seam | PR 5 | `bun run build && bun run test:dist` | real dist artifact | tokenmeter.tsx + deletions |
| 6 | Final gates + verify prep | PR 6 | `bun run coverage` | N/A — CI gates only | sweep-only edits |

## Phase 1: Settings model + dialog (PR 1)

- [x] 1.1 RED `test/settings.test.ts`: no `defaultView`; `collapsedSummary` default `session`, invalid → `session`; cycle session⇄project; one atomic `kv.set("tokenmeter.settings.v1", {cache,numbers,collapsedSummary})`, no `defaultView`/`subagents`; not-ready = memory only
- [x] 1.2 GREEN `settings.ts`: drop `ViewPref`/`defaultView`/`cycleDefaultView`; add `CollapsedSummaryPref` + `cycleCollapsedSummary`
- [x] 1.3 RED dialog frames: DialogSelect 4 options with current values; select cycles + re-renders; cancel → `dialog.clear()`
- [x] 1.4 GREEN new `panel/settings-dialog.tsx` `showSettingsDialog(api)` (recursive re-render; cancel clears)

## Phase 2: Master disclosure + headings (PR 2)

- [x] 2.1 RED `test/render.test.tsx`: master initially EXPANDED; title click → `▶ TokenMeter` + exactly one L1 of `collapsedSummary` source; empty source copy; transient, no kv
- [x] 2.2 GREEN `panel/index.tsx`: transient `masterCollapsed` (default expanded); collapsed branch; chevron or title toggles
- [x] 2.3 GREEN `glyphs.ts` `▶`/`▼`; `section.tsx`+`index.tsx` headings `theme().text`; leftmost chevron; section title-text toggles

## Phase 3: 3-color map + bullets + elastic (PR 3)

- [x] 3.1 RED `test/format.test.ts`: elastic ladder L2/L3 (labels/` · ` drop → `$…` → value `…`); reasoning+cache values always present
- [x] 3.2 RED render frames: family-colored `●` bullet right of heading; exactly 3 non-muted hues; values present at 22 cols
- [x] 3.3 GREEN `panel/colors.ts`: gold tokens+spend `#D4AF37`; cool input+output; warm reasoning+cache; labels/sep muted
- [x] 3.4 GREEN `format.ts` L2/L3 elastic + bullet segments; `glyphs.ts` add `●`

## Phase 4: `↳` subagents + sweep (PR 4)

- [x] 4.1 RED frames: `▶ Subagents (N agents · M tasks)` keeps `tasks` text (no ∑ icon); `↳ General · 5 tasks` + spend line; replace-on-expand, exclusive, transient; all 8 agents in scrollbox, no cue
- [x] 4.2 GREEN `group-rows.tsx` `↳` indent, no per-agent chevron; `format.ts` `↳` agent line; `glyphs.ts` add `↳`
- [x] 4.3 Sweep: no `▸`/`▾`/`defaultView` refs (`rg`); harness/render/format frames consistent

## Phase 5: Palette + delete seam (PR 5)

- [x] 5.1 RED frames: no `Settings`/`Back` title toggle; no screen replaces metrics
- [x] 5.2 RED `registerLayer` mock: `TokenMeter: Settings` (category `TokenMeter`) → dialog; no `api.command`/`registerExCommands`
- [x] 5.3 GREEN `tokenmeter.tsx`: `registerLayer` vs installed `tui.d.ts`; `onDispose` disposer; dialog cleared on cancel/dispose
- [x] 5.4 GREEN delete `panel/settings-screen.tsx`; remove `screen` signal/`openSettings()`/`showMetrics()` from `panel/index.tsx`
- [x] 5.5 RED→GREEN `test/artifact.test.ts`: built dist registers palette category

## Phase 6: Final gates + verify prep (PR 6)

- [x] 6.1 `bun run typecheck && bun run biome:check`
- [x] 6.2 `bun run build && bun run test:dist`
- [x] 6.3 `bun run test`
- [x] 6.4 `bun run coverage` (80/80/80, dist excluded)
- [x] 6.5 Verify prep: scenario trace, verify-report inputs, PR refs approved issue; protected files untouched

Threat matrix: N/A (no routing/shell/subprocess boundary per design).
