# Exploration: Progressive Disclosure UI for the TokenMeter Sidebar

Change: `progressive-disclosure-ui` — partial presentation redesign of the TokenMeter TUI sidebar. Data architecture, width-safe rendering, theme roles, gold spend color, persistence, and metric correctness are preserved.

## Current State

The panel (`src/tokenmeter/panel/index.tsx`, entry `src/tokenmeter.tsx`) renders, top to bottom:

1. **Title row** — `TokenMeter 1.0.1`; the version is hardcoded twice in the source (`" 1.0.1"`).
2. **Project section** — `Project` accent label + two always-on metric rows: row 1 spend (`SPEND_GOLD` coins) · thinking (accent) · cost (error); row 2 muted `↑ input · ↓ output real · 🖿 cache R|W`. Static `…` placeholder while no snapshot; stable error line on failure.
3. **Session section** — same two metric rows; same `…` fallback.
4. **Subagents row** — accent label + chevron (`▶`/`▼`), mouse-toggled (`onMouseDown`, `selectable={false}`), persisted in `api.kv` (`tokenmeter.sidebar.expanded`, collapsed default).
5. **Expanded list** — agents/task metrics row, then per-agent groups: each group is **exactly three rows** (marker+robot+name+tasks; indented spend·thinking·cost; indented breakdown), wrapped in a 6-row scrollbox when ≥3 groups.

Data layer (unchanged by this redesign): `snapshot` (`UsageSnapshot`: rootID, cost, totalTokens, input, output, reasoning, cacheRead, cacheWrite, cache, delegations, agents, groups) from `store.ts`/`reconcile.ts`; `projectSnapshot` (`ProjectUsage`: id, sessions, cost, context, input, output, reasoning, cacheRead, cacheWrite, cache) from `project.ts`. Both carry every metric the compact/detailed views need — **no data-model change required**.

Key verified facts (installed types, `node_modules/@opencode-ai/plugin/dist/tui.d.ts` v1.18.14):

- `sidebar_content` slot props are **only `{ session_id: string }`**; `TuiSlotContext` is **only `{ theme: TuiTheme }`**. The width chain (`resolveSidebarWidth`: width → columns → cols → size → viewport → bounds) **never resolves from the installed types** — the panel always renders at fallback 38 (content 36). The "narrow widths 24–37 hiding content" audit finding cannot be fixed by measurement; the fix is a compact-first design whose rows fit the narrowest clamp.
- `TuiKV` = `{ get<V>(key, fallback?), set(key, value), readonly ready }` — confirmed; `ready` may be false at startup, writes then may be dropped. No change notification.
- `TuiThemeCurrent` provides all roles in use (text, textMuted, primary, accent, error, success, info, warning…) plus `thinkingOpacity`.
- `api.ui` exposes host dialogs (`DialogSelect`, `DialogPrompt`, …) and `api.ui.toast`; `api.keymap` exists in types but `@opentui/keymap` is **not installed** (optional peer), and the project skill's feasibility reference rules out adding commands/keybindings — the direction's "no native command" choice is correct; host dialogs remain a viable-but-declined alternative.
- OpenTUI base catalogue (`@opentui/solid`): `box`, `text`, `scrollbox`, `select`, `tab_select`, `input`, `textarea`… — `select`/`tab_select` exist but need `focused` + keyboard; the proven interaction primitive in this plugin is `onMouseDown` on `selectable={false}` text.
- UI files (`src/tokenmeter.tsx`, `panel/*.tsx`) carry `// @ts-nocheck` — the typecheck gate does not check the plugin UI source; installed-type verification is manual discipline.

Pinned by tests (will need updating): render/harness suites pin exact frames and layout — "collapsed shows ONLY the Subagents toggle row", "each group renders exactly three rows", "accent Project/Session subtitles, clean title, chevron after Subagents", "scrollbox capped at 2 groups", static `…` loading fallback, two-visible-spaces-after-glyph rules, `fmtCost` always two decimals, glyph codepoint constants, no text metric labels.

