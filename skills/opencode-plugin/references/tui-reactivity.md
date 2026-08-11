# TUI Reactivity Production Gate

Use this gate for every OpenCode TUI plugin that renders `.tsx` with
`@opentui/solid`.

## Failure signature

If a sidebar updates only after closing and reopening, inspect the compiled
artifact before debugging event or store logic. The state may be changing while
the mounted JSX was compiled eagerly:

- broken shape: `jsxDEV(...)` or `@opentui/solid/jsx-runtime`, with values such
  as `when: view()` and `children: formatHeadline(snap())` evaluated at render;
- working shape: OpenTUI `effect` and accessor `insert` bindings, such as
  `_$effect(...)` and `_$insert(node, () => ...)`.

The `@opentui/solid/preload` test setup can hide this defect by transforming
source files during tests even when the production `tui.json` entry is loaded
without that transform.

## Required build shape

Use this production layout:

```text
tui-plugins/
├── build.ts                 # Bun build entry
├── <plugin>.tsx             # source
└── dist/<plugin>.js         # artifact loaded by tui.json
```

Expose a reproducible command, for example:

```json
{ "scripts": { "build:tui-plugin": "bun tui-plugins/build.ts" } }
```

Build `tui-plugins/<plugin>.tsx` into `tui-plugins/dist/<plugin>.js` with Bun
and `createSolidTransformPlugin()` from `@opentui/solid/bun-plugin`:

- target Bun;
- format ESM;
- disable splitting;
- keep `@opencode-ai/plugin`, `@opencode-ai/plugin/tui`, `@opentui/core`,
  `@opentui/solid`, and `solid-js` external;
- write the artifact to `dist/`;
- load that exact compiled `.js` path from `tui.json`, never the source `.tsx`;
- create signals/effects inside the plugin's `createRoot` and pass accessors to
  rendered components so their lifetime follows the plugin.

The build must fail if reactive `effect`/`insert`/`insertNode` bindings are
absent or if `jsxDEV`/`jsx-runtime` output is present. Artifact tests must:

1. inspect the compiled file for those bindings and forbidden eager JSX;
2. import its default export and verify the expected TUI module shape;
3. verify a mounted panel changes without a remount.

Run the build before the artifact tests, using the plugin's declared build
script. Restart OpenCode after changing a TUI plugin or its `tui.json` entry.
