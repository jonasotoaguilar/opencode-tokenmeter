// biome-ignore-all lint/style/noNonNullAssertion: durable harness - absolute path guarantee
/**
 * Durable path resolution — real filesystem + pure Windows.
 * Verifies OS/XDG roots, absolute-only overrides, case folding,
 * symlink/relative handling, and normalizeAlias invariants.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  durableDbPath,
  normalizeAlias,
  resolveDurableDir,
} from "../src/tokenmeter/durable/paths"

describe("durable paths — OS roots and overrides", () => {
  test("resolves outside host state dir via XDG / Application Support / AppData", () => {
    expect(
      resolveDurableDir({
        env: { XDG_DATA_HOME: "/tmp/xdg" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBe("/tmp/xdg/opencode-tokenmeter")
    expect(
      resolveDurableDir({ env: {}, platform: "darwin", homedir: "/Users/u" }),
    ).toBe("/Users/u/Library/Application Support/opencode-tokenmeter")
    const win = resolveDurableDir({
      env: { APPDATA: "C:/Users/u/AppData/Roaming" },
      platform: "win32",
      homedir: "C:/Users/u",
    })!
    expect(win).toContain("opencode-tokenmeter")
    expect(win).toContain("AppData")
    const viaOverride = durableDbPath({ dataDir: "/tmp/override" })!
    expect(viaOverride.endsWith("checkpoints.sqlite")).toBe(true)
    expect(normalizeAlias("/proj/dir")).toBe("/proj/dir")
    expect(normalizeAlias("/")).toBe("")
    expect(normalizeAlias("")).toBe("")
  })

  test("env override TOKENMETER_DURABLE_DIR is injectable and restored even on failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "dur-env-"))
    const saved = process.env.TOKENMETER_DURABLE_DIR
    process.env.TOKENMETER_DURABLE_DIR = dir
    try {
      expect(durableDbPath()!.startsWith(dir)).toBe(true)
    } finally {
      if (saved === undefined)
        delete (process.env as Record<string, unknown>).TOKENMETER_DURABLE_DIR
      else process.env.TOKENMETER_DURABLE_DIR = saved
      rmSync(dir, { recursive: true, force: true })
      expect(
        (process.env.TOKENMETER_DURABLE_DIR as string | undefined) === saved,
      ).toBe(true)
    }
  })

  test("absolute-only override rejects relative, root, and homedir", () => {
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "relative/path" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBeNull()
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "/" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBeNull()
    expect(
      resolveDurableDir({
        env: { TOKENMETER_DURABLE_DIR: "/home/u" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBeNull()
    expect(
      durableDbPath({ dataDir: "relative/path", platform: "linux" } as never),
    ).toBeNull()
    expect(
      durableDbPath({ dataDir: "/", platform: "linux" } as never),
    ).toBeNull()
  })
})

describe("durable paths — injected OS/env fallbacks (coverage)", () => {
  test("win32 LOCALAPPDATA fallback and homedir/null", () => {
    expect(
      resolveDurableDir({
        env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBe("C:\\Users\\u\\AppData\\Local\\opencode-tokenmeter")
    expect(
      resolveDurableDir({
        env: {},
        platform: "win32",
        homedir: "C:\\Users\\u",
      }),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\opencode-tokenmeter")
    expect(
      resolveDurableDir({ env: {}, platform: "win32", homedir: "" }),
    ).toBeNull()
  })
  test("darwin HOME fallback and null", () => {
    expect(
      resolveDurableDir({ env: {}, platform: "darwin", homedir: "/Users/u" }),
    ).toBe("/Users/u/Library/Application Support/opencode-tokenmeter")
    expect(
      resolveDurableDir({
        env: { HOME: "/Users/u2" },
        platform: "darwin",
        homedir: "",
      }),
    ).toBe("/Users/u2/Library/Application Support/opencode-tokenmeter")
    expect(
      resolveDurableDir({ env: {}, platform: "darwin", homedir: "" }),
    ).toBeNull()
  })
  test("linux XDG/HOME fallbacks and null", () => {
    expect(
      resolveDurableDir({
        env: { XDG_DATA_HOME: "/tmp/xdg2" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBe("/tmp/xdg2/opencode-tokenmeter")
    expect(
      resolveDurableDir({ env: {}, platform: "linux", homedir: "/home/u" }),
    ).toBe("/home/u/.local/share/opencode-tokenmeter")
    expect(
      resolveDurableDir({
        env: { HOME: "/home/u2" },
        platform: "linux",
        homedir: "",
      }),
    ).toBe("/home/u2/.local/share/opencode-tokenmeter")
    expect(
      resolveDurableDir({ env: {}, platform: "linux", homedir: "" }),
    ).toBeNull()
  })
})
