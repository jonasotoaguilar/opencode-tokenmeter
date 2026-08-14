```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d73dd581553417288506a2d5045ca0af905128c3b6866eb6f747e3618ad0aced
verdict: pass
blockers: 0
critical_findings: 0
requirements: 25/25
scenarios: 54/54
test_command: bun run test
test_exit_code: 0
test_output_hash: sha256:dbe11e74a0206cf15dda669185e8525328a01c4ba21f0e919b37258e13266087
build_command: bun run build
build_exit_code: 0
build_output_hash: sha256:8bc664a7398bdc7a48ccc3de68e7d2a7156e8dc16015721813a36c004c51bccc
```

## Verification Report

**Change**: progressive-disclosure-ui
**Version**: FINAL shipped contract (amended 2026-08-13/14: semantic-yellow headings, tone hierarchy, no bullets, `reason` label, Compact 3/Precise 5 rows, `↳ name (N tasks) ▶/▼` trailing chevrons, Subagents hidden at zero groups, one-shot DialogSelect with reactive titles, settings Shortcut row persisting `tokenmeter.toggle.shortcut`, `registerLayer({commands,bindings})`, ctrl+e default, disposers in onDispose)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 24 |
| Tasks complete | 24 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: ✅ Passed
```text
bun run build → exit 0; dist/tui.js + dist/tui.d.ts; Reactive bindings: effect + insert + insertNode, no eager JSX
```

**Tests**: ✅ 225 passed / 0 failed / 0 skipped (7 files, 7826 expect() calls, exit 0)
```text
bun run test → 225 pass / 0 fail; settings 14, format 52, toggle 13, tone 6, render 56, harness 69, artifact 15
```
**Dist artifact suite**: ✅ 15 passed / 0 failed (69 expect, exit 0) — `bun run test:dist`
**Typecheck**: ✅ exit 0 (`tsc -p tsconfig.json && tsc -p tsconfig.test.json`)
**Biome**: ✅ exit 0 — 0 errors, 114 warnings (all `lint/style/noNonNullAssertion`; preexisting legacy harness/render regions + toggle.test.ts non-null assertions including the new wrap test; zero diagnostics in edited regions beyond those)
**Coverage**: 99.75% funcs / 99.56% lines (All files) → threshold 80/80/80 per-file → ✅ Above
```text
bun run coverage → exit 0; 210 pass / 0 fail (artifact.test.ts excluded by script; dist/** excluded by bunfig);
worst changed file section.tsx 95.08% funcs / 93.18% lines (uncovered 235-241, 251-255 — render-only branch);
data-layer reconcile.ts 97.73% lines; every instrumented file ≥ 80% on all three metrics (exit 0 proves per-file gate)
```

### Spec Compliance Matrix
Counts from the amended spec files: **25 requirements / 54 scenarios** (command-palette 4/10, panel-ui 14/30, settings 7/14).

