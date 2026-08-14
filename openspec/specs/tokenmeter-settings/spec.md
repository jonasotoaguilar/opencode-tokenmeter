# tokenmeter-settings Specification

## Purpose

Settings model, single-key kv persistence (the three-field `settings.v1` object plus the dedicated `sidebar.expanded` and `toggle.shortcut` keys), a one-shot `DialogSelect` settings menu opened from the palette, and the persisted master-disclosure collapsed-summary source. Settings persist; disclosure is transient.

## Requirements

### Requirement: Settings object and defaults

`tokenmeter.settings.v1` MUST contain exactly THREE preferences — `cache`, `numbers`, `collapsedSummary`. `subagents` MUST NOT live in `settings.v1`; its durable source is the existing `tokenmeter.sidebar.expanded` key. The `shortcut` preference MUST live in its own `tokenmeter.toggle.shortcut` key (mirroring the Subagents key pattern) and MUST NOT live in `settings.v1`. All five default when absent:

| Preference | Values | Default | Durable source |
|---|---|---|---|
| `cache` | combined \| separated | combined | `settings.v1` |
| `numbers` | compact \| precise | compact | `settings.v1` |
| `collapsedSummary` | session \| project | session | `settings.v1` |
| `subagents` | collapsed \| expanded | collapsed | `tokenmeter.sidebar.expanded` |
| `shortcut` | ctrl+e \| ctrl+shift+e \| ctrl+m \| off | ctrl+e | `tokenmeter.toggle.shortcut` |

(Previously: third field was `defaultView`; it is removed.)

#### Scenario: Defaults apply when nothing is persisted

- GIVEN no persisted settings exist
- WHEN settings load
- THEN the five choices equal (combined, compact, session, collapsed, ctrl+e)

#### Scenario: Persisted source honored

- GIVEN `settings.v1` stores `collapsedSummary: "project"`
- WHEN settings load
- THEN the master collapsed summary renders Project totals

### Requirement: Single versioned three-field kv object

`settings.v1` MUST hold exactly `cache`/`numbers`/`collapsedSummary` as one object, read once at startup, and written as the whole three-field object on every object-preference change. `subagents`, `shortcut` and `defaultView` MUST NOT be fields of this object.

#### Scenario: One atomic write per object-preference change

- GIVEN a loaded settings object
- WHEN `cache`, `numbers`, or `collapsedSummary` changes
- THEN exactly one `kv.set("tokenmeter.settings.v1", <three-field object>)` is issued
- AND the object contains no `subagents`, `shortcut` or `defaultView` field

### Requirement: Malformed or missing values resolve to safe defaults

Loading MUST resolve a missing key, non-object value, unknown enum (including an invalid `collapsedSummary`), or absent/non-finite field to that field's default; MUST NOT throw or produce `NaN`. The dedicated `shortcut` key resolves absent or unknown values to `ctrl+e` in its own module.

#### Scenario: Missing or malformed value

- GIVEN the key is absent, or the stored value is malformed (string, `null`, invalid fields)
- WHEN settings load
- THEN invalid fields use defaults (`collapsedSummary: "other"` → `session`), valid overrides are honored, no `NaN`, no throw

### Requirement: kv readiness write gating

A write MUST be gated on `api.kv.ready`. Cycling an object-backed preference (`cache`/`numbers`/`collapsedSummary`) MUST write the full three-field `settings.v1` object when ready. Cycling `subagents` MUST write only `tokenmeter.sidebar.expanded`; cycling `shortcut` MUST write only `tokenmeter.toggle.shortcut`. When not ready, the in-memory value MUST still update for the session and MUST NOT be reported as persisted.

#### Scenario: Ready, object preference

- GIVEN `api.kv.ready === true`
- WHEN an object-backed preference changes
- THEN the three-field object is durably written and the next mount reads the new value

#### Scenario: Ready, Subagents

- GIVEN `api.kv.ready === true`
- WHEN `subagents` is cycled
- THEN only `tokenmeter.sidebar.expanded` is written; `settings.v1` is untouched

