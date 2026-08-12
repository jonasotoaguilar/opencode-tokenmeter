/**
 * Production-artifact regression guard for the TokenMeter sidebar.
 *
 * The mounted sidebar stopped repainting in production because the local
 * plugin entry could be compiled through Bun's ordinary eager JSX transform
 * when loaded from tui.json: `jsxDEV` props evaluated eagerly (no reactivity)
 * means the mounted panel never repaints on snapshot updates. The source TSX
 * tests cannot catch this — bunfig.toml preloads @opentui/solid/preload, so
 * source tests always run with the correct transform regardless of what the
 * production loading boundary does.
 *
 * This test inspects the COMPILED artifact (dist/tui.js) produced by
 * `bun run build`, not the source under the preload:
 *  - the artifact must carry the Solid transform's reactive bindings
 *    (effect/insert/insertNode from @opentui/solid) and no eager jsxDEV
 *    runtime usage;
 *  - importing the artifact must yield the TokenMeter plugin module
 *    (default export with the "tokenmeter" id and a `tui` function)
 *    without starting any interactive TUI;
 *  - dist/tui.js must exist and be the compiled artifact, not the source
 *    .tsx, so the reactive bundle is what actually ships;
 *  - the public surface is exactly dist/tui.js + dist/tui.d.ts — OpenCode
 *    resolves npm TUI plugins through `exports["./tui"]`, so the obsolete
 *    `dist/tokenmeter.js` and any `index.*` artifacts are a packaging bug
 *    (the package failed to load as opencode-tokenmeter-tui@1.0.0 for
 *    exactly that reason) and must never return.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const ARTIFACT_PATH = resolve(REPO_ROOT, "dist/tui.js")
const DECLARATION_PATH = resolve(REPO_ROOT, "dist/tui.d.ts")
const DIST_DIR = resolve(REPO_ROOT, "dist")

describe("production TokenMeter artifact (dist/tui.js)", () => {
  test("contains reactive OpenTUI bindings, not eager JSX", () => {
    const code = readFileSync(ARTIFACT_PATH, "utf8")

    // Solid transform output: runtime bindings imported from @opentui/solid
    // and invoked with accessors — the same shape the working
    // opencode-subagent-statusline dist ships.
    expect(code).toMatch(/effect as _\$effect/)
    expect(code).toMatch(/_\$effect\(/)
    expect(code).toMatch(/insert as _\$insert/)
    expect(code).toMatch(/_\$insert\(/)
    expect(code).toMatch(/insertNode as _\$insertNode/)
    expect(code).toMatch(/_\$insertNode\(/)

    // Eager JSX output would import @opentui/solid/jsx-runtime and call
    // jsxDEV with evaluated props — exactly the non-reactive shape that
    // broke production repainting. It must never ship again.
    expect(code).not.toMatch(/jsxDEV/)
    expect(code).not.toMatch(/jsx-runtime/)
  })

  test("exports the TokenMeter TUI plugin module without starting a TUI", async () => {
    // The path is runtime-computed, so TypeScript types this dynamic import
    // as `any` whether or not dist/ exists (a fresh checkout has no build).
    const mod = (await import(ARTIFACT_PATH)) as {
      default?: { id?: unknown; tui?: unknown }
    }
    expect(mod.default).toBeDefined()
    expect(mod.default?.id).toBe("tokenmeter")
    expect(typeof mod.default?.tui).toBe("function")
  })

  test("REGRESSION: the artifact loads bun:sqlite and can execute a real SQLite statement", async () => {
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    // The plugin-owned Project store imports bun:sqlite (a Bun builtin the
    // host cannot provide as an external package); the bundle must keep that
    // import and never inline or rewrite it.
    expect(code).toContain('import { Database } from "bun:sqlite"')
    expect(code).toContain("tokenmeter.sqlite")
    expect(code).toContain("INSERT OR IGNORE INTO tombstones")
    // The artifact module graph loads in the Bun runtime (its top-level
    // bun:sqlite import resolves), and the runtime executes real SQLite
    // statements — the same path the TUI host will take.
    const mod = (await import(ARTIFACT_PATH)) as { default?: unknown }
    expect(mod.default).toBeDefined()
    const { Database } = await import("bun:sqlite")
    const db = new Database(":memory:")
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY)")
    const run = db.query("INSERT OR IGNORE INTO t (id) VALUES (?)")
    expect(run.run("a").changes).toBe(1)
    expect(run.run("a").changes).toBe(0)
    db.close()
  })

  test("the artifact carries the task text, Subagents and no old tasklist glyph", () => {
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    expect(code).not.toContain("tasklist")
    expect(code).toContain("task")
    expect(code).toContain("Subagents")
  })

  test("the artifact ships the new U+E20F task and U+EE9C reasoning glyphs, and no old U+F0CA/U+F0AE/U+EB67 glyphs or generated sum", () => {
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    // Bun's printer normalizes braced source escapes to the short form
    // (e.g. \u{E20F} → \uE20F); the codepoints must match regardless.
    expect(code).toContain("\\uE20F")
    expect(code).toContain("\\uEE9C")
    expect(code).not.toContain("\\uF0CA")
    expect(code).not.toContain("\\uEB67")
    expect(code).not.toContain("\\uF0AE")
    expect(code).not.toMatch(/generated/)
  })

  test("the artifact targets the stable client API: no experimental session.list, no archived flag, no raw error leakage", () => {
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    // The production runtime failure was `api.client.experimental` being
    // undefined; the compiled artifact must never reference that path or
    // the undocumented archived flag again, and must carry the stable
    // user-facing error message.
    expect(code).not.toContain("experimental")
    expect(code).not.toContain("archived")
    expect(code).toContain("Unable to load project data")
  })

  test("dist/tui.js exists and is the compiled artifact, not the source .tsx", () => {
    // There is no tui.json in this repository; the published package ships
    // dist/tui.js. The artifact must be the compiled plugin module: the
    // Solid transform's reactive bindings only exist in compiled output —
    // the source .tsx never contains them.
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    expect(code).toMatch(/effect as _\$effect/)
    expect(code).toMatch(/insertNode as _\$insertNode/)
  })

  test("REGRESSION: dist ships exactly tui.js + tui.d.ts — the broken tokenmeter.js and index.* names must never return", () => {
    // The package failed to load as opencode-tokenmeter-tui@1.0.0 because it
    // shipped dist/tokenmeter.js with no exports map. The dist surface is
    // now contract: exactly the TUI entrypoint pair, nothing else.
    const entries = readdirSync(DIST_DIR)
      .filter((name) => name.endsWith(".js") || name.endsWith(".d.ts"))
      .sort()
    expect(entries).toEqual(["tui.d.ts", "tui.js"])
  })

  test("dist/tui.d.ts declares the real default export and is usable by TypeScript", () => {
    // The declaration is emitted from the source entry by the project's own
    // TypeScript during `bun run build`; it must describe the actual default
    // export ({ id, tui }) with the host's TuiPlugin type.
    const decl = readFileSync(DECLARATION_PATH, "utf8")
    expect(decl).toContain("export default plugin")
    expect(decl).toContain('from "@opencode-ai/plugin/tui"')
    expect(decl).toContain("id: string")
    expect(decl).toContain("tui: TuiPlugin")
  })
})

describe("package manifest identity", () => {
  test("ships the unscoped npm name and only the intended files", () => {
    // Both `opencode-tokenmeter` (E403 — too similar to `opencode-token-meter`)
    // and the scoped `@jonasotoaguilar/opencode-tokenmeter` were rejected, so
    // the package identity is the unscoped `opencode-tokenmeter-tui` while the
    // GitHub repository keeps its path. The tarball must report the package
    // name and ship only dist/.
    const manifest = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
    )
    expect(manifest.name).toBe("opencode-tokenmeter-tui")
    expect(manifest.files).toEqual(["dist"])
    expect(manifest.repository.url).toBe(
      "https://github.com/jonasotoaguilar/opencode-tokenmeter.git",
    )
    expect(manifest.publishConfig).toEqual({
      access: "public",
      provenance: true,
    })
  })

  test("REGRESSION: main/types/exports resolve the TUI entrypoint pair via the ./tui subpath", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
    )
    expect(manifest.main).toBe("./dist/tui.js")
    expect(manifest.types).toBe("./dist/tui.d.ts")
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/tui.d.ts", import: "./dist/tui.js" },
      "./tui": { types: "./dist/tui.d.ts", import: "./dist/tui.js" },
    })
    // A TUI-only package has no server/runtime entry: the exports map must
    // never reference index.* — the missing exports["."] or a null exports
    // map is exactly the defect that made 1.0.0 unloadable.
    expect(JSON.stringify(manifest.exports)).not.toMatch(/index\./)
  })

  test("REGRESSION: the packed tarball ships dist/tui.js + dist/tui.d.ts and never the obsolete names", () => {
    // Dry-run with --ignore-scripts: the tarball listing reflects the dist/
    // on disk (built by test:dist), not a re-build. This is the exact gate
    // a publisher runs before shipping — a stale dist/tokenmeter.js or an
    // accidental index.* would fail right here.
    const result = spawnSync(
      "bun",
      ["pm", "pack", "--dry-run", "--ignore-scripts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("dist/tui.js")
    expect(result.stdout).toContain("dist/tui.d.ts")
    expect(result.stdout).not.toContain("dist/tokenmeter.js")
    expect(result.stdout).not.toContain("dist/index.js")
    expect(result.stdout).not.toContain("dist/index.d.ts")
  })
})