**tokenmeter-command-palette (4 requirements, 10 scenarios)**

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Palette command registration | Command present in the palette | `test/render.test.tsx > palette command` (layers[0] name/namespace/category/title; toggle layer command name) | ✅ COMPLIANT |
| Palette command registration | Registration mechanism | `test/harness.test.ts > entry registers via keymap.registerLayer` + `test/render.test.tsx > layer disposers wired to lifecycle.onDispose` + `test/artifact.test.ts` (no `api.command`/`registerExCommands`) | ✅ COMPLIANT |
| Palette run opens the settings dialog | Command opens the dialog | `test/render.test.tsx > palette command` (dialog.stack length 1, DialogSelect frame, metrics body unchanged) | ✅ COMPLIANT |
| Palette run opens the settings dialog | No sidebar settings screen | `test/render.test.tsx > no in-panel settings screen` (no Settings/Back toggle, metrics never replaced) + `test/harness.test.ts > panel exposes no in-panel settings seam` | ✅ COMPLIANT |
| Toggle-sections command with configurable shortcut | Default binding | `test/toggle.test.ts > registers the default ctrl+e binding` + `test/render.test.tsx > palette command` (bindings [{key:"ctrl+e",…}]) | ✅ COMPLIANT |
| Toggle-sections command with configurable shortcut | Toggle all sections | `test/toggle.test.ts > expands all when all are collapsed; collapses all when any is expanded` + `test/render.test.tsx > running the toggle command expands all sections together (Subagents persists)` | ✅ COMPLIANT |
| Toggle-sections command with configurable shortcut | Off keeps the command | `test/toggle.test.ts > Off removes the binding while keeping the command` + `test/render.test.tsx > Shortcut row` (bindings [] + command name preserved) | ✅ COMPLIANT |
| Toggle-sections command with configurable shortcut | Live re-registration | `test/toggle.test.ts > changing the shortcut re-registers the layer with the new binding, no restart` (dispose+rebind, kv write) + `test/render.test.tsx > Shortcut row` (same dialog, re-registered layer) | ✅ COMPLIANT |
| Source and artifact boundary tests | Source boundary | `test/toggle.test.ts > palette path run toggles sections` + `test/harness.test.ts > palette registration pin` (source) | ✅ COMPLIANT |
| Source and artifact boundary tests | Built artifact boundary | `test/artifact.test.ts > the artifact registers the palette command via keymap.registerLayer` + dist grep (2× registerLayer, 2× palette, category TokenMeter, 0× legacy) | ✅ COMPLIANT |