## Affected Areas

- `src/tokenmeter/panel/index.tsx` — restructured: header + settings entry, settings menu replacing panel content (with `Back`), compact section summaries with click disclosure, Subagents summary row, exclusive group accordion wiring.
- `src/tokenmeter/panel/group-rows.tsx` — one compact row per group + expandable detail block (replaces the fixed three-row block).
- `src/tokenmeter/panel/project-section.tsx` — error line stays; placeholder/empty-copy split.
- `src/tokenmeter.tsx` — settings kv wiring (read defaults at startup, write on change), pass settings signals/accessors to `UsagePanel`.
- `src/tokenmeter/settings.ts` (NEW) — settings model: defaults, one kv key, signals; mirrors `project.ts` pattern (signals + persistence, no render logic).
- `src/tokenmeter/format.ts` — compact summary formatters, pluralized counts (1 task / 2 tasks, 1 agent / 2 agents), separate cache R|W formatter, precise number formatter.
- `src/tokenmeter/numbers.ts` — `fmtPrecise` (thousands-separated integers) alongside `fmtTokens`/`fmtCompact`/`fmtCost`.
- `src/tokenmeter/text.ts` — unchanged mechanics; possibly new fit-budget constants for compact/detail rows.
- `src/tokenmeter/glyphs.ts` — only if a settings glyph is added (currently no settings icon exists in `docs/assets/icons/`; a text label avoids the verification burden).
- `test/harness.test.ts`, `test/render.test.tsx` — layout-pinning assertions updated to the new frame contract; new tests for settings defaults/persistence, exclusive accordion, disclosure toggles, pluralization, precise format.
- `DESIGN.md`, `PRD.md`, `README.md`, `docs/release-security.md`, `skills/npm-secure-config/` (SKILL.md + references/bun-config.md, npm-config.md, pnpm-config.md, publishing.md) — **protected (uncommitted user changes); not edited by exploration**. DESIGN.md/PRD.md will receive updates in later phases per the delta rules; README/release-security and the npm-secure-config skill files stay untouched unless the proposal explicitly scopes doc work.
- `docs/adr/` — width ADR-0005 stays valid (clamping/fallback unchanged); a new ADR for settings persistence is optional at design phase.

## Approaches

### 1. Interaction state model

- **A. Dedicated `settings.ts` module (signals + kv + defaults) and module-level UI state signals** — settings owned by a new module (read/write kv, default constants, `createSignal` per preference or one object signal); disclosure state (project/session open, open group index) as plain module-level signals in the panel, defaulting from settings on mount; entry passes accessors down.
  - Pros: matches the golden rule (store-like owner, panel presentational); directly unit-testable without rendering; entry stays lean; exclusive accordion is one signal (`openGroupIndex`, set on open, cleared on global collapse).
  - Cons: new module (small); prop-drilling of a few accessors.
  - Effort: Low
- **B. All state in `tokenmeter.tsx` entry** — extend the existing `expanded` pattern to four settings + disclosure signals, passed as props.
  - Pros: no new module; mirrors today's code.
  - Cons: entry grows past its "wires events and slot" role; harder to test settings logic in isolation; more props through `UsagePanel`.
  - Effort: Low
- **C. Single settings object signal + derived UI state** — one `createSignal<Settings>`; disclosure derived from it.
  - Pros: one source of truth.
  - Cons: per-section disclosure is transient UI state, not a preference — mixing both in one signal couples unrelated lifecycles (settings survive restarts; disclosure is per-mount).
  - Effort: Low

### 2. Persistence model (settings)

- **A. One kv key `tokenmeter.settings.v1` holding a small object; defaults on missing/malformed** — one `kv.set` per change; read once at startup; malformed/missing → defaults (never NaN, never crash).
  - Pros: single atomic read/write, no torn multi-key states; fail-safe defaults; consistent with the existing single-key `tokenmeter.sidebar.expanded` practice.
  - Cons: concurrent TUIs last-writer-wins (acceptable for a user preference; the SQLite store exists precisely because kv RMW loses history — settings are not history).
  - Effort: Low
