# ADR-0004: External runtime packages

## Status

Accepted

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

The TUI host loads the plugin's bundled entry inside its own process and provides the plugin SDK and rendering primitives itself: `@opencode-ai/plugin` (and its `/tui` entry), `@opentui/core`, `@opentui/solid`, and `solid-js` are all host-provided at load time. If the bundle inlined its own copies of these packages, the host would end up with duplicate module instances (two `solid-js` runtimes, two copies of OpenTUI) — a guaranteed source of broken reactivity, mismatched component identities, and version-skew bugs that are extremely hard to diagnose in a TUI process. The published package must also stay small: only the plugin's own code belongs in the tarball.

## Decision

Mark the runtime packages **external** in the build (`EXTERNAL` list in `scripts/build.ts`: `@opencode-ai/plugin`, `@opencode-ai/plugin/tui`, `@opentui/core`, `@opentui/solid`, `solid-js`), so they resolve from the host at load time and are never inlined. The package declares `@opencode-ai/plugin` as a peer dependency (`>=1.14.50 <2`) as the compatibility contract with the host, and `"files": ["dist"]` restricts the npm tarball to the built artifact. The dist regression test (`test/artifact.test.ts`) imports the compiled artifact directly to prove it loads as a plugin module against the host environment.

## Consequences

### Positive

- Single module instances in the host process: reactivity, component identity, and `solid-js` store semantics are shared with the host.
- Small publishable tarball (only `dist/`); no duplicated runtime code.
- The peer range documents the host SDK contract explicitly.

### Negative

- The plugin cannot run standalone outside the host — it is load-bound by design.
- Host SDK upgrades are a compatibility surface: the plugin pins a peer range, not an exact version, so a future breaking host change requires a plugin release.

### Neutral

- Dev dependencies still install the full set for typechecking and the `@opentui/solid` transform plugin at build time; only the runtime resolution is delegated to the host.

## Options Considered

### Option A: External runtime packages (chosen)

Correct module identity inside the host process; matches the reference plugin's dist; smallest tarball.

### Option B: Inline everything

Self-contained file, but duplicate runtimes and OpenTUI/Solid instances in the host process — breaks reactivity and component identity. Rejected.

### Option C: Vendor a pinned host SDK copy

Deterministic but wrong: the host loads its own copy regardless, so the plugin would run against two versions at once. Rejected.

## Trade-off Analysis

The host is the platform, not a peer: duplicating its primitives cannot work, so the only real cost of externalization is the peer-range compatibility surface — which the dist smoke test and CI gates keep honest.

## Action Items

1. [x] `EXTERNAL` list in `scripts/build.ts`.
2. [x] `peerDependencies` with the SDK range; `files: ["dist"]`.
3. [x] `test/artifact.test.ts` imports the dist against the host module resolution.

## References

- `scripts/build.ts` — `EXTERNAL` list
- `package.json` — `peerDependencies`, `files`
- `test/artifact.test.ts` — dist import/load regression
- [ADR-0001: Bundled dist with the Solid transform plugin](0001-bundled-dist-with-solid-transform-plugin.md)