**tokenmeter-panel-ui (14 requirements, 30 scenarios)**

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Master TokenMeter disclosure | Collapsed output | `test/render.test.tsx > master disclosure > starts EXPANDED…; chevron click collapses to ▶ TokenMeter + exactly the Session L1 and no other rows` | ✅ COMPLIANT |
| Master TokenMeter disclosure | Source switch | `test/render.test.tsx > master disclosure > collapsedSummary source switch: project source shows exactly the Project L1` | ✅ COMPLIANT |
| Master TokenMeter disclosure | Full-row toggle | `test/render.test.tsx > master disclosure > title-text click toggles both ways; the chevron click expands it back` | ✅ COMPLIANT |
| Master TokenMeter disclosure | Empty source | `test/render.test.tsx > master disclosure > empty source copy: No usage yet / No sessions, never the loading …` | ✅ COMPLIANT |
| Semantic-yellow headings | Heading tones | `test/render.test.tsx > expanded detail tone hierarchy` (titleColors = warning for Project/Session/Subagents, no `●` glyph) + `test/harness.test.ts > panel colors… warning-yellow section titles` | ✅ COMPLIANT |
| Larger chevrons, leading and trailing | Exact glyphs | `test/render.test.tsx > subagents frames` (`▶`/`▼` leftmost on master/sections/Subagents) + `test/format.test.ts > formatAgentLine` (`↳ <name> (N tasks) ▶` closed / `▼` open) + glyph pins | ✅ COMPLIANT |
| Theme-relative tone hierarchy | Primary line tones | `test/render.test.tsx > expanded detail tone hierarchy` (L1 segments `theme().text`, `$amount` `theme().error`; L2/L3 detailTone) + `test/tone.test.ts > segmentTone` | ✅ COMPLIANT |
| Theme-relative tone hierarchy | Agent tones | `test/render.test.tsx > compact agent colors` (↳ indent+chevron white, name info, tasks detail tone) + `test/tone.test.ts` | ✅ COMPLIANT |
| Nested indentation | Section indent | `test/render.test.tsx > expanded detail tone hierarchy` (detailRows findIndex === 2, no `●`) | ✅ COMPLIANT |
| Nested indentation | Agent tree indent | `test/render.test.tsx > compact agent two-line entry` (agent row starts col 2) + `precise at 22` (agent metric rows 4-col under `  ↳ `) | ✅ COMPLIANT |
| Precise-mode elastic degradation | Reasoning and cache never hidden | `test/render.test.tsx > precise at 22 columns` (reason/cache values present, `…`-truncated) + `test/format.test.ts > every line fits its width; reasoning and cache values render at every two-value width` | ✅ COMPLIANT |
| Precise-mode elastic degradation | Labels yield before values | `test/format.test.ts > compact paired rows: labels and the separator drop before values truncate; values never truncate while labeled` | ✅ COMPLIANT |
| Section disclosure with replace-on-expand | Replace on expand | `test/render.test.tsx > compact default…` / `independent disclosure` (L1 once, replaces compact, no duplicates) + agent replace-on-expand frame | ✅ COMPLIANT |
| Section disclosure with replace-on-expand | Independent disclosure | `test/render.test.tsx > independent disclosure: expanding Project detail leaves Session collapsed` | ✅ COMPLIANT |
| Section disclosure with replace-on-expand | Transient reset | `test/render.test.tsx > a session change resets disclosure to the closed seed` (no kv writes) | ✅ COMPLIANT |
| Exact labeled metric lines | Exact conceptual rows | `test/format.test.ts > renders exactly the three spec lines with combined cache` (`10M tokens · $92.24`, `152K input · 215M output`, `414K reason · 212M cache`) | ✅ COMPLIANT |
| Exact labeled metric lines | No spent word | `test/format.test.ts > no formatter output contains the word spent — $ already conveys cost` + `test/render.test.tsx` (`not.toContain("spent")`, `$0.03` two decimals) | ✅ COMPLIANT |
| Exact labeled metric lines | Precise five rows | `test/format.test.ts > precise: exactly five single-metric rows, the reason label last-word` + `test/render.test.tsx > precise at 22 columns: expanded Session renders EXACTLY five rows` | ✅ COMPLIANT |
| Exact labeled metric lines | Separated cache | `test/format.test.ts > separated renders R\|W from the same raw values, zero sides omitted` + `test/render.test.tsx > cache mode: combined one summed value; separated R\|W` | ✅ COMPLIANT |
| Subagents global row, `↳` list, per-agent accordion | Hidden when empty | `test/render.test.tsx > zero subagent groups render NO Subagents heading, no scrollbox and no 0-count caption` + `the Subagents section appears automatically once the first group exists` | ✅ COMPLIANT |
| Subagents global row, `↳` list, per-agent accordion | Collapsed aggregates | `test/render.test.tsx > collapsed global row shows the aggregate counts and NO agent list` | ✅ COMPLIANT |
| Subagents global row, `↳` list, per-agent accordion | `↳`-indented entries | `test/render.test.tsx > compact agent two-line entry` (`↳ General (5 tasks) ▶` + `3.7M tokens · $0.11`; click → `▼`, three-line detail, L1 exactly once) | ✅ COMPLIANT |
| Subagents global row, `↳` list, per-agent accordion | Exclusivity and non-persistence | `test/render.test.tsx > exclusive accordion: opening one agent closes the other; clicking the open agent closes it` + `the open agent is transient: nothing written to kv, fresh mount closed, session change resets` | ✅ COMPLIANT |
| Agent list real scrollbox | All agents reachable | `test/render.test.tsx > all 8 agents render inside the real scrollbox, every one reachable by scrolling, no clipped cue` | ✅ COMPLIANT |
| Agent list real scrollbox | Fewer than viewport | `test/render.test.tsx > one agent renders fully without any scroll interaction` | ✅ COMPLIANT |
| Compact width safety and elastic detail | Narrow width | `test/render.test.tsx > narrow width: detail rows never wrap and degrade elastically at 22 columns` + `test/harness.test.ts > formatCompactSummary never overflows its width frame` | ✅ COMPLIANT |
| Loading vs empty distinction | Loading | `test/render.test.tsx > REGRESSION: with no snapshot… the panel shows the static …` + `test/harness.test.ts > the Project loading fallback is the static …` | ✅ COMPLIANT |
| Loading vs empty distinction | Empty | `test/render.test.tsx > zero-usage snapshot shows the empty copy, never the loading …` | ✅ COMPLIANT |
| Resolve version hardcoding | No hardcoded version | `test/artifact.test.ts > REGRESSION: the artifact ships no version literal in the title render path` + `test/render.test.tsx > compact default… no version literal` | ✅ COMPLIANT |
| Theme role contracts | Theme contracts | `test/harness.test.ts > panel colors and layout match the approved theme contract` + `test/tone.test.ts > the derived tone equals the documented blend — never an arbitrary hex` + `test/render.test.tsx > span-color checks` + `test/format.test.ts > the colors module no longer exists` | ✅ COMPLIANT |

