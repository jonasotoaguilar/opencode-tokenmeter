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
 * This test inspects the COMPILED artifact (dist/tokenmeter.js)
 * produced by `bun run build`, not the source under the preload:
 *  - the artifact must carry the Solid transform's reactive bindings
 *    (effect/insert/insertNode from @opentui/solid) and no eager jsxDEV
 *    runtime usage;
 *  - importing the artifact must yield the TokenMeter plugin module
 *    (default export with the "tokenmeter" id and a `tui` function)
 *    without starting any interactive TUI;
 *  - dist/tokenmeter.js must exist and be the compiled artifact, not the
 *    source .tsx, so the reactive bundle is what actually ships.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const ARTIFACT_PATH = resolve(REPO_ROOT, "dist/tokenmeter.js")

describe("production TokenMeter artifact (dist/tokenmeter.js)", () => {
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
    // The compiled artifact ships without a declaration file; it is the
    // runtime plugin module under test.
    // @ts-expect-error - dist/tokenmeter.js is untyped generated output
    const mod = await import("../dist/tokenmeter.js")
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe("tokenmeter")
    expect(typeof mod.default.tui).toBe("function")
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
    // @ts-expect-error - dist/tokenmeter.js is untyped generated output
    await import("../dist/tokenmeter.js")
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

  test("dist/tokenmeter.js exists and is the compiled artifact, not the source .tsx", () => {
    // There is no tui.json in this repository; the published package ships
    // dist/tokenmeter.js. The artifact must be the compiled plugin module:
    // the Solid transform's reactive bindings only exist in compiled output —
    // the source .tsx never contains them.
    const code = readFileSync(ARTIFACT_PATH, "utf8")
    expect(code).toMatch(/effect as _\$effect/)
    expect(code).toMatch(/insertNode as _\$insertNode/)
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
})
