# Proposal: Progressive Disclosure UI

## Intent

Dense rows, icon saturation, overflow-hidden metrics hurt narrow panels. Refresh presentation: master disclosure, colored bullets, 3-color semantics, palette dialog settings, no silent data drops. Presentation-only.

## Scope

### In Scope
- Settings leave sidebar; `TokenMeter: Settings` (palette category `TokenMeter`) opens an `api.ui.dialog.replace` `DialogSelect`. Only `api.keymap.registerLayer` — no `registerExCommands` (keymap 0.2.9 lacks addons), no `api.command`.
- Chevron OR row-text click toggles disclosure.
- TokenMeter title, Project, Session, Subagents headings `theme().text` (white); larger left-aligned `▶`/`▼` chevrons.
- Master disclosure left of TokenMeter title: collapsed = title + one compact summary (Session or Project, new persisted setting); expanded = normal sections.
- Max 3 semantic colors (muted/white excluded): gold tokens/spent, cool input/output, warm reasoning/cache — cost > volume > cognitive.
- Subagents: `↳`-indented subsection, real scroll.
- Precise mode kept; L2/L3 elastic degradation so reasoning/cache never silently disappear.
- Metric rows: MCP-style colored bullet left, indented from headings, color per row role.
- Preserve: `spent` wording, no duplicate L1, agent/global disclosure, palette registration.

### Out of Scope
Data/core; `api.command`; `registerExCommands`; motion; protected files (DESIGN.md, PRD.md, README.md, docs/release-security.md, npm-secure-config/**).

## Capabilities

### New Capabilities
- `tokenmeter-settings`: model/kv, collapsed-summary source, dialog settings UI.
- `tokenmeter-panel-ui`: master disclosure, white headings, large chevrons, 3-color map, bullets, `↳` subsection, precise degradation.
- `tokenmeter-command-palette`: `registerLayer` palette command (category `TokenMeter`) → settings dialog.

### Modified Capabilities
None — `openspec/specs/` is empty.

## Approach

Dialog settings replace the sidebar screen; `registerLayer` (`category: "TokenMeter"`) → dialog; master disclosure keyed on collapsed-summary setting; `metricColor` → 3 roles; colored bullet leads rows; `↳` subsection inside existing scrollbox; `fmtPrecise` retained with elastic degradation.

## Affected Areas

- `src/tokenmeter/panel/index.tsx`, `group-rows.tsx` — master disclosure, headings, chevrons, bullets, `↳` subsection
- `src/tokenmeter/panel/settings-screen.tsx` — removed; palette dialog replaces it
- `src/tokenmeter/settings.ts`, `panel/colors.ts` — collapsed-summary setting; 3-color map
- `src/tokenmeter.tsx`, `format.ts`, `numbers.ts` — `registerLayer` → dialog; degradation
- `test/*` — dialog, palette, bullet, degradation contracts

## Risks

- Test churn over review budget (High) — slice at tasks phase
- DialogSelect drift; degradation drops data (Med) — pin installed types; value-always-visible invariant

## Rollback Plan

Presentation + one keymap registration over untouched data layer. Revert commits; kv keys inert; layer unregistered on dispose.

## Dependencies

None.

## Success Criteria

- [ ] Palette `TokenMeter` opens DialogSelect; no sidebar settings screen; no `registerExCommands`/`api.command`.
- [ ] Chevron or row toggles; `▶`/`▼` left; headings white; collapsed = title + one summary per persisted source.
- [ ] 3 semantic colors beyond muted/white; bullets colored per row role, indented.
- [ ] Subagents `↳`-indented, real scroll; precise mode never hides reasoning/cache.
- [ ] Regression: `spent` wording, no duplicate L1, agent/global disclosure, palette registration; suites + coverage pass; PR refs approved issue.