- **B. Four separate kv keys** (one per preference).
  - Pros: independent evolution.
  - Cons: partial writes on concurrent TUIs produce mixed states; more keys to migrate; no benefit at this scale.
  - Effort: Low
- **C. No persistence (in-memory only)**.
  - Pros: zero kv risk.
  - Cons: violates the product direction (settings are preferences that must survive restarts); defaults would reapply every launch.
  - Effort: Low

### 3. Settings UI placement

- **B. Settings replace panel content (approved)** — a settings entry in the title row opens a TokenMeter settings menu that temporarily replaces the panel content: four rows (`Default view ▸ Compact/Detailed`, `Cache ▸ Combined/R&W`, `Subagents ▸ Collapsed/Expanded`, `Numbers ▸ Compact/Precise`), each click-to-cycle via `onMouseDown` on `selectable={false}` text (proven pattern), plus a `Back` action that returns to the metrics panel.
  - Pros: matches the approved conversation direction; adds no rows on top of the metrics, preserving the density objective; full content width for values; one explicit Show/switch in the panel.
  - Cons: metrics are hidden while adjusting (temporary, by design — Back is the unmistakable exit); the menu adds a Show/switch branch to the panel; frame tests must cover both views.
  - Effort: Low–Medium
- **A. Inline settings section that expands under the title row (overlay-in-flow)** — a `Settings` header row (click toggles); when open, four rows render below it, each click-to-cycle; clicking the header again closes. (Alternative, NOT chosen.)
  - Pros: metrics stay visible while adjusting; reuses the proven interaction primitive; no new glyph needed (text label, like `Project`/`Session`).
  - Cons: adds 4–5 rows on top of the metrics, against the density objective; contradicts the approved direction.
  - Effort: Low–Medium
- **C. Host `api.ui.DialogSelect`** per preference.
  - Pros: host-rendered, consistent with OpenCode look; typed `DialogSelect<Value>` exists in installed types.
  - Cons: contradicts the approved direction ("plugin-owned inline settings accessible from panel header"); dialogs are a different interaction surface (modal), harder to test in the frame harness (harness drives the slot, not the dialog stack); per-preference dialogs are heavier than one inline row.
  - Effort: Medium–High

### 4. Responsive / layout strategy

- **A. Compact-first: every compact row fits the narrowest clamp (sidebar 24 → content 22), detail rows are fits-gated and user-revealed** — compact summaries are single rows (`🪙 1.2M · $3.40` ≈ 16 cols, fits 22); detailed rows keep today's fit-gating (render only when they fit); no reliance on a width signal that does not exist.
  - Pros: the audit's "narrow widths hiding content" is solved by design (nothing important is hidden — detail is one deliberate click away); keeps every invariant (no wrap, no overflow, width-chain fallback 38 untouched).
  - Cons: at 24–30 widths the detailed rows may hide — but that is now an explicit user choice, not a silent casualty.
  - Effort: Medium
- **B. Width-responsive section compression** (auto-collapse sections below a threshold) — requires a real width signal the installed slot types do not provide; would rely on speculative runtime props.
  - Pros: (would) adapt automatically.
  - Cons: unverifiable against installed types; adds conditional complexity on a chain that currently never resolves; rejected.
  - Effort: High
- **C. Keep current two-row sections and only add settings** — minimal, but fails the core audit findings (dense repeated metrics, weak hierarchy) and does not deliver the approved direction.
  - Effort: Low (but out of scope of the direction)

### 5. Disclosure state persistence

- **A. In-memory per mount; defaults from settings** — section disclosure and group accordion are transient UI state; the `Default view` preference seeds them at mount; only settings and the Subagents collapse state persist.
  - Pros: matches "group detail need not persist"; no new kv keys; switching sessions re-seeds from the preference, predictable.
  - Cons: disclosure resets on plugin restart (fine — it is a preference-driven default).
  - Effort: Low
