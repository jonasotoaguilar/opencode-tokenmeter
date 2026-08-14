# tokenmeter-command-palette Specification

## Purpose

TokenMeter-category command-palette entries that open the plugin-owned settings dialog (`DialogSelect` via `api.ui.dialog.replace`) and toggle section disclosure, registered through the modern keymap API with a configurable shortcut, with tests at both the source and built-artifact boundaries. There is no sidebar settings screen.

## Requirements

### Requirement: Palette command registration

The TokenMeter commands MUST be registered via `api.keymap.registerLayer` with `namespace: "palette"` — `tokenmeter.settings` titled `TokenMeter: Settings` and `tokenmeter.toggle-sections` titled `TokenMeter: Expand/Collapse Sections` — discoverable in the palette under the `TokenMeter` category. The legacy `api.command` API MUST NOT be the registration mechanism, and `registerExCommands` MUST NOT be used. Registration disposers MUST be released in `api.lifecycle.onDispose`.

#### Scenario: Command present in the palette

- GIVEN the plugin is loaded in the host
- WHEN the command palette is opened and filtered by `TokenMeter`
- THEN `TokenMeter: Settings` and `TokenMeter: Expand/Collapse Sections` entries are present under the TokenMeter category

#### Scenario: Registration mechanism

- GIVEN the plugin source and built artifact
- WHEN command registration is inspected
- THEN registration uses `api.keymap.registerLayer` with `namespace: "palette"`
- AND no `api.command` or `registerExCommands` registration exists for the commands
- AND both registration disposers are released in `api.lifecycle.onDispose`

### Requirement: Palette run opens the settings dialog

Selecting the command MUST open the settings menu through `api.ui.dialog.replace` rendering `api.ui.DialogSelect`. The plugin MUST NOT render a sidebar settings screen: the panel title row MUST NOT contain a `Settings`/`Back` toggle, and no in-panel view MAY replace the metric body.
(Previously: the command switched the mounted panel to an in-panel Settings screen via a module-scope `openSettings` seam.)

#### Scenario: Command opens the dialog

- GIVEN the plugin is loaded
- WHEN the `TokenMeter: Settings` command is invoked
- THEN `api.ui.dialog.replace` renders the settings `DialogSelect`
- AND the sidebar metric body remains unchanged

#### Scenario: No sidebar settings screen

- GIVEN the panel renders
- WHEN the title-row frame is captured
- THEN it contains no `Settings` or `Back` toggle text
- AND no settings screen ever replaces the metric rows

### Requirement: Toggle-sections command with configurable shortcut

The `tokenmeter.toggle-sections` command MUST expand or collapse the Project, Session and Subagents sections together (Project/Session transient, Subagents through the durable preference). The command MUST bind to a configurable shortcut — default `ctrl+e`, cycled `ctrl+e` → `ctrl+shift+e` → `ctrl+m` → `off` in the settings dialog — persisted under `tokenmeter.toggle.shortcut`. `off` MUST keep the command palette-visible with NO key binding. A shortcut change MUST re-register the layer live so the new binding (or its removal) takes effect WITHOUT a restart.

#### Scenario: Default binding

- GIVEN no persisted shortcut preference
- WHEN the plugin registers its layers
- THEN `ctrl+e` fires `tokenmeter.toggle-sections`
- AND the command is queryable in the palette under TokenMeter

#### Scenario: Toggle all sections

- GIVEN Project, Session and Subagents are all collapsed
- WHEN the command runs
- THEN all three sections expand (Subagents persisted to `tokenmeter.sidebar.expanded`)
- AND a second run collapses them again

#### Scenario: Off keeps the command

- GIVEN the shortcut preference is `off`
- WHEN the layer re-registers
- THEN no key binding exists for the command
- AND `TokenMeter: Expand/Collapse Sections` remains queryable in the palette

#### Scenario: Live re-registration

- GIVEN the plugin running with the default `ctrl+e` binding
- WHEN the Shortcut preference cycles to `ctrl+m`
- THEN `ctrl+m` triggers the command immediately without a restart
- AND `ctrl+e` no longer triggers it

### Requirement: Source and artifact boundary tests

Tests MUST assert the command at both boundaries: the source test suite and the built `dist` artifact test.

#### Scenario: Source boundary

- GIVEN the source test suite
- WHEN `bun run test` executes
- THEN a test asserts the palette command exists and opens the settings dialog

#### Scenario: Built artifact boundary

- GIVEN the built `dist` artifact
- WHEN the artifact test runs
- THEN it asserts the built artifact registers the palette command
