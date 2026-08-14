# Design: Progressive Disclosure UI

## Technical Approach

Presentation-only refresh over the untouched data pipeline (event → invalidation → reconcile): master disclosure, `theme().warning` section titles, theme-relative tones, nested indentation (no bullets), `↳` real-scroll Subagents hidden when empty, elastic degradation that never drops values, palette `DialogSelect` settings, toggle shortcut.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Settings UI | `dialog.replace` ONCE → `DialogSelect` (titles re-read signals); stack `onClose` + once-guarded `clear()`; `settings-screen.tsx` deleted | Recursive re-`replace`; in-panel screen | `replace` resets host stack; no `onCancel` |
| Palette layers | `registerLayer({commands})`: `tokenmeter.settings`, `tokenmeter.toggle-sections`; `namespace:"palette"`, `category:"TokenMeter"`; disposers in `onDispose` | `registerExCommands`, `api.command` | Banned |
| Toggle shortcut | `registerLayer({bindings, commands})` on `tokenmeter.toggle.shortcut` (ctrl+e→ctrl+shift+e→ctrl+m→off, default ctrl+e); `off` keeps command unbound; re-registers live | Fixed binding | No restart |
| Settings model | `settings.v1` = {cache, numbers, collapsedSummary}; `subagents`↔`sidebar.expanded`; `shortcut`↔`toggle.shortcut`; no `defaultView` | Single blob | One source per pref |
| Master disclosure | Transient `masterCollapsed`; starts EXPANDED; resets on session change; never kv | kv-persist | Spec |
| Chevrons & headings | `▶`/`▼` LEFTMOST on master/sections/Subagents, TRAILING on agents; chevron OR title-text toggles; TokenMeter `theme().text`; section titles `theme().warning`, no glyph | `▸`/`▾`; chevron-only; white headings | Spec |
| Tone hierarchy | L1 `theme().text`, `$amount` `theme().error`; L2/L3 + `(N tasks)` `textMuted`→`background` 50% (`tone.ts`); agent names `theme().info` | Gold/cool/warm map, `#D4AF37` | No fixed hex |
| Indentation | Sections 2 cols; agent headers 2 / metric rows 4; no bullets | `●` bullets | Spec |
| Agent entry | `↳ <name> (<N> tasks) ▶/▼` — branch + trailing chevron main-text, name `theme().info`, count detail tone | `↳`-only | Spec |
| Detail rows | Compact 3 / Precise 5 labeled rows; elastic ladder (labels/sep → `$…` → `…`); reasoning/cache always render; label `reason`; no `spent`/`cost` | Fits-gate omission | Never hidden |
| Subagents section | Hidden at zero groups (no heading/scrollbox/caption); scrollbox height 4 + 1 reserved scrollbar column | 0-count caption; sliced list | Spec |

## Data Flow

```
mount → loadSettings + loadToggleShortcut → {settings.v1, sidebar.expanded, toggle.shortcut}
keymap → registerLayer(settings + toggle-sections) → disposed in onDispose
palette → showSettingsDialog → dialog.replace(DialogSelect, close)
  onSelect → cycle*(api) → kv-gated write; titles re-read — no re-replace
  onClose → once-guarded clear()
shortcut cycle → registerToggleLayer → rebind live
panel → masterCollapsed? → `▶ TokenMeter` + elastic L1(collapsedSummary)
      → else → Sections → closed L1 | open: 3/5 rows
Subagents (groups>0) → scrollbox(4, scrollbar col) → `↳ name (N tasks) ▶/▼`
```

## File Changes

| File | Action | Description |
|---|---|---|
| `panel/settings-dialog.tsx` | Create | DialogSelect seam |
| `panel/settings-screen.tsx` | Delete | Replaced by dialog |
| `panel/tone.ts` | Create | Tones |
| `panel/colors.ts` | Delete | Obsolete |
| `shortcut.ts` | Create | Shortcut pref + layer |
| `sections.ts` | Create | Section store + toggle |
| `tokenmeter.tsx` | Modify | Palette layers + `onDispose` |
| `settings.ts` | Modify | Three-field object |
| `panel/index.tsx` | Modify | Master disclosure, gating |
| `panel/section.tsx` | Modify | Warning title |
| `panel/group-rows.tsx` | Modify | `↳` + trailing chevron |
| `format.ts` | Modify | 3/5 rows, `reason`, ladders |
| `glyphs.ts` | Modify | `▶`/`▼`/`↳` only |
| `test/{settings,format,tone,toggle,render,harness,artifact}.*` | Modify | Dialog, commands, tones |

## Interfaces / Contracts

```ts
type Settings = { cache: CachePref; numbers: NumbersPref; collapsedSummary: CollapsedSummaryPref }
const SETTINGS_KV_KEY = "tokenmeter.settings.v1"
const SUBAGENTS_KV_KEY = "tokenmeter.sidebar.expanded"
type ToggleShortcutPref = "ctrl+e" | "ctrl+shift+e" | "ctrl+m" | "off"
const TOGGLE_SHORTCUT_KV_KEY = "tokenmeter.toggle.shortcut"
export function cycleCollapsedSummary(api: SettingsApi): void
export function loadToggleShortcut(api): void
export function registerToggleLayer(api): () => void  // {bindings, commands}, idempotent
export function cycleToggleShortcut(api): void        // write + re-register live
export function disposeToggleLayer(): void
export function toggleSections(api: SettingsApi): void
export function showSettingsDialog(api: DialogSurface): void
```

Non-obvious: the close hook is the stack-level `onClose` (no `onCancel` exists), once-guarded so `clear()` stays idempotent; `onSelect` only cycles preferences, never re-`replace`s.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Sanitize/cycle/gating; ladders, 3/5 rows, `reason`, no `spent`; tone blend; shortcut cycle/`off`/re-register | `settings`/`format`/`tone`/`toggle` suites — RED first |
| Integration | Warning titles, chevron placement, indents, replace-on-expand, zero-group Subagents, scrollbox; dialog once + reactive titles + idempotent close | `test/render.test.tsx` + harness mocks |
| E2E / artifact | Built `dist/tui.js` registers both palette commands via `registerLayer`; no `api.command`/`registerExCommands` | `test/artifact.test.ts` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

`defaultView` never shipped → removed; sanitizer ignores stale field. `subagents`/`shortcut` dedicated keys. Master starts EXPANDED. Layers disposed in `onDispose`; dialog closes idempotently. Revert = revert commits.

## Open Questions

None — resolved: master starts EXPANDED; Subagents hidden at zero groups; shortcut defaults `ctrl+e`.