- **B. Persist every disclosure bit in kv** — per-section flags + open group.
  - Pros: full continuity.
  - Cons: more keys, cross-TUI clobber surface, no user-visible value; contradicts the direction's "need not persist".
  - Effort: Low

## Recommendation

**Approach 1A + 2A + 3B + 4A + 5A**, i.e.: a new `settings.ts` module owning defaults + one kv key (`tokenmeter.settings.v1`) + signals; a settings entry in the title row opens a TokenMeter settings menu that temporarily REPLACES the panel content (four click-to-cycle rows — Default view, Cache, Subagents, Numbers — plus a `Back` action returning to the metrics panel; click-to-cycle on `selectable={false}` text, the proven primitive); compact-first single-row Project/Session summaries with independent click disclosure; Subagents global summary row + one-row-per-group list with an exclusive in-memory accordion (one `openGroupIndex` signal, closed on global collapse); transient disclosure state seeded from the `Default view` preference; pluralized counts and a precise number formatter added to `format.ts`/`numbers.ts`; distinct loading (`…`, static, per the no-animation rule) vs empty copy ("No usage yet" / "No sessions"); version removed from the title (or build-time injected) to fix the hardcoded/stale-version finding; the Subagents kv key `tokenmeter.sidebar.expanded` stays and the new preference row writes the same key (no migration, no dual source of truth).

Rationale: every piece reuses a pattern already proven in this codebase (kv single-key persistence, `onMouseDown` toggles, fits-gated rows, module-owned signals), the data layer is untouched (correctness invariants in `store.ts`/`reconcile.ts`/`project.ts`/`db.ts` stay as-is), and the design makes the width limitation (no slot width signal in installed types) irrelevant for the primary view. Settings must persist (direction), disclosure must not (direction), and the accordion exclusivity is one signal.

## Risks

- **Test churn**: `test/render.test.tsx` and `test/harness.test.ts` pin many exact frames and layout facts ("three rows per group", "collapsed shows ONLY the Subagents toggle row", theme-contract source assertions). The redesign intentionally changes these contracts; expect a large, mostly test-side diff. Review budget (400 lines) is likely exceeded — flag chained-PR planning at the tasks phase.
- **No width signal**: the panel cannot sense the real sidebar width (installed slot types carry only `session_id`); the compact-first strategy mitigates, but detail rows may still hide at 24–30 sidebar widths — accepted, user-revealed.
- **kv readiness window**: a settings write during the startup `kv.ready === false` window may be dropped; reads at startup gate on defaults, and a dropped write only loses the latest preference change (user re-cycles). Consider gating writes on `kv.ready` (cheap).
- **Settings glyph**: no settings icon exists in the verified asset set; introducing a new PUA codepoint requires verification against the installed Nerd Font and a test update — prefer a text label to keep the glyph contract closed.
- **`// @ts-nocheck` UI sources**: typecheck does not cover the panel; installed-type verification stays manual (this exploration verified against `tui.d.ts` 1.18.14).
- **Mouse-only interaction**: keyboard users cannot toggle disclosure/settings; consistent with the current plugin, but worth stating in the design contract.
- **Protected files**: DESIGN.md/PRD.md/README.md/docs/release-security.md and `skills/npm-secure-config/` (SKILL.md + references) carry uncommitted user changes; later phases must apply delta rules without reverting them.

## Ready for Proposal

Yes. The direction is feasible end-to-end with no data-layer or persistence-architecture change. What the orchestrator should tell the user: the redesign is presentation-only as approved; the only notable constraint discovered is that the installed TUI slot API exposes no sidebar-width signal (the panel always renders at fallback 38), so the compact default view is also the width-safety strategy — detail rows are user-revealed, not width-dependent. Settings persist under one new kv key; the existing Subagents collapse key is reused. Expect substantial test-contract updates; plan delivery slices accordingly.