**tokenmeter-settings (7 requirements, 14 scenarios)**

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Settings object and defaults | Defaults apply when nothing is persisted | `test/settings.test.ts > applies all defaults when nothing is persisted` | ✅ COMPLIANT |
| Settings object and defaults | Persisted source honored | `test/settings.test.ts > honors valid overrides and defaults absent fields` + `test/render.test.tsx > master disclosure source switch (Project L1)` | ✅ COMPLIANT |
| Single versioned three-field kv object | One atomic write per object-preference change | `test/settings.test.ts > cycles cache combined → separated → combined, one whole-object write each` + `each object write carries the full three-field object including earlier changes` (no `subagents`/`shortcut`/`defaultView`) | ✅ COMPLIANT |
| Malformed or missing values resolve to safe defaults | Missing or malformed value | `test/settings.test.ts > resolves a non-object string value` / `resolves a null value… without throwing` / `resolves unknown enums per field and honors valid overrides` / `ignores a stale legacy view field` + `test/toggle.test.ts > malformed shortcut defaults` | ✅ COMPLIANT |
| kv readiness write gating | Ready, object preference | `test/settings.test.ts > a ready cycle reports persisted and the next mount reads the new value` | ✅ COMPLIANT |
| kv readiness write gating | Ready, Subagents | `test/settings.test.ts > subagents cycles write only the sidebar.expanded key, never settings.v1` | ✅ COMPLIANT |
| kv readiness write gating | Ready, Shortcut | `test/toggle.test.ts > changing the shortcut re-registers…` (kv.sets = only `tokenmeter.toggle.shortcut`) + `test/render.test.tsx > Shortcut row` (kvWrites contains TOGGLE_SHORTCUT_KV_KEY) | ✅ COMPLIANT |
| kv readiness write gating | Not ready | `test/settings.test.ts > not-ready cycles update memory only and report persisted=false` + `test/toggle.test.ts > a not-ready kv still updates the preference and re-registers, without persisting` | ✅ COMPLIANT |
| Dialog settings menu | Cycle an object preference in the dialog | `test/render.test.tsx > selecting an option cycles its preference and the SAME dialog re-renders reactively with the new value` (cache/summary, kvWrites probes) | ✅ COMPLIANT |
| Dialog settings menu | Shortcut cycles | `test/render.test.tsx > the Shortcut row shows the current binding and cycling it re-registers the layer on the SAME dialog` (Ctrl+Shift+E → Ctrl+M → Off titles, bindings, kv writes, replaces stays 1) + `test/toggle.test.ts > the full cycle wraps off back to Ctrl+E after four selections` (4th step: value `ctrl+e`, label `Ctrl+E`, kv write `tokenmeter.toggle.shortcut`, layer rebound with ctrl+e, command preserved) — the complete cycle ctrl+e→ctrl+shift+e→ctrl+m→off→ctrl+e is now asserted | ✅ COMPLIANT |
| Dialog settings menu | Same instance, filter and focus preserved | `test/render.test.tsx > REGRESSION: selecting an option keeps the SAME dialog stack entry and render identity — no replace, filter query preserved, titles reactive` | ✅ COMPLIANT |
| Dialog settings menu | Cancel closes without changes | `test/render.test.tsx > cancelling closes the dialog without changing preferences` (stack-level onClose → guarded clear, once) | ✅ COMPLIANT |
| Preference semantics | Source drives master disclosure | `test/render.test.tsx > master disclosure source switch` + `test/settings.test.ts > persisted-source tests` | ✅ COMPLIANT |
| Subagents preference durable source | No dual source | `test/settings.test.ts > resolves subagents to expanded only when the key stores true` + `subagents cycles write only the sidebar.expanded key, never settings.v1` | ✅ COMPLIANT |