#### Scenario: Ready, Shortcut

- GIVEN `api.kv.ready === true`
- WHEN `shortcut` is cycled
- THEN only `tokenmeter.toggle.shortcut` is written; `settings.v1` is untouched

#### Scenario: Not ready

- GIVEN `api.kv.ready === false`
- WHEN any preference changes
- THEN the value updates in memory only, no durable write occurs, and persistence is not claimed

### Requirement: Dialog settings menu

Settings MUST be edited in a host `DialogSelect` opened ONCE through `api.ui.dialog.replace`, with one option per preference (`cache`, `numbers`, `collapsedSummary`, `subagents`, `shortcut`), each option title showing its current value. Selecting an option MUST cycle its value in fixed order: `cache` combined→separated→combined; `numbers` compact→precise→compact; `collapsedSummary` session→project→session; `subagents` collapsed→expanded→collapsed; `shortcut` ctrl+e→ctrl+shift+e→ctrl+m→off. The dialog MUST NOT be re-created or re-opened after a selection — the host re-renders the SAME instance reactively from the live signals, preserving the typed filter query and focus; calling `dialog.replace` again would reset the whole host stack. Escape MUST close the dialog idempotently via the stack-level `onClose` (a once-guarded `clear()`); the host `DialogSelect` has no `onCancel`.
(Previously: click-to-cycle preference rows inside the sidebar settings screen.)

#### Scenario: Cycle an object preference in the dialog

- GIVEN the dialog shows `cache combined`
- WHEN the Cache option is selected once, then again
- THEN the value is `separated`, then `combined` again, each writing the three-field object

#### Scenario: Shortcut cycles

- GIVEN the dialog shows `Shortcut: Ctrl+E`
- WHEN the Shortcut option is selected repeatedly
- THEN the title reads `Ctrl+Shift+E`, then `Ctrl+M`, then `Off`, then `Ctrl+E` again, each selection writing only `tokenmeter.toggle.shortcut`

#### Scenario: Same instance, filter and focus preserved

- GIVEN the dialog is open with a filter query typed
- WHEN an option is selected
- THEN titles update on the same DialogSelect instance
- AND the filter query and focus remain
- AND the dialog is not re-opened via `replace`

#### Scenario: Cancel closes without changes

- GIVEN the dialog is open
- WHEN Escape fires `onClose`
- THEN the dialog closes idempotently (repeat Escapes are no-ops)
- AND no preference changed

### Requirement: Preference semantics

| Preference | Semantics |
|---|---|
| `cache` | combined vs separated cache rendering (panel-ui) |
| `numbers` | compact vs precise formatting (panel-ui) |
| `collapsedSummary` | master-disclosure collapsed summary source (panel-ui) |
| `subagents` | Subagents list collapse state (durable source: `tokenmeter.sidebar.expanded`) |
| `shortcut` | toggle-sections key binding: ctrl+e \| ctrl+shift+e \| ctrl+m \| off; `off` keeps the palette command with no binding (durable source: `tokenmeter.toggle.shortcut`) |

#### Scenario: Source drives master disclosure

- GIVEN `collapsedSummary` is `project`
- WHEN the panel is master-collapsed
- THEN exactly the Project compact summary renders under the title

### Requirement: Subagents preference durable source

The `subagents` preference MUST read and write exclusively the existing `tokenmeter.sidebar.expanded` key and MUST NOT be duplicated inside `settings.v1` (no second source of truth).

#### Scenario: No dual source

- GIVEN `tokenmeter.sidebar.expanded` is `true`
- WHEN settings load
- THEN `subagents` is `expanded`, and `settings.v1` contains no `subagents` field

## Superseded requirements

| Old requirement | Resolution |
|---|---|
| Settings screen replaces metrics with explicit Back | Removed — the palette `DialogSelect` replaces the sidebar settings screen; no title-row `Settings`/`Back` toggle |
| Transient disclosure seeding from `defaultView` | Removed — superseded by the master disclosure; `defaultView` no longer exists in `settings.v1` |
