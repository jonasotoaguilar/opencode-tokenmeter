/**
 * Production build for the TokenMeter TUI plugin (tokenmeter).
 *
 * Why this exists: the TUI plugin host loads the plugin entry as a plain
 * file. When the source .tsx entry is loaded that way, the
 * JSX can be compiled through Bun's ordinary eager transform, which emits
 * `jsxDEV` calls with eagerly evaluated props (`when: view()`,
 * `children: formatHeadline(snap())`) and zero OpenTUI reactive bindings.
 * The mounted sidebar then never repaints when the usage snapshot updates —
 * only closing/reopening it remounts and reads the latest snapshot.
 *
 * This script bundles the entry with @opentui/solid's Solid transform plugin
 * (the same transform the working opencode-subagent-statusline dist ships),
 * producing a deterministic artifact with real `effect`/`insert` bindings.
 * The post-build assertion fails loudly if the artifact ever degrades back
 * to an eager JSX shape, so a broken build cannot silently ship.
 *
 * Usage: `bun run build` (or `bun scripts/build.ts`).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const ROOT = resolve(import.meta.dir, "..")
const ENTRY = resolve(ROOT, "src/tokenmeter.tsx")
const OUTDIR = resolve(ROOT, "dist")
const ARTIFACT = resolve(OUTDIR, "tokenmeter.js")

// Shared runtime packages stay external, exactly like the working
// opencode-subagent-statusline dist: the TUI host provides them at load
// time, so they must not be inlined into the artifact.
const EXTERNAL = [
  "@opencode-ai/plugin",
  "@opencode-ai/plugin/tui",
  "@opentui/core",
  "@opentui/solid",
  "solid-js",
]

const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: OUTDIR,
  target: "bun",
  format: "esm",
  splitting: false,
  minify: false,
  sourcemap: "none",
  external: EXTERNAL,
  plugins: [createSolidTransformPlugin()],
})

if (!result.success) {
  console.error("TokenMeter build failed:")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Reactive-binding guard. The Solid transform emits imports of the form
// `effect as _$effect` / `insert as _$insert` from @opentui/solid and calls
// like `_$effect((_$p) => _$setProp(...))` / `_$insert(_el, () => ...)`.
// An eager JSX artifact instead imports @opentui/solid/jsx-runtime and calls
// `jsxDEV(...)` with evaluated props. Fail loudly rather than ship that.
const code = readFileSync(ARTIFACT, "utf8")

const REQUIRED = [
  {
    pattern: /effect as _\$effect/,
    what: "effect binding (effect as _$effect)",
  },
  { pattern: /_\$effect\(/, what: "effect invocation (_$effect(...))" },
  {
    pattern: /insert as _\$insert/,
    what: "accessor insert binding (insert as _$insert)",
  },
  {
    pattern: /_\$insert\(/,
    what: "accessor insert invocation (_$insert(...))",
  },
  {
    pattern: /insertNode as _\$insertNode/,
    what: "accessor insertNode binding (insertNode as _$insertNode)",
  },
  {
    pattern: /_\$insertNode\(/,
    what: "accessor insertNode invocation (_$insertNode(...))",
  },
]

const FORBIDDEN = [
  { pattern: /jsxDEV/, what: "eager jsxDEV call" },
  {
    pattern: /jsx-runtime/,
    what: "eager JSX runtime import (@opentui/solid/jsx-runtime)",
  },
]

let failures = 0
for (const { pattern, what } of REQUIRED) {
  if (!pattern.test(code)) {
    console.error(`TokenMeter artifact missing ${what} — build is not reactive`)
    failures += 1
  }
}
for (const { pattern, what } of FORBIDDEN) {
  if (pattern.test(code)) {
    console.error(`TokenMeter artifact contains ${what} — eager JSX slipped in`)
    failures += 1
  }
}

if (failures > 0) {
  console.error(
    "TokenMeter build produced a non-reactive artifact; refusing to ship",
  )
  process.exit(1)
}

console.log(`TokenMeter artifact: ${ARTIFACT}`)
console.log(`Reactive bindings: effect + insert + insertNode, no eager JSX`)