**Compliance summary**: 54/54 scenarios compliant, 0 PARTIAL, 0 FAILING, 0 UNTESTED.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Palette command registration | ✅ Implemented | `tokenmeter.tsx` `api.keymap.registerLayer({commands:[…]})` namespace/category/title; `registerToggleLayer({bindings,commands})`; disposers in `lifecycle.onDispose`; zero `api.command`/`registerExCommands`; `settings-screen.tsx` and `colors.ts` deleted from disk |
| Palette run opens settings dialog | ✅ Implemented | `settings-dialog.tsx` one-shot `dialog.replace(DialogSelect, close)`; once-guarded `clear()` on stack `onClose`; no re-replace; no in-panel screen seam (no `openSettings`/`showMetrics`/screen signal) |
| Toggle-sections command + shortcut | ✅ Implemented | `shortcut.ts` ctrl+e default; cycle ctrl+e→ctrl+shift+e→ctrl+m→off; kv `tokenmeter.toggle.shortcut`; `off` = no bindings, command kept; idempotent live re-register; `sections.ts` `toggleSections` transient Project/Session + durable Subagents |
| Master disclosure | ✅ Implemented | `index.tsx` transient `masterCollapsed`, EXPANDED default, session-change reset, never kv; collapsed = `▶ TokenMeter` + one L1 of `collapsedSummary` source; chevron + title-text toggle |
| Semantic-yellow headings | ✅ Implemented | `Section` title `theme().warning`; TokenMeter master + chevrons `theme().text`; no marker glyph |
| Chevrons + tones | ✅ Implemented | `glyphs.ts` `▶`/`▼`/`↳` only; leading chevrons master/sections/Subagents, trailing on agent entries; `tone.ts` `detailTone` = textMuted 50% toward background; `segmentTone` L1 text + spend error, L2/L3 detail |
| Exact labeled metric lines | ✅ Implemented | `format.ts` `formatMetricLines` 3 compact rows / `formatDetailLines` 5 precise rows; `reason` display label; `fmtCost` two decimals; no `spent`/`cost`; `R\|W` cache pair |
| Subagents section | ✅ Implemented | hidden at zero groups; scrollbox height 4 + scrollbar column; `↳ <name> (N tasks) ▶/▼`; exclusive transient accordion (index-keyed) |
| Settings model | ✅ Implemented | `settings.v1` = {cache, numbers, collapsedSummary}; `sidebar.expanded` for subagents; `toggle.shortcut` dedicated key; ready-gated whole-object writes; sanitizer never throws |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| `dialog.replace` ONCE → DialogSelect, stack `onClose` + once-guarded `clear()`; `settings-screen.tsx` deleted | ✅ Yes | design.md matches; file deleted on disk |
| `registerLayer({commands})` + `registerLayer({bindings, commands})`, namespace `palette`, category `TokenMeter`, disposers in `onDispose` | ✅ Yes | verified against installed `tui.d.ts` shape; render dispose test unregisters BOTH layers |
| Toggle shortcut `tokenmeter.toggle.shortcut`, ctrl+e default, off = unbound, live re-register | ✅ Yes | shortcut.ts matches interfaces contract |
| Settings model: three-field `settings.v1`, no `defaultView`, dedicated keys | ✅ Yes | settings.ts matches; sweep `rg "▸|▾|defaultView" src test` → empty (exit 1) |
| Master disclosure transient, EXPANDED default, never kv | ✅ Yes | index.tsx |
| Tone hierarchy: L1 text + error spend; detail tone blend; agent names info | ✅ Yes | tone.ts; render span-color evidence |
| Indentation 2/4 cols, no bullets | ✅ Yes | section.tsx SUMMARY_INDENT/DETAIL_INDENT; group-rows GROUP_INDENT/AGENT_METRIC_INDENT; no `●` in src |
| Compact 3 / Precise 5 labeled rows, elastic ladders, `reason`, no `spent` | ✅ Yes | format.ts |
| Subagents hidden at zero groups; scrollbox 4 + 1 scrollbar column | ✅ Yes | index.tsx + group-rows.tsx SCROLLBAR_COL |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress.md` cumulative TDD Cycle Evidence tables (all 6 phases + remediation sections) |
| All tasks have tests | ✅ | 24/24 tasks; check-only gate tasks (6.1/6.4/6.5) documented N/A with gate evidence; behavior tasks all RED→GREEN with test files |
| RED confirmed (tests exist) | ✅ | per-batch RED runs captured before production edits (module-load failures, frame timeouts, pin failures; artifact stale-dist RED 14/1) |
| GREEN confirmed (tests pass) | ✅ | re-run on current tree: `bun run test` 225/0; `bun run test:dist` 15/0; `bun run coverage` 210/0 |
| Triangulation adequate | ✅ | multiple cases per behavior (settings 14, format 52, toggle 13, tone 6, render 56, harness 69); spec scenarios mapped 54/54 with ≥1 passing covering test each |
| Safety Net for modified files | ✅ | baselines recorded per batch (186→225 suite growth, all green at each boundary); current tree verified independently |

**TDD Compliance**: 6/6 checks passed

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 85 | 4 (settings 14, format 52, toggle 13, tone 6) | bun:test |
| Integration | 125 | 2 (render 56, harness 69) | @opentui/solid headless preload harness |
| Artifact (built dist) | 15 | 1 (artifact 15) | bun:test + real dist/tui.js |
| **Total** | **225** | **7** | |

### Changed File Coverage
| File | Line % | Funcs % | Uncovered Lines | Rating |
|------|--------|---------|-----------------|--------|
| `src/tokenmeter.tsx` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/settings.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/shortcut.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/sections.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/format.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/glyphs.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/numbers.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/panel/index.tsx` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/panel/section.tsx` | 93.18 | 95.08 | 235-241, 251-255 (render-only branch) | ⚠️ Acceptable |
| `src/tokenmeter/panel/group-rows.tsx` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/panel/settings-dialog.tsx` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/panel/tone.ts` | 100 | 100 | — | ✅ Excellent |
| `src/tokenmeter/panel/project-section.tsx` | 100 | 100 | — | ✅ Excellent |

**Average changed-file coverage**: ≈ 99.4% lines — all ≥ 80% per-file gate (bunfig `coverageThreshold` 0.8/0.8/0.8, exit 0 proves compliance)

### Assertion Quality
**Assertion quality**: ✅ All assertions verify real behavior — no tautologies, no ghost loops (width sweeps iterate fixed numeric ranges, not queryable collections), no smoke-only renders (every frame test asserts rendered content + colors + counts), no orphan empty checks (each has non-empty companions). The new wrap test asserts value + label + kv write + re-registered binding + preserved command — behavior, not implementation.

### Quality Metrics
**Linter**: ⚠️ 114 warnings (all `noNonNullAssertion` style, 0 errors; preexisting legacy harness/render baseline + new-file non-null assertions in `toggle.test.ts` incl. the wrap test and `shortcut.ts:145` cyclic-index `!`) — FIXABLE, exit 0, "No fixes applied"
**Type Checker**: ✅ No errors (both tsconfigs)

### Issues Found
**CRITICAL**: None
**WARNING**:
1. **Biome 114 warnings** — all `lint/style/noNonNullAssertion` (0 errors); includes preexisting legacy regions plus non-null assertions in `test/toggle.test.ts` (including the new wrap test) and `src/tokenmeter/shortcut.ts:145` (cyclic-index `!`, FIXABLE).
2. **`section.tsx` uncovered render branch (235-241, 251-255)** — fits-gated/loading-branch lines; 93.18% lines, well above the 80% gate but the only changed file below 95%.
**SUGGESTION**: None.

### Verdict
PASS (archive-ready)
25/25 requirements implemented and runtime-covered; 54/54 scenarios COMPLIANT — including "Shortcut cycles": the previously missing 4th wrap step (Off → Ctrl+E) is now directly asserted by `test/toggle.test.ts > the full cycle wraps off back to Ctrl+E after four selections` (value, label, kv write, re-registered binding, preserved command), completing the dialog-level cycle evidence (render test covers Ctrl+Shift+E → Ctrl+M → Off on the SAME dialog instance). All gates green: test 225/0, dist 15/0, coverage 210/0 above 80/80/80, typecheck 0 errors, build exit 0, biome 0 errors. The sole former blocker is resolved; remaining warnings are style-level (biome non-null assertions) and one uncovered render branch.
