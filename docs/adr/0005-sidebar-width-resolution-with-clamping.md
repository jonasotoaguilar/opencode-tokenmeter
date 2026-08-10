# ADR-0005: Sidebar width resolution with clamping

## Status

Accepted

## Date

2026-08-10

## Deciders

jonasotoaguilar

## Context

The `sidebar_content` slot does not guarantee a stable width shape across host versions: the available width may arrive in the slot context or props, under different keys, or not at all. The panel must render correctly at whatever width the host gives it, and the terminal must never wrap mid-word. The `useTerminalDimensions()` hook is not usable — it measures the whole terminal, not the sidebar. Hardcoding a fixed width would either overflow narrow sidebars or waste space on wide ones, and a text template that assumes a width breaks the moment the width changes.

## Decision

Resolve the sidebar width from the slot context/props chain in fixed order — `width` → `columns` → `cols` → `size.width` → `viewport.width` → `bounds.width` — taking the first finite positive integer found (`resolveSidebarWidth`). When nothing resolves, fall back to **38** (realistic for the host layout). The resolved value is clamped to the useful range **24–52** (`clampSidebarWidth`), and the panel's usable content width is the sidebar width minus a one-column host margin on each side, floored at 10 (`contentWidth`). Every rendered line is then column-measured and truncated to that content width (`textColumns`/`truncateToColumns`, treating wide/combining codepoints as real columns), and fit-gated rows (metric and group rows) render only when they fit.

## Consequences

### Positive

- The panel renders correctly across the whole host width range and degrades gracefully (rows omitted, names truncated) instead of overflowing.
- Width resolution is version-tolerant: the key chain covers the plausible slot shapes and falls back predictably.
- The terminal can never wrap mid-word: every line is truncated with `…`.

### Negative

- Extremely narrow sidebars (below 24) get clamped up rather than honored, and very wide ones (above 52) are not fully exploited — an explicit product choice for legibility.
- The key chain is a best-effort contract against the host slot shape; a future host shape change may require extending `resolveSidebarWidth`.

### Neutral

- The fallback/clamp constants (38/24/52) are single-source constants in `text.ts`, shared by the panel and the tests.

## Options Considered

### Option A: Resolve chain + fallback 38 + clamp 24–52 (chosen)

Version-tolerant, bounded, column-safe; matches the reference plugin's approach of trusting slot context, never terminal dimensions.

### Option B: Fixed width

Predictable but wrong for every sidebar that differs; overflow or waste by construction. Rejected.

### Option C: `useTerminalDimensions()`-style measurement

Measures the whole terminal, not the sidebar; unusable for a slot panel. Rejected.

### Option D: No truncation, rely on host wrapping

The terminal wraps mid-word, breaking the panel's lines and layout. Rejected.

## Trade-off Analysis

The clamp gives up exact width fidelity at the extremes for guaranteed legibility and rendering stability — a cheap trade for a read-only metrics panel whose value is at-a-glance readability.

## Action Items

1. [x] `resolveSidebarWidth` / `clampSidebarWidth` / `contentWidth` in `text.ts`.
2. [x] Slot wiring in `tokenmeter.tsx` (props → ctx fallback).
3. [x] Column-safe helpers (`textColumns`, `truncateToColumns`) used by every panel line and covered by the harness.

## References

- `src/tokenmeter/text.ts` — width chain, clamp constants, column math
- `src/tokenmeter.tsx` — slot width wiring
- `src/tokenmeter/panel/index.tsx` — fit-gated rows and truncation
