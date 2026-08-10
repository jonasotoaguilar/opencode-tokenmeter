# ADR-0001: Bundled dist with the Solid transform plugin

## Status

Accepted

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

The TUI plugin host loads the plugin entry as a plain file. When the source `.tsx` entry is loaded that way, Bun's ordinary eager JSX transform kicks in: it emits `jsxDEV` calls whose props are evaluated eagerly (`when: view()`, `children: formatHeadline(snap())`), so the mounted sidebar receives zero OpenTUI reactive bindings and **never repaints** when the usage snapshot updates — only closing and reopening the panel remounts it and reads the latest snapshot. Source-level tests cannot catch this: `bunfig.toml` preloads `@opentui/solid/preload`, so source tests always run under the correct transform regardless of what the production loading boundary does. The plugin therefore needs a build step that produces a deterministic artifact with real `effect`/`insert` bindings, and a guard that fails loudly if the artifact ever degrades back to the eager shape.

## Decision

Build the entry with `bun build` plus `createSolidTransformPlugin()` from `@opentui/solid/bun-plugin` (the same transform the working reference plugin dist ships), producing `dist/tokenmeter.js` as a single-file ESM bundle. Shared runtime packages (`@opencode-ai/plugin`, `@opencode-ai/plugin/tui`, `@opentui/core`, `@opentui/solid`, `solid-js`) are marked external. The build script (`scripts/build.ts`) post-checks the artifact: it requires the reactive binding imports/calls (`effect as _$effect`, `insert as _$insert`, `insertNode as _$insertNode`) and forbids `jsxDEV` and `@opentui/solid/jsx-runtime` imports, exiting non-zero otherwise. `test/artifact.test.ts` independently re-verifies the compiled artifact on every `test:dist` run, so the guard is enforced both at build time and in CI.

## Consequences

### Positive

- The shipped artifact always carries real Solid reactivity — the mounted panel repaints on snapshot updates without a remount.
- A broken (non-reactive) build cannot silently ship: the assertion fails the build and the artifact test fails CI.
- `bun build` keeps the toolchain minimal (no extra bundler) and matches the reference plugin's proven pipeline.

### Negative

- Build output must be regenerated and committed/published — running from source is not a supported production path.
- The artifact assertion patterns are coupled to the `@opentui/solid` transform's emit shape; a transform change may require updating `scripts/build.ts`.

### Neutral

- `dist/` is produced by tooling; consumers load the bundle, never the source.

## Options Considered

### Option A: Bun build + `createSolidTransformPlugin` (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — one script, one plugin |
| Toolchain | Reuses Bun (already the package manager/runtime) |
| Provenance | Matches the working reference plugin dist |
| Guard | Post-build assertion + artifact test |

### Option B: Ship source `.tsx` and let the host compile it

| Dimension | Assessment |
|-----------|------------|
| Complexity | Lowest |
| Correctness | Broken — eager transform yields a panel that never repaints |
| Guard | None possible |

**Cons:** the exact failure this ADR exists to prevent.

### Option C: tsup

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — second bundler in the toolchain |
| Correctness | Requires wiring the Solid transform plugin anyway |
| Value | No advantage over `bun build` for a single-entry ESM bundle |

**Cons:** redundant toolchain; the Solid transform plugin is the deciding factor, not the bundler.

## Trade-off Analysis

The deciding factor is the transform, not the bundler: eager JSX is the bug, and `createSolidTransformPlugin` is the fix — `bun build` is the cheapest way to run it while keeping the whole pipeline (install, test, build, publish) on one tool.

## Action Items

1. [x] `scripts/build.ts` with the transform plugin, external packages, and the reactive-binding assertion.
2. [x] `test/artifact.test.ts` dist regression guard.
3. [x] `prepack` runs the build automatically on pack/publish.

## References

- `scripts/build.ts` — build + assertion implementation
- `test/artifact.test.ts` — independent artifact guard
- [ADR-0004: External runtime packages](0004-external-runtime-packages.md)
